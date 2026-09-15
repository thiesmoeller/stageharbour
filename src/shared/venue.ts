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
  calibration: calibrationSchema.optional(),
});
export type VenueTrace = z.infer<typeof venueTraceSchema>;

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
