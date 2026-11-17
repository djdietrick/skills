// `openfin launch` — attach first, launch only when nothing is running.
//
// Debug port reachable: attach (start nothing), make sure the log collector runs.
// Otherwise:
//   1. dev server (config.devServer): skipped when its readyUrl already
//      answers (someone else runs it; not ours). Else start it and wait for
//      readySignal in its output / readyUrl to answer.
//   2. app: config.launcher (a stand-in command, used by tests) or the RVM:
//      %LOCALAPPDATA%\OpenFin\OpenFinRVM.exe --config=<manifest>
//        --runtime-arguments=--remote-debugging-port=<port>
//      Wait for the debug port and a first page target.
//   3. record what was started in the session state, start the collector.
// Any failure: stop what this call started, LAUNCH_FAILED with its output.
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { probeDebugPort, debugUrl } from '../lib/cdp.mjs';
import { ensureCollector } from '../lib/collector.mjs';
import { CliError, ErrorCode } from '../lib/errors.mjs';
import { readState, updateState, launchedBySkill } from '../lib/state.mjs';
import { spawnOwned, killOwnedTree, tail, launchDir } from '../lib/owned.mjs';

const DEV_SERVER_TIMEOUT_MS = 120_000;
const APP_TIMEOUT_MS = 120_000;
const POLL_MS = 250;

export default {
  summary: 'Start the dev server and the app with the debug port enabled.',
  needsConfig: true,
  async run({ config, env }) {
    const { debugPort, repoRoot } = config;
    if ((await probeDebugPort(debugPort)).reachable) {
      return {
        launched: false,
        attached: true,
        debugPort,
        launchedBySkill: launchedBySkill(readState(repoRoot), debugPort),
        collector: await startCollector(config),
      };
    }

    const logs = { devServer: join(launchDir(repoRoot), 'dev-server.log'), app: join(launchDir(repoRoot), 'app.log') };
    let devServer = null;
    let app = null;
    try {
      devServer = await startDevServer(config, logs.devServer);
      if (devServer?.pid) updateState(repoRoot, (s) => ({ ...s, devServer: { ...devServer, startedAt: new Date().toISOString() } }));
      app = await startApp(config, env, logs.app);
    } catch (err) {
      if (app?.pid) await killOwnedTree(app.pid);
      if (devServer?.pid) {
        await killOwnedTree(devServer.pid);
        updateState(repoRoot, (s) => ({ ...s, devServer: null }));
      }
      if (err instanceof CliError) throw err;
      throw launchFailed(`Launch failed: ${err?.message ?? err}`, logs);
    }

    updateState(repoRoot, (s) => ({
      ...s,
      debugPort,
      app: { launchedBySkill: true, pid: app.pid, command: app.command, logFile: logs.app, startedAt: new Date().toISOString() },
    }));
    return {
      launched: true,
      attached: false,
      debugPort,
      app: { pid: app.pid, command: app.command },
      devServer: devServer ?? null,
      collector: await startCollector(config),
    };
  },
};

async function startCollector(config) {
  try {
    return await ensureCollector(config);
  } catch (err) {
    return { running: false, error: err?.message ?? String(err) };
  }
}

/** @returns {Promise<null | { alreadyRunning: true, readyUrl: string } | { pid: number, command: string, cwd: string, logFile: string }>} */
async function startDevServer(config, logFile) {
  const ds = config.devServer;
  if (!ds) return null;
  if (ds.readyUrl && (await urlResponds(ds.readyUrl))) return { alreadyRunning: true, readyUrl: ds.readyUrl };

  const child = spawnOwned({ command: ds.command, cwd: ds.cwd, logFile });
  const exit = watchExit(child);
  const started = { pid: child.pid, command: ds.command, cwd: ds.cwd, logFile };
  const fail = (message) => {
    const e = launchFailed(message, { devServer: logFile });
    e.started = started;
    return e;
  };
  if (!child.pid) throw fail(`Could not start the dev server (${ds.command}).`);

  const deadline = Date.now() + DEV_SERVER_TIMEOUT_MS;
  for (;;) {
    if (exit.code !== undefined) throw fail(`The dev server exited (code ${exit.code}) before it was ready.`);
    if (ds.readySignal ? tail(logFile, Infinity).includes(ds.readySignal) : ds.readyUrl ? await urlResponds(ds.readyUrl) : true) break;
    if (Date.now() > deadline) {
      throw fail(`The dev server wasn't ready after ${DEV_SERVER_TIMEOUT_MS / 1000}s (waiting for ${ds.readySignal ? `"${ds.readySignal}" in its output` : ds.readyUrl}).`);
    }
    await sleep(POLL_MS);
  }
  child.unref();
  return started;
}

/** @returns {Promise<{ pid: number, command: string }>} */
async function startApp(config, env, logFile) {
  const { debugPort, repoRoot } = config;
  const manifest = /^[a-z][a-z0-9+.-]*:\/\//i.test(config.manifest) ? config.manifest : resolve(repoRoot, config.manifest);
  let spec;
  if (config.launcher) {
    const command = config.launcher.command.replaceAll('{debugPort}', String(debugPort)).replaceAll('{manifest}', manifest);
    spec = { command, cwd: config.launcher.cwd, display: command };
  } else {
    if (process.platform !== 'win32') {
      throw new CliError(ErrorCode.LAUNCH_FAILED, 'OpenFin apps launch through the RVM, which exists only on Windows.', {
        hint: 'Run the skill on Windows, or attach to an instance started elsewhere with the debug port open.',
      });
    }
    const rvm = join(env.LOCALAPPDATA ?? '', 'OpenFin', 'OpenFinRVM.exe');
    if (!existsSync(rvm)) {
      throw new CliError(ErrorCode.LAUNCH_FAILED, `The OpenFin RVM was not found at ${rvm}.`, {
        hint: 'Install the OpenFin RVM (it comes with any OpenFin app installer), or ask the developer to start the app with the debug port open.',
      });
    }
    const args = [`--config=${manifest}`, `--runtime-arguments=--remote-debugging-port=${debugPort}`];
    spec = { file: rvm, args, cwd: repoRoot, display: [rvm, ...args].join(' ') };
  }

  const child = spawnOwned({ ...spec, logFile });
  const exit = watchExit(child);
  const started = { pid: child.pid, command: spec.display };
  const fail = (message) => {
    const e = launchFailed(message, { app: logFile });
    e.started = started;
    return e;
  };
  if (!child.pid) throw fail(`Could not start the app (${spec.display}).`);

  // The RVM exits 0 once it has handed off to the runtime; only a non-zero exit is a failure.
  const deadline = Date.now() + APP_TIMEOUT_MS;
  for (;;) {
    if (exit.code !== undefined && exit.code !== 0) throw fail(`The app launcher exited with code ${exit.code}.`);
    if (await hasPageTarget(debugPort)) break;
    if (Date.now() > deadline) {
      throw fail(`Nothing answered on debug port ${debugPort} with a window after ${APP_TIMEOUT_MS / 1000}s.`);
    }
    await sleep(POLL_MS);
  }
  child.unref();
  return started;
}

function watchExit(child) {
  const state = { code: undefined };
  child.on('exit', (code, signal) => (state.code = code ?? signal ?? 'unknown'));
  child.on('error', (err) => (state.code = err.code ?? 'error'));
  return state;
}

async function hasPageTarget(port) {
  try {
    const res = await fetch(`${debugUrl(port)}/json/list`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return false;
    return (await res.json()).some((t) => t.type === 'page');
  } catch {
    return false;
  }
}

/** True when `url` answers with a non-5xx HTTP response. */
export async function urlResponds(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    await res.body?.cancel();
    return res.status < 500;
  } catch {
    return false;
  }
}

function launchFailed(message, logs) {
  const details = {};
  if (logs.devServer) Object.assign(details, { devServerOutput: tail(logs.devServer), devServerLog: logs.devServer });
  if (logs.app) Object.assign(details, { runtimeOutput: tail(logs.app), runtimeLog: logs.app });
  return new CliError(ErrorCode.LAUNCH_FAILED, message, {
    hint: 'Read the captured output (devServerOutput / runtimeOutput) for the cause, fix it, and run launch again. For runtime failures also check debug.log in the configured logsDir.',
    details,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
