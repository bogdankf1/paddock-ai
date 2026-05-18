# Paddock AI

> A desktop application that wraps Claude Code in a motorsport-themed visual experience.
> Agent activity is visualized as a race car navigating the Spa-Francorchamps circuit.

---

## Concept

Most AI agent interfaces show raw terminal output. Paddock AI translates Claude Code's internal states into a living, breathing race — where thinking becomes a pit stop, execution becomes speed, and token usage becomes fuel.

The metaphor is not cosmetic. Every visual element maps to a real agent behavior.

---

## Core Metaphor Mapping

| Claude Code Event | Race Visualization |
|---|---|
| Planning / thinking | Car in pit lane, mechanics working |
| Executing a task | Car on track, speed reflects intensity |
| Reading files | Car through slow technical sector |
| Writing code | Car on long straight (Kemmel), high speed |
| Error / retry | Yellow flag, car slows, returns to pit |
| Task complete | Checkered flag, cool-down lap |
| Token usage | Fuel gauge, depletes in real time |
| Token warning | Fuel warning light, car slows |

---

## Track: Spa-Francorchamps

Spa is chosen for its distinct sectors — each section of the track has a different character that maps naturally to different agent states.

| Sector | Track Section | Agent State |
|---|---|---|
| Sector 1 | La Source hairpin | Task start, slow deliberate entry |
| Sector 1 | Eau Rouge / Raidillon | Complex reasoning, high load |
| Sector 2 | Kemmel Straight | Generating large code blocks |
| Sector 2 | Les Combes | Decision point, branching logic |
| Sector 3 | Pouhon | Iterative loop, repeated operations |
| Sector 3 | Bus Stop chicane | File analysis, careful reading |
| Sector 3 | Blanchimont → finish | Final output, task wrapping up |

---

## Weather System

Spa's legendary unpredictable weather becomes a dynamic mood layer:

- **Sunny** — agent running smoothly, no errors
- **Overcast** — agent retrying or encountering warnings
- **Rain** — error state, multiple retries
- **Heavy rain** — critical failure, session interrupted

---

## Target Platform

- **Desktop application** via [Tauri](https://tauri.app/)
- Frontend: React + TypeScript
- Rendering: Pixi.js (2D, GPU-accelerated) or Canvas API
- Backend: Rust (Tauri) — spawns Claude Code as subprocess, reads stdout stream
- Future: Three.js 3D mode as optional view

---

## Architecture

```
┌─────────────────────────────────────┐
│           Tauri Shell (Rust)        │
│  - Spawns claude process            │
│  - Parses stdout stream             │
│  - Emits events via IPC             │
└────────────────┬────────────────────┘
                 │ Tauri IPC events
┌────────────────▼────────────────────┐
│         React Frontend              │
│  - Receives agent state events      │
│  - Updates race visualization       │
│  - Renders Spa track + car          │
└─────────────────────────────────────┘
```

### Agent State Machine

```
IDLE → PLANNING → EXECUTING → COMPLETE
                     ↓              ↓
                   ERROR  →    RETRYING
                                   ↓
                               EXECUTING
```

---

## V1 Scope

The first version prioritizes visual quality over feature completeness.

**In scope:**
- Spa-Francorchamps SVG track layout
- Animated race car that moves along the track path
- State-based car behavior (pit lane vs on track)
- Real-time fuel gauge (token counter)
- Weather overlay system
- Basic Claude Code subprocess integration
- Session log panel (collapsible terminal output)

**Out of scope for V1:**
- Multiple agents / multiple cars
- 3D mode
- Session history / replay
- Custom track selection
- Settings / configuration UI

---

## Visual Style

- Dark background, asphalt aesthetic
- Neon accent colors for UI elements
- Car livery: something personal — open to a custom design
- Minimal UI chrome — the track is the interface
- Inspired by: Raycast, Linear, but with racing soul

---

## Future Roadmap

| Version | Feature |
|---|---|
| V1 | 2D Spa track, core agent states, fuel gauge, weather |
| V2 | Session replay, lap history, token cost breakdown |
| V3 | 3D mode via Three.js |
| V4 | Multiple agents = multiple cars on track simultaneously |
| V5 | Custom track selection (Monza, Suzuka, Silverstone) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri (Rust) |
| Frontend framework | React + TypeScript |
| 2D rendering | Pixi.js |
| 3D rendering (future) | Three.js |
| Styling | Tailwind CSS |
| Build tool | Vite |
| Claude integration | Claude Code CLI subprocess |

---

## Why Paddock AI

The paddock is where the real work happens — out of sight from the grandstands.  
Paddock AI makes that invisible work visible.

