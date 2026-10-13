import { z } from 'zod';
import { planPointSchema, type PlanPoint } from './venue.js';

const coordinate = z.number().finite().min(-100000).max(100000);
const name = z.string().trim().min(1).max(120);
const notes = z.string().trim().max(500).optional();

export const connectionKindSchema = z.enum(['power', 'audio']);
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

export const connectionPointSchema = z.strictObject({
  id: z.uuid(), kind: connectionKindSchema, label: name,
  x: coordinate, y: coordinate, notes,
});
export type ConnectionPoint = z.infer<typeof connectionPointSchema>;

export const cableRoutingCorridorSchema = z.strictObject({
  id: z.uuid(), label: name, notes,
  path: z.array(planPointSchema).min(2).max(500).superRefine((points, ctx) => {
    if (points.some((point, index) => {
      if (!index) return false;
      const previous = points[index - 1]!;
      return point.x === previous.x && point.y === previous.y;
    })) {
      ctx.addIssue({ code: 'custom', message: 'Corridor points must be distinct from neighbours' });
    }
  }),
});
export type CableRoutingCorridor = z.infer<typeof cableRoutingCorridorSchema>;

export const cablePurposeSchema = z.enum(['power', 'audio', 'data', 'dmx', 'video', 'other']);
export type CablePurpose = z.infer<typeof cablePurposeSchema>;
export const CABLE_PURPOSE_LABELS: Record<CablePurpose, string> = {
  power: 'Strom', audio: 'Audio', data: 'Daten', dmx: 'DMX', video: 'Video', other: 'Sonstiges',
};
export const cableEndpointSchema = z.strictObject({
  label: name,
  x: coordinate,
  y: coordinate,
  connectionPointId: z.uuid().optional(),
});
export type CableEndpoint = z.infer<typeof cableEndpointSchema>;
/** Shape only — use in Zod unions; prefer `cableRunSchema` for document validation. */
export const cableRunFieldsSchema = z.strictObject({
  id: z.uuid(),
  label: name,
  purpose: cablePurposeSchema,
  cableType: name,
  quantity: z.number().int().min(1).max(100),
  slackMm: z.number().int().min(0).max(100000).default(0),
  start: cableEndpointSchema,
  end: cableEndpointSchema,
  path: z.array(planPointSchema).min(2).max(500),
  notes,
});
export const cableRunSchema = cableRunFieldsSchema.refine(run => run.path.every((point, index) => {
  if (!index) return true;
  const previous = run.path[index - 1]!;
  return point.x !== previous.x || point.y !== previous.y;
}), 'Cable run points must be distinct from neighbours');
export type CableRun = z.infer<typeof cableRunFieldsSchema>;
export const cableRunsSchema = z.array(cableRunSchema).max(250)
  .refine(runs => new Set(runs.map(run => run.id)).size === runs.length, 'Cable run IDs must be unique');

export function polylineLengthMm(points: readonly { x: number; y: number }[]): number {
  return Math.round(points.slice(1).reduce((sum, point, index) => {
    const previous = points[index]!;
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0));
}

export function requiredCableLengthMm(run: CableRun): number {
  return polylineLengthMm(run.path) + run.slackMm;
}

export const connectionPointsSchema = z.array(connectionPointSchema).max(250)
  .refine(pins => new Set(pins.map(pin => pin.id)).size === pins.length, 'Connection point IDs must be unique');
export const cableRoutingCorridorsSchema = z.array(cableRoutingCorridorSchema).max(250)
  .refine(corridors => new Set(corridors.map(corridor => corridor.id)).size === corridors.length, 'Cable routing corridor IDs must be unique');

export function newConnectionPoint(id: string, kind: ConnectionKind, x: number, y: number): ConnectionPoint {
  return { id, kind, label: kind === 'power' ? 'Strom' : 'Audio', x, y };
}

export function newCableRoutingCorridor(id: string, path: PlanPoint[]): CableRoutingCorridor {
  return { id, label: 'Kabelkorridor', path };
}

export function newCableRun(id: string, path: PlanPoint[]): CableRun {
  if (path.length < 2) throw new Error('Cable run path needs at least two points.');
  const start = path[0]!;
  const end = path.at(-1)!;
  return {
    id, label: 'Kabelweg', purpose: 'power', cableType: 'Strom', quantity: 1, slackMm: 1000,
    start: { label: 'Technikstand', x: start.x, y: start.y },
    end: { label: 'Bühne', x: end.x, y: end.y },
    path: path.map(point => ({ x: point.x, y: point.y })),
  };
}

/** Keep endpoint metadata in sync when the polyline vertices move. */
export function setCableRunVertex(run: CableRun, index: number, point: PlanPoint): CableRun {
  if (index < 0 || index >= run.path.length) return run;
  const path = run.path.map((entry, i) => i === index ? { x: point.x, y: point.y } : entry);
  const start = path[0]!;
  const end = path.at(-1)!;
  return {
    ...run,
    path,
    start: { ...run.start, x: start.x, y: start.y },
    end: { ...run.end, x: end.x, y: end.y },
  };
}

export function insertCableRunVertex(run: CableRun, afterIndex: number, point: PlanPoint): CableRun {
  if (run.path.length >= 500 || afterIndex < 0 || afterIndex >= run.path.length - 1) return run;
  const neighbour = run.path[afterIndex]!;
  const next = run.path[afterIndex + 1]!;
  if ((point.x === neighbour.x && point.y === neighbour.y) || (point.x === next.x && point.y === next.y)) return run;
  const path = [...run.path.slice(0, afterIndex + 1), { x: point.x, y: point.y }, ...run.path.slice(afterIndex + 1)];
  return { ...run, path };
}

export function removeCableRunVertex(run: CableRun, index: number): CableRun {
  if (run.path.length <= 2 || index <= 0 || index >= run.path.length - 1) return run;
  const path = run.path.filter((_, i) => i !== index);
  return { ...run, path };
}

/** Nearest segment + projected point for inserting a vertex, or undefined if outside reach. */
export function nearestCableRunInsert(run: CableRun, point: PlanPoint, reachMm: number):
  { afterIndex: number; point: PlanPoint } | undefined {
  let best = -1;
  let bestDistance = reachMm;
  let bestPoint: PlanPoint | undefined;
  for (let index = 0; index < run.path.length - 1; index++) {
    const a = run.path[index]!;
    const b = run.path[index + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
    const projected = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
      bestPoint = projected;
    }
  }
  if (best < 0 || !bestPoint) return undefined;
  return { afterIndex: best, point: { x: Math.round(bestPoint.x), y: Math.round(bestPoint.y) } };
}

/** Nearest segment index (before the second endpoint) for inserting a vertex, or -1. */
export function nearestCableRunSegment(run: CableRun, point: PlanPoint, reachMm: number): number {
  return nearestCableRunInsert(run, point, reachMm)?.afterIndex ?? -1;
}
