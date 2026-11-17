// Test harness: runs the openfin CLI as a subprocess and parses its single
// JSON stdout object. Tests assert only on { exitCode, json } and on
// observable effects; they never import the CLI's internal modules (test
// helpers may reuse its plain PID utilities to check and clean up processes).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = join(here, '..', '..');
export const CLI = join(SKILL_DIR, 'scripts', 'openfin.mjs');
export const FIXTURES = join(here, '..', 'fixtures');

/**
 * Run the CLI. `env` is merged over a scrubbed copy of process.env with any
 * OPENFIN_* variables removed so the developer's shell can't leak in.
 */
export function runCli(args, { cwd, env = {}, cli = CLI } = {}) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    cwd: cwd ?? makeRepo(),
    env: cliEnv(env),
    encoding: 'utf8',
  });
  return parseResult(res.status, res.stdout, res.stderr);
}

/** Like runCli, but doesn't block: for running several CLI calls at once. */
export function runCliAsync(args, { cwd, env = {}, cli = CLI } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: cwd ?? makeRepo(), env: cliEnv(env) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        resolve(parseResult(code, stdout, stderr));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function cliEnv(env) {
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('OPENFIN_') && k !== 'NODE_PATH'),
  );
  return { ...baseEnv, ...env };
}

function parseResult(exitCode, stdout, stderr) {
  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error(`stdout was not a single JSON object.\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
  return { exitCode, json, stderr };
}

/** Create an empty temp "consuming repo". Optionally seed docs/agents/openfin.md. */
export function makeRepo({ configFixture, configText } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'openfin-repo-'));
  if (configFixture || configText !== undefined) {
    mkdirSync(join(dir, 'docs', 'agents'), { recursive: true });
    const target = join(dir, 'docs', 'agents', 'openfin.md');
    if (configFixture) cpSync(join(FIXTURES, configFixture), target);
    else writeFileSync(target, configText);
  }
  return dir;
}
