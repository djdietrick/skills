// Test harness: runs the openfin CLI as a subprocess and parses its single
// JSON stdout object. Tests assert only on { exitCode, json } and on
// observable effects; they never import the CLI's internal modules.
import { spawnSync } from 'node:child_process';
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
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('OPENFIN_') && k !== 'NODE_PATH'),
  );
  const res = spawnSync(process.execPath, [cli, ...args], {
    cwd: cwd ?? makeRepo(),
    env: { ...baseEnv, ...env },
    encoding: 'utf8',
  });
  let json;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    throw new Error(
      `stdout was not a single JSON object.\nstdout: ${res.stdout}\nstderr: ${res.stderr}`,
    );
  }
  return { exitCode: res.status, json, stderr: res.stderr };
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
