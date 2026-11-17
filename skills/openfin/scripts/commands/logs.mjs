// `openfin logs [--target <t>] [--level <l>] [--limit <n>]` — recent entries
// from the log collector's current session file, oldest first, plus the path
// to the runtime's debug.log. Reads files only; never connects.
//
// --target matches an entry's `uuid/name`, its short name, or a config alias.
// --level is a minimum: debug < log = info < warn < error.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { collectorStatus, logsDir } from '../lib/collector.mjs';
import { CliError, ErrorCode } from '../lib/errors.mjs';
import { runtimeDebugLogPath } from '../lib/config.mjs';

const DEFAULT_LIMIT = 100;
const SEVERITY = { debug: 0, log: 1, info: 1, warn: 2, error: 3 };
const LEVEL_ALIASES = { warning: 'warn' };

export default {
  summary: 'Return recent console entries, filtered by target and level.',
  needsConfig: true,
  async run({ config, args }) {
    const { target, level, limit } = parseFlags(args.flags);
    const collector = collectorStatus(config.repoRoot);
    const logFile = collector.logFile ?? newestLogFile(config.repoRoot);

    let entries = logFile ? readEntries(logFile) : [];
    if (target !== undefined) entries = entries.filter(matchesTarget(target, config));
    if (level !== undefined) entries = entries.filter((e) => (SEVERITY[e.level] ?? 1) >= SEVERITY[level]);
    const matched = entries.length;
    entries = entries.slice(-limit);

    return {
      logFile: logFile ?? null,
      collector,
      matched,
      entries,
      runtimeDebugLog: runtimeDebugLogPath(config.logsDir),
      ...(logFile ? {} : { hint: 'No collector log yet. Run `status` or any target command while the app is reachable to start the collector.' }),
    };
  },
};

function parseFlags(flags) {
  const bad = (message, hint) => new CliError(ErrorCode.INVALID_ARGS, message, { hint });
  const usage = 'Usage: logs [--target <t>] [--level debug|log|info|warn|error] [--limit <n>]';
  for (const f of ['target', 'level', 'limit']) {
    if (flags[f] === true) throw bad(`--${f} needs a value.`, usage);
  }
  let level = flags.level?.toLowerCase();
  if (level !== undefined) {
    level = LEVEL_ALIASES[level] ?? level;
    if (!(level in SEVERITY)) throw bad(`Unknown level "${flags.level}".`, usage);
  }
  let limit = DEFAULT_LIMIT;
  if (flags.limit !== undefined) {
    limit = Number(flags.limit);
    if (!Number.isInteger(limit) || limit < 1) throw bad('--limit must be a positive integer.', usage);
  }
  return { target: flags.target, level, limit };
}

function matchesTarget(query, config) {
  const ids = new Set([query]);
  const names = new Set([query]);
  for (const w of config.windows ?? []) {
    if (w.name !== query) continue;
    if (w.identity) ids.add(w.identity);
    else names.add(w.name);
  }
  return (e) => ids.has(e.target) || names.has(e.target.slice(e.target.indexOf('/') + 1));
}

function readEntries(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a line still being written
    }
  }
  return out;
}

function newestLogFile(repoRoot) {
  const dir = logsDir(repoRoot);
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return undefined;
  }
  return files
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
