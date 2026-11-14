import { inferenceFaceAligned, resolveDragDeltaMm } from '../pushPull.js';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from './math.js';
import { solidVertices, type ResolvedPart, type ResolvedSolid } from './resolve.js';

/**
 * SketchUp-style inference in part millimetres: the pointer ray snaps to corners, edge
 * midpoints, edges, faces, the origin and the axes through the start of the running operation.
 * Without a hit the point lies on the drawing plane, on a 1 mm grid. Alt bypasses all of it.
 */

export type SnapKind = 'endpoint' | 'midpoint' | 'origin' | 'edge' | 'axis' | 'face' | 'grid' | 'free';
export type AxisName = 'x' | 'y' | 'z';

export const SNAP_LABELS: Readonly<Record<SnapKind, string>> = {
  endpoint: 'Endpunkt', midpoint: 'Mittelpunkt', origin: 'Ursprung', edge: 'Auf Kante',
  axis: 'Auf Achse', face: 'Auf Fläche', grid: 'Raster', free: 'Frei',
};
/** Red along X, green up (part Y), blue along Z. The stage is Y-up, so green is up. */
export const AXIS_COLORS: Readonly<Record<AxisName, string>> = { x: '#d6322f', y: '#2f9e44', z: '#2f6fd6' };
export const AXIS_LABELS: Readonly<Record<AxisName, string>> = { x: 'Auf roter Achse', y: 'Auf grüner Achse', z: 'Auf blauer Achse' };
export const AXIS_VECTORS: Readonly<Record<AxisName, Vec3>> = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };
export const GRID_MM = 1;

export type InferencePoint = { point: Vec3; kind: 'endpoint' | 'midpoint' | 'origin'; solid?: string };
export type InferenceEdge = { a: Vec3; b: Vec3; solid: string };
export type InferenceCandidates = { points: InferencePoint[]; edges: InferenceEdge[] };

export type Ray = { origin: Vec3; direction: Vec3 };
export type SurfaceHit = { point: Vec3; normal: Vec3; solid?: string };
export type Snap = { point: Vec3; kind: SnapKind; label: string; axis?: AxisName; solid?: string; normal?: Vec3 };

function solidEdges(solid: ResolvedSolid): [Vec3, Vec3][] {
  const vertices = solidVertices(solid);
  if (solid.kind === 'sheet') {
    // Vertices alternate front/back per outline point.
    const count = solid.outline.length;
    const edges: [Vec3, Vec3][] = [];
    for (let index = 0; index < count; index++) {
      const next = (index + 1) % count;
      edges.push([vertices[index * 2]!, vertices[next * 2]!], [vertices[index * 2 + 1]!, vertices[next * 2 + 1]!], [vertices[index * 2]!, vertices[index * 2 + 1]!]);
    }
    return edges;
  }
  // Corners are ordered by (sx, sy, sz) in binary: neighbours differ in one bit.
  const edges: [Vec3, Vec3][] = [];
  for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) if (!(a & bit)) edges.push([vertices[a]!, vertices[a | bit]!]);
  return edges;
}

export function inferenceCandidates(resolved: Pick<ResolvedPart, 'solids'>, exclude: ReadonlySet<string> = new Set()): InferenceCandidates {
  const points: InferencePoint[] = [{ point: { x: 0, y: 0, z: 0 }, kind: 'origin' }];
  const edges: InferenceEdge[] = [];
  for (const solid of resolved.solids) {
    if (exclude.has(solid.id)) continue;
    for (const point of solidVertices(solid)) points.push({ point, kind: 'endpoint', solid: solid.id });
    for (const [a, b] of solidEdges(solid)) {
      edges.push({ a, b, solid: solid.id });
      points.push({ point: scale(add(a, b), 0.5), kind: 'midpoint', solid: solid.id });
    }
  }
  return { points, edges };
}

/** Distance of a point from a ray, or Infinity behind it. */
function rayDistance(ray: Ray, point: Vec3): number {
  const along = dot(sub(point, ray.origin), ray.direction);
  if (along < 0) return Infinity;
  return length(sub(point, add(ray.origin, scale(ray.direction, along))));
}

/** Closest point on segment `a b` to the ray, and its distance. */
function closestOnSegment(ray: Ray, a: Vec3, b: Vec3): { point: Vec3; distance: number } {
  const u = sub(b, a);
  const w0 = sub(a, ray.origin);
  const uu = dot(u, u), ud = dot(u, ray.direction), uw = dot(u, w0), dw = dot(ray.direction, w0);
  const denominator = uu - ud * ud;
  let t = denominator > 1e-12 ? (ud * dw - uw) / denominator : 0;
  t = Math.max(0, Math.min(1, t));
  const point = add(a, scale(u, t));
  return { point, distance: rayDistance(ray, point) };
}

/** Closest point on the infinite line through `origin` along `axis` to the ray. */
function closestOnLine(ray: Ray, origin: Vec3, axis: Vec3): { t: number; point: Vec3; distance: number } {
  const w0 = sub(origin, ray.origin);
  const ud = dot(axis, ray.direction), uw = dot(axis, w0), dw = dot(ray.direction, w0);
  const denominator = 1 - ud * ud;
  const t = denominator > 1e-9 ? (ud * dw - uw) / denominator : 0;
  const point = add(origin, scale(axis, t));
  return { t, point, distance: rayDistance(ray, point) };
}

export function rayPlane(ray: Ray, origin: Vec3, normal: Vec3): Vec3 | undefined {
  const denominator = dot(ray.direction, normal);
  if (Math.abs(denominator) < 1e-9) return undefined;
  const t = dot(sub(origin, ray.origin), normal) / denominator;
  return t >= 0 ? add(ray.origin, scale(ray.direction, t)) : undefined;
}

export const snapToGrid = (value: number, grid = GRID_MM) => {
  const snapped = Math.round(value / grid) * grid;
  return Object.is(snapped, -0) ? 0 : Math.round(snapped * 1e6) / 1e6;
};
const gridPoint = (point: Vec3, grid: number): Vec3 => ({ x: snapToGrid(point.x, grid), y: snapToGrid(point.y, grid), z: snapToGrid(point.z, grid) });

/** The grid point nearest `point` that stays in the plane through `origin` with `normal`. */
function gridInPlane(point: Vec3, origin: Vec3, normal: Vec3, grid: number): Vec3 {
  const rounded = gridPoint(point, grid);
  return sub(rounded, scale(normal, dot(sub(rounded, origin), normal)));
}

export type SnapInput = {
  candidates: InferenceCandidates;
  ray: Ray;
  /** Surface under the pointer. */
  hit?: SurfaceHit;
  /** Where the point lies without a hit; the floor by default. */
  plane?: { origin: Vec3; normal: Vec3 };
  /** Start of the running operation, for axis locks. */
  from?: Vec3;
  /** Snap radius in millimetres at the pointer's depth. */
  tolerance: number;
  grid?: number;
  /** Alt: no snapping. */
  bypass?: boolean;
};

const PRIORITY: Readonly<Record<InferencePoint['kind'], number>> = { endpoint: 0, origin: 0.1, midpoint: 0.2 };

export function snapPoint(input: SnapInput): Snap | undefined {
  const { ray, tolerance, hit } = input;
  const grid = input.grid ?? GRID_MM;
  const plane = input.plane ?? { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
  const onPlane = () => rayPlane(ray, plane.origin, plane.normal);
  if (input.bypass) {
    const point = hit?.point ?? onPlane();
    return point && { point, kind: 'free', label: SNAP_LABELS.free, ...(hit ? { solid: hit.solid, normal: hit.normal } : {}) };
  }

  let bestPoint: { candidate: InferencePoint; score: number } | undefined;
  for (const candidate of input.candidates.points) {
    const distance = rayDistance(ray, candidate.point);
    if (distance > tolerance) continue;
    const score = distance / tolerance + PRIORITY[candidate.kind];
    if (!bestPoint || score < bestPoint.score) bestPoint = { candidate, score };
  }
  if (bestPoint) {
    const { candidate } = bestPoint;
    return { point: candidate.point, kind: candidate.kind, label: SNAP_LABELS[candidate.kind], ...(candidate.solid ? { solid: candidate.solid } : {}) };
  }

  if (input.from) {
    let bestAxis: { axis: AxisName; point: Vec3; distance: number } | undefined;
    for (const axis of ['x', 'y', 'z'] as const) {
      const found = closestOnLine(ray, input.from, AXIS_VECTORS[axis]);
      if (found.distance <= tolerance && (!bestAxis || found.distance < bestAxis.distance)) {
        bestAxis = { axis, point: add(input.from, scale(AXIS_VECTORS[axis], snapToGrid(found.t, grid))), distance: found.distance };
      }
    }
    if (bestAxis) return { point: bestAxis.point, kind: 'axis', label: AXIS_LABELS[bestAxis.axis], axis: bestAxis.axis };
  }

  let bestEdge: { edge: InferenceEdge; point: Vec3; distance: number } | undefined;
  for (const edge of input.candidates.edges) {
    const found = closestOnSegment(ray, edge.a, edge.b);
    if (found.distance <= tolerance && (!bestEdge || found.distance < bestEdge.distance)) bestEdge = { edge, ...found };
  }
  if (bestEdge) {
    const { a, b } = bestEdge.edge;
    const span = length(sub(b, a));
    const along = span > 0 ? snapToGrid(dot(sub(bestEdge.point, a), normalize(sub(b, a))), grid) : 0;
    const point = span > 0 ? add(a, scale(normalize(sub(b, a)), Math.max(0, Math.min(span, along)))) : a;
    return { point, kind: 'edge', label: SNAP_LABELS.edge, solid: bestEdge.edge.solid };
  }

  if (hit) {
    return { point: gridInPlane(hit.point, hit.point, normalize(hit.normal), grid), kind: 'face', label: SNAP_LABELS.face, ...(hit.solid ? { solid: hit.solid } : {}), normal: hit.normal };
  }
  const point = onPlane();
  return point && { point: gridInPlane(point, plane.origin, normalize(plane.normal), grid), kind: 'grid', label: SNAP_LABELS.grid, normal: plane.normal };
}

/** The part axis a direction lies along, if any. */
export function axisOf(direction: Vec3, minAbsDot = 0.999): AxisName | undefined {
  const unit = normalize(direction);
  return (['x', 'y', 'z'] as const).find(axis => Math.abs(dot(unit, AXIS_VECTORS[axis])) >= minAbsDot);
}

export type AxisSnapInput = {
  candidates: InferenceCandidates;
  /** The dragged face or point at the start of the drag, and the drag direction (unit). */
  origin: Vec3;
  axis: Vec3;
  /** Pointer travel along the axis without snapping. */
  freeDelta: number;
  ray?: Ray;
  hit?: SurfaceHit;
  tolerance: number;
  grid?: number;
  bypass?: boolean;
};

/**
 * Snap of a drag along one axis (push/pull, an axis move): flush with a corner or midpoint under
 * the pointer, or with a face parallel to the dragged one; else the free travel on the grid.
 */
export function snapAlongAxis(input: AxisSnapInput): { delta: number; snap?: Snap } {
  const grid = input.grid ?? GRID_MM;
  let inferred: number | undefined;
  let snap: Snap | undefined;
  if (!input.bypass && input.ray) {
    let best: { candidate: InferencePoint; distance: number } | undefined;
    for (const candidate of input.candidates.points) {
      const distance = rayDistance(input.ray, candidate.point);
      if (distance <= input.tolerance && (!best || distance < best.distance)) best = { candidate, distance };
    }
    if (best) {
      inferred = dot(sub(best.candidate.point, input.origin), input.axis);
      snap = { point: best.candidate.point, kind: best.candidate.kind, label: SNAP_LABELS[best.candidate.kind], ...(best.candidate.solid ? { solid: best.candidate.solid } : {}) };
    } else if (input.hit && inferenceFaceAligned(input.axis, normalize(input.hit.normal))) {
      inferred = dot(sub(input.hit.point, input.origin), input.axis);
      snap = { point: input.hit.point, kind: 'face', label: SNAP_LABELS.face, ...(input.hit.solid ? { solid: input.hit.solid } : {}), normal: input.hit.normal };
    }
  }
  const { deltaMm, inferred: used } = resolveDragDeltaMm(input.freeDelta, inferred, { snapEnabled: true, bypass: !!input.bypass, gridMm: grid });
  return { delta: Math.round(deltaMm * 1e6) / 1e6, ...(used && snap ? { snap } : {}) };
}

/** Rotation angle: multiples of 15° pull within 2.5°, else whole degrees; Alt keeps it free. */
export function snapAngle(degrees: number, bypass = false): number {
  if (bypass) return degrees;
  const notch = Math.round(degrees / 15) * 15;
  if (Math.abs(degrees - notch) <= 2.5) return notch === 0 ? 0 : notch;
  return Math.round(degrees);
}

/** Signed angle in degrees from `a` to `b` about `axis`. */
export function angleAbout(axis: Vec3, a: Vec3, b: Vec3): number {
  const unit = normalize(axis);
  const pa = sub(a, scale(unit, dot(a, unit))), pb = sub(b, scale(unit, dot(b, unit)));
  return Math.atan2(dot(cross(pa, pb), unit), dot(pa, pb)) * 180 / Math.PI;
}

/** The grid point on the line through `origin` along `axis` (unit) nearest the pointer ray. */
export function pointOnAxis(ray: Ray, origin: Vec3, axis: Vec3, grid = GRID_MM, bypass = false): Vec3 {
  const { t } = closestOnLine(ray, origin, axis);
  return add(origin, scale(axis, bypass ? t : snapToGrid(t, grid)));
}
