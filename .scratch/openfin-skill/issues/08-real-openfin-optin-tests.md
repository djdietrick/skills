# 08 — Opt-in real-OpenFin test backend (Windows)

Status: resolved
Type: task
Blocked by: 06

Spec: Testing Decisions backend 2 (Real OpenFin), Further Notes (unverified items).

## What to build

- Make the CLI-level test suite runnable against a real OpenFin app on Windows, opt-in via env (e.g. `OPENFIN_REAL=1` + `OPENFIN_REAL_CONFIG=<path>`), skipped otherwise. Covers RVM launch, dev-server lifecycle, real views as CDP targets, graceful quit, runtime `debug.log` path existence.
- Short `skills/openfin/scripts/test/REAL-OPENFIN.md` explaining how to run it against a public sample app, and the Windows acceptance checklist (fresh agent session sets up sample app, verifies a visible change, writes and runs one E2E test), plus the unverified items to confirm.

## Acceptance

- Real suite is skipped cleanly on macOS/CI; `npm test` still green. Cannot be executed here — note that in the ticket comments.

## Comments

- Built on macOS. The real suite (`skills/openfin/test/real/real-openfin.test.mjs`) **could not be executed on this machine**: it needs Windows, the OpenFin RVM and a sample app. Here only its skip path and the opt-in gate (`test/real/gate.mjs`, unit-tested in `test/real/gate.test.mjs`) were exercised; `npm test` is green with the real suite skipped, including with `OPENFIN_REAL=1` set (skips because the platform isn't Windows).
- Opt-in: `OPENFIN_REAL=1` + `OPENFIN_REAL_CONFIG=<sample>\docs\agents\openfin.md` (repo root inferred, or `OPENFIN_REAL_REPO`). Opted in on Windows but misconfigured fails instead of skipping.
- The run guide is at `skills/openfin/test/real/REAL-OPENFIN.md`, next to the suite, not at `scripts/test/` as the ticket said. Tests live under `test/`, and `scripts/` ships only CLI code. It holds the run steps, the unverified items to confirm, and the Windows acceptance checklist.
