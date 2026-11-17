// Test-side helpers for the background log collector. Tests read its PID
// from the session state file (the same place `stop` will) and always kill
// it afterwards, so no collector outlives its test. Process checks reuse the
// CLI's own helpers (plain PID utilities, not CLI behaviour under test).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { isAlive } from '../../scripts/lib/processes.mjs';
import { waitForExit as waitForOwnedExit } from '../../scripts/lib/owned.mjs';

export function collectorPid(repo) {
  try {
    return JSON.parse(readFileSync(join(repo, '.scratch', 'openfin', 'state.json'), 'utf8')).collector?.pid;
  } catch {
    return undefined;
  }
}

/**
 * PIDs of every collector process started for `repo` (found by command line,
 * so it includes any the state file doesn't name). POSIX only; elsewhere
 * falls back to the state file's collector.
 */
export function collectorPidsFor(repo) {
  if (process.platform === 'win32') return [collectorPid(repo)].filter(Boolean);
  const out = execFileSync('ps', ['-A', '-o', 'pid=,command='], { encoding: 'utf8' });
  const dir = basename(repo); // unique temp dir name; immune to /var vs /private/var
  return out
    .split('\n')
    .filter((line) => line.includes('collector.mjs') && line.includes(dir))
    .map((line) => Number(line.trim().split(/\s+/)[0]));
}

export { isAlive };

/** Wait until `pid` has exited; false on timeout. */
export function waitForExit(pid, timeoutMs = 5000) {
  return waitForOwnedExit(pid, timeoutMs);
}

/** Register a t.after that kills every collector started for the repo. */
export function killCollectorAfter(t, repo) {
  t.after(async () => {
    for (const pid of new Set([collectorPid(repo), ...collectorPidsFor(repo)])) {
      if (!isAlive(pid)) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
      await waitForExit(pid);
    }
  });
}
