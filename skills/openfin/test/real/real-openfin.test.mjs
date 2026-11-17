// Real-OpenFin backend (opt-in, manual, Windows). The same CLI-level checks as
// the simulated suite, against a real OpenFin app: RVM launch, the dev-server
// lifecycle, real views as CDP targets, graceful quit, and the runtime
// debug.log path. Skipped unless OPENFIN_REAL=1 on Windows; see REAL-OPENFIN.md.
//
// Tests run in order and share one launched app. The app must NOT be running
// when the suite starts: `launch` has to own it so `stop` may quit it.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { runCli as runCliRaw } from '../helpers/cli.mjs';
import { isAlive } from '../helpers/collector.mjs';
import { realOpenFinGate } from './gate.mjs';

const gate = realOpenFinGate();

if (gate.error) {
  test('real-OpenFin suite configuration', () => assert.fail(gate.error));
}

describe('real OpenFin (opt-in, Windows)', { skip: gate.skip ?? (gate.error ? 'misconfigured' : false) }, () => {
  const cli = (...args) => runCliRaw([...args, '--config', gate.configPath], { cwd: gate.repoRoot });
  const ok = ({ exitCode, json }, what) => {
    assert.equal(exitCode, 0, `${what} failed: ${JSON.stringify(json)}`);
    assert.equal(json.ok, true);
    return json;
  };
  let launched = false;
  let launch;
  let targets = [];

  // Safety net: if a test failed mid-way, quit what launch started (stop never
  // touches anything it didn't launch).
  after(() => {
    if (launched) cli('stop');
  });

  test('doctor is ready (config valid, playwright-core resolvable)', () => {
    const json = ok(cli('doctor'), 'doctor');
    assert.equal(json.ready, true, JSON.stringify(json.checks));
  });

  test('the app is not already running (launch must own it)', () => {
    const json = ok(cli('status'), 'status');
    assert.equal(
      json.reachable,
      false,
      `Something already answers on debug port ${json.debugPort}. Quit the sample app (and its dev server) first.`,
    );
  });

  test('launch starts the dev server and the app through the RVM', () => {
    launch = ok(cli('launch'), 'launch');
    launched = launch.launched === true;
    assert.equal(launch.launched, true);
    assert.equal(launch.attached, false);
    assert.ok(launch.app?.pid, 'launch reports the RVM pid');
    assert.match(launch.app.command, /OpenFinRVM\.exe/i, 'real launch goes through the RVM, not a launcher override');
    assert.match(launch.app.command, /--remote-debugging-port=/);
    if (launch.devServer) {
      assert.ok(launch.devServer.pid || launch.devServer.alreadyRunning, JSON.stringify(launch.devServer));
    }
    assert.equal(launch.collector?.running, true, JSON.stringify(launch.collector));
  });

  test('status reports the app reachable and launched by the skill', () => {
    const json = ok(cli('status'), 'status');
    assert.equal(json.reachable, true);
    assert.equal(json.launchedBySkill, true);
  });

  test('list-targets shows real windows and views with OpenFin identity', (t) => {
    const json = ok(cli('list-targets'), 'list-targets');
    targets = json.targets;
    t.diagnostic(`targets: ${JSON.stringify(targets.map(({ target, kind, parent, workspace }) => ({ target, kind, parent, workspace })))}`);
    const windows = targets.filter((x) => x.kind === 'window');
    const views = targets.filter((x) => x.kind === 'view');
    assert.ok(windows.length >= 1, 'at least one OpenFin window');
    // Unverified item: is each view its own CDP page target?
    assert.ok(views.length >= 1, 'at least one view listed as its own target');
    for (const v of views) assert.ok(v.parent, `view ${v.target} names its parent window`);
    for (const x of [...windows, ...views]) assert.match(x.target, /^[^/]+\/.+/, 'targets are uuid/name');
  });

  test('text and screenshot work on a real view', (t) => {
    const view = targets.find((x) => x.kind === 'view') ?? targets.find((x) => x.kind === 'window');
    assert.ok(view, 'a target to inspect');
    const text = ok(cli('text', view.target), 'text');
    assert.equal(typeof text.text, 'string');
    const shot = ok(cli('screenshot', view.target), 'screenshot');
    assert.ok(existsSync(shot.path) && statSync(shot.path).size > 0, `screenshot written: ${shot.path}`);
    // Unverified item: does a view screenshot include the window frame? Look at it.
    t.diagnostic(`view screenshot (check whether it includes the window frame): ${shot.path}`);
  });

  test('eval reaches the fin API in a real window', () => {
    const win = targets.find((x) => x.kind === 'window' && x.workspace == null) ?? targets.find((x) => x.kind === 'window');
    const json = ok(cli('eval', win.target, 'fin.me.identity'), 'eval');
    assert.equal(`${json.result.uuid}/${json.result.name}`, win.target);
  });

  test('logs returns the collector log and an existing runtime debug.log path', () => {
    const json = ok(cli('logs', '--limit', '5'), 'logs');
    assert.equal(json.collector.running, true);
    assert.ok(json.runtimeDebugLog, 'logs reports the runtime debug.log path');
    assert.ok(existsSync(json.runtimeDebugLog), `runtime debug.log exists at ${json.runtimeDebugLog}`);
  });

  test('stop quits the app gracefully and stops what launch started', async () => {
    const json = ok(cli('stop'), 'stop');
    const app = json.stopped.find((s) => s.what === 'app');
    assert.ok(app, `app stopped; leftRunning: ${JSON.stringify(json.leftRunning)}`);
    assert.ok(app.quitVia, 'app quit through fin.Application quit(), not a kill');
    assert.ok(json.stopped.some((s) => s.what === 'collector'));
    if (launch?.devServer?.pid) assert.ok(json.stopped.some((s) => s.what === 'devServer'));
    assert.deepEqual(json.leftRunning.filter((s) => s.what === 'app'), []);
    launched = false;

    const status = ok(cli('status'), 'status after stop');
    assert.equal(status.reachable, false, 'debug port closed after graceful quit');
    if (launch?.devServer?.pid) assert.equal(isAlive(launch.devServer.pid), false, 'dev server process gone');
  });
});

