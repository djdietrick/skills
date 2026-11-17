// Targets: the windows and views of the running OpenFin app, named by their
// OpenFin identity. The CDP target list doesn't carry identity, so it is read
// inside each page through its `fin` global.
//
// Every target-taking command goes through `withTarget`:
//
//   return withTarget(config, ctx.args.positionals[0], async ({ page, target }) => ...);
//
// It connects, resolves the target argument to one page, runs fn, and always
// disconnects (the runtime keeps running). `listTargets` / `resolveTarget`
// are the lower-level pieces for commands that hold their own session.
//
// A Target (the JSON shape `list-targets` prints):
//   {
//     target: string,          // "uuid/name"; the page URL when the page has no `fin`
//     uuid: string | null,
//     name: string | null,
//     kind: 'window' | 'view' | 'unknown',
//     parent: string | null,   // views: parent window "uuid/name"
//     url: string,
//     title: string,
//     workspace: 'Home' | 'Dock' | 'Store' | null,
//     aliases: string[],       // config windows[].name entries that point here
//   }
import { connect } from './cdp.mjs';
import { CliError, ErrorCode } from './errors.mjs';
import { formatTargetId, configAliases } from './identity.mjs';
import { withTimeout } from './wait.mjs';

export const WORKSPACE_UUID = 'openfin-workspace';
export const WORKSPACE_COMPONENTS = Object.freeze({
  'openfin-home': 'Home',
  'openfin-dock': 'Dock',
  'openfin-storefront': 'Store',
});

const PAGE_EVAL_TIMEOUT_MS = 2000;

/**
 * Connect, resolve `query` to one page, run fn, disconnect.
 * @template T
 * @param {import('./config.mjs').ProjectConfig} config
 * @param {string | undefined} query  `uuid/name`, unique short name, config alias, or URL (fin-less pages)
 * @param {(arg: { page: import('playwright-core').Page, target: object, session: object }) => Promise<T>} fn
 * @returns {Promise<T>}
 * @throws {CliError} INVALID_ARGS | TARGET_NOT_FOUND | TARGET_AMBIGUOUS | DEBUG_PORT_UNREACHABLE | PLAYWRIGHT_MISSING
 */
export async function withTarget(config, query, fn) {
  requireQuery(query);
  const session = await connect(config);
  try {
    const { page, target } = await resolveTarget(session, config, query);
    return await fn({ page, target, session });
  } finally {
    await session.close();
  }
}

/**
 * Every page target with its identity.
 * @returns {Promise<{ target: object, page: import('playwright-core').Page }[]>}
 */
export async function listTargets(session, config) {
  const pages = session.pages();
  const infos = await Promise.all(pages.map((page) => readIdentity(page)));
  const entries = pages.map((page, i) => ({ page, info: infos[i] }));
  await fillParentsFromSnapshots(entries);
  return entries.map(({ page, info }) => ({ page, target: toTarget(page, info, config) }));
}

/**
 * The Target for one page, without parent lookup (`parent` is null for views
 * whose page can't report it). Used by the log collector to label entries.
 */
export async function identifyPage(page, config) {
  return toTarget(page, await readIdentity(page), config);
}

/**
 * Turn a target argument into one page. Match order: exact `uuid/name` (or
 * URL for fin-less pages), then config alias, then unique short name.
 * @returns {Promise<{ target: object, page: import('playwright-core').Page }>}
 */
export async function resolveTarget(session, config, query) {
  requireQuery(query);
  const all = await listTargets(session, config);
  const matches =
    pick(all, (t) => t.target === query) ??
    pick(all, (t) => t.aliases.includes(query)) ??
    pick(all, (t) => t.name === query) ??
    [];
  const candidates = all.map(({ target }) => describe(target));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new CliError(ErrorCode.TARGET_NOT_FOUND, `No window or view matches "${query}".`, {
      hint: 'Use one of the candidates\' `target` (uuid/name), a unique short name, or a config alias. Run `list-targets` for details.',
      details: { query, candidates },
    });
  }
  throw new CliError(ErrorCode.TARGET_AMBIGUOUS, `"${query}" matches ${matches.length} targets.`, {
    hint: 'Use the full `uuid/name` of one of the candidates.',
    details: { query, candidates: matches.map(({ target }) => describe(target)) },
  });
}

function requireQuery(query) {
  if (typeof query !== 'string' || query === '') {
    throw new CliError(ErrorCode.INVALID_ARGS, 'A target is required.', {
      hint: 'Pass a target as `uuid/name`, a unique short name, or a config alias. Run `list-targets` to see them.',
    });
  }
}

function pick(all, pred) {
  const m = all.filter(({ target }) => pred(target));
  return m.length ? m : undefined;
}

function describe(t) {
  return {
    target: t.target,
    kind: t.kind,
    ...(t.workspace ? { workspace: t.workspace } : {}),
    ...(t.aliases.length ? { aliases: t.aliases } : {}),
    title: t.title,
  };
}

/** Runs in the page. Never throws; `fin`-less or hung pages come back as { fin: false }. */
async function readIdentity(page) {
  const evaluated = page.evaluate(async () => {
    const f = globalThis.fin;
    if (!f?.me?.identity) return { fin: false };
    const { uuid, name } = f.me.identity;
    const isView = Boolean(f.me.isView);
    let parent = null;
    if (isView) {
      try {
        const w = await f.me.getCurrentWindow();
        if (w?.identity) parent = { uuid: w.identity.uuid, name: w.identity.name };
      } catch {
        // fall back to the platform snapshot
      }
    }
    return { fin: true, uuid, name, kind: isView ? 'view' : 'window', parent };
  });
  const [info, title] = await Promise.all([
    withTimeout(evaluated, PAGE_EVAL_TIMEOUT_MS).catch(() => ({ fin: false })),
    page.title().catch(() => ''),
  ]);
  return { ...info, title };
}

/**
 * Views whose parent the page couldn't tell us: ask each platform for its
 * snapshot (windows[].layout → view componentState names) and use that.
 */
async function fillParentsFromSnapshots(entries) {
  const orphans = entries.filter(({ info }) => info.kind === 'view' && !info.parent);
  if (!orphans.length) return;
  const uuids = [...new Set(orphans.map(({ info }) => info.uuid))];
  for (const uuid of uuids) {
    const host = entries.find(({ info }) => info.fin && info.uuid === uuid);
    const snapshot = await host.page
      .evaluate(async () => {
        try {
          return await globalThis.fin.Platform.getCurrentSync().getSnapshot();
        } catch {
          return null;
        }
      })
      .catch(() => null);
    for (const w of snapshot?.windows ?? []) {
      for (const viewName of viewNames(w.layout)) {
        for (const o of orphans) {
          if (o.info.uuid === uuid && o.info.name === viewName) o.info.parent = { uuid, name: w.name };
        }
      }
    }
  }
}

function viewNames(node) {
  if (!node || typeof node !== 'object') return [];
  const own = node.componentState?.name ? [node.componentState.name] : [];
  return own.concat((node.content ?? []).flatMap(viewNames));
}

function toTarget(page, info, config) {
  const url = page.url();
  if (!info.fin) {
    return { target: url, uuid: null, name: null, kind: 'unknown', parent: null, url, title: info.title, workspace: null, aliases: [] };
  }
  const id = formatTargetId(info.uuid, info.name);
  return {
    target: id,
    uuid: info.uuid,
    name: info.name,
    kind: info.kind,
    parent: info.parent ? formatTargetId(info.parent.uuid, info.parent.name) : null,
    url,
    title: info.title,
    workspace: (info.uuid === WORKSPACE_UUID && WORKSPACE_COMPONENTS[info.name]) || null,
    aliases: configAliases(id, config),
  };
}
