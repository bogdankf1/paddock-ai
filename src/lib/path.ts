import spaSvg from "../assets/tracks/spa.svg?raw";

export type PathPoint = { x: number; y: number; angle: number };

export type PathSampler = {
  point: (t: number) => PathPoint;
  samples: { x: number; y: number }[];
};

const SVG_NS = "http://www.w3.org/2000/svg";
const SAMPLE_COUNT = 800;

function buildSampler(
  svgText: string,
  cx: number,
  cy: number,
  width: number,
  height: number,
): PathSampler {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const srcPath = doc.querySelector("path");
  if (!srcPath) throw new Error("Track SVG has no <path>");
  const d = srcPath.getAttribute("d") ?? "";
  const closed = /[zZ]\s*$/.test(d) ? d : d + " Z";

  const host = document.createElementNS(SVG_NS, "svg");
  host.setAttribute(
    "style",
    "position:absolute;width:0;height:0;visibility:hidden;pointer-events:none;",
  );
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", closed);
  host.appendChild(path);
  document.body.appendChild(host);

  const bbox = path.getBBox();
  const total = path.getTotalLength();
  const fit = Math.min(width / bbox.width, height / bbox.height);
  const offsetX = cx - (bbox.x + bbox.width / 2) * fit;
  const offsetY = cy - (bbox.y + bbox.height / 2) * fit;

  const samples: { x: number; y: number }[] = new Array(SAMPLE_COUNT);
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const p = path.getPointAtLength((i / SAMPLE_COUNT) * total);
    samples[i] = { x: offsetX + p.x * fit, y: offsetY + p.y * fit };
  }

  document.body.removeChild(host);

  const point = (t: number): PathPoint => {
    const norm = ((t % 1) + 1) % 1;
    const f = norm * SAMPLE_COUNT;
    const i0 = Math.floor(f) % SAMPLE_COUNT;
    const i1 = (i0 + 1) % SAMPLE_COUNT;
    const frac = f - Math.floor(f);
    const a = samples[i0];
    const b = samples[i1];
    const x = a.x + (b.x - a.x) * frac;
    const y = a.y + (b.y - a.y) * frac;
    return { x, y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
  };

  return { point, samples };
}

let cached: PathSampler | null = null;

export function spaPath(
  cx: number,
  cy: number,
  width: number,
  height: number,
): PathSampler {
  if (cached) return cached;
  cached = buildSampler(spaSvg, cx, cy, width, height);
  return cached;
}
