export type PathPoint = { x: number; y: number; angle: number };

export function pointOnEllipse(
  t: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): PathPoint {
  const theta = t * Math.PI * 2;
  const x = cx + rx * Math.cos(theta);
  const y = cy + ry * Math.sin(theta);
  const dx = -rx * Math.sin(theta);
  const dy = ry * Math.cos(theta);
  return { x, y, angle: Math.atan2(dy, dx) };
}
