// Resolve and load `playwright-core` without ever installing it.
// Lookup order: the consuming repo (repoRoot) first, then the skill's own
// folder. Node's normal resolution applies from each base, so ancestor
// node_modules folders count too.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CliError, ErrorCode } from './errors.mjs';

export const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @returns {{ from: 'project' | 'skill', path: string, version: string }}
 *   path is the package directory.
 * @throws {CliError} PLAYWRIGHT_MISSING
 */
export function resolvePlaywright({ repoRoot, skillDir = SKILL_DIR }) {
  const bases = [
    ['project', repoRoot],
    ['skill', skillDir],
  ];
  for (const [from, base] of bases) {
    if (!base) continue;
    try {
      const req = createRequire(join(base, 'noop.js'));
      const pkgJson = req.resolve('playwright-core/package.json');
      const { version } = JSON.parse(readFileSync(pkgJson, 'utf8'));
      return { from, path: dirname(pkgJson), version };
    } catch {
      // not resolvable from this base; try the next
    }
  }
  throw new CliError(ErrorCode.PLAYWRIGHT_MISSING, 'playwright-core could not be found in the project or the skill folder.', {
    hint:
      'Ask the developer to install it (the skill never installs dependencies itself), either in the app repo: ' +
      '`npm install -D playwright-core`, or in the skill folder: ' +
      `\`npm install --prefix "${skillDir}" playwright-core\`. No browser download is needed.`,
  });
}

/**
 * Import playwright-core from wherever resolvePlaywright found it.
 * @returns {Promise<{ playwright: typeof import('playwright-core'), info: ReturnType<typeof resolvePlaywright> }>}
 */
export async function loadPlaywright(opts) {
  const info = resolvePlaywright(opts);
  const req = createRequire(join(info.path, 'package.json'));
  const entry = req.resolve('playwright-core');
  const mod = await import(pathToFileURL(entry).href);
  return { playwright: mod.default ?? mod, info };
}
