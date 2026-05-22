import { useEffect, useMemo, useRef, useState } from "react";
import { Application, extend, useTick } from "@pixi/react";
import { Container, Graphics } from "pixi.js";
import { spaPath, type PathSampler } from "../lib/path";
import { useClaudeStore, type AgentState } from "../state/claudeStore";

extend({ Container, Graphics });

const TRACK_WIDTH = 1200;
const TRACK_HEIGHT = 720;
const CX = TRACK_WIDTH / 2;
const CY = TRACK_HEIGHT / 2;
const FIT_W = 1080;
const FIT_H = 600;
const LAP_SECONDS = 28;
const PIT_T = 0.0; // path start — adjust after eyeballing
const ASPHALT_WIDTH = 28;
const KERB_WIDTH = 32;

const CAR_COLOR: Record<AgentState, number> = {
  IDLE: 0x6b7280,
  PLANNING: 0xf59e0b,
  EXECUTING: 0xff2a2a,
  COMPLETE: 0x10b981,
  ERROR: 0xef4444,
};

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

function Car({ sampler }: { sampler: PathSampler }) {
  const agentState = useClaudeStore((s) => s.agentState);
  const tRef = useRef(PIT_T);
  const angleRef = useRef(0);
  const wobbleRef = useRef(0);
  const [, forceRender] = useState(0);

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

    const { angle } = sampler.point(tRef.current);
    angleRef.current = lerpAngle(angleRef.current, angle, Math.min(1, dt * 6));
    forceRender((n) => (n + 1) & 0xffff);
  });

  const { x, y } = sampler.point(tRef.current);
  const color = CAR_COLOR[agentState];
  const wobble =
    agentState === "PLANNING" ? Math.sin(wobbleRef.current * 6) * 0.04 : 0;

  return (
    <pixiGraphics
      x={x}
      y={y}
      rotation={angleRef.current + wobble}
      draw={(g) => {
        g.clear();
        g.roundRect(-14, -6, 28, 12, 3).fill(color);
        g.roundRect(-4, -8, 8, 16, 2).fill(0x1a1a1a);
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

const VIEWPORT_PAD = 40;

export function Track() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const sampler = useMemo(() => spaPath(CX, CY, FIT_W, FIT_H), []);

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

  return (
    <div className="absolute inset-0">
      <Application
        resizeTo={window}
        background={0x0a0a0a}
        antialias
      >
        <pixiContainer x={offsetX} y={offsetY} scale={scale}>
          <TrackPath sampler={sampler} />
          <Car sampler={sampler} />
        </pixiContainer>
      </Application>
    </div>
  );
}
