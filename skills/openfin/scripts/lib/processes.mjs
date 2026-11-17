// OS process inspection, kept behind small functions so the rest of the CLI
// stays platform-neutral.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * TEST-ONLY seam: when set, the path of a JSON file holding
 * `[{ name, pid, commandLine }]` that is used as the OpenFin process list
 * instead of asking the OS (OpenFin processes can't exist off Windows).
 * Never set it in real use.
 */
export const TEST_PROCESS_LIST_ENV = 'OPENFIN_TEST_PROCESS_LIST';

/** True when a process with this PID exists (EPERM: exists, not ours to signal). */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Running OpenFin runtime / RVM processes whose command line references the
 * configured manifest, so other OpenFin apps on the machine don't count.
 * Windows only; elsewhere (and on any failure to list) returns [].
 * @param {{ manifest: string, repoRoot: string }} config
 * @returns {Promise<{ name: string, pid: number, commandLine: string }[]>}
 */
export async function findAppOpenFinProcesses(config, { env = process.env, platform = process.platform } = {}) {
  const all = await listOpenFinProcesses({ env, platform });
  const needles = manifestNeedles(config);
  return all.filter((p) => {
    const cmd = normalize(p.commandLine ?? '');
    return needles.some((n) => cmd.includes(n));
  });
}

/** The manifest as written and as launch resolves it, normalized for matching. */
function manifestNeedles({ manifest, repoRoot }) {
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(manifest);
  return [...new Set([manifest, ...(isUrl ? [] : [resolve(repoRoot, manifest)])].map(normalize))];
}

/** Windows paths and URLs compare case-insensitively, with either slash. */
const normalize = (s) => s.toLowerCase().replaceAll('\\', '/');

async function listOpenFinProcesses({ env, platform }) {
  if (env[TEST_PROCESS_LIST_ENV]) {
    try {
      return JSON.parse(readFileSync(env[TEST_PROCESS_LIST_ENV], 'utf8'));
    } catch {
      return [];
    }
  }
  if (platform !== 'win32') return [];
  try {
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name='OpenFin.exe' OR Name='OpenFinRVM.exe'\" | " +
      'Select-Object Name,ProcessId,CommandLine | ConvertTo-Json -Compress';
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 10000,
    });
    if (!stdout.trim()) return [];
    const rows = [].concat(JSON.parse(stdout)); // one process comes back as an object, not an array
    return rows.map((r) => ({ name: r.Name, pid: r.ProcessId, commandLine: r.CommandLine ?? '' }));
  } catch {
    return [];
  }
}
