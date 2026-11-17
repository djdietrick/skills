# 03 — `list-targets` and target name resolution

Status: ready-for-agent
Type: task
Blocked by: 02

Spec: user stories 22–27; Implementation Decisions "Target identity".

## What to build

- `list-targets`: for each CDP page target, evaluate OpenFin identity in-page → `uuid/name`, kind (window|view), parent window identity (views), url, title. Use platform snapshot where available. Label Workspace components (`openfin-workspace` uuid with `openfin-home`, `openfin-dock`, `openfin-storefront` → Home/Dock/Store). Attach config aliases (config windows/views names) to matching targets. Pages without `fin` are listed with a fallback identity/kind `unknown`.
- Target resolution module used by every target-taking command: accept `uuid/name`, unique short `name`, or config alias. `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS` errors include the candidate list.

## Acceptance

- CLI tests against simulated backend: full listing with kinds/parents/Workspace label/alias; ambiguous and not-found errors list candidates. Resolution is exercised via a minimal command or via the next tickets (expose it through `list-targets --target <t>` filter if convenient).
