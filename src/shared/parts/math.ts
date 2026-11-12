/** Small vector, quaternion and polygon helpers for the part kernel. Pure; no three.js. */

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };
/** Unit quaternion, same component order and handedness as three.js. */
export type Quat = { x: number; y: number; z: number; w: number };
export type Bounds3 = { min: Vec3; max: Vec3 };
/** Rotate, then translate. */
export type RigidTransform = { rotation: Quat; translation: Vec3 };

export const QUAT_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
export const VEC3_ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const DEG = Math.PI / 180;

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, factor: number): Vec3 => ({ x: a.x * factor, y: a.y * factor, z: a.z * factor });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export function normalize(a: Vec3): Vec3 {
  const size = length(a);
  return size > 0 ? scale(a, 1 / size) : { ...VEC3_ZERO };
}

/** Hamilton product: the result applies `b` first, then `a`. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatFromAxisAngle(axis: Vec3, radians: number): Quat {
  const unit = normalize(axis);
  const sine = Math.sin(radians / 2);
  return { x: unit.x * sine, y: unit.y * sine, z: unit.z * sine, w: Math.cos(radians / 2) };
}

/** Euler angles in degrees, applied like three.js `Euler(x, y, z, 'XYZ')`. */
export function quatFromEulerDegrees(x: number, y: number, z: number): Quat {
  if (x === 0 && y === 0 && z === 0) return { ...QUAT_IDENTITY };
  const c1 = Math.cos(x * DEG / 2), c2 = Math.cos(y * DEG / 2), c3 = Math.cos(z * DEG / 2);
  const s1 = Math.sin(x * DEG / 2), s2 = Math.sin(y * DEG / 2), s3 = Math.sin(z * DEG / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

/** Quaternion of the rotation whose matrix columns are the given orthonormal axes. */
export function quatFromBasis(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quat {
  const m11 = xAxis.x, m12 = yAxis.x, m13 = zAxis.x;
  const m21 = xAxis.y, m22 = yAxis.y, m23 = zAxis.y;
  const m31 = xAxis.z, m32 = yAxis.z, m33 = zAxis.z;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return { w: 0.25 / s, x: (m32 - m23) * s, y: (m13 - m31) * s, z: (m21 - m12) * s };
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return { w: (m32 - m23) / s, x: 0.25 * s, y: (m12 + m21) / s, z: (m13 + m31) / s };
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return { w: (m13 - m31) / s, x: (m12 + m21) / s, y: 0.25 * s, z: (m23 + m32) / s };
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return { w: (m21 - m12) / s, x: (m13 + m31) / s, y: (m23 + m32) / s, z: 0.25 * s };
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  if (q.x === 0 && q.y === 0 && q.z === 0) return { ...v };
  const axis = { x: q.x, y: q.y, z: q.z };
  const t = scale(cross(axis, v), 2);
  return add(add(v, scale(t, q.w)), cross(axis, t));
}

/** The rotated X, Y and Z unit axes. */
export function quatAxes(q: Quat): { x: Vec3; y: Vec3; z: Vec3 } {
  return { x: rotate(q, { x: 1, y: 0, z: 0 }), y: rotate(q, { x: 0, y: 1, z: 0 }), z: rotate(q, { x: 0, y: 0, z: 1 }) };
}

export function applyTransform(transform: RigidTransform, point: Vec3): Vec3 {
  return add(rotate(transform.rotation, point), transform.translation);
}

export function boundsOf(points: readonly Vec3[]): Bounds3 {
  if (!points.length) return { min: { ...VEC3_ZERO }, max: { ...VEC3_ZERO } };
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const point of points) {
    min.x = Math.min(min.x, point.x); min.y = Math.min(min.y, point.y); min.z = Math.min(min.z, point.z);
    max.x = Math.max(max.x, point.x); max.y = Math.max(max.y, point.y); max.z = Math.max(max.z, point.z);
  }
  return { min, max };
}

/** Positive for counter-clockwise loops. */
export function signedArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonArea(points: readonly Vec2[]): number {
  return Math.abs(signedArea(points));
}

export function withWinding(points: readonly Vec2[], counterClockwise: boolean): Vec2[] {
  return (signedArea(points) >= 0) === counterClockwise ? [...points] : [...points].reverse();
}

export function polygonBounds(points: readonly Vec2[]) {
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function polygonPerimeter(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

/** Even-odd test; points exactly on the boundary may fall either way. */
export function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const squared = dx * dx + dy * dy;
  const t = squared > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared)) : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export function distanceToBoundary(point: Vec2, polygon: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    best = Math.min(best, distanceToSegment(point, polygon[i]!, polygon[(i + 1) % polygon.length]!));
  }
  return best;
}

const cross2 = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** True when the closed segments share at least one point. */
export function segmentsTouch(a: Vec2, b: Vec2, c: Vec2, d: Vec2, eps = 1e-9): boolean {
  const d1 = cross2(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
  const d2 = cross2(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y);
  const d3 = cross2(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y);
  const d4 = cross2(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
  return distanceToSegment(c, a, b) <= eps || distanceToSegment(d, a, b) <= eps
    || distanceToSegment(a, c, d) <= eps || distanceToSegment(b, c, d) <= eps;
}

/** True when no two non-neighbouring edges touch and no edge is degenerate. */
export function isSimplePolygon(points: readonly Vec2[]): boolean {
  const count = points.length;
  if (count < 3) return false;
  for (let i = 0; i < count; i++) {
    const a = points[i]!, b = points[(i + 1) % count]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) return false;
    for (let j = i + 1; j < count; j++) {
      if (j === i + 1 || (i === 0 && j === count - 1)) continue;
      if (segmentsTouch(a, b, points[j]!, points[(j + 1) % count]!)) return false;
    }
  }
  return true;
}

/** True when the loops cross, touch, or one lies inside the other. */
export function loopsOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsTouch(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return pointInPolygon(a[0]!, b) || pointInPolygon(b[0]!, a);
}

/** Drop repeated points and points lying on the line between their neighbours. */
export function cleanPolygon(points: readonly Vec2[], eps = 1e-7): Vec2[] {
  const distinct: Vec2[] = [];
  for (const point of points) {
    const previous = distinct[distinct.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > eps) distinct.push(point);
  }
  while (distinct.length > 1) {
    const first = distinct[0]!, last = distinct[distinct.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y) > eps) break;
    distinct.pop();
  }
  if (distinct.length < 3) return distinct;
  const kept = distinct.filter((point, index) => {
    const previous = distinct[(index - 1 + distinct.length) % distinct.length]!;
    const next = distinct[(index + 1) % distinct.length]!;
    const span = Math.hypot(next.x - previous.x, next.y - previous.y);
    if (span <= eps) return true;
    const offset = Math.abs(cross2(next.x - previous.x, next.y - previous.y, point.x - previous.x, point.y - previous.y)) / span;
    const along = (point.x - previous.x) * (next.x - previous.x) + (point.y - previous.y) * (next.y - previous.y);
    return offset > eps || along < 0 || along > span * span;
  });
  return kept.length >= 3 ? kept : distinct;
}

/**
 * Convex hull, counter-clockwise, starting at the point with the smallest y (then smallest x).
 * Input is snapped to `precision` so float noise cannot add near-duplicate corners.
 */
export function convexHull(points: readonly Vec2[], precision = 1e-6): Vec2[] {
  const snap = (value: number) => {
    const snapped = Math.round(value / precision) * precision;
    return snapped === 0 ? 0 : snapped;
  };
  const seen = new Set<string>();
  const unique: Vec2[] = [];
  for (const point of points) {
    const snapped = { x: snap(point.x), y: snap(point.y) };
    const key = `${snapped.x},${snapped.y}`;
    if (!seen.has(key)) { seen.add(key); unique.push(snapped); }
  }
  unique.sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length < 3) return unique;
  const turnsLeft = (a: Vec2, b: Vec2, c: Vec2) => {
    const span = Math.hypot(c.x - a.x, c.y - a.y);
    return cross2(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y) < -precision * span;
  };
  const half = (ordered: Vec2[]) => {
    const chain: Vec2[] = [];
    for (const point of ordered) {
      while (chain.length >= 2 && !turnsLeft(chain[chain.length - 2]!, point, chain[chain.length - 1]!)) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  const hull = [...half(unique), ...half([...unique].reverse())];
  let start = 0;
  hull.forEach((point, index) => {
    const best = hull[start]!;
    if (point.y < best.y || (point.y === best.y && point.x < best.x)) start = index;
  });
  return [...hull.slice(start), ...hull.slice(0, start)];
}

export type SubtractResult =
  | { kind: 'cut'; polygons: Vec2[][] }
  /** The clip does not cross the subject boundary: it lies fully inside or fully outside. */
  | { kind: 'apart' }
  /** The clip covers the whole subject. */
  | { kind: 'removed' }
  /** Edges meet in a way the clipper does not resolve: an edge through a corner, or a corner that only touches. */
  | { kind: 'degenerate' };

/** Distance within which a cut-out counts as flush with the sheet edge (mm). */
export const FLUSH_EPS_MM = 0.5;
const PUSH_MM = 1;
/** Corners of a cut result closer together than this are one corner (mm); pushing leaves such pairs behind. */
const MERGE_EPS_MM = 0.01;

type Hit = {
  point: Vec2; subjectEdge: number; subjectT: number; clipEdge: number; clipT: number;
  entering: boolean; visited: boolean; subjectIndex: number; clipIndex: number;
};
type RingNode = { point: Vec2; hit?: Hit };

type Push = { nx: number; ny: number; outward: (point: Vec2) => number };

/**
 * Move clip corners that sit on the subject boundary slightly outside it, so a flush cut-out
 * crosses the boundary cleanly instead of running along it. A corner slides along the clip
 * edge that enters the subject there, which keeps that edge on its line: the cut meets the
 * boundary exactly where it was drawn. Other corners move square to the boundary; their
 * edges lie on it or outside. Returns `undefined` when the clip only touches the boundary
 * from inside with a corner, which has no clean cut.
 */
function pushFlushCornersOutward(subject: readonly Vec2[], clip: readonly Vec2[]): Vec2[] | undefined {
  const pushes = clip.map(() => [] as Push[]);
  const note = (index: number, push: Push) => {
    const list = pushes[index]!;
    if (!list.some(other => Math.abs(other.nx - push.nx) < 1e-6 && Math.abs(other.ny - push.ny) < 1e-6)) list.push(push);
  };
  for (let s = 0; s < subject.length; s++) {
    const a = subject[s]!, b = subject[(s + 1) % subject.length]!;
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(span > 0)) continue;
    const ux = (b.x - a.x) / span, uy = (b.y - a.y) / span;
    const push: Push = { nx: uy, ny: -ux, outward: point => (point.x - a.x) * uy - (point.y - a.y) * ux };
    const along = (point: Vec2) => (point.x - a.x) * ux + (point.y - a.y) * uy;
    for (let c = 0; c < clip.length; c++) {
      const p = clip[c]!, q = clip[(c + 1) % clip.length]!;
      if (distanceToSegment(p, a, b) <= FLUSH_EPS_MM) note(c, push);
      const runsAlong = Math.abs(push.outward(p)) <= FLUSH_EPS_MM && Math.abs(push.outward(q)) <= FLUSH_EPS_MM
        && Math.min(Math.max(along(p), along(q)), span) - Math.max(Math.min(along(p), along(q)), 0) > 1e-9;
      if (runsAlong) {
        note(c, push);
        note((c + 1) % clip.length, push);
      }
    }
  }
  let touching = false;
  const moved = clip.map((point, index) => {
    const list = pushes[index]!;
    if (!list.length) return point;
    const neighbours = [clip[(index - 1 + clip.length) % clip.length]!, clip[(index + 1) % clip.length]!];
    // Clip edges from this corner that leave the boundary, and of those the ones that enter the subject.
    const leaving = neighbours.filter(other => !list.some(push => Math.abs(push.outward(other)) <= FLUSH_EPS_MM));
    const entering = leaving.filter(other => {
      if (list.length === 1) return list[0]!.outward(other) < 0;
      const reach = Math.hypot(other.x - point.x, other.y - point.y);
      const step = Math.min(1, reach / 2) / reach;
      return pointInPolygon({ x: point.x + (other.x - point.x) * step, y: point.y + (other.y - point.y) * step }, subject);
    });
    if (entering.length === 2) {
      touching = true;
      return point;
    }
    if (entering.length === 1) {
      const dx = point.x - entering[0]!.x, dy = point.y - entering[0]!.y;
      let factor = 0;
      for (const push of list) {
        const rise = dx * push.nx + dy * push.ny;
        if (rise > 1e-12) factor = Math.max(factor, (PUSH_MM - push.outward(point)) / rise);
      }
      if (factor > 0) return { x: point.x + dx * factor, y: point.y + dy * factor };
    }
    return list.reduce((sum, push) => {
      const lift = PUSH_MM - push.outward(point);
      return { x: sum.x + push.nx * lift, y: sum.y + push.ny * lift };
    }, point);
  });
  return touching ? undefined : moved;
}

/**
 * `subject` minus `clip` for simple counter-clockwise polygons whose boundaries cross.
 * Weiler-Atherton walk: follow the subject outside the clip, then the clip backwards.
 */
export function subtractPolygon(subject: readonly Vec2[], clipInput: readonly Vec2[]): SubtractResult {
  const clip = pushFlushCornersOutward(subject, clipInput);
  if (!clip) return { kind: 'degenerate' };
  const hits: Hit[] = [];
  const EPS = 1e-9;
  for (let s = 0; s < subject.length; s++) {
    const a = subject[s]!, b = subject[(s + 1) % subject.length]!;
    const rx = b.x - a.x, ry = b.y - a.y;
    for (let c = 0; c < clip.length; c++) {
      const p = clip[c]!, q = clip[(c + 1) % clip.length]!;
      const sx = q.x - p.x, sy = q.y - p.y;
      const denominator = cross2(rx, ry, sx, sy);
      if (Math.abs(denominator) <= EPS * Math.hypot(rx, ry) * Math.hypot(sx, sy)) {
        if (segmentsTouch(a, b, p, q)) return { kind: 'degenerate' };
        continue;
      }
      const t = cross2(p.x - a.x, p.y - a.y, sx, sy) / denominator;
      const u = cross2(p.x - a.x, p.y - a.y, rx, ry) / denominator;
      if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) continue;
      if (t < EPS || t > 1 - EPS || u < EPS || u > 1 - EPS) return { kind: 'degenerate' };
      const point = { x: a.x + t * rx, y: a.y + t * ry };
      if (sx === 0) point.x = p.x;
      if (sy === 0) point.y = p.y;
      hits.push({
        point, subjectEdge: s, subjectT: t, clipEdge: c, clipT: u,
        entering: cross2(sx, sy, rx, ry) > 0, visited: false, subjectIndex: -1, clipIndex: -1,
      });
    }
  }
  if (!hits.length) {
    return subject.every(point => pointInPolygon(point, clip)) ? { kind: 'removed' } : { kind: 'apart' };
  }
  if (hits.length % 2) return { kind: 'degenerate' };

  const ring = (points: readonly Vec2[], edge: (hit: Hit) => number, t: (hit: Hit) => number, mark: (hit: Hit, index: number) => void) => {
    const nodes: RingNode[] = [];
    points.forEach((point, index) => {
      nodes.push({ point });
      for (const hit of hits.filter(item => edge(item) === index).sort((x, y) => t(x) - t(y))) {
        mark(hit, nodes.length);
        nodes.push({ point: hit.point, hit });
      }
    });
    return nodes;
  };
  const subjectRing = ring(subject, hit => hit.subjectEdge, hit => hit.subjectT, (hit, index) => { hit.subjectIndex = index; });
  const clipRing = ring(clip, hit => hit.clipEdge, hit => hit.clipT, (hit, index) => { hit.clipIndex = index; });

  const polygons: Vec2[][] = [];
  const limit = (subjectRing.length + clipRing.length) * 2;
  for (const start of hits) {
    if (start.entering || start.visited) continue;
    const polygon: Vec2[] = [];
    let current = start;
    for (let guard = 0; ; guard++) {
      if (guard > limit) return { kind: 'degenerate' };
      current.visited = true;
      polygon.push(current.point);
      let index = current.subjectIndex;
      let entry: Hit | undefined;
      for (let step = 0; step < subjectRing.length && !entry; step++) {
        index = (index + 1) % subjectRing.length;
        const node = subjectRing[index]!;
        if (node.hit) entry = node.hit; else polygon.push(node.point);
      }
      if (!entry || !entry.entering) return { kind: 'degenerate' };
      entry.visited = true;
      polygon.push(entry.point);
      index = entry.clipIndex;
      let exit: Hit | undefined;
      for (let step = 0; step < clipRing.length && !exit; step++) {
        index = (index - 1 + clipRing.length) % clipRing.length;
        const node = clipRing[index]!;
        if (node.hit) exit = node.hit; else polygon.push(node.point);
      }
      if (!exit || exit.entering) return { kind: 'degenerate' };
      if (exit === start) break;
      current = exit;
    }
    const cleaned = cleanPolygon(polygon, MERGE_EPS_MM);
    if (cleaned.length >= 3) polygons.push(cleaned);
  }
  return polygons.length ? { kind: 'cut', polygons } : { kind: 'removed' };
}
