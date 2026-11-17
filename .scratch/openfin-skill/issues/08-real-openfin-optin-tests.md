# 08 — Opt-in real-OpenFin test backend (Windows)

Status: claimed
Type: task
Blocked by: 06

Spec: Testing Decisions backend 2 (Real OpenFin), Further Notes (unverified items).

## What to build

- Make the CLI-level test suite runnable against a real OpenFin app on Windows, opt-in via env (e.g. `OPENFIN_REAL=1` + `OPENFIN_REAL_CONFIG=<path>`), skipped otherwise. Covers RVM launch, dev-server lifecycle, real views as CDP targets, graceful quit, runtime `debug.log` path existence.
- Short `skills/openfin/scripts/test/REAL-OPENFIN.md` explaining how to run it against a public sample app, and the Windows acceptance checklist (fresh agent session sets up sample app, verifies a visible change, writes and runs one E2E test), plus the unverified items to confirm.

## Acceptance

- Real suite is skipped cleanly on macOS/CI; `npm test` still green. Cannot be executed here — note that in the ticket comments.
