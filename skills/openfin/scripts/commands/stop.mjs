// `openfin stop` — stop only what this skill started; report the rest.
//
// App launched by the skill: quit it gracefully over CDP
// (fin.Application.getCurrentSync().quit() in one of its windows), wait for
// the debug port to close. An app merely attached to is left running.
// Dev server: stopped (by recorded PID tree) only if `launch` started it.
// Log collector: always the skill's own; stopped first.
// Never kills OpenFin processes by name.
import { probeDebugPort, connect } from '../lib/cdp.mjs';
import { stopCollector } from '../lib/collector.mjs';
import { readState, updateState, launchedBySkill } from '../lib/state.mjs';
import { identifyPage, WORKSPACE_UUID } from '../lib/targets.mjs';
import { killOwnedTree } from '../lib/owned.mjs';
import { urlResponds } from './launch.mjs';

const QUIT_TIMEOUT_MS = 15_000;
const EVAL_TIMEOUT_MS = 3000;

export default {
  summary: 'Stop what this skill launched; leave attached instances alone.',
  needsConfig: true,
  async run({ config }) {
    const { debugPort, repoRoot } = config;
    const state = readState(repoRoot) ?? {};
    const stopped = [];
    const leftRunning = [];
    const reachable = (await probeDebugPort(debugPort)).reachable;

    // Collector first, so the app quitting doesn't race its own shutdown.
    const collector = stopCollector(repoRoot);
    if (collector.pid) stopped.push({ what: 'collector', pid: collector.pid, ...(collector.stopped ? {} : { alreadyExited: true }) });

    if (launchedBySkill(state, debugPort)) {
      const pid = state.app.pid;
      if (!reachable) {
        await killOwnedTree(pid);
        stopped.push({ what: 'app', debugPort, pid, alreadyExited: true });
      } else {
        const quitIn = await requestQuit(config);
        if (quitIn && (await waitForPortClosed(debugPort))) {
          await killOwnedTree(pid); // launcher leftovers, if any; ours by PID
          stopped.push({ what: 'app', debugPort, pid, quitVia: quitIn });
        } else {
          leftRunning.push({
            what: 'app',
            debugPort,
            pid,
            reason: quitIn
              ? `quit() was called in ${quitIn} but the debug port still answers after ${QUIT_TIMEOUT_MS / 1000}s`
              : 'no app window with the fin API to call quit() in',
          });
        }
      }
      if (stopped.some((s) => s.what === 'app')) updateState(repoRoot, (s) => ({ ...s, app: null }));
    } else if (reachable) {
      leftRunning.push({ what: 'app', debugPort, reason: 'attached, not launched by this skill' });
    }

    if (state.devServer?.pid) {
      await killOwnedTree(state.devServer.pid);
      stopped.push({ what: 'devServer', pid: state.devServer.pid, command: state.devServer.command });
      updateState(repoRoot, (s) => ({ ...s, devServer: null }));
    } else if (config.devServer?.readyUrl && (await urlResponds(config.devServer.readyUrl))) {
      leftRunning.push({ what: 'devServer', readyUrl: config.devServer.readyUrl, reason: 'not started by this skill' });
    }

    return { stopped, leftRunning };
  },
};

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

async function waitForPortClosed(port) {
  const deadline = Date.now() + QUIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await probeDebugPort(port, { timeoutMs: 500 })).reachable) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timed out')), ms))),
  ]).finally(() => clearTimeout(timer));
}
