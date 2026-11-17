// Test-side helpers for the simulated OpenFin backend (test/sim/backend.mjs).
//
//   const sim = await startSim(t);                    // headless Chromium + fixture pages
//   const repo = makeSimRepo({ debugPort: sim.debugPort });
//   runCli(['status'], { cwd: repo });
//
// startSim(t) registers cleanup on the test context, so the browser is always
// torn down. Pass `{ fixtures }` to replace the default fixture pages (see
// test/sim/fixtures.mjs for the shape and DEFAULT_FIXTURES).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './cli.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const SIM_BACKEND = join(here, '..', 'sim', 'backend.mjs');
export { DEFAULT_FIXTURES } from '../sim/fixtures.mjs';

/** A TCP port that was free a moment ago (nothing listening on it). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Create a temp consuming repo with docs/agents/openfin.md pointing at
 * `debugPort`. `config` fields are merged over the defaults (manifest,
 * debugPort). `state`, if given, is written to .scratch/openfin/state.json
 * as-is, simulating a previous `launch`.
 */
export function makeSimRepo({ debugPort, config = {}, state } = {}) {
  const block = { manifest: 'http://127.0.0.1/sim/manifest.json', debugPort, ...config };
  const configText =
    '# OpenFin project config (simulated backend)\n\n' +
    '```json openfin-config\n' +
    JSON.stringify(block, null, 2) +
    '\n```\n';
  const repo = makeRepo({ configText });
  if (state !== undefined) writeSimState(repo, state);
  return repo;
}

/**
 * Env for runCli that makes the CLI see `processes` ({ name, pid, commandLine })
 * as the running OpenFin processes (the CLI's test-only process-list seam;
 * OpenFin processes can't exist off Windows).
 */
export function fakeOpenFinProcesses(repo, processes) {
  const file = join(repo, 'fake-processes.json');
  writeFileSync(file, JSON.stringify(processes));
  return { OPENFIN_TEST_PROCESS_LIST: file };
}

export function writeSimState(repo, state) {
  const dir = join(repo, '.scratch', 'openfin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2));
}

/**
 * Start the simulated backend as a child process and wait until it is ready.
 * @param {import('node:test').TestContext | undefined} t  registers t.after(stop) when given
 * @param {{ fixtures?: object[], debugPort?: number }} [opts]
 * @returns {Promise<{ debugPort: number, httpPort: number, baseUrl: string, pid: number,
 *   alive(): boolean, openPage(id: string): Promise<void>, stop(): Promise<void>, exited: Promise<number|null> }>}
 */
export async function startSim(t, { fixtures, debugPort } = {}) {
  const args = [SIM_BACKEND, '--exit-on-stdin-close'];
  if (fixtures) args.push('--fixtures', JSON.stringify(fixtures));
  if (debugPort) args.push('--debug-port', String(debugPort));
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  let exitCode;
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve((exitCode = code))));

  const ready = await new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      child.stdout.off('data', onData);
      try {
        resolve(JSON.parse(buf.slice(0, nl)));
      } catch (e) {
        reject(new Error(`sim backend printed a bad ready line: ${buf}\n${stderr}`));
      }
    };
    child.stdout.on('data', onData);
    exited.then((code) => reject(new Error(`sim backend exited (${code}) before ready:\n${stderr}`)));
  });

  const sim = {
    ...ready,
    pid: child.pid,
    exited,
    alive: () => exitCode === undefined,
    /** Open another fixture page (by fixture id) as a new CDP target. */
    async openPage(id) {
      const res = await fetch(`${ready.baseUrl}/__open?id=${encodeURIComponent(id)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`openPage(${id}) failed: ${res.status} ${await res.text()}`);
    },
    /**
     * Run `fn` in the page of fixture `id` (over CDP, like the CLI does) and
     * return its result. Lets tests poke page state independently of the CLI.
     */
    async evaluate(id, fn, arg) {
      return withSimPage(sim, id, (page) => page.evaluate(fn, arg));
    },
    /** Quit the way an app would: fin.Application.getCurrentSync().quit() in a page. Resolves when the runtime is gone. */
    async quit(id = undefined) {
      const target = id ?? (await firstFinPageId(sim));
      await withSimPage(sim, target, (page) =>
        page.evaluate(() => fin.Application.getCurrentSync().quit()).catch(() => {}),
      );
      await exited;
    },
    async stop() {
      if (exitCode !== undefined) return;
      child.kill('SIGTERM');
      await exited;
    },
  };
  t?.after(() => sim.stop());
  return sim;
}

/** URL of fixture `id`'s page in a running sim. */
export function simPageUrl(sim, id) {
  return `${sim.baseUrl}/page/${encodeURIComponent(id)}`;
}

async function firstFinPageId(sim) {
  const list = await (await fetch(`http://127.0.0.1:${sim.debugPort}/json/list`)).json();
  const prefix = `${sim.baseUrl}/page/`;
  const t = list.find((x) => x.type === 'page' && x.url.startsWith(prefix));
  if (!t) throw new Error('no fixture pages open');
  return decodeURIComponent(t.url.slice(prefix.length));
}

/** Connect to the sim over CDP, run fn(page) on fixture `id`'s page, disconnect. */
export async function withSimPage(sim, id, fn) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${sim.debugPort}`);
  try {
    const url = simPageUrl(sim, id);
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url() === url);
    if (!page) throw new Error(`fixture page ${id} is not open`);
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}
