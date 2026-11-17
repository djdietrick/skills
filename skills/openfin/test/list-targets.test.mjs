import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from './helpers/cli.mjs';
import { makeSimRepo, startSim, simPageUrl } from './helpers/sim.mjs';

// A platform app with two windows and a view, a second app that reuses the
// window name "main", Workspace Home and Dock, and a page with no `fin`.
const FIXTURES = [
  { id: 'main', uuid: 'sim-app', name: 'main', kind: 'window', title: 'Sim App — Main' },
  { id: 'secondary', uuid: 'sim-app', name: 'secondary', kind: 'window', title: 'Sim App — Secondary' },
  { id: 'blotter', uuid: 'sim-app', name: 'blotter-view', kind: 'view', parent: 'main', title: 'Blotter' },
  { id: 'other-main', uuid: 'other-app', name: 'main', kind: 'window', title: 'Other App' },
  { id: 'home', uuid: 'openfin-workspace', name: 'openfin-home', kind: 'window', title: 'Home' },
  { id: 'dock', uuid: 'openfin-workspace', name: 'openfin-dock', kind: 'window', title: 'Dock' },
  { id: 'plain', fin: false, title: 'Plain page' },
];

const byTarget = (json) => Object.fromEntries(json.targets.map((t) => [t.target, t]));

test('list-targets names every page by OpenFin identity with kind, parent, url and title', async (t) => {
  const sim = await startSim(t, { fixtures: FIXTURES });
  const repo = makeSimRepo({ debugPort: sim.debugPort });
  const { exitCode, json } = runCli(['list-targets'], { cwd: repo });
  assert.equal(exitCode, 0, JSON.stringify(json));
  const targets = byTarget(json);

  assert.deepEqual(Object.keys(targets).sort(), [
    'openfin-workspace/openfin-dock',
    'openfin-workspace/openfin-home',
    'other-app/main',
    'sim-app/blotter-view',
    'sim-app/main',
    'sim-app/secondary',
    simPageUrl(sim, 'plain'),
  ].sort());
  assert.deepEqual(targets['sim-app/main'], {
    target: 'sim-app/main',
    uuid: 'sim-app',
    name: 'main',
    kind: 'window',
    parent: null,
    url: simPageUrl(sim, 'main'),
    title: 'Sim App — Main',
    workspace: null,
    aliases: [],
  });
  assert.equal(targets['sim-app/blotter-view'].kind, 'view');
  assert.equal(targets['sim-app/blotter-view'].parent, 'sim-app/main');
  assert.ok(sim.alive(), 'list-targets must leave the instance running');
});

test('list-targets labels Workspace components and lists fin-less pages as kind unknown', async (t) => {
  const sim = await startSim(t, { fixtures: FIXTURES });
  const repo = makeSimRepo({ debugPort: sim.debugPort });
  const targets = byTarget(runCli(['list-targets'], { cwd: repo }).json);

  assert.equal(targets['openfin-workspace/openfin-home'].workspace, 'Home');
  assert.equal(targets['openfin-workspace/openfin-dock'].workspace, 'Dock');
  assert.equal(targets['sim-app/main'].workspace, null);
  assert.deepEqual(targets[simPageUrl(sim, 'plain')], {
    target: simPageUrl(sim, 'plain'),
    uuid: null,
    name: null,
    kind: 'unknown',
    parent: null,
    url: simPageUrl(sim, 'plain'),
    title: 'Plain page',
    workspace: null,
    aliases: [],
  });
});

test('list-targets attaches config window names as aliases, by identity or by short name', async (t) => {
  const sim = await startSim(t, { fixtures: FIXTURES });
  const repo = makeSimRepo({
    debugPort: sim.debugPort,
    config: {
      windows: [
        { name: 'shell', identity: 'sim-app/main' },
        { name: 'blotter-view', purpose: 'orders' },
        { name: 'gone', identity: 'sim-app/closed' },
      ],
    },
  });
  const targets = byTarget(runCli(['list-targets'], { cwd: repo }).json);
  assert.deepEqual(targets['sim-app/main'].aliases, ['shell']);
  assert.deepEqual(targets['other-app/main'].aliases, []);
  assert.deepEqual(targets['sim-app/blotter-view'].aliases, ['blotter-view']);
});

test('--target resolves uuid/name, a unique short name, a config alias, or a fin-less page URL', async (t) => {
  const sim = await startSim(t, { fixtures: FIXTURES });
  const repo = makeSimRepo({ debugPort: sim.debugPort, config: { windows: [{ name: 'shell', identity: 'sim-app/main' }] } });
  const resolve = (q) => {
    const { exitCode, json } = runCli(['list-targets', '--target', q], { cwd: repo });
    assert.equal(exitCode, 0, JSON.stringify(json));
    assert.equal(json.targets.length, 1);
    return json.targets[0].target;
  };
  assert.equal(resolve('other-app/main'), 'other-app/main');
  assert.equal(resolve('blotter-view'), 'sim-app/blotter-view');
  assert.equal(resolve('openfin-home'), 'openfin-workspace/openfin-home');
  assert.equal(resolve('shell'), 'sim-app/main');
  assert.equal(resolve(simPageUrl(sim, 'plain')), simPageUrl(sim, 'plain'));
});

test('an ambiguous short name fails with TARGET_AMBIGUOUS listing just the matching candidates', async (t) => {
  const sim = await startSim(t, { fixtures: FIXTURES });
  const repo = makeSimRepo({ debugPort: sim.debugPort });
  const { exitCode, json } = runCli(['list-targets', '--target', 'main'], { cwd: repo });
  assert.equal(exitCode, 1);
  assert.equal(json.error.code, 'TARGET_AMBIGUOUS');
  assert.equal(json.error.query, 'main');
  assert.deepEqual(json.error.candidates.map((c) => c.target).sort(), ['other-app/main', 'sim-app/main']);
  assert.match(json.error.hint, /uuid\/name/);
});

test('an unknown target fails with TARGET_NOT_FOUND listing every target as a candidate', async (t) => {
  const sim = await startSim(t, { fixtures: FIXTURES });
  const repo = makeSimRepo({ debugPort: sim.debugPort });
  const { exitCode, json } = runCli(['list-targets', '--target', 'sim-app/nope'], { cwd: repo });
  assert.equal(exitCode, 1);
  assert.equal(json.error.code, 'TARGET_NOT_FOUND');
  assert.equal(json.error.candidates.length, FIXTURES.length);
  assert.deepEqual(json.error.candidates.find((c) => c.target === 'openfin-workspace/openfin-home'), {
    target: 'openfin-workspace/openfin-home',
    kind: 'window',
    workspace: 'Home',
    title: 'Home',
  });
  assert.ok(sim.alive());
});

test("list-targets finds a view's parent from the platform snapshot when the view can't report it", async (t) => {
  const fixtures = FIXTURES.map((f) => (f.id === 'blotter' ? { ...f, parentApi: false } : f));
  const sim = await startSim(t, { fixtures });
  const repo = makeSimRepo({ debugPort: sim.debugPort });
  const targets = byTarget(runCli(['list-targets'], { cwd: repo }).json);
  assert.equal(targets['sim-app/blotter-view'].kind, 'view');
  assert.equal(targets['sim-app/blotter-view'].parent, 'sim-app/main');
});
