# skills

Agent skills in the plain [Agent Skills](https://agentskills.io) layout: one folder per skill under `skills/`, each with a `SKILL.md`.

| Skill | What it does |
| --- | --- |
| [`openfin`](skills/openfin/SKILL.md) | Lets a coding agent drive an OpenFin app on Windows (attach or launch, list windows and views, screenshot, click, type, read text, eval, console logs, stop) and write E2E tests for it. |

## Install

With the standard skills tooling, from the consuming repo:

```
npx skills add <owner>/<repo> --skill openfin
```

Replace `<owner>/<repo>` with this repository's GitHub path. Or copy `skills/openfin/` into your agent's skills folder (e.g. `.claude/skills/openfin/`).

### `openfin` prerequisites

- Windows with the OpenFin RVM installed (the skill can't drive apps on macOS or Linux).
- Node.js 22 or later.
- `playwright-core`, installed by you into either the app repo or the skill folder. No browser download is needed. The skill checks for it during setup and tells you the command; it never installs it itself.

On first use the agent walks you through writing `docs/agents/openfin.md` in your app repo (manifest, debug port, dev-server command, key windows and views, logs directory).

## Layout

```
skills/
  openfin/
    SKILL.md                     # skill entry point: setup, lifecycle, command reference, safety
    references/test-authoring.md # loaded only for E2E test-writing tasks
    assets/openfin.template.md   # project config template copied into consuming repos
    scripts/openfin.mjs          # helper CLI (one JSON object per run)
    scripts/commands/            # one module per subcommand, registered in index.mjs
    scripts/lib/                 # config loader, output contract, error codes, playwright resolution
    test/                        # CLI-level tests: npm test (in skills/openfin)
docs/agents/                     # how agents work in this repo (issue tracker, labels, domain docs)
```

## Developing

```
cd skills/openfin
npm install
npm test
```

Tests drive the CLI as a subprocess and assert on its JSON output. `test/skill-docs.test.mjs` fails if a subcommand is missing from `SKILL.md`'s command reference.
