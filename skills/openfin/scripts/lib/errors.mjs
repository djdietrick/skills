// Every failure the CLI reports carries one of these codes. Agents branch on
// the code, so codes are stable; messages and hints are for humans/agents.
export const ErrorCode = Object.freeze({
  CONFIG_MISSING: 'CONFIG_MISSING',
  CONFIG_INVALID: 'CONFIG_INVALID',
  PLAYWRIGHT_MISSING: 'PLAYWRIGHT_MISSING',
  DEBUG_PORT_UNREACHABLE: 'DEBUG_PORT_UNREACHABLE',
  INSTANCE_WITHOUT_DEBUG_PORT: 'INSTANCE_WITHOUT_DEBUG_PORT',
  TARGET_NOT_FOUND: 'TARGET_NOT_FOUND',
  TARGET_AMBIGUOUS: 'TARGET_AMBIGUOUS',
  SELECTOR_TIMEOUT: 'SELECTOR_TIMEOUT',
  EVAL_FAILED: 'EVAL_FAILED',
  LAUNCH_FAILED: 'LAUNCH_FAILED',
  UNKNOWN_COMMAND: 'UNKNOWN_COMMAND',
  INVALID_ARGS: 'INVALID_ARGS',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

/**
 * Throw a CliError from anywhere in a command; the dispatcher turns it into
 * `{ ok: false, error: { code, message, hint?, ...details } }`.
 */
export class CliError extends Error {
  /**
   * @param {string} code one of ErrorCode
   * @param {string} message what went wrong
   * @param {{ hint?: string, details?: Record<string, unknown> }} [extra]
   *   hint: what to do about it; details: extra machine-readable fields
   *   merged into the error object (e.g. `candidates` for TARGET_AMBIGUOUS).
   */
  constructor(code, message, { hint, details } = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}
