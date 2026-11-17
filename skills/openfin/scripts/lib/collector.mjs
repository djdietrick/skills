// Background log collector: a detached Node process (../collector.mjs) that
// stays connected over CDP and appends every target's console messages and
// uncaught errors to .scratch/openfin/logs/<session>.jsonl in the consuming
// repo, one JSON object per line:
//
//   { ts, target: "uuid/name", level: "debug"|"log"|"info"|"warn"|"error", text,
//     type: "console"|"pageerror", stack? }
//
// Its PID and log file are recorded in the session state (state.collector).
//
// API (for `launch`, first attach via cdp.connect, and `stop`):
//   ensureCollector(config) -> { pid, logFile, started }  idempotent: reuses a live
//                                                        collector on the same port; serialized
//                                                        across processes by .scratch/openfin/collector.lock
//   stopCollector(repoRoot) -> { stopped, pid? }         kills it, clears state.collector
//   collectorStatus(repoRoot) -> { running, pid?, logFile? }
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratchDir, readState, updateState } from './state.mjs';
import { isAlive } from './processes.mjs';
import { pollUntil } from './wait.mjs';

const COLLECTOR_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'collector.mjs');
const READY_TIMEOUT_MS = 15000;
const LOCK_STALE_MS = READY_TIMEOUT_MS + 5000; // longer than any start holds the lock

export function logsDir(repoRoot) {
  return join(scratchDir(repoRoot), 'logs');
}

/** @returns {{ running: boolean, pid?: number, logFile?: string }} */
export function collectorStatus(repoRoot) {
  const c = readState(repoRoot)?.collector;
  if (!c) return { running: false };
  return { running: isAlive(c.pid), pid: c.pid, ...(c.logFile ? { logFile: c.logFile } : {}) };
}

/**
 * Make sure a collector is attached to `config.debugPort`. Starts one (a new
 * session log file) unless the state names a live collector for this port.
 * Resolves once the new collector is subscribed to every current target.
 * @param {{ repoRoot: string, debugPort: number }} config
 * @returns {Promise<{ pid: number, logFile: string, started: boolean }>}
 */
export async function ensureCollector(config) {
  // Serialized across CLI processes: concurrent first attaches must not each start one.
  const release = await acquireStartLock(config.repoRoot);
  try {
    return await ensureCollectorLocked(config);
  } finally {
    release();
  }
}

/**
 * ensureCollector, best effort: a collector that fails to start must not fail
 * the command that wanted it. The one place that failure is handled.
 * @returns {Promise<{ pid: number, logFile: string, started: boolean } | { running: false, error: string }>}
 */
export async function tryEnsureCollector(config) {
  try {
    return await ensureCollector(config);
  } catch (err) {
    const error = err?.message ?? String(err);
    process.stderr.write(`log collector not started: ${error}\n`);
    return { running: false, error };
  }
}

async function ensureCollectorLocked(config) {
  const { repoRoot, debugPort } = config;
  const current = readState(repoRoot)?.collector;
  if (current && isAlive(current.pid)) {
    if (current.debugPort === undefined || current.debugPort === debugPort) {
      return { pid: current.pid, logFile: current.logFile, started: false };
    }
    stopCollector(repoRoot);
  }

  const dir = logsDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const session = `session-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const logFile = join(dir, `${session}.jsonl`);
  const errFd = openSync(join(dir, `${session}.collector.log`), 'a');
  let child;
  try {
    child = spawn(
      process.execPath,
      [COLLECTOR_SCRIPT, '--repo-root', repoRoot, '--debug-port', String(debugPort), '--log-file', logFile],
      { cwd: repoRoot, detached: true, stdio: ['ignore', 'pipe', errFd], windowsHide: true },
    );
  } finally {
    closeSync(errFd);
  }

  try {
    await waitForReady(child);
  } catch (err) {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
    throw err;
  }
  child.stdout.destroy();
  child.unref();

  updateState(repoRoot, (s) => ({
    ...s,
    collector: { pid: child.pid, logFile, debugPort, startedAt: new Date().toISOString() },
  }));
  return { pid: child.pid, logFile, started: true };
}

/**
 * Kill the collector the state names (if alive) and clear state.collector.
 * @returns {{ stopped: boolean, pid?: number }}
 */
export function stopCollector(repoRoot) {
  const c = readState(repoRoot)?.collector;
  if (!c) return { stopped: false };
  let stopped = false;
  if (isAlive(c.pid)) {
    try {
      process.kill(c.pid, 'SIGTERM');
      stopped = true;
    } catch {
      // exited in between
    }
  }
  updateState(repoRoot, (s) => ({ ...s, collector: null }));
  return { stopped, pid: c.pid };
}

/**
 * Take the collector start lock (.scratch/openfin/collector.lock, created
 * exclusively, holding the owner's PID). A lock whose owner is dead, or that
 * is older than any start could take, is stale and taken over.
 * @returns {Promise<() => void>} release
 */
async function acquireStartLock(repoRoot) {
  const lockPath = join(scratchDir(repoRoot), 'collector.lock');
  mkdirSync(dirname(lockPath), { recursive: true });
  const acquired = await pollUntil(
    () => {
      try {
        const fd = openSync(lockPath, 'wx');
        writeSync(fd, String(process.pid));
        closeSync(fd);
        return true;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        if (lockIsStale(lockPath)) rmSync(lockPath, { force: true });
        return false;
      }
    },
    { timeoutMs: LOCK_STALE_MS, intervalMs: 50 },
  );
  if (!acquired) throw new Error(`log collector start lock ${lockPath} is held by another process`);
  return () => rmSync(lockPath, { force: true });
}

function lockIsStale(lockPath) {
  try {
    const owner = Number(readFileSync(lockPath, 'utf8'));
    // An empty file is a lock being written right now: not stale unless old.
    if (owner && !isAlive(owner)) return true;
    return Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false; // gone already; the next try takes it
  }
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => done(new Error('log collector did not become ready in time')), READY_TIMEOUT_MS);
    const done = (err) => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      err ? reject(err) : resolve();
    };
    const onData = (d) => {
      buf += d;
      if (buf.includes('\n')) done(buf.startsWith('ready') ? undefined : new Error(`log collector: ${buf.trim()}`));
    };
    const onExit = (code) => done(new Error(`log collector exited (${code}) before it was ready`));
    child.stdout.on('data', onData);
    child.on('exit', onExit);
  });
}
