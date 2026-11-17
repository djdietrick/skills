// Self-tests for the simulated OpenFin backend, so CLI tests can trust it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSim, simPageUrl } from './helpers/sim.mjs';

const identityOf = () => ({ identity: fin.me.identity, isView: fin.me.isView, isWindow: fin.me.isWindow });

test('sim: fixture pages expose OpenFin identity, view parents, Workspace Home and a platform snapshot', async (t) => {
  const sim = await startSim(t);

  assert.deepEqual(await sim.evaluate('main', identityOf), {
    identity: { uuid: 'sim-app', name: 'main' },
    isView: false,
    isWindow: true,
  });
  assert.deepEqual(await sim.evaluate('blotter', identityOf), {
    identity: { uuid: 'sim-app', name: 'blotter-view' },
    isView: true,
    isWindow: false,
  });
  assert.deepEqual(
    await sim.evaluate('blotter', async () => (await fin.me.getCurrentWindow()).identity),
    { uuid: 'sim-app', name: 'main' },
  );
  assert.deepEqual((await sim.evaluate('home', identityOf)).identity, { uuid: 'openfin-workspace', name: 'openfin-home' });

  const snap = await sim.evaluate('main', () => fin.Platform.getCurrentSync().getSnapshot());
  assert.deepEqual(
    snap.windows.map((w) => w.name),
    ['main', 'secondary'],
  );
  const main = snap.windows.find((w) => w.name === 'main');
  assert.deepEqual(main.layout.content[0].content[0].componentState, {
    name: 'blotter-view',
    uuid: 'sim-app',
    url: simPageUrl(sim, 'blotter'),
  });
});

test('sim: openPage adds a page target later; fin: false pages have no fin', async (t) => {
  const sim = await startSim(t, {
    fixtures: [
      { id: 'w', uuid: 'a', name: 'w', kind: 'window' },
      { id: 'late', uuid: 'a', name: 'late', kind: 'window', open: false },
      { id: 'plain', uuid: 'x', name: 'plain', kind: 'window', fin: false },
    ],
  });
  const count = async () =>
    (await (await fetch(`http://127.0.0.1:${sim.debugPort}/json/list`)).json()).filter((x) => x.type === 'page').length;
  assert.equal(await count(), 2);
  await sim.openPage('late');
  assert.equal(await count(), 3);
  assert.equal(await sim.evaluate('plain', () => typeof window.fin), 'undefined');
});

test('sim: fin.Application quit() shuts the browser down and closes the debug port', async (t) => {
  const sim = await startSim(t);
  await sim.quit('blotter');
  assert.equal(sim.alive(), false);
  await assert.rejects(fetch(`http://127.0.0.1:${sim.debugPort}/json/version`));
});
