# 01 — Skill scaffold, CLI output contract, project config parsing

Status: claimed
Type: task
Blocked by: none

Spec: `.scratch/openfin-skill/spec.md` — user stories 10–13, 34; Implementation Decisions "One skill", "Project config", "Helper scripts" (output contract, error codes); Testing Decisions.

## What to build

- Repo layout `skills/openfin/` (Agent Skills layout) with a Node package for the helper scripts (`skills/openfin/scripts/`), a CLI entry point (e.g. `scripts/openfin.mjs`) dispatching subcommands, and a test runner (Node's built-in `node:test` preferred; no heavy deps). `playwright-core` as a devDependency of the skill package only, for tests.
- Output contract helper: exactly one JSON object on stdout; `{ok:true,...}` exit 0, `{ok:false,error:{code,message,hint?}}` non-zero. Unknown subcommand → error.
- Config template `skills/openfin/assets/openfin.template.md`: readable markdown with a clearly delimited machine-readable block (e.g. a fenced ```json openfin-config block) holding: manifest, debugPort (default 9090), devServer {command, cwd, readyUrl/readySignal}, windows/views [{name, identity?, purpose}], logsDir (default `%LOCALAPPDATA%\OpenFin`).
- Config loader: finds `docs/agents/openfin.md` relative to the consuming repo root (cwd, overridable via `--config <path>` and/or `OPENFIN_CONFIG` env for tests), applies defaults, validates. Error codes `CONFIG_MISSING` and `CONFIG_INVALID` with field-specific messages and a hint to run interactive setup.
- `playwright-core` resolution helper: resolve from consuming repo first, then skill folder; `PLAYWRIGHT_MISSING` error with install hint. (Used by later tickets.)
- Define the full error-code list as constants: CONFIG_MISSING, CONFIG_INVALID, PLAYWRIGHT_MISSING, DEBUG_PORT_UNREACHABLE, INSTANCE_WITHOUT_DEBUG_PORT, TARGET_NOT_FOUND, TARGET_AMBIGUOUS, SELECTOR_TIMEOUT, LAUNCH_FAILED, plus a generic one.
- Stub subcommands (`status`, `launch`, `stop`, `list-targets`, `screenshot`, `eval`, `click`, `type`, `text`, `logs`) may return a NOT_IMPLEMENTED error for now.

## Acceptance

- Tests run the CLI as a subprocess with fixture configs and assert only on stdout JSON + exit code.
- Missing config, malformed block, missing required field (manifest) each produce the right code and an actionable message.
- `npm test` in `skills/openfin` passes.
