// OS process inspection, kept behind small functions so the rest of the CLI
// stays platform-neutral.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OPENFIN_IMAGES = ['openfin.exe', 'openfinrvm.exe'];

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
 * Running OpenFin runtime / RVM processes. Windows only; elsewhere (and on
 * any failure to list) returns [] — OpenFin itself is Windows-only.
 * @returns {Promise<{ name: string, pid: number }[]>}
 */
export async function findOpenFinProcesses({ platform = process.platform } = {}) {
  if (platform !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.match(/^"([^"]+)","(\d+)"/))
      .filter((m) => m && OPENFIN_IMAGES.includes(m[1].toLowerCase()))
      .map((m) => ({ name: m[1], pid: Number(m[2]) }));
  } catch {
    return [];
  }
}
