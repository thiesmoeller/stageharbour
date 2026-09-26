import { z } from 'zod';

const coordinate = z.number().finite().min(-100000).max(100000);
const dimension = z.number().finite().min(1).max(100000);
export const planPointSchema = z.strictObject({ x: coordinate, y: coordinate });
export type PlanPoint = z.infer<typeof planPointSchema>;

export const calibrationSchema = z.strictObject({
  pointA: planPointSchema, pointB: planPointSchema, distanceMm: dimension,
}).refine(value => Math.hypot(value.pointB.x - value.pointA.x, value.pointB.y - value.pointA.y) > 0, 'Calibration points must be distinct');
export type Calibration = z.infer<typeof calibrationSchema>;

export function millimetresPerUnit(calibration: Calibration) {
  return calibration.distanceMm / Math.hypot(calibration.pointB.x - calibration.pointA.x, calibration.pointB.y - calibration.pointA.y);
}

function signedArea(points: PlanPoint[]) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

export const venueOutlineSchema = z.array(planPointSchema).min(3).max(500).superRefine((points, ctx) => {
  if (points.some((point, index) => {
    const next = points[(index + 1) % points.length]!;
    return point.x === next.x && point.y === next.y;
  }) || !(Math.abs(signedArea(points)) > 0)) {
    ctx.addIssue({ code: 'custom', message: 'Venue outline must enclose area' });
  }
});
export type VenueOutline = z.infer<typeof venueOutlineSchema>;

export const venueTraceSchema = z.strictObject({
  fileId: z.uuid(),
  page: z.number().int().min(1).max(9999).optional(),
  /** Degrees clockwise in plan view (SVG uses negated Y; positive rotates the underlay image clockwise on screen). */
  rotationDeg: z.number().finite().min(-360).max(360).optional(),
  calibration: calibrationSchema.optional(),
});
export type VenueTrace = z.infer<typeof venueTraceSchema>;

/** Convert a plan millimetre point to underlay source pixels, undoing scale and rotation. */
export function planToUnderlaySource(
  point: PlanPoint,
  overlay: { pixelWidth: number; pixelHeight: number },
  unit: number,
  rotationDeg = 0,
): PlanPoint {
  const cx = overlay.pixelWidth * unit / 2;
  const cy = overlay.pixelHeight * unit / 2;
  const angle = -rotationDeg * Math.PI / 180;
  const dx = point.x - cx, dy = point.y - cy;
  const localX = cx + dx * Math.cos(angle) - dy * Math.sin(angle);
  const localY = cy + dx * Math.sin(angle) + dy * Math.cos(angle);
  return {
    x: Math.round(localX / unit),
    y: Math.round(overlay.pixelHeight - localY / unit),
  };
}

/** Plan-space point from underlay source pixels after scale and rotation. */
export function underlaySourceToPlan(
  source: PlanPoint,
  overlay: { pixelWidth: number; pixelHeight: number },
  unit: number,
  rotationDeg = 0,
): PlanPoint {
  const localX = source.x * unit;
  const localY = (overlay.pixelHeight - source.y) * unit;
  const cx = overlay.pixelWidth * unit / 2;
  const cy = overlay.pixelHeight * unit / 2;
  const angle = rotationDeg * Math.PI / 180;
  const dx = localX - cx, dy = localY - cy;
  return {
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

export function measuredOutline(venue: { width: number; depth: number; outline?: PlanPoint[] }): PlanPoint[] {
  return venue.outline ?? [
    { x: 0, y: 0 }, { x: venue.width, y: 0 }, { x: venue.width, y: venue.depth }, { x: 0, y: venue.depth },
  ];
}

export function boundsFromOutline(outline: PlanPoint[]) {
  const xs = outline.map(point => point.x);
  const ys = outline.map(point => point.y);
  return {
    width: Math.min(100000, Math.max(1, Math.max(...xs) - Math.min(0, ...xs))),
    depth: Math.min(100000, Math.max(1, Math.max(...ys) - Math.min(0, ...ys))),
  };
}

/** Click within this distance of an outline edge inserts a vertex on that edge. */
export const OUTLINE_VERTEX_INSERT_MM = 400;

function projectOnSegment(point: PlanPoint, start: PlanPoint, end: PlanPoint) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(length > 0)) return { point: { ...start }, distance: Math.hypot(point.x - start.x, point.y - start.y), t: 0 };
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)));
  const projected = { x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) };
  return { point: projected, distance: Math.hypot(point.x - projected.x, point.y - projected.y), t };
}

/**
 * Insert a vertex on the nearest outline edge to `point`.
 * Returns undefined when no edge is within `maxDistanceMm`, the outline is full, or the hit is on an existing vertex.
 */
export function insertOutlineVertex(
  outline: readonly PlanPoint[],
  point: PlanPoint,
  maxDistanceMm = OUTLINE_VERTEX_INSERT_MM,
): PlanPoint[] | undefined {
  if (outline.length >= 500) return undefined;
  let best: { index: number; point: PlanPoint; distance: number; t: number } | undefined;
  for (let index = 0; index < outline.length; index++) {
    const start = outline[index]!, end = outline[(index + 1) % outline.length]!;
    const hit = projectOnSegment(point, start, end);
    if (!best || hit.distance < best.distance) best = { index, point: hit.point, distance: hit.distance, t: hit.t };
  }
  if (!best || best.distance > maxDistanceMm) return undefined;
  // Skip endpoints so clicks near corners do not create zero-length edges.
  if (best.t <= 1e-6 || best.t >= 1 - 1e-6) return undefined;
  const next = [...outline];
  next.splice(best.index + 1, 0, { x: Math.round(best.point.x), y: Math.round(best.point.y) });
  return venueOutlineSchema.safeParse(next).success ? next : undefined;
}

/** Click within this distance of an outline edge selects it for parallel offset. */
export const OUTLINE_EDGE_HIT_MM = 400;

/**
 * Outward unit normal for edge `index → index+1`.
 * Venue outlines use Cartesian +Y up-stage; CCW winding yields a positive signed area, so the
 * clockwise perpendicular of the edge direction points outward.
 */
export function outlineEdgeOutwardNormal(outline: readonly PlanPoint[], edgeIndex: number): PlanPoint | undefined {
  if (edgeIndex < 0 || edgeIndex >= outline.length) return undefined;
  const start = outline[edgeIndex]!, end = outline[(edgeIndex + 1) % outline.length]!;
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return undefined;
  // Clockwise perpendicular of (dx, dy) is (dy, -dx). Flip when winding is clockwise.
  const outward = signedArea([...outline]) > 0 ? 1 : -1;
  return { x: outward * dy / length, y: outward * -dx / length };
}

/** Nearest outline edge to `point`, or undefined when farther than `maxDistanceMm`. */
export function nearestOutlineEdge(
  outline: readonly PlanPoint[],
  point: PlanPoint,
  maxDistanceMm = OUTLINE_EDGE_HIT_MM,
): { index: number; distance: number; point: PlanPoint } | undefined {
  let best: { index: number; distance: number; point: PlanPoint } | undefined;
  for (let index = 0; index < outline.length; index++) {
    const start = outline[index]!, end = outline[(index + 1) % outline.length]!;
    const hit = projectOnSegment(point, start, end);
    if (!best || hit.distance < best.distance) best = { index, distance: hit.distance, point: hit.point };
  }
  if (!best || best.distance > maxDistanceMm) return undefined;
  return best;
}

/**
 * Move both endpoints of edge `edgeIndex` along the outward normal by `deltaMm` (positive grows the room).
 * Returns undefined when the edge is invalid or the result would not be a valid venue outline.
 */
export function offsetOutlineEdge(
  outline: readonly PlanPoint[],
  edgeIndex: number,
  deltaMm: number,
): PlanPoint[] | undefined {
  if (!Number.isFinite(deltaMm) || edgeIndex < 0 || edgeIndex >= outline.length) return undefined;
  const normal = outlineEdgeOutwardNormal(outline, edgeIndex);
  if (!normal) return undefined;
  const i0 = edgeIndex, i1 = (edgeIndex + 1) % outline.length;
  const next = outline.map(point => ({ ...point }));
  const a = next[i0]!, b = next[i1]!;
  next[i0] = { x: Math.round(a.x + normal.x * deltaMm), y: Math.round(a.y + normal.y * deltaMm) };
  next[i1] = { x: Math.round(b.x + normal.x * deltaMm), y: Math.round(b.y + normal.y * deltaMm) };
  return venueOutlineSchema.safeParse(next).success ? next : undefined;
}
