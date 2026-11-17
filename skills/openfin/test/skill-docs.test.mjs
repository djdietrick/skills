// Doc-consistency: SKILL.md must document every subcommand the CLI exposes.
// The command list comes from the CLI itself (the UNKNOWN_COMMAND hint), so
// adding a subcommand without documenting it fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, SKILL_DIR } from './helpers/cli.mjs';

const skillMd = () => readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');

function cliCommands() {
  const { json } = runCli([]);
  return json.error.hint
    .split('\n')
    .map((line) => line.match(/^([a-z][a-z-]*):/)?.[1])
    .filter(Boolean);
}

test('SKILL.md frontmatter names the skill openfin and has a description', () => {
  const fm = skillMd().match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, 'SKILL.md needs YAML frontmatter');
  assert.match(fm[1], /^name: openfin$/m);
  assert.match(fm[1], /^description: .+/m);
});

test('SKILL.md documents every CLI subcommand with a usage line', () => {
  const doc = skillMd();
  const commands = cliCommands();
  assert.ok(commands.length >= 10, `expected the full command list, got ${commands}`);
  const missing = commands.filter((c) => !new RegExp(`openfin\\.mjs ${c}\\b`).test(doc));
  assert.deepEqual(missing, [], 'subcommands missing an `openfin.mjs <command>` usage line in SKILL.md');
});

test('every relative file SKILL.md links to exists', () => {
  const links = [...skillMd().matchAll(/\]\((?!https?:)([^)#]+)\)/g)].map((m) => m[1]);
  const broken = links.filter((l) => !existsSync(join(SKILL_DIR, l)));
  assert.deepEqual(broken, []);
});
