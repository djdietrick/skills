// OpenFin target identities as the CLI writes them: "uuid/name". OpenFin
// uuids contain no "/", so the first "/" splits them; names may contain more.
// Also the one rule for which config windows[] entries alias a target.

/** @returns {string} "uuid/name" */
export function formatTargetId(uuid, name) {
  return `${uuid}/${name}`;
}

/** @returns {{ uuid: string | null, name: string }} a string without "/" is all name */
export function parseTargetId(id) {
  const i = id.indexOf('/');
  return i === -1 ? { uuid: null, name: id } : { uuid: id.slice(0, i), name: id.slice(i + 1) };
}

/**
 * Names of the config windows[] entries that point at target `id`: by
 * `identity` when the entry sets one, else by short name.
 * @param {string} id  "uuid/name"
 * @param {{ windows?: { name: string, identity?: string }[] } | null} config
 * @returns {string[]}
 */
export function configAliases(id, config) {
  const { name } = parseTargetId(id);
  return (config?.windows ?? []).filter((w) => (w.identity ? w.identity === id : w.name === name)).map((w) => w.name);
}
