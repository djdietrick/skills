// `openfin status` — is an instance reachable on the configured debug port,
// and did this skill launch it? Never an error for "not running": an
// unreachable port is reachable:false, plus an INSTANCE_WITHOUT_DEBUG_PORT
// warning when OpenFin processes are running without it (Windows).
import { probeDebugPort, connect } from '../lib/cdp.mjs';
import { readState, launchedBySkill, statePath } from '../lib/state.mjs';
import { findOpenFinProcesses } from '../lib/processes.mjs';
import { ErrorCode } from '../lib/errors.mjs';

export default {
  summary: 'Report whether the app is reachable on the debug port and who launched it.',
  needsConfig: true,
  async run({ config }) {
    const { debugPort, repoRoot } = config;
    const state = readState(repoRoot);
    const base = {
      debugPort,
      launchedBySkill: launchedBySkill(state, debugPort),
      stateFile: statePath(repoRoot),
      state,
    };

    const probe = await probeDebugPort(debugPort);
    if (!probe.reachable) {
      const result = { reachable: false, ...base };
      const processes = await findOpenFinProcesses();
      if (processes.length) {
        result.warning = {
          code: ErrorCode.INSTANCE_WITHOUT_DEBUG_PORT,
          message: `OpenFin is running (${processes.length} process(es)) but nothing answers on debug port ${debugPort}.`,
          hint:
            'Do not restart the developer\'s app. Ask them to add "--remote-debugging-port=' +
            debugPort +
            '" to the runtime arguments in their dev manifest and restart it themselves.',
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
