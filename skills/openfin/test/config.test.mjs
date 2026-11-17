import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { realpathSync, readFileSync } from 'node:fs';
import { runCli, makeRepo, SKILL_DIR, FIXTURES } from './helpers/cli.mjs';

test('the shipped template is a valid config with every field populated', () => {
  const template = readFileSync(join(SKILL_DIR, 'assets', 'openfin.template.md'), 'utf8');
  const repo = makeRepo({ configText: template });
  const { exitCode, json } = runCli(['config'], { cwd: repo });
  assert.equal(exitCode, 0, JSON.stringify(json));
  const root = realpathSync(repo);
  assert.equal(json.config.manifest, 'http://localhost:5050/manifest.fin.json');
  assert.equal(json.config.debugPort, 9090);
  assert.deepEqual(json.config.devServer, {
    command: 'npm run dev',
    cwd: root,
    readyUrl: 'http://localhost:5050/manifest.fin.json',
  });
  assert.deepEqual(json.config.windows, [
    { name: 'main', identity: 'my-app/main', purpose: 'Main application window that hosts the views.' },
    { name: 'blotter', purpose: "Trade blotter view; lists today's orders." },
  ]);
});

test('config command prints the resolved config with defaults applied', () => {
  const repo = makeRepo({ configFixture: 'minimal.md' });
  const { exitCode, json } = runCli(['config'], { cwd: repo, env: { LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' } });
  assert.equal(exitCode, 0);
  assert.equal(json.ok, true);
  assert.deepEqual(json.config, {
    repoRoot: realpathSync(repo),
    configPath: join(realpathSync(repo), 'docs', 'agents', 'openfin.md'),
    manifest: 'http://localhost:5050/manifest.json',
    debugPort: 9090,
    devServer: null,
    windows: [],
    logsDir: 'C:\\Users\\dev\\AppData\\Local\\OpenFin',
  });
});

const block = (json) => `# Config\n\n\`\`\`json openfin-config\n${json}\n\`\`\`\n`;

function expectInvalid(configText, { fields = [], message } = {}) {
  const repo = makeRepo({ configText });
  const { exitCode, json } = runCli(['config'], { cwd: repo });
  assert.notEqual(exitCode, 0);
  assert.equal(json.ok, false);
  assert.equal(json.error.code, 'CONFIG_INVALID');
  assert.ok(json.error.message.includes(join('docs', 'agents', 'openfin.md')), json.error.message);
  if (message) assert.match(json.error.message, message);
  for (const f of fields) {
    assert.ok(
      json.error.fields?.some((p) => p.field === f),
      `expected a problem for field ${f}: ${JSON.stringify(json.error)}`,
    );
    assert.ok(json.error.message.includes(f), json.error.message);
  }
  assert.match(json.error.hint, /interactive setup/i);
  return json.error;
}

test('malformed JSON in the config block returns CONFIG_INVALID mentioning JSON', () => {
  expectInvalid(block('{ "manifest": "x", }'), { message: /not valid JSON/ });
});

test('a config file without an openfin-config block returns CONFIG_INVALID', () => {
  expectInvalid('# Config\n\n```json\n{ "manifest": "x" }\n```\n', { message: /openfin-config/ });
});

test('two openfin-config blocks are rejected as ambiguous', () => {
  expectInvalid(block('{ "manifest": "a" }') + block('{ "manifest": "b" }'), { message: /exactly one/ });
});

test('missing manifest returns CONFIG_INVALID naming the manifest field', () => {
  expectInvalid(block('{ "debugPort": 9090 }'), { fields: ['manifest'], message: /required/ });
});

test('every invalid field is reported at once', () => {
  expectInvalid(
    block(
      JSON.stringify({
        manifest: '',
        debugPort: 70000,
        devServer: { cwd: 'web' },
        windows: [{ purpose: 'no name' }],
        logsDir: 42,
      }),
    ),
    { fields: ['manifest', 'debugPort', 'devServer.command', 'windows[0].name', 'logsDir'] },
  );
});

test('--config points at a config outside docs/agents', () => {
  const repo = makeRepo();
  const { exitCode, json } = runCli(['config', '--config', join(FIXTURES, 'custom-port.md')], { cwd: repo });
  assert.equal(exitCode, 0, JSON.stringify(json));
  assert.equal(json.config.debugPort, 9123);
  assert.equal(json.config.configPath, join(FIXTURES, 'custom-port.md'));
});

test('OPENFIN_CONFIG env var points at a config, and --config wins over it', () => {
  const repo = makeRepo();
  const env = { OPENFIN_CONFIG: join(FIXTURES, 'custom-port.md') };
  const viaEnv = runCli(['config'], { cwd: repo, env });
  assert.equal(viaEnv.json.config.debugPort, 9123);
  const viaFlag = runCli(['config', `--config=${join(FIXTURES, 'minimal.md')}`], { cwd: repo, env });
  assert.equal(viaFlag.json.config.debugPort, 9090);
});

test('--config naming a missing file returns CONFIG_MISSING with that path', () => {
  const repo = makeRepo();
  const { exitCode, json } = runCli(['config', '--config', 'nope/openfin.md'], { cwd: repo });
  assert.notEqual(exitCode, 0);
  assert.equal(json.error.code, 'CONFIG_MISSING');
  assert.ok(json.error.message.includes(join('nope', 'openfin.md')));
});

test('missing project config returns CONFIG_MISSING naming the expected path and pointing at setup', () => {
  const repo = makeRepo();
  const { exitCode, json } = runCli(['status'], { cwd: repo });
  assert.notEqual(exitCode, 0);
  assert.equal(json.ok, false);
  assert.equal(json.error.code, 'CONFIG_MISSING');
  assert.ok(json.error.message.includes(join('docs', 'agents', 'openfin.md')));
  assert.match(json.error.hint, /interactive setup/i);
});
