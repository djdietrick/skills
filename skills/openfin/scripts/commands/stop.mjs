// `openfin stop [--timeout <ms>]` — stop only what this skill started; report the rest.
//
// App: only if the instance answering on the debug port is the very one
// `launch` started (same browser GUID; see state.isLaunchedInstance). It is
// quit gracefully over CDP (fin.Application.getCurrentSync().quit() in one of
// its windows), then we wait up to --timeout (default 15 s) for the debug
// port to close. The app is never killed: the RVM and runtime are shared with
// other OpenFin apps. If it doesn't close, it is reported in leftRunning.
// A launch record whose instance has gone (or been replaced) is cleared.
// Dev server: killed by recorded PID tree only if `launch` started it and
// that PID is still alive.
// Log collector: always the skill's own; stopped first.
import { probeDebugPort, connect } from '../lib/cdp.mjs';
import { stopCollector } from '../lib/collector.mjs';
import { readState, updateState, recordedLaunch, isLaunchedInstance } from '../lib/state.mjs';
import { identifyPage, WORKSPACE_UUID } from '../lib/targets.mjs';
import { killOwnedTree } from '../lib/owned.mjs';
import { isAlive } from '../lib/processes.mjs';
import { runtimeDebugLogPath } from '../lib/config.mjs';
import { timeoutFlag } from '../lib/args.mjs';
import { pollUntil, withTimeout } from '../lib/wait.mjs';
import { urlResponds } from './launch.mjs';

const DEFAULT_QUIT_TIMEOUT_MS = 15_000;
const EVAL_TIMEOUT_MS = 3000;

export default {
  summary: 'Stop what this skill launched; leave attached instances alone.',
  needsConfig: true,
  async run({ config, args }) {
    const { debugPort, repoRoot } = config;
    const quitTimeoutMs = timeoutFlag(args.flags.timeout, DEFAULT_QUIT_TIMEOUT_MS);
    const state = readState(repoRoot) ?? {};
    const stopped = [];
    const leftRunning = [];
    const probe = await probeDebugPort(debugPort);
    const launch = recordedLaunch(state, debugPort);
    const clearAppRecord = () => updateState(repoRoot, (s) => ({ ...s, app: null }));

    // Collector first, so the app quitting doesn't race its own shutdown.
    const collector = stopCollector(repoRoot);
    if (collector.pid) stopped.push({ what: 'collector', pid: collector.pid, ...(collector.stopped ? {} : { alreadyExited: true }) });

    if (isLaunchedInstance(state, debugPort, probe)) {
      const pid = launch.pid;
      const quitIn = await requestQuit(config);
      if (quitIn && (await waitForPortClosed(debugPort, quitTimeoutMs))) {
        stopped.push({ what: 'app', debugPort, pid, quitVia: quitIn });
        clearAppRecord();
      } else {
        leftRunning.push({
          what: 'app',
          debugPort,
          pid,
          reason: quitIn
            ? `quit() was called in ${quitIn} but the debug port still answers after ${quitTimeoutMs / 1000}s`
            : 'no app window with the fin API to call quit() in',
          hint:
            'The skill never force-kills the OpenFin runtime (it is shared with other OpenFin apps). Ask the developer to close the app, ' +
            'or run stop again later. Check the runtime debug.log for why it did not quit.',
          runtimeDebugLog: runtimeDebugLogPath(config.logsDir),
        });
      }
    } else {
      if (launch) {
        // The instance launch started is gone. Whatever answers now (if anything) isn't ours.
        if (!probe.reachable) stopped.push({ what: 'app', debugPort, pid: launch.pid, alreadyExited: true });
        clearAppRecord();
      }
      if (probe.reachable) {
        leftRunning.push({
          what: 'app',
          debugPort,
          reason: launch
            ? 'a different instance than the one launch started (that one exited); not launched by this skill'
            : 'attached, not launched by this skill',
        });
      }
    }

    const devServer = state.devServer;
    if (devServer?.pid) {
      if (isAlive(devServer.pid)) {
        await killOwnedTree(devServer.pid);
        stopped.push({ what: 'devServer', pid: devServer.pid, command: devServer.command });
      } else {
        stopped.push({ what: 'devServer', pid: devServer.pid, command: devServer.command, alreadyExited: true });
      }
      updateState(repoRoot, (s) => ({ ...s, devServer: null }));
    } else if (config.devServer?.readyUrl && (await urlResponds(config.devServer.readyUrl))) {
      leftRunning.push({ what: 'devServer', readyUrl: config.devServer.readyUrl, reason: 'not started by this skill' });
    }

    return { stopped, leftRunning };
  },
};

function waitForPortClosed(port, timeoutMs) {
  return pollUntil(async () => !(await probeDebugPort(port, { timeoutMs: 500 })).reachable, { timeoutMs, intervalMs: 200 });
}

/** Call quit() in the first non-Workspace app window. @returns the `uuid/name` used, or null. */
async function requestQuit(config) {
  const session = await connect(config, { collector: false });
  try {
    for (const page of session.pages()) {
      const target = await withTimeout(identifyPage(page, config), EVAL_TIMEOUT_MS).catch(() => null);
      if (!target?.uuid || target.uuid === WORKSPACE_UUID) continue;
      // The page may go away mid-call; that's the point.
      await withTimeout(page.evaluate(() => fin.Application.getCurrentSync().quit()), EVAL_TIMEOUT_MS).catch(() => {});
      return target.target;
    }
    return null;
  } finally {
    await session.close();
  }
}
