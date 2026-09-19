import { z } from 'zod';
import { type PlanPoint } from './venue.js';
import { stairCorners } from './levels.js';

const name = z.string().trim().min(1).max(120);
const dimension = z.number().finite().min(1).max(100000);
const coordinate = z.number().finite().min(-100000).max(100000);

/** Example millimetres for a lighting hang bar. Not a measured venue. */
export const EXAMPLE_TRUSS_LENGTH = 6000;
export const EXAMPLE_TRUSS_SECTION_WIDTH = 400;
export const EXAMPLE_TRUSS_BOTTOM_HEIGHT = 3500;
export const EXAMPLE_TRUSS_THICKNESS = 300;

export const hangPointSchema = z.strictObject({
  id: z.uuid(),
  /** Millimetres along the truss centreline from the centre toward +length/2. */
  offsetMm: z.number().finite().min(-50000).max(50000),
});
export type HangPoint = z.infer<typeof hangPointSchema>;

export const trussSchema = z.strictObject({
  id: z.uuid(), label: name,
  x: coordinate, y: coordinate,
  rotation: z.number().finite().min(-360).max(360).default(0),
  length: dimension, sectionWidth: dimension,
  bottomHeight: dimension, thickness: dimension,
  hangPoints: z.array(hangPointSchema).max(250).default([]),
}).refine(
  truss => new Set(truss.hangPoints.map(point => point.id)).size === truss.hangPoints.length,
  'Hang point IDs must be unique',
).refine(
  truss => truss.hangPoints.every(point => Math.abs(point.offsetMm) <= truss.length / 2),
  'Hang points must lie on the truss length',
);
export type Truss = z.infer<typeof trussSchema>;
export const trussesSchema = z.array(trussSchema).max(250)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Truss IDs must be unique');

export function newTruss(id: string, x: number, y: number, extras?: Partial<Pick<Truss, 'length' | 'rotation' | 'bottomHeight'>>): Truss {
  return {
    id, label: 'Traverse', x, y, rotation: extras?.rotation ?? 0,
    length: extras?.length ?? EXAMPLE_TRUSS_LENGTH,
    sectionWidth: EXAMPLE_TRUSS_SECTION_WIDTH,
    bottomHeight: extras?.bottomHeight ?? EXAMPLE_TRUSS_BOTTOM_HEIGHT,
    thickness: EXAMPLE_TRUSS_THICKNESS,
    hangPoints: [],
  };
}

/** Plan footprint of the truss chord (length × sectionWidth). */
export function trussCorners(truss: Pick<Truss, 'x' | 'y' | 'rotation' | 'length' | 'sectionWidth'>): PlanPoint[] {
  return stairCorners({
    x: truss.x, y: truss.y, rotation: truss.rotation ?? 0,
    width: truss.length, run: truss.sectionWidth,
  });
}

export function trussHangWorld(truss: Truss, hang: HangPoint): PlanPoint {
  const angle = (truss.rotation ?? 0) * Math.PI / 180;
  return {
    x: truss.x + hang.offsetMm * Math.cos(angle),
    y: truss.y + hang.offsetMm * Math.sin(angle),
  };
}

/** Build a truss from two plan points (SketchUp-like click start / click end). */
export function trussFromSegment(id: string, start: PlanPoint, end: PlanPoint, bottomHeight = EXAMPLE_TRUSS_BOTTOM_HEIGHT): Truss | undefined {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(length >= 1)) return undefined;
  return newTruss(id, (start.x + end.x) / 2, (start.y + end.y) / 2, {
    length: Math.round(length),
    rotation: Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI,
    bottomHeight,
  });
}
