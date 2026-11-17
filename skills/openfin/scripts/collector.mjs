#!/usr/bin/env node
// Log collector process. Started detached by lib/collector.mjs
// ensureCollector; not a CLI command.
//
//   node scripts/collector.mjs --repo-root <dir> --debug-port <n> --log-file <path>
//
// Connects over CDP, subscribes to console and pageerror on every current
// page and every page opened later, and appends one JSON line per event to
// the log file. Prints "ready" on stdout once subscribed to the current
// pages (nothing after that). Exits when the runtime disconnects or on
// SIGTERM/SIGINT.
import { appendFileSync } from 'node:fs';
import { parseArgs } from './lib/args.mjs';
import { loadPlaywright } from './lib/playwright.mjs';
import { debugUrl } from './lib/cdp.mjs';
import { identifyPage } from './lib/targets.mjs';

const { flags } = parseArgs(['collector', ...process.argv.slice(2)]);
const repoRoot = flags['repo-root'];
const debugPort = Number(flags['debug-port']);
const logFile = flags['log-file'];

const LEVELS = { warning: 'warn', trace: 'debug' };

function write(entry) {
  appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

function watch(page) {
  // Per-page queue keeps entries in event order while the label resolves.
  let queue = Promise.resolve();
  let label;
  let labelUrl;
  const labelFor = async () => {
    const url = page.url();
    if (label && labelUrl === url) return label;
    if (url === 'about:blank') await page.waitForLoadState('domcontentloaded').catch(() => {});
    labelUrl = page.url();
    label = (await identifyPage(page, null).catch(() => ({ target: labelUrl }))).target;
    return label;
  };
  const record = (fields) => {
    const ts = new Date().toISOString();
    queue = queue.then(async () => write({ ts, target: await labelFor(), ...fields })).catch((err) => {
      process.stderr.write(`collector: ${err?.stack ?? err}\n`);
    });
  };
  page.on('console', (msg) => {
    const type = msg.type();
    record({ level: LEVELS[type] ?? (['debug', 'info', 'error', 'warn'].includes(type) ? type : 'log'), text: msg.text(), type: 'console' });
  });
  page.on('pageerror', (err) => {
    record({ level: 'error', text: `${err.name}: ${err.message}`, type: 'pageerror', ...(err.stack ? { stack: err.stack } : {}) });
  });
}

async function main() {
  const { playwright } = await loadPlaywright({ repoRoot });
  const browser = await playwright.chromium.connectOverCDP(debugUrl(debugPort), { timeout: 10000 });
  browser.on('disconnected', () => process.exit(0));
  for (const context of browser.contexts()) {
    context.pages().forEach(watch);
    context.on('page', watch);
  }
  process.stdout.write('ready\n');
}

process.stdout.on('error', () => {}); // parent may have closed the pipe
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

main().catch((err) => {
  process.stdout.write(`error ${err?.message ?? err}\n`);
  process.stderr.write(`collector: ${err?.stack ?? err}\n`);
  process.exit(1);
});
