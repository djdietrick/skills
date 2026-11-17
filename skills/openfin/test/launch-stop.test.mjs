// launch / stop ownership on the simulated backend. `launch` uses the config's
// `launcher` override (the sim backend stands in for the RVM); dev servers are
// small node stand-ins. Every test kills what it spawned, by process group,
// whatever the CLI did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './helpers/cli.mjs';
import { makeSimRepo, startSim, freePort, SIM_BACKEND, fakeOpenFinProcesses } from './helpers/sim.mjs';
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
async function launchableRepo({ fixtures = FIXTURES, ...config } = {}) {
  const debugPort = await freePort();
  const repo = makeSimRepo({ debugPort });
  const fixturesFile = join(repo, 'sim-fixtures.json');
  writeFileSync(fixturesFile, JSON.stringify(fixtures));
  const simCommand = `${node} ${q(SIM_BACKEND)} --debug-port {debugPort} --fixtures ${q(fixturesFile)}`;
  // `launcher` may be a function of the sim command (to wrap it).
  const launcher =
    typeof config.launcher === 'function' ? { command: config.launcher(simCommand) } : (config.launcher ?? { command: simCommand });
  writeConfig(repo, { manifest: 'http://127.0.0.1/sim/manifest.json', debugPort, ...config, launcher });
  return { repo, debugPort };
}

/**
 * An RVM stand-in: starts `simCommand` as a child and stays alive after the
 * runtime exits, like the RVM. Its own pid is written to a file.
 */
function rvmLikeLauncher(simCommand) {
  const dir = mkdtempSync(join(tmpdir(), 'openfin-rvm-'));
  const pidFile = join(dir, 'pid');
  const script = join(dir, 'rvm.cjs');
  writeFileSync(
    script,
    `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
      `require('node:child_process').spawn(process.argv[2], { shell: true, stdio: 'inherit' });\n` +
      `setInterval(() => {}, 1000);\n`,
  );
  return {
    command: `${node} ${q(script)} ${q(simCommand)}`,
    pid: () => {
      try {
        return Number(readFileSync(pidFile, 'utf8'));
      } catch {
        return undefined;
      }
    },
  };
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

/** A stand-in that records its pid in a fresh file, then idles: never opens a port, never prints a ready line. */
function hangingProcess() {
  const pidFile = join(mkdtempSync(join(tmpdir(), 'openfin-pid-')), 'pid');
  const script = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`;
  return {
    command: `${node} -e ${q(script)}`,
    pid: () => {
      try {
        return Number(readFileSync(pidFile, 'utf8'));
      } catch {
        return undefined;
      }
    },
  };
}

test('a launcher that stays alive but never opens the debug port is killed when launch times out', { timeout: 30_000 }, async (t) => {
  const launcher = hangingProcess();
  const { repo } = await launchableRepo({ launcher: { command: launcher.command } });
  cleanupAfter(t, repo, () => [launcher.pid()]);

  const { exitCode, json } = runCli(['launch', '--timeout', '1500'], { cwd: repo });
  assert.notEqual(exitCode, 0);
  assert.equal(json.error.code, 'LAUNCH_FAILED', JSON.stringify(json));
  assert.match(json.error.message, /1\.5s/);
  assert.ok(launcher.pid(), 'the launcher should have started');
  assert.ok(await waitForExit(launcher.pid()), 'the launcher this launch started must be killed on failure');
  assert.equal(readStateFile(repo).app ?? null, null);
});

test('a dev server that never becomes ready is killed when launch times out', { timeout: 30_000 }, async (t) => {
  const devServer = hangingProcess();
  const { repo } = await launchableRepo({
    devServer: { command: devServer.command, readyUrl: `http://127.0.0.1:${await freePort()}/` },
  });
  cleanupAfter(t, repo, () => [devServer.pid()]);

  const { exitCode, json } = runCli(['launch', '--timeout', '1500'], { cwd: repo });
  assert.notEqual(exitCode, 0);
  assert.equal(json.error.code, 'LAUNCH_FAILED', JSON.stringify(json));
  assert.ok(devServer.pid(), 'the dev server should have started');
  assert.ok(await waitForExit(devServer.pid()), 'the dev server this launch started must be killed on failure');
  assert.equal(readStateFile(repo).devServer ?? null, null);
});

test('launch rejects a malformed --timeout', async (t) => {
  const { repo } = await launchableRepo();
  cleanupAfter(t, repo);
  const { exitCode, json } = runCli(['launch', '--timeout', 'soon'], { cwd: repo });
  assert.notEqual(exitCode, 0);
  assert.equal(json.error.code, 'INVALID_ARGS');
});

test('launch refuses with INSTANCE_WITHOUT_DEBUG_PORT when this app runs without the debug port', async (t) => {
  const launcher = hangingProcess();
  const { repo } = await launchableRepo({ launcher: { command: launcher.command } });
  cleanupAfter(t, repo, () => [launcher.pid()]);
  const env = fakeOpenFinProcesses(repo, [
    { name: 'OpenFinRVM.exe', pid: 4002, commandLine: 'OpenFinRVM.exe --config=http://127.0.0.1/sim/manifest.json' },
  ]);

  const { exitCode, json } = runCli(['launch', '--timeout', '1000'], { cwd: repo, env });
  assert.notEqual(exitCode, 0);
  assert.equal(json.error.code, 'INSTANCE_WITHOUT_DEBUG_PORT', JSON.stringify(json));
  assert.match(json.error.hint, /--remote-debugging-port=/);
  assert.equal(launcher.pid(), undefined, 'nothing is launched');
});

test('launch is not blocked by another OpenFin app running without the debug port', async (t) => {
  const { repo } = await launchableRepo();
  cleanupAfter(t, repo);
  const env = fakeOpenFinProcesses(repo, [
    { name: 'OpenFin.exe', pid: 4001, commandLine: 'OpenFin.exe --config=https://example.com/other-app/app.json' },
  ]);
  const { exitCode, json } = runCli(['launch'], { cwd: repo, env });
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(json.launched, true);
});

async function waitForPortClosed(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (await reachable(port)) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

test('an instance the developer started on the port after the launched one exited is not ours to stop', async (t) => {
  const { repo, debugPort } = await launchableRepo();
  cleanupAfter(t, repo);
  assert.equal(runCli(['launch'], { cwd: repo }).json.launched, true);

  // The launched app goes away outside the skill; the developer starts their own on the same port.
  await killGroup(readStateFile(repo).app.pid);
  assert.ok(await waitForPortClosed(debugPort));
  const theirs = await startSim(t, { fixtures: FIXTURES, debugPort });

  assert.equal(runCli(['status'], { cwd: repo }).json.launchedBySkill, false);
  const stopped = runCli(['stop'], { cwd: repo });
  assert.equal(stopped.exitCode, 0, JSON.stringify(stopped.json));
  assert.ok(!stopped.json.stopped.some((s) => s.what === 'app'), JSON.stringify(stopped.json));
  assert.deepEqual(stopped.json.leftRunning.map((s) => s.what), ['app']);
  assert.match(stopped.json.leftRunning[0].reason, /not launched by this skill/);
  assert.ok(theirs.alive(), "the developer's instance must survive stop");
  assert.ok(await reachable(debugPort));
  assert.equal(readStateFile(repo).app ?? null, null, 'the stale launch record is cleared');
});

test('stop quits the app gracefully and never kills the launcher (RVM) process tree', async (t) => {
  let rvm;
  const { repo, debugPort } = await launchableRepo({ launcher: (simCommand) => (rvm = rvmLikeLauncher(simCommand)).command });
  cleanupAfter(t, repo, () => [rvm.pid()]);

  const launched = runCli(['launch'], { cwd: repo });
  assert.equal(launched.exitCode, 0, JSON.stringify(launched.json));
  const stopped = runCli(['stop'], { cwd: repo });
  assert.equal(stopped.exitCode, 0, JSON.stringify(stopped.json));
  assert.deepEqual(stopped.json.stopped.map((s) => s.what).sort(), ['app', 'collector']);
  assert.equal(await reachable(debugPort), false, 'the app quit');
  assert.ok(isAlive(rvm.pid()), 'the RVM stand-in must not be killed by stop');
});

test('when quit() does not close the app, stop leaves it running with a hint instead of killing it', async (t) => {
  const ignoresQuit = FIXTURES.map((f) =>
    f.id === 'main'
      ? { ...f, body: '<script>fin.Application.getCurrentSync = () => ({ quit: async () => {} });</script>' }
      : f,
  );
  const { repo, debugPort } = await launchableRepo({ fixtures: ignoresQuit });
  cleanupAfter(t, repo);
  assert.equal(runCli(['launch'], { cwd: repo }).json.launched, true);
  const appPid = readStateFile(repo).app.pid;

  const stopped = runCli(['stop', '--timeout', '1000'], { cwd: repo });
  assert.equal(stopped.exitCode, 0, JSON.stringify(stopped.json));
  assert.deepEqual(stopped.json.stopped.map((s) => s.what), ['collector']);
  const [app] = stopped.json.leftRunning;
  assert.equal(app?.what, 'app', JSON.stringify(stopped.json));
  assert.match(app.hint, /debug\.log/);
  assert.ok(isAlive(appPid), 'the app must not be force-killed');
  assert.ok(await reachable(debugPort));
  assert.equal(readStateFile(repo).app?.pid, appPid, 'still ours: a later stop can retry');
});

test('stop reports a dev server launch started that has since exited, without killing anything', async (t) => {
  const devPort = await freePort();
  const { repo } = await launchableRepo({
    devServer: { command: `${node} -e ${q(DEV_SERVER)} ${devPort}`, readySignal: 'dev server ready' },
  });
  cleanupAfter(t, repo);
  assert.equal(runCli(['launch'], { cwd: repo }).exitCode, 0);
  const devPid = readStateFile(repo).devServer.pid;
  await killGroup(devPid);

  const stopped = runCli(['stop'], { cwd: repo });
  const dev = stopped.json.stopped.find((s) => s.what === 'devServer');
  assert.equal(dev?.alreadyExited, true, JSON.stringify(stopped.json));
  assert.equal(readStateFile(repo).devServer ?? null, null);
});
