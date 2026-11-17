# 06 — `launch` and `stop` with ownership rules

Status: claimed
Type: task
Blocked by: 03, 05

Spec: user stories 15, 17–21, 41–45; Implementation Decisions "Launch", "Ownership state", "Shutdown"; Testing Decisions ("launch is tested with a stand-in launcher configured in the fixture config").

## What to build

- `launch`: if debug port already reachable → attach (no starting), ensure collector. Else start dev server per config (command, cwd), wait for readiness URL/signal with timeout; then start app via RVM (`%LOCALAPPDATA%\OpenFin\OpenFinRVM.exe --config=<manifest> --runtime-arguments="--remote-debugging-port=<port>"`), unless the config supplies a launcher override (used by tests to start the simulated backend). Wait for debug endpoint + first target. Record PIDs/what was started in state. Start collector. On failure, `LAUNCH_FAILED` including captured dev-server/runtime stderr output.
- `stop`: if skill launched the app → quit via CDP (`fin.Application.getCurrentSync().quit()` in an app target); then stop dev server and collector it started. Never blanket-kill OpenFin. Report `{stopped:[...], leftRunning:[...]}`. Instances/dev servers merely attached to are left alone.

## Acceptance

- CLI tests on simulated backend: launch via stand-in launcher then stop quits it; stop after attaching to an externally started backend leaves it running and says so; launch failure surfaces stderr; dev server stand-in started and stopped.
