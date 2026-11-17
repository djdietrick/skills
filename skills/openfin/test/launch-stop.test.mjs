// launch / stop ownership on the simulated backend. `launch` uses the config's
// `launcher` override (the sim backend stands in for the RVM); dev servers are
// small node stand-ins. Every test kills what it spawned, by process group,
// whatever the CLI did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli } from './helpers/cli.mjs';
import { makeSimRepo, startSim, freePort, SIM_BACKEND } from './helpers/sim.mjs';
import { collectorPid, isAlive, killCollectorAfter, waitForExit } from './helpers/collector.mjs';

const FIXTURES = [
  { id: 'home', uuid: 'openfin-workspace', name: 'openfin-home', kind: 'window', title: 'Home' },
  { id: 'main', uuid: 'sim-app', name: 'main', kind: 'window', title: 'Main' },
];

const q = (s) => JSON.stringify(s);
const node = q(process.execPath);

function readStateFile(repo) {
  try {
    return JSON.parse(readFileSync(join(repo, '.scratch', 'openfin', 'state.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** Kill a process group (falls back to the pid) and wait for the leader to exit. */
async function killGroup(pid) {
  if (!isAlive(pid)) return;
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // not a group leader / already gone
    }
  }
  await waitForExit(pid);
}

/** After the test, kill whatever the state says this skill started, plus any extra pids. */
function cleanupAfter(t, repo, extraPids = () => []) {
  killCollectorAfter(t, repo);
  t.after(async () => {
    const s = readStateFile(repo);
    for (const pid of [s.app?.pid, s.devServer?.pid, ...extraPids()]) if (pid) await killGroup(pid);
  });
}

/** A repo whose launcher runs the sim backend on a free port. */
async function launchableRepo(config = {}) {
  const debugPort = await freePort();
  const repo = makeSimRepo({ debugPort });
  const fixturesFile = join(repo, 'sim-fixtures.json');
  writeFileSync(fixturesFile, JSON.stringify(FIXTURES));
  const launcher = { command: `${node} ${q(SIM_BACKEND)} --debug-port {debugPort} --fixtures ${q(fixturesFile)}` };
  writeConfig(repo, { manifest: 'http://127.0.0.1/sim/manifest.json', debugPort, launcher, ...config });
  return { repo, debugPort };
}

function writeConfig(repo, block) {
  writeFileSync(
    join(repo, 'docs', 'agents', 'openfin.md'),
    '# config\n\n```json openfin-config\n' + JSON.stringify(block, null, 2) + '\n```\n',
  );
}

async function reachable(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

test('launch starts the app through the launcher, then stop quits it and the collector', async (t) => {
  const { repo, debugPort } = await launchableRepo();
  cleanupAfter(t, repo);

  const launched = runCli(['launch'], { cwd: repo });
  assert.equal(launched.exitCode, 0, JSON.stringify(launched.json));
  assert.equal(launched.json.launched, true);
  assert.equal(launched.json.attached, false);
  assert.ok(await reachable(debugPort), 'debug port should answer after launch returns');
  const appPid = readStateFile(repo).app?.pid;
  assert.ok(isAlive(appPid), 'state should record the launched app pid');

  const status = runCli(['status'], { cwd: repo });
  assert.equal(status.json.launchedBySkill, true);
  const collector = collectorPid(repo);
  assert.ok(isAlive(collector), 'launch should start the log collector');

  const stopped = runCli(['stop'], { cwd: repo });
  assert.equal(stopped.exitCode, 0, JSON.stringify(stopped.json));
  assert.deepEqual(stopped.json.stopped.map((s) => s.what).sort(), ['app', 'collector']);
  assert.deepEqual(stopped.json.leftRunning, []);
  assert.ok(await waitForExit(appPid), 'the launched app should have quit');
  assert.ok(await waitForExit(collector), 'the collector should have stopped');
  assert.equal(await reachable(debugPort), false);
  assert.equal(runCli(['status'], { cwd: repo }).json.launchedBySkill, false);
});

test('stop after attaching to an externally started app leaves it running and says so', async (t) => {
  const sim = await startSim(t, { fixtures: FIXTURES });
  const repo = makeSimRepo({ debugPort: sim.debugPort });
  cleanupAfter(t, repo);

  const launched = runCli(['launch'], { cwd: repo });
  assert.equal(launched.exitCode, 0, JSON.stringify(launched.json));
  assert.equal(launched.json.attached, true);
  assert.equal(launched.json.launched, false);
  const collector = collectorPid(repo);
  assert.ok(isAlive(collector), 'attaching should start the log collector');

  const stopped = runCli(['stop'], { cwd: repo });
  assert.equal(stopped.exitCode, 0, JSON.stringify(stopped.json));
  assert.deepEqual(stopped.json.stopped.map((s) => s.what), ['collector']);
  assert.deepEqual(stopped.json.leftRunning.map((s) => s.what), ['app']);
  assert.match(stopped.json.leftRunning[0].reason, /not launched by this skill/);
  assert.ok(await waitForExit(collector));
  assert.ok(sim.alive(), 'an attached app must survive stop');
  assert.ok(await reachable(sim.debugPort));
});

test('a launcher that fails surfaces its error output as LAUNCH_FAILED', async (t) => {
  const { repo } = await launchableRepo({
    launcher: { command: `${node} -e ${q("console.error('runtime exploded: bad manifest'); process.exit(3)")}` },
  });
  cleanupAfter(t, repo);

  const { exitCode, json } = runCli(['launch'], { cwd: repo });
  assert.notEqual(exitCode, 0);
  assert.equal(json.error.code, 'LAUNCH_FAILED');
  assert.match(json.error.runtimeOutput, /runtime exploded: bad manifest/);
  assert.equal(readStateFile(repo).app ?? null, null, 'a failed launch must not claim an app');
});

// Dev-server stand-in: serves 'ok' on the given port, then prints its ready line.
const DEV_SERVER =
  "require('node:http').createServer((q, r) => r.end('ok'))" +
  ".listen(Number(process.argv[1]), '127.0.0.1', () => console.log('dev server ready'))";

test('launch starts the dev server first and waits for its ready signal; stop stops it', async (t) => {
  const devPort = await freePort();
  const { repo } = await launchableRepo({
    devServer: { command: `${node} -e ${q(DEV_SERVER)} ${devPort}`, readySignal: 'dev server ready' },
  });
  cleanupAfter(t, repo);

  const launched = runCli(['launch'], { cwd: repo });
  assert.equal(launched.exitCode, 0, JSON.stringify(launched.json));
  const devPid = readStateFile(repo).devServer?.pid;
  assert.ok(isAlive(devPid), 'state should record the dev server pid');
  assert.equal(await (await fetch(`http://127.0.0.1:${devPort}/`)).text(), 'ok');

  const stopped = runCli(['stop'], { cwd: repo });
  assert.equal(stopped.exitCode, 0, JSON.stringify(stopped.json));
  assert.deepEqual(stopped.json.stopped.map((s) => s.what).sort(), ['app', 'collector', 'devServer']);
  assert.ok(await waitForExit(devPid), 'the dev server should have stopped');
  await assert.rejects(fetch(`http://127.0.0.1:${devPort}/`, { signal: AbortSignal.timeout(1000) }));
});

test('launch waits for a readyUrl, and a dev server that dies early fails with its output', async (t) => {
  const devPort = await freePort();
  const { repo } = await launchableRepo({
    devServer: {
      command: `${node} -e ${q("console.error('EADDRINUSE: dev server could not start'); process.exit(1)")}`,
      readyUrl: `http://127.0.0.1:${devPort}/`,
    },
  });
  cleanupAfter(t, repo);

  const { exitCode, json } = runCli(['launch'], { cwd: repo });
  assert.notEqual(exitCode, 0);
  assert.equal(json.error.code, 'LAUNCH_FAILED');
  assert.match(json.error.devServerOutput, /EADDRINUSE: dev server could not start/);
  assert.equal(readStateFile(repo).app ?? null, null);
});

test('a dev server the skill did not start is left running by stop', async (t) => {
  const devPort = await freePort();
  const { spawn } = await import('node:child_process');
  const external = spawn(process.execPath, ['-e', DEV_SERVER, String(devPort)], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => killGroup(external.pid));
  await new Promise((r) => external.stdout.once('data', r));

  const readyUrl = `http://127.0.0.1:${devPort}/`;
  const { repo } = await launchableRepo({
    devServer: { command: `${node} -e ${q("console.error('should not run'); process.exit(1)")}`, readyUrl },
  });
  cleanupAfter(t, repo);

  const launched = runCli(['launch'], { cwd: repo });
  assert.equal(launched.exitCode, 0, JSON.stringify(launched.json));
  assert.equal(readStateFile(repo).devServer ?? null, null, 'an already-running dev server is not ours');

  const stopped = runCli(['stop'], { cwd: repo });
  assert.deepEqual(stopped.json.stopped.map((s) => s.what).sort(), ['app', 'collector']);
  assert.deepEqual(stopped.json.leftRunning.map((s) => s.what), ['devServer']);
  assert.ok(isAlive(external.pid));
});

test('when the app fails to launch, the dev server launch started is stopped again', async (t) => {
  const devPort = await freePort();
  const { repo } = await launchableRepo({
    devServer: { command: `${node} -e ${q(DEV_SERVER)} ${devPort}`, readySignal: 'dev server ready' },
    launcher: { command: `${node} -e ${q("console.error('no runtime'); process.exit(2)")}` },
  });
  cleanupAfter(t, repo);

  const { json } = runCli(['launch'], { cwd: repo });
  assert.equal(json.error?.code, 'LAUNCH_FAILED', JSON.stringify(json));
  assert.match(json.error.runtimeOutput, /no runtime/);
  assert.equal(readStateFile(repo).devServer ?? null, null);
  await assert.rejects(fetch(`http://127.0.0.1:${devPort}/`, { signal: AbortSignal.timeout(1000) }));
});
