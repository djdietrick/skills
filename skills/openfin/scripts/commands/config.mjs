// `openfin config` — print the resolved project config (defaults applied,
// paths absolute). Lets agents and interactive setup confirm the file parses.
export default {
  summary: 'Print the resolved project config (validates docs/agents/openfin.md).',
  needsConfig: true,
  async run({ config }) {
    const { raw, ...resolved } = config;
    return { config: resolved };
  },
};
