// Session state: what this skill started, so `status` and `stop` work across
// separate agent turns. Lives in the consuming repo at
// .scratch/openfin/state.json (cwd-relative; the scratch area is gitignored
// by convention).
//
// Shape (every field optional; unknown fields are preserved):
//   {
//     version: 1,
//     debugPort: number,                       // port the launched app listens on
//     app:        { browserId: string, pid?: number, startedAt?: string, command?: string, logFile?: string } | null,
//                 // set only by `launch`. browserId is the runtime's browser GUID
//                 // (from /json/version webSocketDebuggerUrl): the instance identity.
//     devServer:  { pid: number, command: string, cwd?: string, startedAt?: string } | null,
//     collector:  { pid: number, logFile?: string, startedAt?: string } | null,
//   }
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const STATE_VERSION = 1;

/** The skill's scratch area in the consuming repo. */
export function scratchDir(repoRoot) {
  return join(repoRoot, '.scratch', 'openfin');
}

export function statePath(repoRoot) {
  return join(scratchDir(repoRoot), 'state.json');
}

/**
 * @returns {object | null} the parsed state, or null when there is none.
 *   An unreadable/corrupt file is treated as no state (it only records what
 *   we started; losing it never makes us kill something we don't own).
 */
export function readState(repoRoot) {
  let text;
  try {
    text = readFileSync(statePath(repoRoot), 'utf8');
  } catch {
    return null;
  }
  try {
    const state = JSON.parse(text);
    return state && typeof state === 'object' && !Array.isArray(state) ? state : null;
  } catch {
    return null;
  }
}

/** Replace the state file atomically. */
export function writeState(repoRoot, state) {
  mkdirSync(scratchDir(repoRoot), { recursive: true });
  const file = statePath(repoRoot);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: STATE_VERSION, ...state }, null, 2) + '\n');
  renameSync(tmp, file);
}

/** Read-modify-write: `fn(current | {})` returns the new state. Returns it. */
export function updateState(repoRoot, fn) {
  const next = fn(readState(repoRoot) ?? {});
  writeState(repoRoot, next);
  return next;
}

export function clearState(repoRoot) {
  rmSync(statePath(repoRoot), { force: true });
}

/**
 * The app launch `launch` recorded for `debugPort`, or null. A launch
 * recorded for a different port doesn't count: the config changed and
 * whatever listens now isn't ours. This says nothing about whether that
 * instance is still the one answering; see isLaunchedInstance.
 * @returns {{ browserId: string, pid?: number } | null}
 */
export function recordedLaunch(state, debugPort) {
  const app = state?.app;
  if (!app?.browserId) return null; // no record, or one without an identity we can check
  return state.debugPort === undefined || state.debugPort === debugPort ? app : null;
}

/**
 * True when the instance answering on the port now (`probe`, from
 * probeDebugPort) is the very one `launch` started: same port and same
 * browser GUID. A restart outside the skill gets a new GUID, so a developer's
 * instance on the same port is never mistaken for ours.
 */
export function isLaunchedInstance(state, debugPort, probe) {
  const app = recordedLaunch(state, debugPort);
  return Boolean(app && probe?.reachable && probe.browserId === app.browserId);
}
