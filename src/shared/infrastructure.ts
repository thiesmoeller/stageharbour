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
