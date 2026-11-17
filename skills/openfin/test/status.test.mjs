import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from './helpers/cli.mjs';
import { makeSimRepo, freePort, startSim, DEFAULT_FIXTURES } from './helpers/sim.mjs';

test('status reports reachable:true for a running instance and leaves it running', async (t) => {
  const sim = await startSim(t);
  const repo = makeSimRepo({ debugPort: sim.debugPort });
  const { exitCode, json } = runCli(['status'], { cwd: repo });
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(json.reachable, true);
  assert.equal(json.debugPort, sim.debugPort);
  assert.equal(json.launchedBySkill, false);
  assert.equal(json.pageCount, DEFAULT_FIXTURES.length);
  assert.ok(sim.alive(), 'status must not close the instance');
  assert.equal(runCli(['status'], { cwd: repo }).json.reachable, true);
});

test('status reports launchedBySkill:true when the state file records a launch on this port', async (t) => {
  const sim = await startSim(t);
  const repo = makeSimRepo({
    debugPort: sim.debugPort,
    state: { version: 1, debugPort: sim.debugPort, app: { launchedBySkill: true, pid: sim.pid } },
  });
  const { exitCode, json } = runCli(['status'], { cwd: repo });
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(json.reachable, true);
  assert.equal(json.launchedBySkill, true);
  assert.equal(json.state.app.pid, sim.pid);
});

test('status ignores a recorded launch on a different port', async () => {
  const debugPort = await freePort();
  const repo = makeSimRepo({
    debugPort,
    state: { version: 1, debugPort: debugPort + 1, app: { launchedBySkill: true, pid: 1 } },
  });
  const { json } = runCli(['status'], { cwd: repo });
  assert.equal(json.reachable, false);
  assert.equal(json.launchedBySkill, false);
});

test('status after the app quits reports reachable:false', async (t) => {
  const sim = await startSim(t);
  const repo = makeSimRepo({ debugPort: sim.debugPort });
  assert.equal(runCli(['status'], { cwd: repo }).json.reachable, true);
  await sim.quit();
  const { exitCode, json } = runCli(['status'], { cwd: repo });
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(json.reachable, false);
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
