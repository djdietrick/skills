# Writing E2E tests for an OpenFin app

Loaded only for test-writing tasks. The helper CLI in [../SKILL.md](../SKILL.md) is for **exploring**; the tests you write use a real test framework and run without this skill.

## 1. Pick the framework

1. **The project's own E2E framework comes first.** Look for existing E2E tests, their config (`wdio.conf.*`, `playwright.config.*`, `jest`/`mocha` E2E projects), and the `package.json` script that runs them. If one exists, write the new test in the same framework, folder, naming, helpers, and launch setup as its neighbours. You're done with this section.
2. **No E2E framework:** set up OpenFin's official stack:
   - `@openfin/automation-cli`: launches the runtime from a manifest, provisions the ChromeDriver that matches that runtime version, runs the suite, and shuts the runtime down.
   - `@openfin/automation-helpers`: test-side helpers for OpenFin identities, windows, views, and Workspace components (Home, Dock, Store).

   Read each package's README for the current CLI flags and supported test runners before wiring it up, and propose the dev dependencies and `package.json` script to the developer. They install; you never install dependencies yourself.

Prefer this stack over Playwright-over-CDP for committed tests: Playwright's CDP connection is lower fidelity and OpenFin doesn't support it, so it suits exploration, not a CI suite.

## 2. Explore before asserting

Ground every selector, target, and expected string in what is actually on screen. With the app running (see the lifecycle in SKILL.md):

- `list-targets` gives the `uuid/name` of each window and view, and which are Workspace components.
- `text <target>` and `text <target> --selector <css>` give the real content to assert on.
- `eval <target> "<js>"` finds selectors: e.g. `[...document.querySelectorAll('[data-testid]')].map(e => e.dataset.testid)`.
- `screenshot <target>` confirms state after a `click` / `type` sequence that mirrors the test's steps.

Walk the test's workflow through the CLI once before writing it. If a step fails there, it will fail in the test.

## 3. Target by OpenFin identity

- Address windows and views by `uuid/name`, never by CDP target id, window handle order, or page title: those change between runs.
- A view and its parent window are separate targets. Switch to the view that holds the content, not the window around it.
- Workspace components have fixed identities: uuid `openfin-workspace` with names `openfin-home` (Home), `openfin-dock` (Dock), `openfin-storefront` (Store). Use the helpers' Workspace APIs for them rather than raw selectors where available.
- Use the config's `windows[].identity` values from `docs/agents/openfin.md` so tests and docs share names.

## 4. Runtime and ChromeDriver versions

ChromeDriver must match the Chromium version of the OpenFin runtime the manifest requests (`runtime.version`). The automation CLI resolves this; if the project manages ChromeDriver itself, pin it to the runtime's Chromium major version and update both together. A version mismatch shows up as session-creation errors before any test step runs.

## 5. Launch and shut down per run

- Each test run launches the app from the manifest and shuts it down at the end, so tests never depend on a developer's running session.
- Stop the app from the test's teardown with the app's quit API (`fin.Application.getCurrentSync().quit()`), not by killing processes.
- The official CLI force-kills OpenFin processes when it shuts down, which also closes other OpenFin apps on the machine. Tell the developer this before running the suite on a workstation with other OpenFin apps open.
- Before running the suite locally, `stop` anything this skill launched so the suite gets a clean runtime and the debug port.

## Done when

The new test runs green through the project's test command, fails when the asserted behaviour is broken, and leaves no OpenFin process of its own running.
