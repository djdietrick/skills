---
name: openfin
description: Drive a running OpenFin app on Windows through a JSON helper CLI (attach or launch, list windows/views, screenshot, click, type, read text, eval, console logs, stop). Use when asked to run, drive, screenshot, or verify an OpenFin app, or to write end-to-end tests for one.
---

# OpenFin

Drive an OpenFin application the way a user would: attach to it (or launch it), address its windows and views by OpenFin identity, look, interact, read logs, and stop only what you started.

**Windows only.** OpenFin apps launch through the RVM, which exists only on Windows. On macOS or Linux, tell the developer the skill can't drive their app there and stop.

**Writing E2E tests?** Read [references/test-authoring.md](references/test-authoring.md) before writing any test. Driving and verifying tasks don't need it.

## The CLI

Run every command from the consuming repo's root (the CLI treats the working directory as the repo root):

```
node <skill-dir>/scripts/openfin.mjs <command> [args] [--config <path>]
```

`<skill-dir>` is the folder holding this file. Each run prints exactly one JSON object on stdout:

- success: `{ "ok": true, ... }`, exit code 0
- failure: `{ "ok": false, "error": { "code", "message", "hint"?, ... } }`, exit code 1

Branch on `error.code`; follow `error.hint`. Codes: `CONFIG_MISSING`, `CONFIG_INVALID` (with `fields`), `PLAYWRIGHT_MISSING`, `DEBUG_PORT_UNREACHABLE`, `INSTANCE_WITHOUT_DEBUG_PORT`, `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS` (with `candidates`), `SELECTOR_TIMEOUT` (with `target`, `selector`), `EVAL_FAILED`, `LAUNCH_FAILED`, `INVALID_ARGS`, `UNKNOWN_COMMAND`, `NOT_IMPLEMENTED`, `INTERNAL_ERROR`.

## 1. Project config

Every command except `doctor` needs the project config: `docs/agents/openfin.md` in the consuming repo (override with `--config <path>` or `$OPENFIN_CONFIG`). Run `doctor` first. When it reports the config missing or invalid, run **interactive setup** below. Take app details only from the config and the developer: the config is the single source of truth, so leave the repo unscanned for manifests or ports.

### Interactive setup

Ask the developer for each field, one at a time, offering the default:

1. **manifest**: path (relative to repo root) or URL of the dev manifest.
2. **debugPort**: remote debugging port, default `9090`.
3. **devServer**: how to start the app's web assets: `command`, `cwd` (default `.`), and how to know it's ready, `readyUrl` (polled) or `readySignal` (text it prints). `null` when assets are hosted elsewhere.
4. **windows**: the key windows and views: what the team calls each (`name`), its `uuid/name` `identity` if known, and its `purpose`.
5. **logsDir**: OpenFin runtime directory holding `debug.log`, default `%LOCALAPPDATA%\OpenFin`.

Then:

- Copy [assets/openfin.template.md](assets/openfin.template.md) to `docs/agents/openfin.md` and replace the values in its `json openfin-config` block with the answers. Keep the surrounding prose.
- Run `config` and confirm it returns `ok: true` with the values you meant.
- Run `doctor`. If `checks.playwright` fails, show the developer both install options from its hint, `playwright-core` into the app repo (`npm install -D playwright-core`) or into the skill folder (`npm install --prefix "<skill-dir>" playwright-core`), let them choose, and wait for them to confirm. The developer installs; you only re-run `doctor`. No browser download is needed.
- Tell the developer to add `--remote-debugging-port=<debugPort>` to `runtime.arguments` in their dev manifest, so you can attach to instances they start themselves.

Setup is done when `doctor` returns `ready: true`.

## 2. Attach first

1. `status`. If the app is `reachable`, **attach**: use it as is.
2. If an instance is running without the debug port (`status` returns `reachable: false` with `warning.code: INSTANCE_WITHOUT_DEBUG_PORT`), tell the developer to add the runtime argument (above) and restart it themselves. Leave their app running.
3. If nothing is running, `launch`. It starts the dev server, launches the app through the RVM with the debug port added, and returns once the first window exists. (If something came up meanwhile, `launch` attaches instead; it never starts a second instance.)
4. `list-targets` to learn the windows and views, then work with them.
5. When finished, `stop`. It quits only what `launch` started and reports what it left running.

Ownership is recorded in `.scratch/openfin/state.json` in the consuming repo, so `status` and `stop` work across turns. A background log collector starts on `launch` or on the first command that attaches (`status` when reachable, `list-targets`, any target command) and records console output and uncaught errors from every window and view, including ones opened later, to `.scratch/openfin/logs/`. Output from before it started isn't captured.

## 3. Command reference

`<target>` is an OpenFin identity `uuid/name`, a config `windows[].name` alias, or a unique short `name`, tried in that order. A miss returns `TARGET_NOT_FOUND` or `TARGET_AMBIGUOUS` with `candidates`; pick one and retry.

| Command | Does |
| --- | --- |
| `node <skill-dir>/scripts/openfin.mjs doctor` | Setup checks: config validity and `playwright-core` resolution. Always exits 0; `ready` is true only when every check passes, `checks.<name>.error` explains a failure. |
| `node <skill-dir>/scripts/openfin.mjs config` | Prints the resolved config (defaults applied, paths absolute). |
| `node <skill-dir>/scripts/openfin.mjs status` | Whether an instance answers on the debug port (`reachable`) and whether this skill launched it (`launchedBySkill`). Unreachable is not an error. |
| `node <skill-dir>/scripts/openfin.mjs launch` | If the debug port already answers, attaches instead (`attached: true`, starts nothing). Otherwise starts the dev server (skipped if its `readyUrl` already answers) and waits for `readySignal`/`readyUrl`, launches the app through the RVM with the debug port added, and returns once a first window exists (`launched: true`), with the log collector running. `LAUNCH_FAILED` carries `devServerOutput` / `runtimeOutput`, and anything this call started is stopped again. |
| `node <skill-dir>/scripts/openfin.mjs stop` | Quits the app only if `launch` started it (calls `fin.Application.getCurrentSync().quit()` in one of its windows and waits for the debug port to close), stops the dev server only if `launch` started it, and stops the log collector. Returns `stopped[]` and `leftRunning[]`, entries `{ what: app/devServer/collector, ... }`; a `leftRunning` entry has a `reason`. |
| `node <skill-dir>/scripts/openfin.mjs list-targets [--target <t>]` | `targets[]`, one per window and view: `target` (`uuid/name`; the URL for a page with no `fin`), `uuid`, `name`, `kind` (`window`/`view`/`unknown`), `parent` (a view's window, `uuid/name`), `url`, `title`, `workspace` (`Home`/`Dock`/`Store` or null), `aliases` (config `windows[].name`s). `--target` returns only the one target `<t>` resolves to, or the error. |
| `node <skill-dir>/scripts/openfin.mjs screenshot <target>` | Saves a PNG under `.scratch/openfin/screenshots/` (timestamped, target-named, never overwritten) and returns its absolute `path`. Read the file to see it. |
| `node <skill-dir>/scripts/openfin.mjs text <target> [--selector <css>] [--timeout <ms>]` | `text`: visible text (`innerText`) of the page, or of the first element matching the selector. |
| `node <skill-dir>/scripts/openfin.mjs click <target> <selector> [--timeout <ms>]` | Clicks the first visible element matching the selector. |
| `node <skill-dir>/scripts/openfin.mjs type <target> <selector> <text> [--timeout <ms>]` | Fills the first visible matching input with `<text>`, replacing its value (fires `input`/`change`). |
| `node <skill-dir>/scripts/openfin.mjs eval <target> <js>` | Evaluates a JavaScript expression in the target (promises are awaited) and returns the JSON-serialized `result` (`null` for `undefined`). Wrap statements in an IIFE. A script that throws fails with `EVAL_FAILED`. Use it for app state or `fin` APIs no other command covers. |
| `node <skill-dir>/scripts/openfin.mjs logs [--target <t>] [--level <l>] [--limit <n>]` | Recent console messages and uncaught errors from the collector's session log, oldest first: `entries[]` of `{ ts, target, level, text, type }` (`type` is `console` or `pageerror`). `--target` takes the same forms as `<target>`; `--level` is a minimum (`debug` < `log`/`info` < `warn` < `error`); `--limit` defaults to 100 (`matched` counts all hits). Also returns `logFile`, `collector.running`, and `runtimeDebugLog`, the path of the runtime's `debug.log`. Reads files only, never attaches. |

`click`, `type`, and `text --selector` wait a bounded time for the selector (default 5000 ms; override with `--timeout <ms>`) before failing with `SELECTOR_TIMEOUT`.

### Verifying a change

After an edit, check the target that shows it: `text` for content, `screenshot` for layout, then `logs --level error` for anything the change broke. For crashes, a blank app, or manifest errors the console never sees, read `debug.log` in the configured `logsDir` (the `logs` command returns its path).

### Example

With OpenFin's public [workspace-starter](https://github.com/built-on-openfin/workspace-starter) samples running (a platform window hosting views, plus Workspace Home):

```
node <skill-dir>/scripts/openfin.mjs list-targets
node <skill-dir>/scripts/openfin.mjs text openfin-workspace/openfin-home
node <skill-dir>/scripts/openfin.mjs screenshot <platform-uuid>/<view-name>
node <skill-dir>/scripts/openfin.mjs logs --level error --limit 20
```

## Safety

- `stop` touches only what `launch` started. An instance or dev server you attached to belongs to the developer; leave it running and say so.
- The OpenFin runtime is shared with other OpenFin apps on the machine. Never kill all OpenFin processes (`taskkill /IM OpenFin.exe`, the official tooling's force-kill) unless the developer explicitly asks for it in this conversation.
- When reporting back, say what you stopped and what you left running (from `stop`'s output).
