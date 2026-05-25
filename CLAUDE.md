# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working style

Always use the relevant **superpowers** skill when it applies — invoke it via the `Skill` tool before doing the work, not after. Pick the one that matches what you're about to do; don't run them all reflexively. Rough mapping:

- **Creating a new feature, component, or behavior** → `superpowers:brainstorming` first, then `superpowers:writing-plans`.
- **Executing a written plan** → `superpowers:executing-plans` (separate session with checkpoints) or `superpowers:subagent-driven-development` (current session, parallelizable tasks).
- **Implementing a feature or bugfix** → `superpowers:test-driven-development` before writing implementation code. No test runner is configured here yet — if a task needs tests, set one up as part of the work.
- **Debugging a bug, test failure, or unexpected behavior** → `superpowers:systematic-debugging` before proposing a fix.
- **Claiming work is done / before committing or opening a PR** → `superpowers:verification-before-completion`. Pair with `superpowers:requesting-code-review` for major features.
- **Receiving review feedback** → `superpowers:receiving-code-review` (verify before agreeing).
- **Wrapping up a branch** → `superpowers:finishing-a-development-branch`.
- **2+ independent tasks** → `superpowers:dispatching-parallel-agents`.
- **Isolating risky work** → `superpowers:using-git-worktrees`.
- **Authoring or editing a skill** → `superpowers:writing-skills`.

User instructions in this file and direct requests override skill defaults. If a skill conflicts with what's written here or what the user just asked for, follow the user.

## Commands

Package manager is **pnpm** (a `pnpm-workspace.yaml` is present).

- `pnpm tauri dev` — run the desktop app. This is what you want 99% of the time; it boots Vite on port 1420 (hardcoded, see `vite.config.ts`) and then builds + launches the Rust shell. `pnpm dev` alone runs Vite only — IPC (`invoke`) calls will fail because no Tauri runtime is attached.
- `pnpm build` — typecheck (`tsc`) + Vite production build of the frontend. Run this to catch TS errors; there is no separate `typecheck` or `lint` script.
- `pnpm tauri build` — produce the desktop binary (slow, full Rust release build).
- Rust: `cd src-tauri && cargo check` for a fast Rust-only sanity check.

No test runner, linter, or formatter is configured.

## High-level architecture

Paddock AI is a Tauri 2 desktop app that **spawns the `claude` CLI as a subprocess and visualizes each running agent as a race car on the Spa-Francorchamps circuit**. The vision doc is `paddock-ai.md` — read it for the metaphor mapping (planning → pit lane, executing → on track, tokens → fuel, etc.).

The data flow is one-way: Rust spawns processes and streams JSON events; the React frontend turns those events into agent state and car motion.

### Rust backend (`src-tauri/src/claude.rs`)

- `claude_run` (Tauri command) resolves the `claude` binary via `/bin/zsh -ilc command -v claude` — a login shell, because the binary usually lives in a Node/nvm path that isn't on Tauri's inherited PATH. The resolved path is cached in `ClaudeState`.
- It then spawns `claude -p <prompt> --output-format stream-json --verbose --include-partial-messages --include-hook-events --permission-mode bypassPermissions [--resume <sid>] [--model <m>]` with `current_dir(app_cwd())`.
- **`app_cwd()`** resolves once at first use: `PADDOCK_CWD` env var if set, else the process's `current_dir()` (i.e. wherever you launched `pnpm tauri dev` from), else `.`. Set `PADDOCK_CWD` if you want agents to operate against a different repo than the launcher cwd.
- Two async tasks read stdout/stderr line-by-line; each stdout line is parsed as JSON and emitted on the `claude:event` channel tagged with the `agent_id`. Stderr and lifecycle transitions emit on `claude:lifecycle`.
- `claude_followup` reuses an existing `agent_id` with `--resume <session_id>` (session id is captured from the first `system` event in the stream).
- `claude_stop` sends a oneshot signal that triggers `child.start_kill()`. `signal_stop_blocking` is invoked on `WindowEvent::CloseRequested` so closing the window kills every running agent.
- The permission mode is `bypassPermissions` — spawned agents run unattended. Be deliberate about what you let users prompt for.

### Frontend state (`src/state/claudeStore.ts`)

- A custom store built on `useSyncExternalStore` — not Redux/Zustand. The single state shape is `{ agents: Record<id, AgentRecord>, agentOrder, selectedId }`.
- `ensureWired()` (called once from `App.tsx`) attaches the two Tauri event listeners. Each event is appended to the agent's ring buffer (`MAX_EVENTS = 500`) and fed to `deriveLightTransitions`, which is the **single source of truth for translating the raw `claude` stream into the visible `AgentState`** (`IDLE | PLANNING | EXECUTING | COMPLETE | ERROR`). When adding new event handling, extend that function rather than touching components.
- The same event also flows through `processStreamEvent` to build a structured transcript: `content_block_start/delta/stop` events are turned into `assistant_text` and `tool_use` entries with `complete: false` until their `stop` arrives. Token usage is extracted from multiple possible payload shapes (`usage`, `message.usage`, `event.usage`) by `extractTokens`.
- After `exited`, the agent is held in `COMPLETE` for `COMPLETE_HOLD_MS` (4 s) before dropping to `IDLE` — this is what gives the "cooldown lap" animation time to play. Don't shorten it without checking `Track.tsx`.
- Agents are assigned a color from `AGENT_PALETTE` based on insertion index; that color is the car tint and the sidebar accent.

### Pixi rendering (`src/components/Track.tsx` + `src/lib/path.ts`)

- Uses `@pixi/react` v8, which exposes Pixi nodes as lowercase intrinsic elements (`<pixiContainer>`, `<pixiGraphics>`) after `extend({ Container, Graphics })`. New Pixi classes must be added to that `extend` call before use.
- The track shape is an SVG (`src/assets/tracks/spa.svg`, imported with `?raw`) sampled into 800 points by `buildSampler`. **The sampler temporarily mounts an `<svg>` into `document.body` to call `getBBox()` / `getPointAtLength()`** — it only works in a browser context. The result is cached module-level.
- `Car` is a `useTick`-driven component. It owns a `t` parameter (0–1) along the path. The state-→-motion mapping lives here: `EXECUTING`/`COMPLETE` → continuous lap; `IDLE`/`PLANNING` → coast to the pit point at `t=0` and idle (with a small wobble while `PLANNING`). Multiple agents in the pit are fanned out perpendicular to the path via `pitOffsetFor`.
- Car silhouette is chosen by `modelFamily(agent.model ?? agent.requestedModel)` — opus = F1, sonnet = GT, haiku = kart. Add new model families in `drawCar`.

### UI surface (`src/components/`)

Single screen, fixed-position overlays on top of the Pixi canvas:
- `PromptBar` (bottom) — launches new agents via `runClaude` then `registerAgent`.
- `AgentList` (left) — selectable cards driving `selectedId`.
- `Transcript` (top right) — structured chat for the selected agent; reply form calls `followUpClaude` and is only enabled when the agent is idle and has a `sessionId`.
- `DebugPanel` (right, above prompt bar) — raw JSON event log for the selected agent.

There is no router and no global CSS framework beyond Tailwind v4 (configured via `@tailwindcss/vite`, no `tailwind.config.js` needed).

### Frontend ↔ Rust contract

Defined in `src/lib/claude.ts`. Keep types in sync with the Rust `Serialize` structs in `claude.rs` — both sides hand-roll the schema, there is no codegen. Specifically, the `claude:lifecycle` payload uses Serde's `#[serde(tag = "kind", rename_all = "lowercase")]`, so adding a variant requires matching `ClaudeLifecycleKind` in TS.
