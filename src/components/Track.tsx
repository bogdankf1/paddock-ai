import { useEffect, useRef, useState } from "react";
import { Application, extend, useTick } from "@pixi/react";
import { Container, Graphics } from "pixi.js";
import { pointOnEllipse } from "../lib/path";
import { useClaudeStore, type AgentState } from "../state/claudeStore";

extend({ Container, Graphics });

const TRACK_WIDTH = 1200;
const TRACK_HEIGHT = 720;
const CX = TRACK_WIDTH / 2;
const CY = TRACK_HEIGHT / 2;
const RX = 460;
const RY = 240;
const LAP_SECONDS = 14;
const PIT_T = 0.5; // 9 o'clock — left side of oval

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

function Car() {
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
      // Always forward at full speed.
      tRef.current = (tRef.current + baseSpeed * dt) % 1;
      wobbleRef.current = 0;
    } else {
      // IDLE / PLANNING / ERROR: ease forward into the pit, never backwards.
      const d = forwardDistance(tRef.current, PIT_T);
      if (d < 0.0015 || d > 0.9985) {
        tRef.current = PIT_T;
        // Pit-lane idle wobble — strongest while mechanics are "working" (PLANNING).
        if (agentState === "PLANNING") {
          wobbleRef.current += dt;
        } else {
          wobbleRef.current = 0;
        }
      } else {
        // Decelerate within the last ~20% of the lap before the pit.
        const speedFactor = Math.min(1, d * 4 + 0.2);
        tRef.current = (tRef.current + baseSpeed * speedFactor * dt) % 1;
        wobbleRef.current = 0;
      }
    }

    const { angle } = pointOnEllipse(tRef.current, CX, CY, RX, RY);
    angleRef.current = lerpAngle(angleRef.current, angle, Math.min(1, dt * 6));
    forceRender((n) => (n + 1) & 0xffff);
  });

  const { x, y } = pointOnEllipse(tRef.current, CX, CY, RX, RY);
  const color = CAR_COLOR[agentState];
  // Small mechanics wobble at the pit during PLANNING.
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

function TrackPath() {
  return (
    <pixiGraphics
      draw={(g) => {
        g.clear();
        g.ellipse(CX, CY, RX + 28, RY + 28).fill(0x1a1a1a);
        g.ellipse(CX, CY, RX - 28, RY - 28).fill(0x0a0a0a);
        g.ellipse(CX, CY, RX + 28, RY + 28).stroke({ color: 0x3a3a3a, width: 2 });
        g.ellipse(CX, CY, RX - 28, RY - 28).stroke({ color: 0x3a3a3a, width: 2 });
        // pit marker — small box on the left side of the inner edge
        const pit = pointOnEllipse(PIT_T, CX, CY, RX - 28, RY - 28);
        g.rect(pit.x - 4, pit.y - 18, 8, 36).fill(0x2a2a2a);
        g.rect(pit.x - 4, pit.y - 18, 8, 36).stroke({ color: 0x4a4a4a, width: 1 });
      }}
    />
  );
}

export function Track() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () =>
      setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="absolute inset-0">
      <Application
        width={size.w}
        height={size.h}
        background={0x0a0a0a}
        antialias
      >
        <pixiContainer
          x={(size.w - TRACK_WIDTH) / 2}
          y={(size.h - TRACK_HEIGHT) / 2}
        >
          <TrackPath />
          <Car />
        </pixiContainer>
      </Application>
    </div>
  );
}
