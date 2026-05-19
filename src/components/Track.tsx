import { useEffect, useRef, useState } from "react";
import { Application, extend, useTick } from "@pixi/react";
import { Container, Graphics } from "pixi.js";
import { pointOnEllipse } from "../lib/path";

extend({ Container, Graphics });

const TRACK_WIDTH = 1200;
const TRACK_HEIGHT = 720;
const CX = TRACK_WIDTH / 2;
const CY = TRACK_HEIGHT / 2;
const RX = 460;
const RY = 240;
const LAP_SECONDS = 14;

function Car() {
  const [t, setT] = useState(0);
  const tRef = useRef(0);

  useTick(({ deltaMS }) => {
    tRef.current = (tRef.current + deltaMS / (LAP_SECONDS * 1000)) % 1;
    setT(tRef.current);
  });

  const { x, y, angle } = pointOnEllipse(t, CX, CY, RX, RY);

  return (
    <pixiGraphics
      x={x}
      y={y}
      rotation={angle}
      draw={(g) => {
        g.clear();
        g.roundRect(-14, -6, 28, 12, 3).fill(0xff2a2a);
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
