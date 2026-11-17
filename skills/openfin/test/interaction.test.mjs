import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { runCli } from './helpers/cli.mjs';
import { makeSimRepo, startSim } from './helpers/sim.mjs';
import { killCollectorAfter } from './helpers/collector.mjs';

// A form page whose button copies the input into #out.
const FIXTURES = [
  {
    id: 'form',
    uuid: 'sim-app',
    name: 'form',
    kind: 'window',
    title: 'Form',
    body:
      '<h1>Order entry</h1><p id="status">idle</p>' +
      '<input id="qty"><button id="go">Go</button><p id="out"></p>' +
      '<p style="display:none">hidden text</p>' +
      '<script>document.getElementById("go").onclick = () => {' +
      'document.getElementById("status").textContent = "clicked";' +
      'document.getElementById("out").textContent = "qty=" + document.getElementById("qty").value; };</script>',
  },
  { id: 'other', uuid: 'sim-app', name: 'other', kind: 'window', title: 'Other', body: '<p>Other</p>' },
];

async function setup(t) {
  const sim = await startSim(t, { fixtures: FIXTURES });
  const repo = makeSimRepo({ debugPort: sim.debugPort });
  killCollectorAfter(t, repo);
  const cli = (args) => runCli(args, { cwd: repo });
  return { sim, repo, cli };
}

test('eval returns the JSON-serialized result of an expression in the target', async (t) => {
  const { cli } = await setup(t);
  const { exitCode, json } = cli(['eval', 'sim-app/form', '({ title: document.title, n: 1 + 2, id: fin.me.identity.name })']);
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.deepEqual(json.result, { title: 'Form', n: 3, id: 'form' });
  assert.equal(json.target, 'sim-app/form');
});

test('eval reports a script that throws as EVAL_FAILED', async (t) => {
  const { cli, sim } = await setup(t);
  const { exitCode, json } = cli(['eval', 'form', 'nope.missing']);
  assert.equal(exitCode, 1);
  assert.equal(json.error.code, 'EVAL_FAILED');
  assert.match(json.error.message, /nope/);
  assert.ok(sim.alive());
});

test('text returns the visible text of the page, or of one element with --selector', async (t) => {
  const { cli } = await setup(t);
  const page = cli(['text', 'sim-app/form']);
  assert.equal(page.exitCode, 0, JSON.stringify(page.json));
  assert.match(page.json.text, /Order entry/);
  assert.match(page.json.text, /idle/);
  assert.doesNotMatch(page.json.text, /hidden text/);
  assert.equal(page.json.target, 'sim-app/form');

  const el = cli(['text', 'form', '--selector', 'h1']);
  assert.equal(el.exitCode, 0, JSON.stringify(el.json));
  assert.equal(el.json.text, 'Order entry');
});

test('a selector that never matches fails with SELECTOR_TIMEOUT after --timeout', async (t) => {
  const { cli, sim } = await setup(t);
  for (const args of [
    ['text', 'form', '--selector', '#missing', '--timeout', '300'],
    ['click', 'form', '#missing', '--timeout', '300'],
    ['type', 'form', '#missing', 'x', '--timeout', '300'],
  ]) {
    const started = Date.now();
    const { exitCode, json } = cli(args);
    assert.equal(exitCode, 1, args[0]);
    assert.equal(json.error.code, 'SELECTOR_TIMEOUT', JSON.stringify(json));
    assert.equal(json.error.selector, '#missing');
    assert.equal(json.error.target, 'sim-app/form');
    assert.ok(Date.now() - started < 4000, `${args[0]} should give up after ~300 ms`);
  }
  assert.ok(sim.alive());
});

test('click and type change page state, observable through text and eval', async (t) => {
  const { cli } = await setup(t);
  const typed = cli(['type', 'sim-app/form', '#qty', '250']);
  assert.equal(typed.exitCode, 0, JSON.stringify(typed.json));
  assert.equal(cli(['eval', 'form', 'document.querySelector("#qty").value']).json.result, '250');

  const clicked = cli(['click', 'form', '#go']);
  assert.equal(clicked.exitCode, 0, JSON.stringify(clicked.json));
  assert.equal(cli(['text', 'form', '--selector', '#status']).json.text, 'clicked');
  assert.equal(cli(['text', 'form', '--selector', '#out']).json.text, 'qty=250');
});

test('screenshot writes distinct target-named PNGs under .scratch/openfin/screenshots and returns absolute paths', async (t) => {
  const { cli, repo } = await setup(t);
  const first = cli(['screenshot', 'sim-app/form']);
  assert.equal(first.exitCode, 0, JSON.stringify(first.json));
  const second = cli(['screenshot', 'sim-app/form']);
  assert.equal(second.exitCode, 0, JSON.stringify(second.json));

  const dir = realpathSync(join(repo, '.scratch', 'openfin', 'screenshots'));
  for (const { json } of [first, second]) {
    assert.ok(isAbsolute(json.path));
    assert.equal(dirname(realpathSync(json.path)), dir);
    assert.match(basename(json.path), /^\d{8}T\d{6}.*sim-app.*form.*\.png$/);
    assert.deepEqual([...readFileSync(json.path).subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(json.target, 'sim-app/form');
  }
  assert.notEqual(first.json.path, second.json.path);
  assert.equal(readdirSync(dir).length, 2);
});

test('click and type wait for an element that appears late', async (t) => {
  const { cli, sim } = await setup(t);
  await sim.evaluate('form', () =>
    setTimeout(() => {
      const b = document.createElement('button');
      b.id = 'late';
      b.onclick = () => (document.getElementById('status').textContent = 'late clicked');
      document.body.append(b);
    }, 700),
  );
  const { exitCode, json } = cli(['click', 'form', '#late']);
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(cli(['text', 'form', '--selector', '#status']).json.text, 'late clicked');
});
