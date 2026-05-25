import { useEffect, useMemo, useRef, useState } from "react";
import { Application, extend, useTick } from "@pixi/react";
import { Container, Graphics, type FederatedPointerEvent } from "pixi.js";
import type { ClaudeModel } from "../lib/claude";
import { spaPath, type PathSampler } from "../lib/path";
import {
  selectAgent,
  useAgentList,
  useClaudeStore,
  type AgentRecord,
  type AgentState,
} from "../state/claudeStore";

type HoverState = { id: string; x: number; y: number };

extend({ Container, Graphics });

const TRACK_WIDTH = 1200;
const TRACK_HEIGHT = 720;
const CX = TRACK_WIDTH / 2;
const CY = TRACK_HEIGHT / 2;
const FIT_W = 1080;
const FIT_H = 600;
const LAP_SECONDS = 28;
const PIT_T = 0.0;
const ASPHALT_WIDTH = 28;
const KERB_WIDTH = 32;
const PIT_SLOT_SPACING = 18;
const VIEWPORT_PAD = 40;

function lerpAngle(a: number, b: number, k: number) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * k;
}

function forwardDistance(from: number, to: number) {
  let d = to - from;
  while (d < 0) d += 1;
  return d;
}

function carTint(color: number, agentState: AgentState): number {
  if (agentState === "IDLE" || agentState === "PLANNING") {
    return darken(color, 0.55);
  }
  if (agentState === "COMPLETE") {
    return blend(color, 0x10b981, 0.35);
  }
  if (agentState === "ERROR") {
    return blend(color, 0xef4444, 0.6);
  }
  return color;
}

function darken(color: number, factor: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function blend(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.floor(ar + (br - ar) * t);
  const g = Math.floor(ag + (bg - ag) * t);
  const bl = Math.floor(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function pitOffsetFor(index: number): number {
  // 0 → 0, 1 → +spacing, 2 → -spacing, 3 → +2*spacing, 4 → -2*spacing …
  if (index === 0) return 0;
  const sign = index % 2 === 1 ? 1 : -1;
  const magnitude = Math.ceil(index / 2);
  return sign * magnitude * PIT_SLOT_SPACING;
}

function modelFamily(model: ClaudeModel | string | null): ClaudeModel {
  if (!model) return "opus";
  const m = String(model).toLowerCase();
  if (m.includes("haiku")) return "haiku";
  if (m.includes("sonnet")) return "sonnet";
  return "opus";
}

function drawCar(g: Graphics, family: ClaudeModel, color: number) {
  if (family === "opus") {
    // F1-style: long body, front + rear wing
    g.roundRect(-16, -4, 32, 8, 2).fill(color);
    g.roundRect(13, -7, 4, 14, 1).fill(color); // front wing
    g.roundRect(-17, -6, 4, 12, 1).fill(color); // rear wing
    g.roundRect(-2, -3, 6, 6, 1).fill(0x1a1a1a); // cockpit
  } else if (family === "sonnet") {
    // GT-style: wider, fuller body
    g.roundRect(-13, -7, 26, 14, 5).fill(color);
    g.roundRect(-5, -5, 12, 10, 2).fill(0x1a1a1a); // cabin
  } else {
    // Haiku → kart: compact and chunky
    g.roundRect(-9, -5, 18, 10, 2).fill(color);
    g.roundRect(-2, -3, 5, 6, 1).fill(0x1a1a1a); // driver
  }
}

function Car({
  agent,
  sampler,
  onHover,
  onLeave,
  onSelect,
}: {
  agent: AgentRecord;
  sampler: PathSampler;
  onHover: (h: HoverState) => void;
  onLeave: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const graphicsRef = useRef<Graphics>(null);
  const tRef = useRef(PIT_T);
  const angleRef = useRef(0);
  const wobbleRef = useRef(0);

  const slotOffset = useMemo(() => pitOffsetFor(agent.index), [agent.index]);
  const family = modelFamily(agent.model ?? agent.requestedModel);
  const color = carTint(agent.color, agent.agentState);
  const agentState = agent.agentState;

  useTick(({ deltaMS }) => {
    const dt = deltaMS / 1000;
    const baseSpeed = 1 / LAP_SECONDS;
    const freeDriving =
      agentState === "EXECUTING" || agentState === "COMPLETE";

    if (freeDriving) {
      tRef.current = (tRef.current + baseSpeed * dt) % 1;
      wobbleRef.current = 0;
    } else {
      const d = forwardDistance(tRef.current, PIT_T);
      if (d < 0.0015 || d > 0.9985) {
        tRef.current = PIT_T;
        if (agentState === "PLANNING") {
          wobbleRef.current += dt;
        } else {
          wobbleRef.current = 0;
        }
      } else {
        const speedFactor = Math.min(1, d * 4 + 0.2);
        tRef.current = (tRef.current + baseSpeed * speedFactor * dt) % 1;
        wobbleRef.current = 0;
      }
    }

    const { x, y, angle } = sampler.point(tRef.current);
    angleRef.current = lerpAngle(angleRef.current, angle, Math.min(1, dt * 6));

    const g = graphicsRef.current;
    if (!g) return;
    const inPit = agentState === "IDLE" || agentState === "PLANNING";
    const perpDx = inPit ? Math.cos(angle + Math.PI / 2) * slotOffset : 0;
    const perpDy = inPit ? Math.sin(angle + Math.PI / 2) * slotOffset : 0;
    const wobble =
      agentState === "PLANNING" ? Math.sin(wobbleRef.current * 6) * 0.04 : 0;
    g.x = x + perpDx;
    g.y = y + perpDy;
    g.rotation = angleRef.current + wobble;
  });

  return (
    <pixiGraphics
      ref={graphicsRef}
      eventMode="static"
      cursor="pointer"
      onPointerOver={(e: FederatedPointerEvent) =>
        onHover({ id: agent.id, x: e.client.x, y: e.client.y })
      }
      onPointerMove={(e: FederatedPointerEvent) =>
        onHover({ id: agent.id, x: e.client.x, y: e.client.y })
      }
      onPointerOut={() => onLeave(agent.id)}
      onPointerTap={() => onSelect(agent.id)}
      draw={(g) => {
        g.clear();
        drawCar(g, family, color);
      }}
    />
  );
}

function tracePath(g: Graphics, samples: { x: number; y: number }[]) {
  g.moveTo(samples[0].x, samples[0].y);
  for (let i = 1; i < samples.length; i++) {
    g.lineTo(samples[i].x, samples[i].y);
  }
  g.closePath();
}

function TrackPath({ sampler }: { sampler: PathSampler }) {
  return (
    <pixiGraphics
      draw={(g) => {
        g.clear();
        tracePath(g, sampler.samples);
        g.stroke({
          color: 0x3a3a3a,
          width: KERB_WIDTH * 2,
          cap: "round",
          join: "round",
        });
        tracePath(g, sampler.samples);
        g.stroke({
          color: 0x1a1a1a,
          width: ASPHALT_WIDTH * 2,
          cap: "round",
          join: "round",
        });
        const pit = sampler.point(PIT_T);
        g.circle(pit.x, pit.y, 7)
          .fill(0x2a2a2a)
          .stroke({ color: 0x6b7280, width: 1.5 });
      }}
    />
  );
}

export function Track() {
  const [size, setSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });
  const [hover, setHover] = useState<HoverState | null>(null);
  const sampler = useMemo(() => spaPath(CX, CY, FIT_W, FIT_H), []);
  const agents = useAgentList();
  const selectedId = useClaudeStore((s) => s.selectedId);

  useEffect(() => {
    const onResize = () =>
      setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const scale = Math.min(
    (size.w - VIEWPORT_PAD * 2) / TRACK_WIDTH,
    (size.h - VIEWPORT_PAD * 2) / TRACK_HEIGHT,
  );
  const offsetX = (size.w - TRACK_WIDTH * scale) / 2;
  const offsetY = (size.h - TRACK_HEIGHT * scale) / 2;

  const hoveredAgent = hover
    ? agents.find((a) => a.id === hover.id)
    : null;

  return (
    <div className="absolute inset-0">
      <Application resizeTo={window} background={0x0a0a0a} antialias>
        <pixiContainer x={offsetX} y={offsetY} scale={scale}>
          <TrackPath sampler={sampler} />
          {agents.map((a) => (
            <Car
              key={a.id}
              agent={a}
              sampler={sampler}
              onHover={setHover}
              onLeave={(id) =>
                setHover((prev) => (prev?.id === id ? null : prev))
              }
              onSelect={selectAgent}
            />
          ))}
        </pixiContainer>
      </Application>
      {hoveredAgent && hover && (
        <div
          className="pointer-events-none absolute z-30 -translate-y-full rounded border border-neutral-700 bg-neutral-950/95 px-2 py-1 font-mono text-[11px] text-neutral-200 shadow-lg backdrop-blur"
          style={{ left: hover.x + 14, top: hover.y - 10 }}
        >
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: `#${hoveredAgent.color
                  .toString(16)
                  .padStart(6, "0")}`,
              }}
            />
            <span className="uppercase tracking-widest">
              Agent {hoveredAgent.index + 1}
            </span>
            <span className="text-neutral-500">
              · {modelFamily(hoveredAgent.model ?? hoveredAgent.requestedModel)}
            </span>
            {selectedId === hoveredAgent.id && (
              <span className="text-emerald-400">· selected</span>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-neutral-500">
            {hoveredAgent.agentState.toLowerCase()} — click to focus
          </div>
        </div>
      )}
    </div>
  );
}
