# Real-OpenFin test backend (opt-in, Windows)

`npm test` runs the simulated backend everywhere. `real-openfin.test.mjs` in this folder runs the same CLI-level checks against a real OpenFin app. It covers RVM launch, the dev-server lifecycle, real views as CDP targets, graceful quit, and the runtime `debug.log` path. It's skipped unless you opt in on Windows.

## Run it

1. On Windows, with the OpenFin RVM installed (`%LOCALAPPDATA%\OpenFin\OpenFinRVM.exe`) and Node 22+.
2. Clone a public sample, e.g. [built-on-openfin/workspace-starter](https://github.com/built-on-openfin/workspace-starter). Pick a sample under `how-to/` that opens a platform window hosting views, and follow its README to `npm install` and build it. Note its dev-server command, the URL it serves on, and its manifest URL.
3. In the sample's folder (the "repo root"), write `docs/agents/openfin.md` from [../../assets/openfin.template.md](../../assets/openfin.template.md). Set `manifest`, a free `debugPort`, and `devServer` (`command` plus `readyUrl` or `readySignal`) so `launch` starts the dev server itself. Leave `launcher` unset so launch goes through the RVM.
4. Make sure `playwright-core` resolves (`npm install --prefix skills/openfin` here, or install it in the sample). No browser download is needed.
5. Quit the sample app and its dev server. The suite must launch the app itself, so `stop` is allowed to quit it.
6. From `skills/openfin`:

   ```
   set OPENFIN_REAL=1
   set OPENFIN_REAL_CONFIG=C:\path\to\sample\docs\agents\openfin.md
   npm test
   ```

   The repo root is inferred from `<repo>\docs\agents\openfin.md`. For a config somewhere else, also set `OPENFIN_REAL_REPO=<repo root>`. With `OPENFIN_REAL=1` on Windows, a missing or misplaced config fails the run instead of skipping.

The suite runs `doctor`, then `status` to check nothing's running, then `launch`, `status`, `list-targets`, `text`, `screenshot`, `eval`, `logs` and `stop`. It ends with `status` to confirm the debug port closed. If a step fails midway, it runs `stop` to quit what it launched. Read the `#` diagnostic lines for the target list and the screenshot path.

## Unverified items to confirm

Record the answers in the ticket or spec.

- [ ] Is each view a separate CDP page target? The `list-targets` test asserts that it is, and its diagnostic shows the list.
- [ ] Does a view screenshot include the window frame? Open the screenshot path from the diagnostic.
- [ ] How do security realms and different runtime arguments affect whether instances share a runtime, and so a debug port? Try a second sample with a different runtime version or arguments while the first is running, and check `status` and `list-targets`.

## Windows acceptance checklist

Do this once, in a fresh agent session with the skill installed and a clean clone of the sample, without the config above:

- [ ] The agent sets up the sample app from scratch with the skill's interactive setup: writes `docs/agents/openfin.md`, gets `doctor` to `ready: true`, and asks you to add the debug-port runtime argument.
- [ ] Ask for a small visible change (e.g. a heading's text). The agent makes it, launches or attaches, and verifies it with `text` or `screenshot`, then checks `logs --level error`.
- [ ] Ask for one E2E test. The agent follows `references/test-authoring.md`, writes the test, runs it, and it passes.
- [ ] At the end, `stop` quits only what the agent launched, and the agent reports what it left running.
