# 04 — `screenshot`, `text`, `click`, `type`, `eval`

Status: ready-for-agent
Type: task
Blocked by: 03

Spec: user stories 28–35; Implementation Decisions "Screenshots".

## What to build

- `screenshot <target>` → PNG under `.scratch/openfin/screenshots/` with timestamped, target-named, distinct filenames; returns absolute path.
- `text <target> [--selector s]` → visible text (innerText) of page or element.
- `click <target> <selector>`, `type <target> <selector> <text>`.
- `eval <target> <js>` → JSON-serialized result.
- Bounded selector wait (default a few seconds, `--timeout` override) → `SELECTOR_TIMEOUT`.

## Acceptance

- CLI tests on simulated backend for each command, including two screenshots not overwriting each other, click/type changing observable page state (checked via text/eval), and selector timeout error.
