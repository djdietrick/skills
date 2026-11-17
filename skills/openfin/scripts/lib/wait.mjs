// Small async timing helpers shared by the commands.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call `check` until it returns a truthy value or `timeoutMs` passes. `check`
 * may throw to abort the wait early (the error propagates).
 * @template T
 * @param {() => T | Promise<T>} check
 * @param {{ timeoutMs: number, intervalMs?: number }} opts
 * @returns {Promise<T | false>} the truthy value, or false on timeout
 */
export async function pollUntil(check, { timeoutMs, intervalMs = 250 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

/** Settle like `promise`, or reject with "timed out" after `ms`. */
export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
