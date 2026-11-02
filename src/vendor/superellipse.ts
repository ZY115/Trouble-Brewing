// Superellipse (squircle) seating math shared by GrimoireBoard and useGrimoireLayout so the two can't drift.
// The board is an n=3.6 superellipse; seats are distributed by equal arc length, starting at the top.

const N = 3.6;
const P = 2 / N;

/** Angles (radians) for `count` seats spaced by equal arc length around the superellipse. */
export function superellipseSeatAngles(
  count: number,
  radiusX: number,
  radiusY: number,
  boardAspect: number,
): number[] {
  if (count <= 1) return [0];

  const rx = radiusX;
  const ry = radiusY * boardAspect;

  const steps = 360;
  const arcLengths = new Float32Array(steps + 1);
  let totalLength = 0;
  arcLengths[0] = 0;

  for (let i = 1; i <= steps; i++) {
    const theta1 = (i - 1) * (360 / steps) * (Math.PI / 180);
    const theta2 = i * (360 / steps) * (Math.PI / 180);
    const midTheta = (theta1 + theta2) / 2;

    const dt = 0.0001;
    const tA = midTheta - dt / 2;
    const tB = midTheta + dt / 2;

    const xA =
      rx * Math.sign(Math.cos(tA)) * Math.pow(Math.abs(Math.cos(tA)), P);
    const yA =
      ry * Math.sign(Math.sin(tA)) * Math.pow(Math.abs(Math.sin(tA)), P);

    const xB =
      rx * Math.sign(Math.cos(tB)) * Math.pow(Math.abs(Math.cos(tB)), P);
    const yB =
      ry * Math.sign(Math.sin(tB)) * Math.pow(Math.abs(Math.sin(tB)), P);

    const dx = (xB - xA) / dt;
    const dy = (yB - yA) / dt;
    const ds = Math.sqrt(dx * dx + dy * dy) * ((2 * Math.PI) / steps);
    totalLength += ds;
    arcLengths[i] = totalLength;
  }

  const startIdx = Math.round(steps / 4);
  const startLength = arcLengths[startIdx];

  const angles: number[] = [];
  const targetStep = totalLength / count;

  for (let i = 0; i < count; i++) {
    const targetLength = (startLength + i * targetStep) % totalLength;
    let idx = 0;
    while (idx < steps && arcLengths[idx + 1] < targetLength) {
      idx++;
    }
    const l1 = arcLengths[idx];
    const l2 = arcLengths[idx + 1];
    const fraction = l2 - l1 > 0 ? (targetLength - l1) / (l2 - l1) : 0;
    const t1 = idx * (360 / steps) * (Math.PI / 180);
    const t2 = (idx + 1) * (360 / steps) * (Math.PI / 180);
    angles.push(t1 + fraction * (t2 - t1));
  }

  return angles;
}

/** Board-relative (%) position of a seat at `angle` on the superellipse. */
export function superellipsePosition(
  angle: number,
  radiusX: number,
  radiusY: number,
): { left: number; top: number } {
  const cosVal = Math.cos(angle);
  const sinVal = Math.sin(angle);
  return {
    left: 50 + radiusX * Math.sign(cosVal) * Math.pow(Math.abs(cosVal), P),
    top: 50 + radiusY * Math.sign(sinVal) * Math.pow(Math.abs(sinVal), P),
  };
}
