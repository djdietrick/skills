// Opt-in gate for the real-OpenFin suite (see REAL-OPENFIN.md).
//
//   OPENFIN_REAL=1                 opt in
//   OPENFIN_REAL_CONFIG=<path>     the sample app's openfin.md project config
//   OPENFIN_REAL_REPO=<dir>        the sample app's repo root (the CLI's cwd);
//                                  inferred when the config is <repo>/docs/agents/openfin.md
//
// Returns one of:
//   { run: true, configPath, repoRoot }
//   { run: false, skip: <reason> }    not opted in, or not on Windows
//   { run: false, error: <message> }  opted in on Windows but misconfigured
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export function realOpenFinGate({ env = process.env, platform = process.platform } = {}) {
  if (env.OPENFIN_REAL !== '1') {
    return { run: false, skip: 'real-OpenFin suite is opt-in: set OPENFIN_REAL=1 (see test/real/REAL-OPENFIN.md)' };
  }
  if (platform !== 'win32') {
    return { run: false, skip: `real-OpenFin suite needs Windows (the RVM); this is ${platform}` };
  }
  if (!env.OPENFIN_REAL_CONFIG) {
    return { run: false, error: 'OPENFIN_REAL=1 needs OPENFIN_REAL_CONFIG=<path to the sample app\'s openfin.md>' };
  }
  const configPath = resolve(env.OPENFIN_REAL_CONFIG);
  if (!existsSync(configPath)) {
    return { run: false, error: `OPENFIN_REAL_CONFIG not found: ${configPath}` };
  }
  let repoRoot;
  if (env.OPENFIN_REAL_REPO) {
    repoRoot = resolve(env.OPENFIN_REAL_REPO);
  } else {
    const agents = dirname(configPath);
    const docs = dirname(agents);
    if (basename(agents) !== 'agents' || basename(docs) !== 'docs') {
      return {
        run: false,
        error: `Can't infer the sample app's repo root from ${configPath}; set OPENFIN_REAL_REPO=<repo root>`,
      };
    }
    repoRoot = dirname(docs);
  }
  return { run: true, configPath, repoRoot };
}
