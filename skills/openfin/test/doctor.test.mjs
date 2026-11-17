import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, cpSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, makeRepo, SKILL_DIR } from './helpers/cli.mjs';

function installFakePlaywright(dir, version) {
  const pkg = join(dir, 'node_modules', 'playwright-core');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: 'playwright-core', version, main: 'index.js', exports: { '.': './index.js', './package.json': './package.json' } }),
  );
  writeFileSync(join(pkg, 'index.js'), 'module.exports = { chromium: {} };\n');
}

test('doctor prefers playwright-core installed in the consuming repo', () => {
  const repo = makeRepo({ configFixture: 'minimal.md' });
  installFakePlaywright(repo, '0.0.0-fake');
  const { exitCode, json } = runCli(['doctor'], { cwd: repo });
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(json.ready, true);
  assert.equal(json.checks.config.ok, true);
  assert.equal(json.checks.playwright.ok, true);
  assert.equal(json.checks.playwright.from, 'project');
  assert.equal(json.checks.playwright.version, '0.0.0-fake');
  assert.ok(json.checks.playwright.path.startsWith(realpathSync(repo)));
});

test('doctor falls back to playwright-core in the skill folder', () => {
  const repo = makeRepo({ configFixture: 'minimal.md' });
  const { json } = runCli(['doctor'], { cwd: repo });
  assert.equal(json.checks.playwright.ok, true);
  assert.equal(json.checks.playwright.from, 'skill');
  assert.ok(json.checks.playwright.path.startsWith(SKILL_DIR));
});

test('doctor reports PLAYWRIGHT_MISSING with an install hint, and missing config, without failing', () => {
  // A copy of the skill with no node_modules, in a tree with no playwright-core.
  const skillCopy = mkdtempSync(join(tmpdir(), 'openfin-skill-'));
  cpSync(join(SKILL_DIR, 'scripts'), join(skillCopy, 'scripts'), { recursive: true });
  cpSync(join(SKILL_DIR, 'package.json'), join(skillCopy, 'package.json'));
  const repo = makeRepo();
  const { exitCode, json } = runCli(['doctor'], { cwd: repo, cli: join(skillCopy, 'scripts', 'openfin.mjs') });
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(json.ready, false);
  assert.equal(json.checks.playwright.ok, false);
  assert.equal(json.checks.playwright.error.code, 'PLAYWRIGHT_MISSING');
  assert.match(json.checks.playwright.error.hint, /npm install( -D| --save-dev)? playwright-core/);
  assert.equal(json.checks.config.ok, false);
  assert.equal(json.checks.config.error.code, 'CONFIG_MISSING');
});
