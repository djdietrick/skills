// Test-side helpers for the background log collector. Tests read its PID
// from the session state file (the same place `stop` will) and always kill
// it afterwards, so no collector outlives its test.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export function collectorPid(repo) {
  try {
    return JSON.parse(readFileSync(join(repo, '.scratch', 'openfin', 'state.json'), 'utf8')).collector?.pid;
  } catch {
    return undefined;
  }
}

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Wait until `pid` has exited; false on timeout. */
export async function waitForExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
  return true;
}

/** Register a t.after that kills whatever collector the repo's state names. */
export function killCollectorAfter(t, repo) {
  t.after(async () => {
    const pid = collectorPid(repo);
    if (!isAlive(pid)) return;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
    await waitForExit(pid);
  });
}
