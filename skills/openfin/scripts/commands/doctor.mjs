// `openfin doctor` — readiness checks for interactive setup. Always succeeds
// (exit 0) and reports each check, so an agent sees every problem at once.
// `ready` is true only when every check passes.
import { loadConfig } from '../lib/config.mjs';
import { resolvePlaywright } from '../lib/playwright.mjs';
import { errorPayload } from '../lib/output.mjs';

function check(fn) {
  try {
    return { ok: true, ...fn() };
  } catch (err) {
    return { ok: false, error: errorPayload(err).error };
  }
}

export default {
  summary: 'Check setup: project config validity and playwright-core availability.',
  needsConfig: false,
  async run({ cwd, env, args }) {
    const checks = {
      config: check(() => {
        const { configPath } = loadConfig({ cwd, env, configFlag: args.flags.config });
        return { configPath };
      }),
      playwright: check(() => resolvePlaywright({ repoRoot: cwd })),
    };
    return { ready: Object.values(checks).every((c) => c.ok), checks };
  },
};
