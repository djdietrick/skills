// The fake `fin` global injected into fixture pages. Mirrors the small slice
// of the OpenFin JS API the CLI relies on:
//
//   fin.me.identity                       { uuid, name }
//   fin.me.isWindow / fin.me.isView       booleans
//   fin.me.getCurrentWindow()             views: Promise<{ identity }> of the parent window
//   fin.Window.getCurrentSync()           windows: { identity }
//   fin.View.getCurrentSync()             views: { identity, getCurrentWindow() }
//   fin.Platform.getCurrentSync().getSnapshot()   Promise<{ windows: [{ name, url, layout? }] }>
//   fin.Application.getCurrentSync().quit()       closes the whole simulated runtime
//   fin.System.getVersion()               Promise<string>
//
// Add to this when a later ticket needs more of the API, keeping real
// OpenFin names and shapes.

/** @returns {string} JS source for an inline <script> */
//
// parentApi: false makes a view's getCurrentWindow() reject, so callers must
// fall back to the platform snapshot to find its parent.
export function fakeFinScript({ identity, kind, parentIdentity, parentApi = true }) {
  const cfg = JSON.stringify({ identity, kind, parentIdentity, parentApi }).replace(/</g, '\\u003c');
  return `(() => {
  const cfg = ${cfg};
  const isView = cfg.kind === 'view';
  const wrap = (identity) => identity && ({ identity: { ...identity } });
  const parentWindow = () => {
    if (!isView) return Promise.reject(new Error('Not a view'));
    if (!cfg.parentApi) return Promise.reject(new Error('getCurrentWindow unavailable (simulated)'));
    return Promise.resolve(wrap(cfg.parentIdentity));
  };
  const app = {
    identity: { uuid: cfg.identity.uuid },
    quit: async () => { await fetch('/__quit', { method: 'POST' }); },
  };
  const me = {
    identity: { ...cfg.identity },
    entityType: cfg.kind,
    isView,
    isWindow: !isView,
    getCurrentWindow: isView ? parentWindow : () => Promise.resolve(wrap(cfg.identity)),
  };
  window.fin = {
    __simulated: true,
    me,
    Window: {
      getCurrentSync: () => { if (isView) throw new Error('Not a window'); return wrap(cfg.identity); },
      getCurrent: async () => fin.Window.getCurrentSync(),
    },
    View: {
      getCurrentSync: () => {
        if (!isView) throw new Error('Not a view');
        return { ...wrap(cfg.identity), getCurrentWindow: parentWindow };
      },
      getCurrent: async () => fin.View.getCurrentSync(),
    },
    Platform: {
      getCurrentSync: () => ({
        identity: { uuid: cfg.identity.uuid },
        getSnapshot: async () =>
          (await fetch('/__snapshot?uuid=' + encodeURIComponent(cfg.identity.uuid))).json(),
      }),
    },
    Application: {
      getCurrentSync: () => app,
      getCurrent: async () => app,
    },
    System: { getVersion: async () => '0.0.0-simulated' },
  };
})();`;
}
