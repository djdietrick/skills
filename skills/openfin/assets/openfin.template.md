# OpenFin project config

This file tells the `openfin` agent skill how to run and drive this project's
OpenFin app. It lives at `docs/agents/openfin.md`. Interactive setup writes it
from the skill's template; edit it by hand whenever the app changes.

The skill's helper scripts read **only** the fenced `json openfin-config`
block below. Everything else in this file is for people and agents. Keep
exactly one such block.

## Fields

| Field | Required | Default | Meaning |
| --- | --- | --- | --- |
| `manifest` | yes | none | Path (relative to the repo root) or URL of the app manifest the skill launches through the RVM. |
| `debugPort` | no | `9090` | Remote debugging port. The skill adds `--remote-debugging-port=<debugPort>` when it launches the app, and attaches to an instance already listening on it. |
| `devServer` | no | `null` | How to start the app's web assets: `command` (required if set), `cwd` (relative to repo root, default `.`), and either `readyUrl` (polled until it responds) or `readySignal` (text the command prints when it's ready). Use `null` if the manifest's URLs are hosted elsewhere. |
| `windows` | no | `[]` | Key windows and views: `name` (what people call it), optional `identity` (`uuid/name` from OpenFin), and `purpose`. Agents use these names when addressing targets. |
| `logsDir` | no | `%LOCALAPPDATA%\OpenFin` | OpenFin runtime directory that holds `debug.log`. `%VAR%` references are expanded. |

To let agents attach to instances you start yourself, add
`--remote-debugging-port=9090` (matching `debugPort`) to `runtime.arguments`
in your dev manifest.

## Config

```json openfin-config
{
  "manifest": "http://localhost:5050/manifest.fin.json",
  "debugPort": 9090,
  "devServer": {
    "command": "npm run dev",
    "cwd": ".",
    "readyUrl": "http://localhost:5050/manifest.fin.json"
  },
  "windows": [
    {
      "name": "main",
      "identity": "my-app/main",
      "purpose": "Main application window that hosts the views."
    },
    {
      "name": "blotter",
      "purpose": "Trade blotter view; lists today's orders."
    }
  ],
  "logsDir": "%LOCALAPPDATA%\\OpenFin"
}
```

## Notes for agents

Add anything an agent should know about driving this app: login steps, test
accounts (never real credentials), workflows worth checking, flaky areas.
