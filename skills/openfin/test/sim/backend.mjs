#!/usr/bin/env node
// Simulated OpenFin runtime for tests: headless Chromium with a remote
// debugging port, showing fixture pages that carry a fake `fin` global.
//
//   node test/sim/backend.mjs [--debug-port N] [--fixtures <json-array | path-to-json>]
//                             [--exit-on-stdin-close]
//
// Prints one JSON line when every startup page has loaded:
//   { "debugPort": N, "httpPort": M, "baseUrl": "http://127.0.0.1:M", "browserPid": P }
// then runs until one of: the fake fin.Application quit() is called (POST
// /__quit), SIGTERM/SIGINT, or (with --exit-on-stdin-close) stdin closes.
// On exit it kills Chromium and removes its profile directory.
//
// Usable directly by tests (test/helpers/sim.mjs startSim) and as the
// stand-in "launcher" command in a fixture project config.
//
// HTTP control endpoints (baseUrl):
//   GET  /page/<id>          fixture page
//   GET  /__snapshot?uuid=U  platform snapshot for app U (open pages only)
//   POST /__open?id=<id>     open fixture <id> as a new page target
//   POST /__quit             shut everything down
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_FIXTURES } from './fixtures.mjs';
import { findChromium } from './chromium.mjs';
import { fakeFinScript } from './fake-fin.mjs';

function parseCli(argv) {
  const opts = { debugPort: 0, fixtures: DEFAULT_FIXTURES, exitOnStdinClose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--debug-port') opts.debugPort = Number(argv[++i]);
    else if (a === '--fixtures') {
      const v = argv[++i];
      opts.fixtures = JSON.parse(v.trim().startsWith('[') ? v : readFileSync(v, 'utf8'));
    } else if (a === '--exit-on-stdin-close') opts.exitOnStdinClose = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

const opts = parseCli(process.argv.slice(2));
const fixtures = opts.fixtures.map((f) => ({ title: f.id, open: true, fin: true, ...f }));
const byId = new Map(fixtures.map((f) => [f.id, f]));
const opened = new Set();
let baseUrl;
let chrome;
let profileDir;
let shuttingDown = false;

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pageUrl = (id) => `${baseUrl}/page/${encodeURIComponent(id)}`;

function snapshot(uuid) {
  const windows = fixtures
    .filter((f) => f.kind === 'window' && f.uuid === uuid && opened.has(f.id))
    .map((w) => {
      const views = fixtures.filter((v) => v.kind === 'view' && v.parent === w.id && opened.has(v.id));
      return {
        name: w.name,
        url: pageUrl(w.id),
        ...(views.length
          ? {
              layout: {
                content: [
                  {
                    type: 'stack',
                    content: views.map((v) => ({
                      type: 'component',
                      componentName: 'view',
                      componentState: { name: v.name, uuid: v.uuid, url: pageUrl(v.id) },
                    })),
                  },
                ],
              },
            }
          : {}),
      };
    });
  return { windows };
}

function renderPage(f) {
  const parent = f.parent ? byId.get(f.parent) : undefined;
  const fin = f.fin
    ? `<script>${fakeFinScript({
        identity: { uuid: f.uuid, name: f.name },
        kind: f.kind,
        parentIdentity: parent ? { uuid: parent.uuid, name: parent.name } : null,
      })}</script>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(f.title)}</title>${fin}</head><body>${f.body ?? ''}</body></html>`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, baseUrl);
  const send = (status, body, type = 'text/plain') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  if (req.method === 'GET' && url.pathname.startsWith('/page/')) {
    const f = byId.get(decodeURIComponent(url.pathname.slice('/page/'.length)));
    return f ? send(200, renderPage(f), 'text/html; charset=utf-8') : send(404, 'no such fixture');
  }
  if (req.method === 'GET' && url.pathname === '/__snapshot') {
    return send(200, JSON.stringify(snapshot(url.searchParams.get('uuid'))), 'application/json');
  }
  if (req.method === 'POST' && url.pathname === '/__open') {
    const id = url.searchParams.get('id');
    if (!byId.has(id)) return send(404, `no such fixture ${id}`);
    openPages([id]).then(
      () => send(200, 'ok'),
      (e) => send(500, String(e)),
    );
    return;
  }
  if (req.method === 'POST' && url.pathname === '/__quit') {
    send(200, 'bye');
    setImmediate(() => shutdown(0));
    return;
  }
  send(404, 'not found');
});

async function cdpJson(path, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${opts.debugPort}${path}`, { method });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  return res.json();
}

/** Open fixture pages as new targets and wait until each has loaded (title set). */
async function openPages(ids) {
  for (const id of ids) {
    await cdpJson(`/json/new?${encodeURIComponent(pageUrl(id))}`, 'PUT');
    opened.add(id);
  }
  const want = new Map(ids.map((id) => [pageUrl(id), byId.get(id).title]));
  for (let i = 0; i < 200; i++) {
    const list = await cdpJson('/json/list');
    const loaded = [...want].every(([u, title]) => list.some((t) => t.url === u && t.title === title));
    if (loaded) return;
    await sleep(25);
  }
  throw new Error(`fixture pages did not load: ${ids.join(', ')}`);
}

async function waitForDebugPort() {
  for (let i = 0; i < 400; i++) {
    if (chrome.exitCode !== null) throw new Error(`Chromium exited early (${chrome.exitCode})`);
    if (!opts.debugPort) {
      try {
        opts.debugPort = Number(readFileSync(join(profileDir, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      } catch {
        // not written yet
      }
    }
    if (opts.debugPort) {
      try {
        await cdpJson('/json/version');
        return;
      } catch {
        // not listening yet
      }
    }
    await sleep(25);
  }
  throw new Error('Chromium debug port never came up');
}

function killChrome() {
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    try {
      chrome.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  killChrome();
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    await new Promise((r) => chrome.once('exit', r));
  }
  server.close();
  server.closeAllConnections?.();
  if (profileDir) rmSync(profileDir, { recursive: true, force: true, maxRetries: 5 });
  process.exit(code);
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('exit', killChrome); // last resort: never leave Chromium behind
if (opts.exitOnStdinClose) {
  process.stdin.on('end', () => shutdown(0));
  process.stdin.on('error', () => shutdown(0));
  process.stdin.resume();
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const { path: exe, headlessShell } = findChromium();
  profileDir = mkdtempSync(join(tmpdir(), 'openfin-sim-profile-'));
  chrome = spawn(
    exe,
    [
      headlessShell ? '--headless' : '--headless=new',
      `--remote-debugging-port=${opts.debugPort}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--use-mock-keychain',
      '--password-store=basic',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let chromeErr = '';
  chrome.stderr.on('data', (d) => (chromeErr = (chromeErr + d).slice(-4000)));
  chrome.on('exit', () => {
    if (!shuttingDown) {
      process.stderr.write(`sim: Chromium exited unexpectedly\n${chromeErr}\n`);
      shutdown(1);
    }
  });

  await waitForDebugPort();
  // Close the about:blank bootstrap tab so only fixture pages are targets.
  const blank = (await cdpJson('/json/list')).filter((t) => t.type === 'page' && t.url === 'about:blank');
  await openPages(fixtures.filter((f) => f.open).map((f) => f.id));
  for (const t of blank) await fetch(`http://127.0.0.1:${opts.debugPort}/json/close/${t.id}`);

  process.stdout.write(
    JSON.stringify({ debugPort: opts.debugPort, httpPort: server.address().port, baseUrl, browserPid: chrome.pid }) + '\n',
  );
}

main().catch((err) => {
  process.stderr.write(`sim: ${err?.stack ?? err}\n`);
  shutdown(1);
});
