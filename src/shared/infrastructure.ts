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
export const cableRunSchema = z.strictObject({
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
}).refine(run => run.path.every((point, index) => {
  if (!index) return true;
  const previous = run.path[index - 1]!;
  return point.x !== previous.x || point.y !== previous.y;
}), 'Cable run points must be distinct from neighbours');
export type CableRun = z.infer<typeof cableRunSchema>;
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

export function newCableRun(id: string, start: PlanPoint, end: PlanPoint): CableRun {
  return {
    id, label: 'Kabelweg', purpose: 'power', cableType: 'Strom', quantity: 1, slackMm: 1000,
    start: { label: 'Technikstand', ...start },
    end: { label: 'Bühne', ...end },
    path: [start, end],
  };
}
