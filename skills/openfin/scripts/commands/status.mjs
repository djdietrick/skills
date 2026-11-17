// `openfin status` — is an instance reachable on the configured debug port,
// and did this skill launch it? Never an error for "not running": an
// unreachable port is reachable:false, plus an INSTANCE_WITHOUT_DEBUG_PORT
// warning when OpenFin processes for this app's manifest are running without
// it (Windows).
import { probeDebugPort, connect, withoutDebugPortHint } from '../lib/cdp.mjs';
import { readState, isLaunchedInstance, statePath } from '../lib/state.mjs';
import { findAppOpenFinProcesses } from '../lib/processes.mjs';
import { ErrorCode } from '../lib/errors.mjs';

export default {
  summary: 'Report whether the app is reachable on the debug port and who launched it.',
  needsConfig: true,
  async run({ config }) {
    const { debugPort, repoRoot } = config;
    const state = readState(repoRoot);
    const probe = await probeDebugPort(debugPort);
    const base = {
      debugPort,
      launchedBySkill: isLaunchedInstance(state, debugPort, probe),
      stateFile: statePath(repoRoot),
      state,
    };

    if (!probe.reachable) {
      const result = { reachable: false, ...base };
      const processes = await findAppOpenFinProcesses(config);
      if (processes.length) {
        result.warning = {
          code: ErrorCode.INSTANCE_WITHOUT_DEBUG_PORT,
          message: `This app's manifest is running in OpenFin (${processes.length} process(es)) but nothing answers on debug port ${debugPort}.`,
          hint: withoutDebugPortHint(debugPort),
          processes,
        };
      }
      return result;
    }

    const session = await connect(config);
    try {
      return { reachable: true, ...base, browser: probe.browser, pageCount: session.pages().length };
    } finally {
      await session.close();
    }
  },
};
