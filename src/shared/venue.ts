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
