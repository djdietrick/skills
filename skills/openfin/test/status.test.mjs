import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from './helpers/cli.mjs';
import { makeSimRepo, freePort, startSim, DEFAULT_FIXTURES, fakeOpenFinProcesses } from './helpers/sim.mjs';
import { killCollectorAfter } from './helpers/collector.mjs';

test('status reports reachable:true for a running instance and leaves it running', async (t) => {
  const sim = await startSim(t);
  const repo = makeSimRepo({ debugPort: sim.debugPort });
  killCollectorAfter(t, repo);
  const { exitCode, json } = runCli(['status'], { cwd: repo });
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(json.reachable, true);
  assert.equal(json.debugPort, sim.debugPort);
  assert.equal(json.launchedBySkill, false);
  assert.equal(json.pageCount, DEFAULT_FIXTURES.length);
  assert.ok(sim.alive(), 'status must not close the instance');
  assert.equal(runCli(['status'], { cwd: repo }).json.reachable, true);
});

/** The browser GUID the instance on `port` reports, as `launch` records it. */
async function browserIdOf(port) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  return v.webSocketDebuggerUrl.split('/devtools/browser/')[1];
}

test('status reports launchedBySkill:true when the state file records a launch of this very instance', async (t) => {
  const sim = await startSim(t);
  const repo = makeSimRepo({
    debugPort: sim.debugPort,
    state: { version: 1, debugPort: sim.debugPort, app: { browserId: await browserIdOf(sim.debugPort), pid: sim.pid } },
  });
  killCollectorAfter(t, repo);
  const { exitCode, json } = runCli(['status'], { cwd: repo });
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(json.reachable, true);
  assert.equal(json.launchedBySkill, true);
  assert.equal(json.state.app.pid, sim.pid);
});

test('status reports launchedBySkill:false when a different instance answers on the recorded port', async (t) => {
  const sim = await startSim(t);
  const repo = makeSimRepo({
    debugPort: sim.debugPort,
    state: { version: 1, debugPort: sim.debugPort, app: { browserId: 'an-earlier-instance', pid: sim.pid } },
  });
  killCollectorAfter(t, repo);
  const { json } = runCli(['status'], { cwd: repo });
  assert.equal(json.reachable, true);
  assert.equal(json.launchedBySkill, false);
});

test('status ignores a recorded launch on a different port', async () => {
  const debugPort = await freePort();
  const repo = makeSimRepo({
    debugPort,
    state: { version: 1, debugPort: debugPort + 1, app: { browserId: 'x', pid: 1 } },
  });
  const { json } = runCli(['status'], { cwd: repo });
  assert.equal(json.reachable, false);
  assert.equal(json.launchedBySkill, false);
});

test('status after the app quits reports reachable:false', async (t) => {
  const sim = await startSim(t);
  const repo = makeSimRepo({ debugPort: sim.debugPort });
  killCollectorAfter(t, repo);
  assert.equal(runCli(['status'], { cwd: repo }).json.reachable, true);
  await sim.quit();
  const { exitCode, json } = runCli(['status'], { cwd: repo });
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(json.reachable, false);
});

test('status warns INSTANCE_WITHOUT_DEBUG_PORT only for OpenFin processes running this app\'s manifest', async () => {
  const debugPort = await freePort();
  const repo = makeSimRepo({ debugPort });
  const other = { name: 'OpenFin.exe', pid: 4001, commandLine: 'OpenFin.exe --config=https://example.com/other-app/app.json' };
  const ours = { name: 'OpenFinRVM.exe', pid: 4002, commandLine: 'OpenFinRVM.exe --config=HTTP://127.0.0.1/sim/manifest.json' };

  const unrelated = runCli(['status'], { cwd: repo, env: fakeOpenFinProcesses(repo, [other]) });
  assert.equal(unrelated.json.reachable, false);
  assert.equal(unrelated.json.warning, undefined, 'another OpenFin app must not trigger the warning');

  const { exitCode, json } = runCli(['status'], { cwd: repo, env: fakeOpenFinProcesses(repo, [other, ours]) });
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(json.reachable, false);
  assert.equal(json.warning?.code, 'INSTANCE_WITHOUT_DEBUG_PORT', JSON.stringify(json));
  assert.deepEqual(json.warning.processes.map((p) => p.pid), [4002]);
});

test('status reports reachable:false (not an error) when nothing listens on the debug port', async () => {
  const debugPort = await freePort();
  const repo = makeSimRepo({ debugPort });
  const { exitCode, json } = runCli(['status'], { cwd: repo });
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(json.ok, true);
  assert.equal(json.reachable, false);
  assert.equal(json.debugPort, debugPort);
  assert.equal(json.launchedBySkill, false);
});
