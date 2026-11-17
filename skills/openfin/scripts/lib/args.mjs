// Minimal argv parser shared by every subcommand.
//   openfin <command> [positionals...] [--flag value | --flag=value | --switch]
// A `--flag` followed by another `--flag` (or nothing) is boolean true.
// Everything after a bare `--` is positional.
import { CliError, ErrorCode } from './errors.mjs';

/** @returns {{ command: string | undefined, positionals: string[], flags: Record<string, string | true> }} */
export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
      continue;
    }
    positionals.push(arg);
  }
  const [command, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

/**
 * Parse a `--timeout <ms>` flag value: a whole number of milliseconds, or
 * `defaultMs` when the flag is absent.
 * @throws {CliError} INVALID_ARGS
 */
export function timeoutFlag(value, defaultMs) {
  if (value === undefined) return defaultMs;
  const n = Number(value);
  if (value === true || !Number.isInteger(n) || n < 0) {
    throw new CliError(ErrorCode.INVALID_ARGS, '--timeout must be a whole number of milliseconds.', {
      hint: `Example: --timeout 10000 (default ${defaultMs}).`,
    });
  }
  return n;
}
