# Spec: `openfin` agent skill

Status: ready-for-agent

## Problem Statement

I build an application that runs on the OpenFin runtime. Coding agents can edit its code, but they can't see or touch the running app. They can't open it, look at a window, click through a workflow, read what a view shows, or catch a console error at startup. So every UI change needs me to check it by hand, and agents can't reliably write end-to-end tests for the app either, because they don't know how to connect to OpenFin, tell its windows and views apart, or use OpenFin's test tooling.

General browser-automation skills don't fit. OpenFin apps start from a manifest through the RVM, not a URL. One app has many windows and views, often including Workspace components (Home, Dock, Store). The runtime is shared with other OpenFin apps on the same machine. And the safe way to start and stop things is specific to OpenFin. I also want to share the solution with other OpenFin developers, so it can't be tied to my app.

## Solution

A generic, shareable agent skill named `openfin` that lets an agent drive any OpenFin application on Windows and write end-to-end tests for it.

- Each project describes its app in a short **project config** file (`docs/agents/openfin.md` in the consuming repo). When the file is missing, the skill runs an **interactive setup** that asks the developer for the details and writes the file from a bundled template.
- The skill ships **helper scripts**: a Node command-line tool that prints JSON. Agents use it to check status, attach to or launch the app, list **targets** (windows and views, named by their OpenFin identity), take screenshots, run JavaScript, click, type, read text, read console logs, and stop the app.
- The skill **attaches first**: it uses an instance that's already running when one has the debug port open. Only when nothing is running does it start the dev server and launch the app itself. It only ever stops what it started.
- When the task is writing tests, the skill loads separate **test-authoring guidance**. That guidance has the agent use the project's existing test framework, or OpenFin's official automation stack when the project has none.

## User Stories

### Setup and configuration

1. As a developer adopting the skill, I want the agent to notice that my repo has no OpenFin project config and offer to set one up, so that I don't have to read docs before first use.
2. As a developer, I want interactive setup to ask me for my app's manifest path or URL, so that the skill launches the right app.
3. As a developer, I want interactive setup to ask which debug port to use, defaulting to 9090, so that it doesn't collide with other tools on my machine.
4. As a developer, I want interactive setup to ask how to start my dev server, so that the skill can bring up my app's web assets however my project needs: any command, working directory, or URL to wait on.
5. As a developer, I want interactive setup to ask for the names and purposes of my key windows and views, so that agents can refer to them as "the blotter view" rather than guessing.
6. As a developer, I want interactive setup to ask where OpenFin's runtime logs are, defaulting to `%LOCALAPPDATA%\OpenFin`, so that machines with non-standard installs still work.
7. As a developer, I want interactive setup to check whether `playwright-core` can be loaded and, if not, tell me exactly what to install and wait for me, so that I stay in control of my dependencies.
8. As a developer, I want to choose whether `playwright-core` goes into my app repo or the skill's own folder, so that I can keep my app's dependencies clean if I prefer.
9. As a developer, I want interactive setup to tell me to add the remote-debugging-port argument to my dev manifest's runtime arguments, so that agents can attach to instances I start myself.
10. As a developer, I want the project config written from a template that ships with the skill, so that every repo's config has the same shape and the scripts can read it reliably.
11. As a developer, I want the project config to be a readable markdown file under `docs/agents/`, so that it sits next to my other agent docs and I can edit it by hand.
12. As a developer, I want the scripts to fail with a clear, actionable message when the project config is missing or invalid, so that I know to run setup or fix a specific field.
13. As a developer, I want the skill to never guess app details by scanning my repo, so that it behaves predictably and only does what the config says.

### Attaching and launching

14. As an agent, I want a `status` command that reports whether an OpenFin instance with the configured debug port is reachable, and whether the skill launched it, so that I can decide to attach or launch.
15. As an agent, I want the skill to attach to an already-running instance when its debug port is reachable, so that I don't disturb the developer's running session.
16. As an agent, I want a clear report when an OpenFin instance appears to be running but the debug port isn't open, so that I tell the developer what to fix rather than restarting their app.
17. As an agent, I want a `launch` command that starts the dev server with the configured command and waits until it's ready, so that the manifest's URLs resolve when the app starts.
18. As an agent, I want `launch` to start the app through the RVM with the remote-debugging-port runtime argument added, so that I can connect without editing the manifest.
19. As an agent, I want `launch` to wait until the debug port responds and the app's first window exists before returning, so that my next command doesn't race the startup.
20. As an agent, I want `launch` to fail with the dev server's or runtime's error output when startup fails, so that I can diagnose it rather than hang.
21. As an agent, I want the skill to remember which processes it started (dev server and app), so that later commands and other agent turns know what they own.

### Targets

22. As an agent, I want a `list-targets` command that names every window and view by its OpenFin identity (`uuid/name`), so that I can address them by stable names rather than CDP ids that change between runs.
23. As an agent, I want each target listed with its kind (window or view), parent window, URL, and title, so that I can find the one I need.
24. As an agent, I want Workspace components (Home, Dock, Store) labeled as such in the target list, so that I don't mistake them for app windows.
25. As an agent, I want the window and view names from the project config shown next to matching targets, so that the developer's names for things carry through.
26. As an agent, I want every command that takes a target to accept the `uuid/name` form, or a unique short name when there's no ambiguity, so that commands stay short.
27. As an agent, I want a clear error listing the candidates when a target name is ambiguous or not found, so that I can correct it in one step.

### Observing and interacting

28. As an agent, I want a `screenshot` command that captures a named target to a PNG file and returns its path, so that I can look at what the user would see.
29. As an agent, I want screenshots saved under the project's scratch area with distinct filenames, so that repeated screenshots don't overwrite each other and don't clutter the repo.
30. As an agent, I want a `text` command that returns the visible text of a target or of an element in it, so that I can check content without a screenshot.
31. As an agent, I want a `click` command that clicks an element in a target by selector, so that I can drive workflows.
32. As an agent, I want a `type` command that types text into an element in a target by selector, so that I can fill in forms.
33. As an agent, I want an `eval` command that runs JavaScript in a target and returns the JSON-serialized result, so that I can query app state or call `fin` APIs when no built-in command fits.
34. As an agent, I want every command to print a single JSON object on success and a JSON error object (with a non-zero exit code) on failure, so that I can parse results reliably.
35. As an agent, I want interaction commands to wait a bounded time for the selector to appear, so that small rendering delays don't cause false failures.

### Logs

36. As an agent, I want a background log collector to start when the skill launches or first attaches to the app, so that console output from startup isn't lost before I connect.
37. As an agent, I want the collector to record each target's console messages and uncaught errors to a per-session log file under the scratch area, labeled by target name, so that I can tell which window logged what.
38. As an agent, I want the collector to pick up windows and views that open after it starts, so that logs from later-created views are captured too.
39. As an agent, I want a `logs` command that returns recent console entries, filtered by target and level, so that I can check for errors after a change.
40. As an agent, I want the skill to point me at the OpenFin runtime's `debug.log` in the configured logs directory, so that I can diagnose crashes and manifest errors the console never sees.

### Shutdown and safety

41. As an agent, I want a `stop` command that gracefully quits the app it launched, by calling the application's quit API over the debug connection, so that the runtime shuts down cleanly.
42. As an agent, I want `stop` to also shut down the dev server and log collector it started, so that no orphan processes are left.
43. As a developer, I want `stop` to leave alone any instance or dev server the skill attached to but didn't start, so that my own session survives the agent's work.
44. As a developer, I want the skill to never kill every OpenFin process unless I explicitly ask for it, so that other OpenFin apps on my machine keep running.
45. As an agent, I want `stop` to report what it stopped and what it deliberately left running, so that I can tell the developer accurately.

### Test authoring

46. As an agent asked to write E2E tests, I want the skill to load test-authoring guidance only for that kind of task, so that driving tasks stay lightweight.
47. As an agent writing tests, I want guidance to find and use the project's existing E2E test framework and conventions first, so that new tests fit the codebase.
48. As an agent writing tests in a project with no E2E framework, I want guidance to set up OpenFin's official automation CLI and helpers, so that tests use the supported, Workspace-aware stack.
49. As an agent writing tests, I want guidance on targeting windows, views, and Workspace components by OpenFin identity, so that tests are stable across runs.
50. As an agent writing tests, I want guidance on matching the ChromeDriver version to the runtime and on launching and shutting down per test run, so that tests are reliable in CI.
51. As an agent writing tests, I want to use the helper scripts to explore the running app (selectors, target names, text) before writing assertions, so that tests are grounded in what's actually on screen.

### Sharing and discovery

52. As another OpenFin developer, I want to install the skill from this repo with standard skills tooling, so that I can use it without copying files by hand.
53. As an agent, I want the skill to trigger when asked to run, drive, screenshot, verify, or write tests for an OpenFin app, so that it loads at the right moment.
54. As another OpenFin developer, I want the skill's examples to use a public OpenFin sample app, so that nothing in it depends on a private application.
55. As a maintainer, I want the skill's instructions to state clearly that it's Windows-only, so that users on other platforms aren't misled.

## Implementation Decisions

- **One skill, named `openfin`**, in the plain Agent Skills layout at the root of this repo (a `skills/` folder, one folder per skill with a `SKILL.md`). Plugin and marketplace packaging is deferred.
- **Skill document structure:** the main skill file covers trigger, Windows-only scope, the config requirement and interactive setup, the attach-first lifecycle, the command reference, and safety rules. Test-authoring guidance is a separate reference file loaded only for test-writing tasks. The project config template ships with the skill.
- **Project config** lives in the consuming repo at `docs/agents/openfin.md`. It is required, and nothing is auto-discovered. Fields:
  - manifest (path or URL)
  - debug port (default 9090)
  - dev-server start instructions (command, working directory, readiness URL or signal; free-form enough for any project)
  - named windows and views with their purpose
  - OpenFin logs directory (default `%LOCALAPPDATA%\OpenFin`)

  The scripts read the machine-readable fields from a clearly delimited block in the markdown file, and prose around it is for humans and agents.
- **Interactive setup** is agent-driven guidance in the skill, not a script. It asks the developer for each config field and writes the config from the template. It checks that `playwright-core` can be loaded and, if not, gives the developer the install command and waits; it never installs dependencies itself. It tells the developer to add the remote-debugging-port runtime argument to the dev manifest.
- **Helper scripts** are a single Node command-line tool with subcommands: `status`, `launch`, `stop`, `list-targets`, `screenshot`, `eval`, `click`, `type`, `text`, `logs`.
  - Output contract: exactly one JSON object on stdout. Success returns `{ ok: true, ... }` and exit code 0. Failure returns `{ ok: false, error: { code, message, hint? } }` and a non-zero exit code.
  - Error codes cover at least: config missing or invalid, `playwright-core` missing, debug port unreachable, an instance running without a debug port, target not found or ambiguous, selector timeout, launch failure.
- **Connection:** Playwright's connect-over-CDP against the configured debug port. `playwright-core` only, with no browser download. The scripts resolve it from the consuming repo first, then the skill's own folder.
- **Target identity:** for each page target, the scripts evaluate the page's OpenFin identity to get `uuid/name` and work out whether it's a window or a view and its parent. They use the platform snapshot where available. Workspace components are labeled by their known identities (`openfin-workspace` uuid with `openfin-home`, `openfin-dock`, `openfin-storefront`). Config-provided names are attached as aliases.
- **Launch:** start the dev server per config, wait for readiness, then start the app through the RVM executable with the manifest and the remote-debugging-port runtime argument. No manifest edits. Wait for the debug endpoint and first target before returning.
- **Ownership state:** the scripts write a session state file under `.scratch/openfin/` in the consuming repo. It records PIDs and what the skill started, so `stop` and `status` work across separate agent turns.
- **Shutdown:** `stop` calls the application's quit API over CDP for an app the skill launched, then ends the dev server and log collector it started. It never runs a blanket kill of OpenFin processes; that happens only on the developer's explicit request, outside the default commands.
- **Log collector:** a detached background process started by `launch` or by the first attach. It subscribes to console and page-error events for all current and future targets. It appends JSON lines labeled by target identity to a log file under `.scratch/openfin/logs/` in the consuming repo, and `logs` reads that file. The skill directs agents to the runtime's `debug.log` in the configured logs directory for runtime-level failures.
- **Screenshots** go under `.scratch/openfin/screenshots/` with timestamped, target-named filenames, and the command returns the absolute path.
- **Test-authoring stack:** use the project's existing E2E framework if there is one. Otherwise OpenFin's official `@openfin/automation-cli` plus `@openfin/automation-helpers`, which handle runtime and ChromeDriver version matching and include Workspace component helpers.
- **Unconfirmed assumption:** the developer decides where `playwright-core` is installed (the consuming repo or the skill's folder). The scripts support both locations.

## Testing Decisions

- **A good test** runs a helper-script subcommand with arguments and a fixture project config, then asserts only on the JSON output, the exit code, and observable effects: files written, processes started or stopped, app state changed. Tests don't reach into internal modules.
- **Single seam: the command-line interface of the helper scripts.** It runs against two backends:
  1. **Simulated OpenFin (automated, any OS, CI).** Headless Chromium started with a remote debugging port serves fixture pages that carry a fake `fin` global. The fake provides identity, a platform snapshot, and an application quit that closes the browser. Fixtures include app windows, views with parents, and a fake Workspace Home.
     - **Covers:** config parsing and its errors, `status`, target listing and naming including Workspace labels and config aliases, ambiguous or missing target errors, `screenshot`, `text`, `click`, `type`, `eval`, the selector timeout, the log collector (including targets opened after it starts), `logs` filtering, and ownership rules (`stop` leaves attached instances alone; `stop` quits what it launched).
     - **Launch in this backend:** `launch` is tested with a stand-in launcher configured in the fixture config.
  2. **Real OpenFin (opt-in, manual, Windows).** The same CLI-level tests run against a public OpenFin sample app on the developer's Windows machine. They cover what the simulation can't: RVM launch, the dev-server lifecycle, real views as CDP targets, graceful quit, and the runtime `debug.log` path.
- **Not automated:** interactive setup and test-authoring guidance are agent instructions. They're validated with an acceptance checklist run on Windows: a fresh agent session sets up the sample app from scratch, verifies a visible change, and writes and runs one E2E test.
- **Prior art:** none in this repo; this is its first skill. The suite establishes the pattern.

## Out of Scope

- macOS and Linux support for driving OpenFin apps. Only the simulated test backend runs cross-platform.
- Auto-discovering app details from the consuming repo.
- The skill installing dependencies itself.
- Claude Code plugin or marketplace packaging (layout leaves room to add later).
- An MCP server; the interface is the helper-script CLI.
- Killing OpenFin processes the skill didn't start, except on explicit developer request.
- Interop, FDC3 channel, or message-bus inspection beyond what `eval` allows.
- Multiple simultaneous OpenFin apps or security realms in one session config.
- Visual regression or snapshot-diff tooling.

## Further Notes

- Research findings that shaped this spec (from OpenFin and Playwright docs and the official automation packages):
  - The RVM accepts runtime arguments on the command line, which is how the debug port is enabled without manifest edits.
  - Playwright's connect-over-CDP is officially "lower fidelity" and OpenFin doesn't endorse it, which is why tests default to the official stack.
  - The RVM has no shutdown flag, and the official tooling force-kills all OpenFin processes, which this skill deliberately avoids.
  - The CDP target list doesn't expose OpenFin identity, so identity is read inside each page.
- Unverified, so confirm during Windows validation:
  - whether each view is a separate CDP page target
  - how security realms and differing runtime arguments affect whether instances share a runtime (and so a debug port)
  - whether a view screenshot includes the window frame
- Validation happens on the developer's Windows machine.
