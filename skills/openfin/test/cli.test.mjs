import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, makeRepo } from './helpers/cli.mjs';

test('no subcommand returns UNKNOWN_COMMAND listing the commands', () => {
  const { exitCode, json } = runCli([]);
  assert.notEqual(exitCode, 0);
  assert.equal(json.error.code, 'UNKNOWN_COMMAND');
  assert.match(json.error.hint, /list-targets/);
});

test('not-yet-built subcommands return NOT_IMPLEMENTED once config is valid', () => {
  const repo = makeRepo({ configFixture: 'minimal.md' });
  const { exitCode, json } = runCli(['stop'], { cwd: repo });
  assert.notEqual(exitCode, 0);
  assert.equal(json.error.code, 'NOT_IMPLEMENTED');
});

test('unknown subcommand returns UNKNOWN_COMMAND error with non-zero exit', () => {
  const { exitCode, json } = runCli(['frobnicate']);
  assert.notEqual(exitCode, 0);
  assert.equal(json.ok, false);
  assert.equal(json.error.code, 'UNKNOWN_COMMAND');
  assert.match(json.error.message, /frobnicate/);
  assert.match(json.error.hint, /status/);
});
