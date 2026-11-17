import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { runCli, runCliAsync } from './helpers/cli.mjs';
import { makeSimRepo, startSim } from './helpers/sim.mjs';
import { collectorPid, collectorPidsFor, isAlive, killCollectorAfter, waitForExit } from './helpers/collector.mjs';

const FIXTURES = [
  { id: 'main', uuid: 'sim-app', name: 'main', kind: 'window', title: 'Main' },
  { id: 'blotter', uuid: 'sim-app', name: 'blotter-view', kind: 'view', parent: 'main', title: 'Blotter' },
  {
    id: 'late',
    uuid: 'sim-app',
    name: 'late-view',
    kind: 'view',
    parent: 'main',
    title: 'Late',
    open: false,
    body: "<script>console.log('late view says hi'); setTimeout(() => { throw new Error('late boom'); });</script>",
  },
];

async function attachedSim(t, config = {}) {
  const sim = await startSim(t, { fixtures: FIXTURES });
  const repo = makeSimRepo({ debugPort: sim.debugPort, config });
  killCollectorAfter(t, repo);
  const { exitCode, json } = runCli(['status'], { cwd: repo });
  assert.equal(exitCode, 0, JSON.stringify(json));
  return { sim, repo };
}

/** Poll `logs` until `until(json)` holds. */
async function waitForLogs(repo, args, until, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = runCli(['logs', ...args], { cwd: repo });
    assert.equal(last.exitCode, 0, JSON.stringify(last.json));
    if (until(last.json)) return last.json;
    await sleep(100);
  }
  assert.fail(`logs never matched; last: ${JSON.stringify(last?.json)}`);
}

const hasText = (text) => (json) => json.entries.some((e) => e.text === text);

test('first attach starts a collector that records console messages from existing targets', async (t) => {
  const { sim, repo } = await attachedSim(t);
  await sim.evaluate('main', () => console.warn('careful from main'));

  const json = await waitForLogs(repo, [], hasText('careful from main'));
  const entry = json.entries.find((e) => e.text === 'careful from main');
  assert.equal(entry.target, 'sim-app/main');
  assert.equal(entry.level, 'warn');
  assert.ok(!Number.isNaN(Date.parse(entry.ts)), `ts should be an ISO time: ${entry.ts}`);
  assert.match(json.logFile, /[\\/]\.scratch[\\/]openfin[\\/]logs[\\/][^\\/]+\.jsonl$/);
});

test('the collector records uncaught errors as level error', async (t) => {
  const { sim, repo } = await attachedSim(t);
  await sim.evaluate('blotter', () => setTimeout(() => { throw new Error('blotter exploded'); }));

  const json = await waitForLogs(repo, [], (j) => j.entries.some((e) => e.type === 'pageerror'));
  const entry = json.entries.find((e) => e.type === 'pageerror');
  assert.equal(entry.target, 'sim-app/blotter-view');
  assert.equal(entry.level, 'error');
  assert.match(entry.text, /blotter exploded/);
});

test('the collector picks up a view opened after it started, including its startup output', async (t) => {
  const { sim, repo } = await attachedSim(t);
  await sim.openPage('late');

  const boomed = (j) => j.entries.some((e) => /late boom/.test(e.text));
  const json = await waitForLogs(repo, [], (j) => hasText('late view says hi')(j) && boomed(j));
  const said = json.entries.find((e) => e.text === 'late view says hi');
  assert.equal(said.target, 'sim-app/late-view');
  assert.equal(said.level, 'log');
  const boom = json.entries.find((e) => /late boom/.test(e.text));
  assert.equal(boom.target, 'sim-app/late-view');
  assert.equal(boom.level, 'error');
});

test('logs filters by target (uuid/name, short name, or config alias), minimum level, and limit', async (t) => {
  const { sim, repo } = await attachedSim(t, { windows: [{ name: 'shell', identity: 'sim-app/main' }] });
  await sim.evaluate('main', () => {
    console.debug('main debug');
    console.log('main log 1');
    console.log('main log 2');
    console.error('main error');
  });
  await sim.evaluate('blotter', () => console.warn('blotter warn'));
  await waitForLogs(repo, [], (j) => hasText('main error')(j) && hasText('blotter warn')(j));
  const texts = (args) => runCli(['logs', ...args], { cwd: repo }).json.entries.map((e) => e.text);

  assert.deepEqual(texts(['--target', 'sim-app/main']), ['main debug', 'main log 1', 'main log 2', 'main error']);
  assert.deepEqual(texts(['--target', 'shell', '--level', 'log']), ['main log 1', 'main log 2', 'main error']);
  assert.deepEqual(texts(['--target', 'blotter-view']), ['blotter warn']);
  assert.deepEqual(texts(['--level', 'warn']), ['main error', 'blotter warn']);
  assert.deepEqual(texts(['--level', 'error']), ['main error']);
  assert.deepEqual(texts(['--target', 'sim-app/main', '--limit', '2']), ['main log 2', 'main error']);

  const bad = runCli(['logs', '--level', 'loud'], { cwd: repo });
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.json.error.code, 'INVALID_ARGS');
});

test('logs points at the runtime debug.log in the configured logsDir', async (t) => {
  const { repo } = await attachedSim(t, { logsDir: 'C:\\Users\\dev\\AppData\\Local\\OpenFin' });
  const { json } = runCli(['logs'], { cwd: repo });
  assert.equal(json.runtimeDebugLog, 'C:\\Users\\dev\\AppData\\Local\\OpenFin\\debug.log');
});

test('starting the collector is idempotent: later attaches reuse the live one', async (t) => {
  const { repo } = await attachedSim(t);
  const pid = collectorPid(repo);
  assert.ok(isAlive(pid), 'first attach should leave a running collector');
  runCli(['list-targets'], { cwd: repo });
  runCli(['status'], { cwd: repo });
  assert.equal(collectorPid(repo), pid);
  assert.equal(runCli(['logs'], { cwd: repo }).json.collector.running, true);
});

test('concurrent first attaches start exactly one collector', async (t) => {
  const sim = await startSim(t, { fixtures: FIXTURES });
  const repo = makeSimRepo({ debugPort: sim.debugPort });
  killCollectorAfter(t, repo);

  const results = await Promise.all([1, 2, 3, 4].map(() => runCliAsync(['list-targets'], { cwd: repo })));
  for (const r of results) assert.equal(r.exitCode, 0, JSON.stringify(r.json));
  assert.deepEqual(collectorPidsFor(repo), [collectorPid(repo)], 'one collector, and it is the one the state names');
});

test('the collector exits on its own when the runtime goes away', async (t) => {
  const { sim, repo } = await attachedSim(t);
  const pid = collectorPid(repo);
  assert.ok(isAlive(pid));
  await sim.stop();
  assert.ok(await waitForExit(pid), 'collector should exit after the runtime disconnects');
  assert.equal(runCli(['logs'], { cwd: repo }).json.collector.running, false);
});
