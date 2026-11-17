# 07 — SKILL.md, interactive setup, test-authoring reference, install docs

Status: claimed
Type: task
Blocked by: 01

Spec: user stories 1–9, 46–55; Implementation Decisions "Skill document structure", "Interactive setup", "Test-authoring stack". Load the `writing-for-agents` skill before writing.

## What to build

- `skills/openfin/SKILL.md`: frontmatter `name: openfin` + description that triggers on run/drive/screenshot/verify/write tests for an OpenFin app. Body: Windows-only scope; config requirement and agent-driven interactive setup (ask each field, write from `assets/openfin.template.md` to `docs/agents/openfin.md`, check `playwright-core` loadable and ask the developer to install into app repo or skill folder — never install; tell dev to add `--remote-debugging-port` to dev manifest runtime args); attach-first lifecycle; command reference for all subcommands (from spec + ticket 01 contract; update if later tickets change flags); safety rules (only stop what it started; never kill all OpenFin processes unless explicitly asked); runtime `debug.log` pointer. Examples use a public OpenFin sample app (e.g. OpenFin's `built-on-openfin/workspace-starter` samples).
- `skills/openfin/references/test-authoring.md`, loaded only for test-writing tasks: use existing E2E framework first; else `@openfin/automation-cli` + `@openfin/automation-helpers`; targeting by identity incl. Workspace components; ChromeDriver/runtime version matching; per-run launch/shutdown; explore with helper scripts before asserting.
- Repo-root `README.md` with install instructions via standard skills tooling (e.g. `npx skills add <repo> --skill openfin`) and repo layout.

## Acceptance

- Docs exist, are consistent with the CLI as built on the integration branch, and cover every listed story. (Not automated; reviewed.)
