// The CLI output contract: exactly one JSON object on stdout.
//   success → { ok: true, ...result }                 exit 0
//   failure → { ok: false, error: { code, message, hint?, ...details } }  exit 1
// Diagnostics for humans go to stderr only.
import { CliError, ErrorCode } from './errors.mjs';

export function successPayload(result = {}) {
  return { ok: true, ...result };
}

export function errorPayload(err) {
  if (err instanceof CliError) {
    const error = { code: err.code, message: err.message };
    if (err.hint) error.hint = err.hint;
    if (err.details) Object.assign(error, err.details);
    return { ok: false, error };
  }
  return {
    ok: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: err?.message ?? String(err),
      hint: 'This is a bug or an unexpected environment problem; see stderr for the stack trace.',
    },
  };
}

/** Write the payload and set the exit code. Call exactly once per process. */
export function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exitCode = payload.ok ? 0 : 1;
}
