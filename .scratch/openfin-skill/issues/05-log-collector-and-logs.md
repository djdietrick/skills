# 05 — Background log collector + `logs` command

Status: ready-for-agent
Type: task
Blocked by: 03

Spec: user stories 36–40; Implementation Decisions "Log collector".

## What to build

- Collector: detached Node process connecting over CDP, subscribing to console and pageerror for all current and future targets (new windows/views opened later), appending JSON lines `{ts, target: "uuid/name", level, text}` to `.scratch/openfin/logs/<session>.jsonl`. Records its PID in the session state file. Exposes a start function `launch` (ticket 06) and first-attach can call; starting is idempotent (don't start a second collector if one is alive).
- First attach: commands that connect (e.g. `status` when reachable, or any target command) ensure the collector is running. Keep this to one well-named function.
- `logs [--target t] [--level l] [--limit n]` returns recent entries from the current session file; includes the path to runtime `debug.log` in configured logsDir as a pointer.

## Acceptance

- CLI tests: collector captures console + uncaught errors from existing targets, and from a page opened after it started; `logs` filtering by target and level; collector process cleanup in tests.
