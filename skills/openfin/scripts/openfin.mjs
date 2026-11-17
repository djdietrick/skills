#!/usr/bin/env node
// openfin skill helper CLI. Prints exactly one JSON object to stdout.
// Usage: node scripts/openfin.mjs <command> [args] [--config <path>]
import { parseArgs } from './lib/args.mjs';
import { CliError, ErrorCode } from './lib/errors.mjs';
import { emit, errorPayload, successPayload } from './lib/output.mjs';
import { loadConfig } from './lib/config.mjs';
import { commands } from './commands/index.mjs';

function commandList() {
  return Object.entries(commands)
    .map(([name, c]) => `${name}: ${c.summary}`)
    .join('\n');
}

async function main(argv) {
  const { command, positionals, flags } = parseArgs(argv);
  if (!command) {
    throw new CliError(ErrorCode.UNKNOWN_COMMAND, 'No subcommand given.', {
      hint: `Available commands:\n${commandList()}`,
    });
  }
  const def = Object.hasOwn(commands, command) ? commands[command] : undefined;
  if (!def) {
    throw new CliError(ErrorCode.UNKNOWN_COMMAND, `Unknown subcommand "${command}".`, {
      hint: `Available commands:\n${commandList()}`,
    });
  }
  const ctx = {
    commandName: command,
    args: { positionals, flags },
    cwd: process.cwd(),
    env: process.env,
  };
  if (def.needsConfig) {
    ctx.config = loadConfig({ cwd: ctx.cwd, env: ctx.env, configFlag: flags.config });
  }
  return successPayload(await def.run(ctx));
}

main(process.argv.slice(2))
  .then(emit)
  .catch((err) => {
    if (!(err instanceof CliError)) process.stderr.write(`${err?.stack ?? err}\n`);
    emit(errorPayload(err));
  });
