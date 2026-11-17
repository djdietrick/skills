// Project config loader.
//
// The consuming repo describes its app in `docs/agents/openfin.md` (written
// by interactive setup from assets/openfin.template.md). Prose is for humans;
// the scripts read only the fenced block tagged `json openfin-config`.
//
// Lookup order: --config <path>, then $OPENFIN_CONFIG, then
// <cwd>/docs/agents/openfin.md. Relative paths resolve against cwd, and cwd
// is treated as the consuming repo root.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { CliError, ErrorCode } from './errors.mjs';

export const DEFAULT_CONFIG_PATH = join('docs', 'agents', 'openfin.md');
export const DEFAULT_DEBUG_PORT = 9090;
export const DEFAULT_LOGS_DIR = '%LOCALAPPDATA%\\OpenFin';

const SETUP_HINT =
  'Run the openfin skill\'s interactive setup to create or fix docs/agents/openfin.md ' +
  'from the bundled template (assets/openfin.template.md).';

const BLOCK_RE = /^```json[ \t]+openfin-config[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;

/**
 * @typedef {object} ProjectConfig
 * @property {string} repoRoot     absolute path of the consuming repo (cwd)
 * @property {string} configPath   absolute path of the config file read
 * @property {string} manifest     manifest path or URL, as written
 * @property {number} debugPort
 * @property {{ command: string, cwd: string, readyUrl?: string, readySignal?: string } | null} devServer
 *   cwd is absolute (resolved against repoRoot); at least one of readyUrl / readySignal is set
 * @property {{ name: string, identity?: string, purpose?: string }[]} windows
 * @property {string} logsDir      with %VAR% references expanded where set
 * @property {{ command: string, cwd: string }} [launcher]  replaces the RVM in `launch` (set only when
 *   configured): a shell command; `{debugPort}` and `{manifest}` are substituted (each as one
 *   shell argument; the manifest is never interpreted by the shell). cwd is absolute.
 * @property {Record<string, unknown>} raw  the parsed block, for fields added later
 */

/** @returns {ProjectConfig} */
export function loadConfig({ cwd, env = process.env, configFlag } = {}) {
  if (configFlag === true) {
    throw new CliError(ErrorCode.INVALID_ARGS, '--config needs a path.', {
      hint: 'Use --config <path-to-openfin.md>.',
    });
  }
  const requested = configFlag ?? env.OPENFIN_CONFIG ?? DEFAULT_CONFIG_PATH;
  const configPath = resolve(cwd, requested);

  if (!existsSync(configPath)) {
    throw new CliError(
      ErrorCode.CONFIG_MISSING,
      `No OpenFin project config found at ${configPath} (expected ${DEFAULT_CONFIG_PATH} in the repo root).`,
      { hint: SETUP_HINT, details: { configPath } },
    );
  }

  const text = readFileSync(configPath, 'utf8');
  const raw = parseBlock(text, configPath);
  const config = validate(raw, { configPath, repoRoot: resolve(cwd), env });
  return config;
}

function invalid(configPath, message, fields) {
  return new CliError(ErrorCode.CONFIG_INVALID, `Invalid OpenFin project config ${configPath}: ${message}`, {
    hint: `Fix the \`\`\`json openfin-config block in that file by hand, or ${SETUP_HINT[0].toLowerCase()}${SETUP_HINT.slice(1)}`,
    details: { configPath, ...(fields ? { fields } : {}) },
  });
}

function parseBlock(text, configPath) {
  const blocks = [...text.matchAll(BLOCK_RE)];
  if (blocks.length === 0) {
    throw invalid(configPath, 'no ```json openfin-config fenced block found.');
  }
  if (blocks.length > 1) {
    throw invalid(configPath, `found ${blocks.length} \`\`\`json openfin-config blocks; expected exactly one.`);
  }
  let raw;
  try {
    raw = JSON.parse(blocks[0][1]);
  } catch (e) {
    throw invalid(configPath, `the openfin-config block is not valid JSON (${e.message}).`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalid(configPath, 'the openfin-config block must be a JSON object.');
  }
  return raw;
}

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

function validate(raw, { configPath, repoRoot, env }) {
  /** @type {{ field: string, problem: string }[]} */
  const problems = [];
  const bad = (field, problem) => problems.push({ field, problem });
  const optionalString = (value, field) => {
    if (value !== undefined && value !== null && typeof value !== 'string') bad(field, 'must be a string if set');
    return typeof value === 'string' && value !== '' ? value : undefined;
  };

  // manifest — required
  if (raw.manifest === undefined) bad('manifest', 'is required (path or URL to the app manifest)');
  else if (!isNonEmptyString(raw.manifest)) bad('manifest', 'must be a non-empty string (path or URL)');

  // debugPort
  let debugPort = DEFAULT_DEBUG_PORT;
  if (raw.debugPort !== undefined) {
    if (!Number.isInteger(raw.debugPort) || raw.debugPort < 1 || raw.debugPort > 65535) {
      bad('debugPort', 'must be an integer between 1 and 65535');
    } else {
      debugPort = raw.debugPort;
    }
  }

  // devServer — optional (assets may be hosted elsewhere)
  let devServer = null;
  if (raw.devServer !== undefined && raw.devServer !== null) {
    const ds = raw.devServer;
    if (typeof ds !== 'object' || Array.isArray(ds)) {
      bad('devServer', 'must be an object { command, cwd?, readyUrl | readySignal } or null');
    } else {
      if (!isNonEmptyString(ds.command)) bad('devServer.command', 'is required when devServer is set');
      const dsCwd = optionalString(ds.cwd, 'devServer.cwd');
      const readyUrl = optionalString(ds.readyUrl, 'devServer.readyUrl');
      const readySignal = optionalString(ds.readySignal, 'devServer.readySignal');
      if (!readyUrl && !readySignal) {
        bad('devServer', 'needs readyUrl or readySignal so launch can tell when it is ready');
      }
      devServer = {
        command: ds.command,
        cwd: isAbsolute(dsCwd ?? '') ? dsCwd : resolve(repoRoot, dsCwd ?? '.'),
        ...(readyUrl ? { readyUrl } : {}),
        ...(readySignal ? { readySignal } : {}),
      };
    }
  }

  // windows — optional named windows/views
  const windows = [];
  if (raw.windows !== undefined && raw.windows !== null) {
    if (!Array.isArray(raw.windows)) {
      bad('windows', 'must be an array of { name, identity?, purpose? }');
    } else {
      raw.windows.forEach((w, i) => {
        const f = `windows[${i}]`;
        if (w === null || typeof w !== 'object' || Array.isArray(w)) {
          bad(f, 'must be an object { name, identity?, purpose? }');
          return;
        }
        if (!isNonEmptyString(w.name)) bad(`${f}.name`, 'is required');
        const identity = optionalString(w.identity, `${f}.identity`);
        const purpose = optionalString(w.purpose, `${f}.purpose`);
        windows.push({ name: w.name, ...(identity ? { identity } : {}), ...(purpose ? { purpose } : {}) });
      });
    }
  }

  // logsDir
  let logsDir = DEFAULT_LOGS_DIR;
  if (raw.logsDir !== undefined && raw.logsDir !== null) {
    if (!isNonEmptyString(raw.logsDir)) bad('logsDir', 'must be a non-empty string if set');
    else logsDir = raw.logsDir;
  }

  // launcher — optional override of the RVM launch command
  let launcher;
  if (raw.launcher !== undefined && raw.launcher !== null) {
    const l = raw.launcher;
    if (typeof l !== 'object' || Array.isArray(l)) {
      bad('launcher', 'must be an object { command, cwd? } or null');
    } else {
      if (!isNonEmptyString(l.command)) bad('launcher.command', 'is required when launcher is set');
      const lCwd = optionalString(l.cwd, 'launcher.cwd');
      launcher = { command: l.command, cwd: isAbsolute(lCwd ?? '') ? lCwd : resolve(repoRoot, lCwd ?? '.') };
    }
  }

  if (problems.length) {
    const summary = problems.map((p) => `${p.field} ${p.problem}`).join('; ');
    throw invalid(configPath, summary + '.', problems);
  }

  return {
    repoRoot,
    configPath,
    manifest: raw.manifest,
    debugPort,
    devServer,
    windows,
    logsDir: expandEnvVars(logsDir, env),
    ...(launcher ? { launcher } : {}),
    raw,
  };
}

/** Path of the runtime's debug.log in `logsDir` (a Windows path in real use; joined with its own separator). */
export function runtimeDebugLogPath(logsDir) {
  const sep = logsDir.includes('\\') ? '\\' : '/';
  return logsDir.endsWith(sep) ? `${logsDir}debug.log` : `${logsDir}${sep}debug.log`;
}

/** Expand Windows-style %VAR% references that are set in env; leave others as-is. */
function expandEnvVars(value, env) {
  return value.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, name) => env[name] ?? m);
}
