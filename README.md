# Paddock AI

A Tauri desktop app that wraps [Claude Code](https://claude.ai/code) and visualizes each running agent as a race car on the Spa-Francorchamps circuit. The metaphor is load-bearing: planning is a pit stop, executing is a hot lap, tokens are fuel, errors are yellow / red flags.

See [`paddock-ai.md`](./paddock-ai.md) for the full vision doc. See [`CLAUDE.md`](./CLAUDE.md) for architecture notes aimed at contributors (human or otherwise).

## Quick start

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` boots Vite on port 1420 and launches the Rust shell. `pnpm dev` alone runs Vite only — IPC calls will fail because no Tauri runtime is attached.

Spawned agents run against the directory the app was launched from. Set `PADDOCK_CWD` to override:

```bash
PADDOCK_CWD=/path/to/some/repo pnpm tauri dev
```

## Requirements

- Node 20+, pnpm
- Rust toolchain (stable) and Tauri 2 system deps — see [Tauri prerequisites](https://tauri.app/start/prerequisites/)
- The `claude` CLI on your PATH (resolved at runtime via a login shell, so anywhere your shell can find it is fine)

## Commands

- `pnpm tauri dev` — run the desktop app (Vite + Rust)
- `pnpm build` — typecheck + Vite production build of the frontend
- `pnpm tauri build` — produce the release desktop binary
- `cd src-tauri && cargo check` — fast Rust-only sanity check

No test runner, linter, or formatter is configured.

## Stack

| Layer | Tech |
|---|---|
| Desktop shell | Tauri 2 (Rust) |
| Frontend | React 19 + TypeScript |
| 2D rendering | Pixi.js v8 via `@pixi/react` |
| Styling | Tailwind CSS v4 |
| Build | Vite |
| Agent runtime | `claude` CLI subprocess, `--output-format stream-json` |

## Status

V1 is in progress. What works today:

- Spa-Francorchamps SVG track with animated cars
- Multi-agent: each prompt spawns a car with its own color and silhouette (F1 / GT / kart by model family)
- Pit-lane vs. on-track behavior driven by Claude lifecycle events
- Per-agent fuel gauge (token counter)
- Structured transcript with follow-up via `--resume`
- Weather overlay reacting to error state across agents
