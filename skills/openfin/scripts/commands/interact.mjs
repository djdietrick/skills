// Interaction commands: `screenshot`, `text`, `click`, `type`, `eval`.
// Each resolves its target through withTarget (connect, resolve, run,
// disconnect) and reports the resolved `target` alongside its result.
import { withTarget } from '../lib/targets.mjs';
import { CliError, ErrorCode } from '../lib/errors.mjs';
import { scratchDir } from '../lib/state.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const screenshot = {
  summary: 'Capture a target to a PNG and return its path.',
  needsConfig: true,
  async run({ config, args }) {
    const [query] = args.positionals;
    return withTarget(config, query, async ({ page, target }) => {
      const png = await page.screenshot({ type: 'png' });
      const dir = join(scratchDir(config.repoRoot), 'screenshots');
      mkdirSync(dir, { recursive: true });
      return { target: target.target, path: writeUnique(dir, screenshotName(target.target), png) };
    });
  },
};

/** `20261116T153012-123Z_sim-app_main` (UTC; sorts by time; filesystem-safe). */
function screenshotName(targetId, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('.', '-');
  const slug = targetId.replace(/^[a-z]+:\/\//i, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return `${stamp}_${slug || 'page'}`;
}

/** Write `<base>.png`, or `<base>-2.png`, ... — never overwrite an earlier shot. */
function writeUnique(dir, base, data) {
  for (let n = 1; ; n++) {
    const file = join(dir, `${base}${n === 1 ? '' : `-${n}`}.png`);
    try {
      writeFileSync(file, data, { flag: 'wx' });
      return file;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

const evalCmd = {
  summary: 'Run JavaScript in a target and return the JSON result.',
  needsConfig: true,
  async run({ config, args }) {
    const [query, js] = args.positionals;
    requireArg(js, 'eval <target> <js>', 'JavaScript expression');
    return withTarget(config, query, async ({ page, target }) => {
      let value;
      try {
        value = await page.evaluate(js);
      } catch (err) {
        throw new CliError(ErrorCode.EVAL_FAILED, `The script threw in ${target.target}: ${firstLine(err)}`, {
          hint: 'Fix the script. It is evaluated as an expression; wrap statements in an IIFE, e.g. `(() => { ...; return x; })()`.',
          details: { target: target.target },
        });
      }
      return { target: target.target, result: value === undefined ? null : value };
    });
  },
};

const text = {
  summary: 'Return the visible text of a target or element.',
  needsConfig: true,
  async run({ config, args }) {
    const [query] = args.positionals;
    const selector = optionalFlag(args.flags.selector, '--selector', 'a CSS selector');
    const timeout = timeoutFlag(args.flags.timeout);
    return withTarget(config, query, async ({ page, target }) => {
      const el = selector
        ? await waitFor(page, target, selector, { state: 'attached', timeout })
        : page.locator('body');
      return { target: target.target, ...(selector ? { selector } : {}), text: await el.innerText() };
    });
  },
};

const click = {
  summary: 'Click an element in a target by selector.',
  needsConfig: true,
  async run({ config, args }) {
    const [query, selector] = args.positionals;
    requireArg(selector, 'click <target> <selector>', 'selector');
    const timeout = timeoutFlag(args.flags.timeout);
    return withTarget(config, query, async ({ page, target }) => {
      const el = await waitFor(page, target, selector, { state: 'visible', timeout });
      await act(target, selector, timeout, () => el.click({ timeout }));
      return { target: target.target, selector, clicked: true };
    });
  },
};

const type = {
  summary: 'Type text into an element in a target by selector.',
  needsConfig: true,
  async run({ config, args }) {
    const [query, selector, value] = args.positionals;
    requireArg(selector, 'type <target> <selector> <text>', 'selector');
    if (typeof value !== 'string') {
      throw new CliError(ErrorCode.INVALID_ARGS, 'Missing text to type.', { hint: 'Usage: type <target> <selector> <text>' });
    }
    const timeout = timeoutFlag(args.flags.timeout);
    return withTarget(config, query, async ({ page, target }) => {
      const el = await waitFor(page, target, selector, { state: 'visible', timeout });
      await act(target, selector, timeout, () => el.fill(value, { timeout }));
      return { target: target.target, selector, typed: value };
    });
  },
};

/** Run a Playwright action; its own actionability timeout becomes SELECTOR_TIMEOUT too. */
async function act(target, selector, timeout, fn) {
  try {
    await fn();
  } catch (err) {
    if (err?.name !== 'TimeoutError') throw err;
    throw new CliError(ErrorCode.SELECTOR_TIMEOUT, `"${selector}" in ${target.target} matched, but did not become actionable within ${timeout} ms.`, {
      hint: 'The element may be disabled, covered, or not editable. Inspect it with `eval`, or raise --timeout <ms>.',
      details: { target: target.target, selector, timeoutMs: timeout },
    });
  }
}

export const DEFAULT_SELECTOR_TIMEOUT_MS = 5000;

/**
 * Wait (bounded) for the first element matching `selector`; returns its locator.
 * @throws {CliError} SELECTOR_TIMEOUT | INVALID_ARGS (malformed selector)
 */
async function waitFor(page, target, selector, { state, timeout }) {
  const el = page.locator(selector).first();
  try {
    await el.waitFor({ state, timeout });
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new CliError(ErrorCode.SELECTOR_TIMEOUT, `No ${state === 'visible' ? 'visible ' : ''}element matched "${selector}" in ${target.target} within ${timeout} ms.`, {
        hint: 'Check the selector against the page (`text <target>` or `eval <target> "document.body.innerHTML"`), make sure it is the right target, or raise --timeout <ms> if the element appears late.',
        details: { target: target.target, selector, timeoutMs: timeout },
      });
    }
    throw new CliError(ErrorCode.INVALID_ARGS, `Bad selector "${selector}": ${firstLine(err)}`, {
      hint: 'Pass a CSS selector (Playwright selector syntax is also accepted).',
      details: { selector },
    });
  }
  return el;
}

function timeoutFlag(value) {
  if (value === undefined) return DEFAULT_SELECTOR_TIMEOUT_MS;
  const n = Number(value);
  if (value === true || !Number.isInteger(n) || n < 0) {
    throw new CliError(ErrorCode.INVALID_ARGS, '--timeout must be a whole number of milliseconds.', {
      hint: `Example: --timeout 10000 (default ${DEFAULT_SELECTOR_TIMEOUT_MS}).`,
    });
  }
  return n;
}

function optionalFlag(value, flag, what) {
  if (value === true) {
    throw new CliError(ErrorCode.INVALID_ARGS, `${flag} needs a value.`, { hint: `Pass ${flag} <${what}>.` });
  }
  return value;
}

function requireArg(value, usage, what) {
  if (typeof value !== 'string' || value === '') {
    throw new CliError(ErrorCode.INVALID_ARGS, `Missing ${what}.`, { hint: `Usage: ${usage}` });
  }
}

function firstLine(err) {
  return String(err?.message ?? err).split('\n')[0];
}

export default {
  screenshot,
  eval: evalCmd,
  text,
  click,
  type,
};
