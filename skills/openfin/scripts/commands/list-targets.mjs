// `openfin list-targets [--target <t>]` — every window and view by OpenFin
// identity. With --target, only the one target that argument resolves to
// (the same resolution every target-taking command uses), or its
// TARGET_NOT_FOUND / TARGET_AMBIGUOUS error.
import { connect } from '../lib/cdp.mjs';
import { listTargets, resolveTarget } from '../lib/targets.mjs';
import { CliError, ErrorCode } from '../lib/errors.mjs';

export default {
  summary: 'List windows and views by OpenFin identity (uuid/name).',
  needsConfig: true,
  async run({ config, args }) {
    const query = args.flags.target;
    if (query === true) {
      throw new CliError(ErrorCode.INVALID_ARGS, '--target needs a value.', {
        hint: 'Use --target <uuid/name | short name | config alias>, or omit it to list everything.',
      });
    }
    const session = await connect(config);
    try {
      if (query !== undefined) {
        const { target } = await resolveTarget(session, config, query);
        return { targets: [target] };
      }
      return { targets: (await listTargets(session, config)).map(({ target }) => target) };
    } finally {
      await session.close();
    }
  },
};
