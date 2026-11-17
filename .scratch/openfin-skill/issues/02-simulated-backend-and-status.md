# 02 — Simulated OpenFin test backend + `status` command

Status: claimed
Type: task
Blocked by: 01

Spec: user stories 14–16; Implementation Decisions "Connection", "Ownership state"; Testing Decisions backend 1 (Simulated OpenFin).

## What to build

- Test harness (under `skills/openfin/scripts/test/` or similar): start headless Chromium (via `playwright-core`'s bundled-browser lookup or `chromium.launch` with `--remote-debugging-port=<free port>`; browsers are installed locally under `~/Library/Caches/ms-playwright`) serving fixture HTML pages with a fake `fin` global: `fin.me.identity` {uuid,name}, `fin.me.isView`/`isWindow`, a way to get a view's parent window, `fin.Platform.getCurrentSync().getSnapshot()` (or equivalent), and `fin.Application.getCurrentSync().quit()` that closes the browser. Fixtures: two app windows, a view with a parent window, and a fake Workspace Home (`openfin-workspace` / `openfin-home`). Helpers for writing a fixture config pointing at the port. Make it reusable by later tickets.
- `status` subcommand: connect over CDP (Playwright `connectOverCDP`) to the configured debug port; report `{reachable, launchedBySkill, ...}` reading the session state file `.scratch/openfin/state.json` (cwd-relative consuming repo). If the port is unreachable, report reachable:false (not an error) and, on Windows, detect whether OpenFin processes are running without the port to report `INSTANCE_WITHOUT_DEBUG_PORT`-style info (keep the process check behind a small function; on non-Windows it returns none).
- Session state module: read/write `.scratch/openfin/state.json` (PIDs, what was started, debug port). Used by later tickets.

## Acceptance

- CLI-level tests against the simulated backend: status reachable vs unreachable port; launchedBySkill reflects the state file.
