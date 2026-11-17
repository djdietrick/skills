// Subcommand registry. Each command is:
//   {
//     summary: string,             // one line, shown in UNKNOWN_COMMAND hints
//     needsConfig?: boolean,       // dispatcher loads + validates project config first
//     run(ctx) => Promise<object>  // returned fields are merged into { ok: true, ... }
//   }
// ctx = { args: { positionals, flags }, cwd, env, config? }
// Commands signal failure by throwing CliError (see ../lib/errors.mjs).
//
// To implement a stubbed command, add a module in this folder and replace its
// `notImplemented(...)` entry below.
import { CliError, ErrorCode } from '../lib/errors.mjs';
import config from './config.mjs';
import doctor from './doctor.mjs';
import status from './status.mjs';
import listTargets from './list-targets.mjs';
import logs from './logs.mjs';

function notImplemented(summary) {
  return {
    summary,
    needsConfig: true,
    async run(ctx) {
      throw new CliError(ErrorCode.NOT_IMPLEMENTED, `"${ctx.commandName}" is not implemented yet.`);
    },
  };
}

export const commands = {
  status,
  launch: notImplemented('Start the dev server and the app with the debug port enabled.'),
  stop: notImplemented('Stop what this skill launched; leave attached instances alone.'),
  'list-targets': listTargets,
  screenshot: notImplemented('Capture a target to a PNG and return its path.'),
  eval: notImplemented('Run JavaScript in a target and return the JSON result.'),
  click: notImplemented('Click an element in a target by selector.'),
  type: notImplemented('Type text into an element in a target by selector.'),
  text: notImplemented('Return the visible text of a target or element.'),
  logs,
  config,
  doctor,
};
