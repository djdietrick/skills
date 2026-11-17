// Subcommand registry. Each command is:
//   {
//     summary: string,             // one line, shown in UNKNOWN_COMMAND hints
//     needsConfig?: boolean,       // dispatcher loads + validates project config first
//     run(ctx) => Promise<object>  // returned fields are merged into { ok: true, ... }
//   }
// ctx = { args: { positionals, flags }, cwd, env, config? }
// Commands signal failure by throwing CliError (see ../lib/errors.mjs).

import config from './config.mjs';
import doctor from './doctor.mjs';
import status from './status.mjs';
import listTargets from './list-targets.mjs';
import interact from './interact.mjs';
import logs from './logs.mjs';
import launch from './launch.mjs';
import stop from './stop.mjs';

export const commands = {
  status,
  launch,
  stop,
  'list-targets': listTargets,
  screenshot: interact.screenshot,
  eval: interact.eval,
  click: interact.click,
  type: interact.type,
  text: interact.text,
  logs,
  config,
  doctor,
};
