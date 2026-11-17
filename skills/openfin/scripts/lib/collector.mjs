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
//                                                        collector on the same port
//   stopCollector(repoRoot) -> { stopped, pid? }         kills it, clears state.collector
//   collectorStatus(repoRoot) -> { running, pid?, logFile? }
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratchDir, readState, updateState } from './state.mjs';
import { isAlive } from './processes.mjs';

const COLLECTOR_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'collector.mjs');
const READY_TIMEOUT_MS = 15000;

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
