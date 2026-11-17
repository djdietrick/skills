// Connection to the OpenFin runtime's Chromium debug port.
//
// probeDebugPort: cheap HTTP check (no playwright needed) used by `status`
// and by launch's readiness wait.
// connect: Playwright connectOverCDP; every target-taking command goes
// through it. Always `await session.close()` — it only disconnects; the
// remote runtime keeps running. Connecting is the "first attach": it makes
// sure the background log collector is running (see collector.mjs).
import { CliError, ErrorCode } from './errors.mjs';
import { loadPlaywright } from './playwright.mjs';
import { ensureCollector } from './collector.mjs';

export const DEBUG_HOST = '127.0.0.1';

export function debugUrl(port) {
  return `http://${DEBUG_HOST}:${port}`;
}

/**
 * @returns {Promise<{ reachable: true, browser: string, protocolVersion?: string, webSocketDebuggerUrl?: string, browserId?: string }
 *   | { reachable: false, reason: string }>}
 */
export async function probeDebugPort(port, { timeoutMs = 1500 } = {}) {
  try {
    const res = await fetch(`${debugUrl(port)}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { reachable: false, reason: `HTTP ${res.status} from /json/version` };
    const v = await res.json();
    return {
      reachable: true,
      browser: v.Browser,
      protocolVersion: v['Protocol-Version'],
      webSocketDebuggerUrl: v.webSocketDebuggerUrl,
      // The browser GUID: new on every runtime start, so it identifies this instance.
      browserId: v.webSocketDebuggerUrl?.match(/\/devtools\/browser\/([^/?#]+)/)?.[1],
    };
  } catch (err) {
    return { reachable: false, reason: err?.cause?.code ?? err?.name ?? String(err) };
  }
}

/**
 * Connect over CDP to the configured debug port.
 * @param {{ repoRoot: string, debugPort: number }} config
 * @param {{ timeoutMs?: number, collector?: boolean }} [opts]  collector:false skips ensureCollector
 * @returns {Promise<{ browser: import('playwright-core').Browser, pages(): import('playwright-core').Page[], close(): Promise<void> }>}
 * @throws {CliError} PLAYWRIGHT_MISSING | DEBUG_PORT_UNREACHABLE
 */
export async function connect(config, { timeoutMs = 10000, collector = true } = {}) {
  const { playwright } = await loadPlaywright({ repoRoot: config.repoRoot });
  let browser;
  try {
    browser = await playwright.chromium.connectOverCDP(debugUrl(config.debugPort), { timeout: timeoutMs });
  } catch (err) {
    throw unreachableError(config.debugPort, err?.message);
  }
  if (collector) {
    // Best effort: a collector that fails to start must not fail the command.
    await ensureCollector(config).catch((err) => process.stderr.write(`log collector not started: ${err?.message ?? err}\n`));
  }
  return {
    browser,
    pages: () => browser.contexts().flatMap((c) => c.pages()),
    close: async () => {
      // For connectOverCDP this disconnects; it does not close the runtime.
      await browser.close().catch(() => {});
    },
  };
}

export function unreachableError(port, reason) {
  return new CliError(ErrorCode.DEBUG_PORT_UNREACHABLE, `Nothing is answering on the OpenFin debug port ${port}.`, {
    hint:
      'Run `status` to check whether an instance is running. If none is, use `launch`. If one is running ' +
      'without the debug port, ask the developer to add --remote-debugging-port to its runtime arguments.',
    details: { debugPort: port, ...(reason ? { reason } : {}) },
  });
}
