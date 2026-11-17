// `openfin launch [--timeout <ms>]` — attach first, launch only when nothing is running.
//
// Debug port reachable: attach (start nothing), make sure the log collector runs.
// This app's manifest running in OpenFin without the debug port:
// INSTANCE_WITHOUT_DEBUG_PORT, start nothing.
// Otherwise (each wait bounded by --timeout, default 120 s):
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
import { probeDebugPort, debugUrl, withoutDebugPortHint } from '../lib/cdp.mjs';
import { findAppOpenFinProcesses } from '../lib/processes.mjs';
import { tryEnsureCollector } from '../lib/collector.mjs';
import { CliError, ErrorCode } from '../lib/errors.mjs';
import { readState, updateState, isLaunchedInstance } from '../lib/state.mjs';
import { spawnOwned, killOwnedTree, tail, launchDir } from '../lib/owned.mjs';
import { timeoutFlag } from '../lib/args.mjs';
import { pollUntil } from '../lib/wait.mjs';

const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_MS = 250;
const MANIFEST_ENV = 'OPENFIN_LAUNCH_MANIFEST';

export default {
  summary: 'Start the dev server and the app with the debug port enabled.',
  needsConfig: true,
  async run({ config, env, args }) {
    const { debugPort, repoRoot } = config;
    const timeoutMs = timeoutFlag(args.flags.timeout, DEFAULT_TIMEOUT_MS);
    const probe = await probeDebugPort(debugPort);
    if (probe.reachable) {
      return {
        launched: false,
        attached: true,
        debugPort,
        launchedBySkill: isLaunchedInstance(readState(repoRoot), debugPort, probe),
        collector: await tryEnsureCollector(config),
      };
    }

    // This app already running without the debug port: launching again would
    // start a second instance (or hand off to the running one). Don't.
    const running = await findAppOpenFinProcesses(config);
    if (running.length) {
      throw new CliError(
        ErrorCode.INSTANCE_WITHOUT_DEBUG_PORT,
        `This app's manifest is already running in OpenFin, but nothing answers on debug port ${debugPort}.`,
        { hint: withoutDebugPortHint(debugPort), details: { debugPort, processes: running } },
      );
    }

    const logs = { devServer: join(launchDir(repoRoot), 'dev-server.log'), app: join(launchDir(repoRoot), 'app.log') };
    let devServer = null;
    let app;
    try {
      devServer = await startDevServer(config, logs.devServer, timeoutMs);
      if (devServer?.pid) updateState(repoRoot, (s) => ({ ...s, devServer: { ...devServer, startedAt: new Date().toISOString() } }));
      app = await startApp(config, env, logs.app, timeoutMs);
    } catch (err) {
      // startDevServer / startApp kill their own process when they fail; a
      // dev server that did come up is ours to stop again.
      if (devServer?.pid) {
        await killOwnedTree(devServer.pid);
        updateState(repoRoot, (s) => ({ ...s, devServer: null }));
      }
      if (err instanceof CliError) throw err;
      throw launchFailed(`Launch failed: ${err?.message ?? err}`, logs);
    }

    // The browser GUID identifies this instance, so `stop` can tell it from
    // one the developer starts on the same port later.
    const { browserId } = await probeDebugPort(debugPort);
    updateState(repoRoot, (s) => ({
      ...s,
      debugPort,
      app: { browserId, pid: app.pid, command: app.command, logFile: logs.app, startedAt: new Date().toISOString() },
    }));
    return {
      launched: true,
      attached: false,
      debugPort,
      app: { pid: app.pid, command: app.command },
      devServer: devServer ?? null,
      collector: await tryEnsureCollector(config),
    };
  },
};

/** @returns {Promise<null | { alreadyRunning: true, readyUrl: string } | { pid: number, command: string, cwd: string, logFile: string }>} */
async function startDevServer(config, logFile, timeoutMs) {
  const ds = config.devServer;
  if (!ds) return null;
  if (ds.readyUrl && (await urlResponds(ds.readyUrl))) return { alreadyRunning: true, readyUrl: ds.readyUrl };

  const { pid } = await startOwned({
    spec: { command: ds.command, cwd: ds.cwd, display: ds.command },
    label: 'dev server',
    logFile,
    failLogs: { devServer: logFile },
    timeoutMs,
    // Config validation guarantees one of the two.
    isReady: async () => (ds.readySignal ? tail(logFile, Infinity).includes(ds.readySignal) : urlResponds(ds.readyUrl)),
    exitFails: () => true,
    exitMessage: (code) => `The dev server exited (code ${code}) before it was ready.`,
    timeoutMessage: (secs) =>
      `The dev server wasn't ready after ${secs}s (waiting for ${ds.readySignal ? `"${ds.readySignal}" in its output` : ds.readyUrl}).`,
  });
  return { pid, command: ds.command, cwd: ds.cwd, logFile };
}

/** @returns {Promise<{ pid: number, command: string }>} */
async function startApp(config, env, logFile, timeoutMs) {
  const { debugPort, repoRoot } = config;
  const manifest = /^[a-z][a-z0-9+.-]*:\/\//i.test(config.manifest) ? config.manifest : resolve(repoRoot, config.manifest);
  let spec;
  if (config.launcher) {
    // {manifest} becomes a quoted reference to an env var holding it, so the
    // shell passes it as one argument and never interprets its characters.
    const manifestRef = process.platform === 'win32' ? `"%${MANIFEST_ENV}%"` : `"$${MANIFEST_ENV}"`;
    const command = config.launcher.command.replaceAll('{debugPort}', String(debugPort)).replaceAll('{manifest}', manifestRef);
    spec = { command, cwd: config.launcher.cwd, env: { ...process.env, [MANIFEST_ENV]: manifest }, display: command };
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

  const { pid } = await startOwned({
    spec,
    label: 'app',
    logFile,
    failLogs: { app: logFile },
    timeoutMs,
    isReady: () => hasPageTarget(debugPort),
    // The RVM exits 0 once it has handed off to the runtime; only a non-zero exit is a failure.
    exitFails: (code) => code !== 0,
    exitMessage: (code) => `The app launcher exited with code ${code}.`,
    timeoutMessage: (secs) => `Nothing answered on debug port ${debugPort} with a window after ${secs}s.`,
  });
  return { pid, command: spec.display };
}

/**
 * Spawn a process this skill owns and wait until `isReady()`. On any failure
 * (could not spawn, exited early, not ready in time) its process tree is
 * killed before LAUNCH_FAILED is thrown, so a failed start never leaks.
 * @returns {Promise<{ pid: number }>}
 */
async function startOwned({ spec, label, logFile, failLogs, timeoutMs, isReady, exitFails, exitMessage, timeoutMessage }) {
  const child = spawnOwned({ ...spec, logFile });
  const exit = watchExit(child);
  try {
    if (!child.pid) throw new Error(`Could not start the ${label} (${spec.display}).`);
    const ready = await pollUntil(
      () => {
        if (exit.code !== undefined && exitFails(exit.code)) throw new Error(exitMessage(exit.code));
        return isReady();
      },
      { timeoutMs, intervalMs: POLL_MS },
    );
    if (!ready) throw new Error(timeoutMessage(timeoutMs / 1000));
  } catch (err) {
    if (child.pid) await killOwnedTree(child.pid);
    throw launchFailed(err.message, failLogs);
  }
  child.unref();
  return { pid: child.pid };
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
