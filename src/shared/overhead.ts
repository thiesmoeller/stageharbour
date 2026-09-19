import { z } from 'zod';
import { stairCorners, supportingSurfaces, surfaceElevation, type Platform, type StairUnit } from './levels.js';
import { type PlanPoint } from './venue.js';
import { trussCorners, type Truss } from './truss.js';

const name = z.string().trim().min(1).max(120);
const dimension = z.number().finite().min(1).max(100000);
const coordinate = z.number().finite().min(-100000).max(100000);

// Example-only millimetre placeholders for a venue ceiling and overhead box. Not a measured venue.
export const EXAMPLE_CEILING_HEIGHT = 4000;
export const EXAMPLE_OVERHEAD_LENGTH = 4000;
export const EXAMPLE_OVERHEAD_WIDTH = 800;
export const EXAMPLE_OVERHEAD_BOTTOM_HEIGHT = 2600;
export const EXAMPLE_OVERHEAD_THICKNESS = 400;

export const overheadBoxSchema = z.strictObject({
  id: z.uuid(), label: name,
  x: coordinate, y: coordinate,
  rotation: z.number().finite().min(-360).max(360).default(0),
  length: dimension, width: dimension,
  bottomHeight: dimension, thickness: dimension,
});
export type OverheadBox = z.infer<typeof overheadBoxSchema>;
export const overheadBoxesSchema = z.array(overheadBoxSchema).max(250)
  .refine(boxes => new Set(boxes.map(box => box.id)).size === boxes.length, 'Overhead box IDs must be unique');
export const ceilingHeightSchema = dimension;

export const overheadWarningSchema = z.strictObject({
  objectId: z.uuid(),
  kind: z.enum(['ceiling', 'overhead']),
  message: z.string().trim().min(1).max(500),
  obstructionId: z.uuid().optional(),
});
export type OverheadWarning = z.infer<typeof overheadWarningSchema>;
export const overheadWarningsSchema = z.array(overheadWarningSchema).max(500);

export function newOverheadBox(id: string, x: number, y: number): OverheadBox {
  return {
    id, label: 'Überbauung', x, y, rotation: 0,
    length: EXAMPLE_OVERHEAD_LENGTH, width: EXAMPLE_OVERHEAD_WIDTH,
    bottomHeight: EXAMPLE_OVERHEAD_BOTTOM_HEIGHT, thickness: EXAMPLE_OVERHEAD_THICKNESS,
  };
}

export function overheadBoxCorners(box: Pick<OverheadBox, 'x' | 'y' | 'length' | 'width'> & { rotation?: number }): PlanPoint[] {
  return stairCorners({ x: box.x, y: box.y, rotation: box.rotation ?? 0, width: box.length, run: box.width });
}

type VenueOverhead = {
  width: number; depth: number; outline?: PlanPoint[]; platforms?: Platform[];
  ceilingHeight?: number; overheadBoxes?: OverheadBox[]; trusses?: Truss[];
};
type PlacedWall = {
  id: string; label: string; supportingSurfaceId?: string;
  x: number; y: number; rotation: number; width: number; height: number; thickness: number;
};
type PlacedBrace = {
  id: string; label: string; supportingSurfaceId?: string;
  x: number; y: number; rotation: number; footprintWidth: number; footprintDepth: number; height: number;
};
type LayoutOverhead = {
  walls: PlacedWall[]; braces: PlacedBrace[]; platforms?: Platform[]; stairs?: StairUnit[];
};

const disclaimer = 'Geometrische Prüfung, kein statischer Nachweis.';

function project(corners: PlanPoint[], axis: PlanPoint) {
  return corners.map(point => point.x * axis.x + point.y * axis.y);
}
function axes(corners: PlanPoint[]) {
  return corners.flatMap((start, index) => {
    const next = corners[(index + 1) % corners.length]!;
    const length = Math.hypot(next.x - start.x, next.y - start.y);
    return length > 0 ? [{ x: -(next.y - start.y) / length, y: (next.x - start.x) / length }] : [];
  });
}
function planOverlap(a: PlanPoint[], b: PlanPoint[]) {
  if (a.length < 3 || b.length < 3) return false;
  return [...axes(a), ...axes(b)].every(axis => {
    const pa = project(a, axis), pb = project(b, axis);
    return Math.max(...pa) >= Math.min(...pb) && Math.max(...pb) >= Math.min(...pa);
  });
}
function heightOverlap(bottomA: number, topA: number, bottomB: number, topB: number) {
  return topA >= bottomB && topB >= bottomA;
}

function placedSolids(layout: LayoutOverhead, venue: VenueOverhead) {
  const surfaces = supportingSurfaces(venue, layout);
  return [
    ...layout.walls.map(wall => ({
      id: wall.id, label: wall.label,
      corners: stairCorners({ x: wall.x, y: wall.y, rotation: wall.rotation, width: wall.width, run: wall.thickness }),
      bottom: surfaceElevation(surfaces, wall.supportingSurfaceId),
      top: surfaceElevation(surfaces, wall.supportingSurfaceId) + wall.height,
    })),
    ...layout.braces.map(brace => ({
      id: brace.id, label: brace.label,
      corners: stairCorners({ x: brace.x, y: brace.y, rotation: brace.rotation, width: brace.footprintWidth, run: brace.footprintDepth }),
      bottom: surfaceElevation(surfaces, brace.supportingSurfaceId),
      top: surfaceElevation(surfaces, brace.supportingSurfaceId) + brace.height,
    })),
  ];
}

export function overheadClearance(layout: LayoutOverhead, venue: VenueOverhead): OverheadWarning[] {
  const warnings: OverheadWarning[] = [];
  for (const object of placedSolids(layout, venue)) {
    if (venue.ceilingHeight !== undefined && object.top >= venue.ceilingHeight) {
      warnings.push({
        objectId: object.id, kind: 'ceiling',
        message: `„${object.label}“ überschreitet von der Auflagefläche die Deckenhöhe ${venue.ceilingHeight} mm. ${disclaimer}`,
      });
    }
    for (const box of venue.overheadBoxes ?? []) {
      if (planOverlap(object.corners, overheadBoxCorners(box))
        && heightOverlap(object.bottom, object.top, box.bottomHeight, box.bottomHeight + box.thickness)) {
        warnings.push({
          objectId: object.id, kind: 'overhead', obstructionId: box.id,
          message: `„${object.label}“ ragt von der Auflagefläche in die Überbauung „${box.label}“. ${disclaimer}`,
        });
      }
    }
    for (const truss of venue.trusses ?? []) {
      if (planOverlap(object.corners, trussCorners(truss))
        && heightOverlap(object.bottom, object.top, truss.bottomHeight, truss.bottomHeight + truss.thickness)) {
        warnings.push({
          objectId: object.id, kind: 'overhead', obstructionId: truss.id,
          message: `„${object.label}“ ragt von der Auflagefläche in die Traverse „${truss.label}“. ${disclaimer}`,
        });
      }
    }
  }
  return warnings;
}
