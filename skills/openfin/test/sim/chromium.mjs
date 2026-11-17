// Find an already-installed Chromium for the simulated backend. Never
// downloads anything. Order:
//   1. $OPENFIN_SIM_CHROMIUM (explicit executable path)
//   2. playwright-core's own expected executable, if present
//   3. the newest chromium_headless_shell-* / chromium-* build in the
//      Playwright browser cache ($PLAYWRIGHT_BROWSERS_PATH or the OS default)
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function cacheDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? homedir(), 'ms-playwright');
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ms-playwright');
}

// Executable locations inside a Playwright browser folder, by flavour.
const CANDIDATES = {
  chromium_headless_shell: [
    'chrome-headless-shell-mac-arm64/chrome-headless-shell',
    'chrome-headless-shell-mac-x64/chrome-headless-shell',
    'chrome-mac/headless_shell',
    'chrome-headless-shell-linux64/chrome-headless-shell',
    'chrome-linux/headless_shell',
    'chrome-headless-shell-win64/chrome-headless-shell.exe',
    'chrome-win/headless_shell.exe',
  ],
  chromium: [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux64/chrome',
    'chrome-linux/chrome',
    'chrome-win64/chrome.exe',
    'chrome-win/chrome.exe',
  ],
};

/** @returns {{ path: string, headlessShell: boolean }} */
export function findChromium() {
  if (process.env.OPENFIN_SIM_CHROMIUM) {
    return { path: process.env.OPENFIN_SIM_CHROMIUM, headlessShell: /headless/i.test(process.env.OPENFIN_SIM_CHROMIUM) };
  }
  try {
    const p = require('playwright-core').chromium.executablePath();
    if (p && existsSync(p)) return { path: p, headlessShell: false };
  } catch {
    // playwright-core missing or unknown platform; fall through to the cache scan
  }
  const dir = cacheDir();
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    // no cache
  }
  for (const flavour of ['chromium_headless_shell', 'chromium']) {
    const builds = entries
      .filter((e) => e.startsWith(`${flavour}-`) && /^\d+$/.test(e.slice(flavour.length + 1)))
      .sort((a, b) => Number(b.slice(flavour.length + 1)) - Number(a.slice(flavour.length + 1)));
    for (const build of builds) {
      for (const rel of CANDIDATES[flavour]) {
        const p = join(dir, build, rel);
        if (existsSync(p)) return { path: p, headlessShell: flavour === 'chromium_headless_shell' };
      }
    }
  }
  throw new Error(
    `No installed Chromium found for the simulated OpenFin backend (looked in ${dir}). ` +
      'Set OPENFIN_SIM_CHROMIUM to a Chromium executable, or install one with `npx playwright-core install chromium-headless-shell`.',
  );
}
