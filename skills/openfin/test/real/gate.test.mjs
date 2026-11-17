// The opt-in gate for the real-OpenFin suite: it runs only when the developer
// asks for it on Windows, skips cleanly everywhere else, and fails loudly when
// asked for but misconfigured (so an opted-in run never "passes" by skipping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realOpenFinGate } from './gate.mjs';

function sampleRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'openfin-real-gate-'));
  mkdirSync(join(repo, 'docs', 'agents'), { recursive: true });
  const config = join(repo, 'docs', 'agents', 'openfin.md');
  writeFileSync(config, '# config\n');
  return { repo, config };
}

test('skips when OPENFIN_REAL is not set', () => {
  const gate = realOpenFinGate({ env: {}, platform: 'win32' });
  assert.equal(gate.run, false);
  assert.match(gate.skip, /OPENFIN_REAL=1/);
  assert.equal(gate.error, undefined);
});

test('skips when OPENFIN_REAL is set to something other than 1', () => {
  const gate = realOpenFinGate({ env: { OPENFIN_REAL: '0' }, platform: 'win32' });
  assert.equal(gate.run, false);
  assert.ok(gate.skip);
});

test('skips off Windows even when opted in', () => {
  const { config } = sampleRepo();
  const gate = realOpenFinGate({ env: { OPENFIN_REAL: '1', OPENFIN_REAL_CONFIG: config }, platform: 'darwin' });
  assert.equal(gate.run, false);
  assert.match(gate.skip, /Windows/);
  assert.equal(gate.error, undefined);
});

test('opted in on Windows without OPENFIN_REAL_CONFIG is an error, not a skip', () => {
  const gate = realOpenFinGate({ env: { OPENFIN_REAL: '1' }, platform: 'win32' });
  assert.equal(gate.run, false);
  assert.equal(gate.skip, undefined);
  assert.match(gate.error, /OPENFIN_REAL_CONFIG/);
});

test('opted in on Windows with a config path that does not exist is an error', () => {
  const gate = realOpenFinGate({
    env: { OPENFIN_REAL: '1', OPENFIN_REAL_CONFIG: join(tmpdir(), 'no-such-dir', 'openfin.md') },
    platform: 'win32',
  });
  assert.equal(gate.run, false);
  assert.match(gate.error, /not found/);
});

test('runs with the repo root inferred from <repo>/docs/agents/openfin.md', () => {
  const { repo, config } = sampleRepo();
  const gate = realOpenFinGate({ env: { OPENFIN_REAL: '1', OPENFIN_REAL_CONFIG: config }, platform: 'win32' });
  assert.deepEqual(gate, { run: true, configPath: config, repoRoot: repo });
});

test('OPENFIN_REAL_REPO overrides the inferred repo root', () => {
  const { config } = sampleRepo();
  const other = mkdtempSync(join(tmpdir(), 'openfin-real-repo-'));
  const gate = realOpenFinGate({
    env: { OPENFIN_REAL: '1', OPENFIN_REAL_CONFIG: config, OPENFIN_REAL_REPO: other },
    platform: 'win32',
  });
  assert.deepEqual(gate, { run: true, configPath: config, repoRoot: other });
});

test('a config outside docs/agents/ needs OPENFIN_REAL_REPO', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfin-real-cfg-'));
  const config = join(dir, 'my-openfin.md');
  writeFileSync(config, '# config\n');
  const gate = realOpenFinGate({ env: { OPENFIN_REAL: '1', OPENFIN_REAL_CONFIG: config }, platform: 'win32' });
  assert.equal(gate.run, false);
  assert.match(gate.error, /OPENFIN_REAL_REPO/);
});
