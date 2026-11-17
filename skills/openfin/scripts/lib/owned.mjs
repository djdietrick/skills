// Processes this skill starts and therefore owns: the dev server and the app
// launcher. Each runs detached (its own process group on POSIX) so it outlives
// the CLI call, with stdout+stderr written to a fresh log file under
// .scratch/openfin/launch/ so a failed launch can report what it printed.
//
// Only ever kill a process (tree) by a PID this skill recorded. Never by image
// name: the OpenFin runtime is shared with other apps.
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { scratchDir } from './state.mjs';
import { isAlive } from './processes.mjs';

export function launchDir(repoRoot) {
  return join(scratchDir(repoRoot), 'launch');
}

/**
 * Start a detached process with output written (truncating) to `logFile`.
 * Pass `command` (run through the shell) or `file` + `args` (no shell);
 * `env` replaces the environment when given.
 * @returns {import('node:child_process').ChildProcess}  call `.unref()` once you're done watching it
 */
export function spawnOwned({ command, file, args = [], cwd, env, logFile }) {
  mkdirSync(dirname(logFile), { recursive: true });
  const fd = openSync(logFile, 'w');
  try {
    const opts = { cwd, env, detached: true, stdio: ['ignore', fd, fd], windowsHide: true };
    const child = command !== undefined ? spawn(command, { ...opts, shell: true }) : spawn(file, args, opts);
    child.on('error', () => {}); // surfaced through 'exit' / readiness checks
    return child;
  } finally {
    closeSync(fd);
  }
}

/** Last `max` characters of a log file ('' if unreadable). */
export function tail(file, max = 4000) {
  try {
    const text = readFileSync(file, 'utf8');
    return text.length > max ? text.slice(-max) : text;
  } catch {
    return '';
  }
}

/**
 * Terminate the process tree rooted at `pid` (a process this skill started).
 * POSIX: SIGTERM to its process group. Windows: `taskkill /T` on that PID only.
 * @returns {Promise<boolean>} whether it was alive and is now gone
 */
export async function killOwnedTree(pid, { timeoutMs = 5000 } = {}) {
  if (!isAlive(pid)) return false;
  if (process.platform === 'win32') {
    await new Promise((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
  } else {
    signalGroup(pid, 'SIGTERM');
    if (!(await waitForExit(pid, timeoutMs))) signalGroup(pid, 'SIGKILL');
  }
  return waitForExit(pid, timeoutMs);
}

function signalGroup(pid, signal) {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, signal);
      return;
    } catch {
      // not a group leader, or gone
    }
  }
}

export async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}
