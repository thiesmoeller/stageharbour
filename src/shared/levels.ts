import { z } from 'zod';
import { measuredOutline, venueOutlineSchema, type PlanPoint } from './venue.js';

const name = z.string().trim().min(1).max(120);
const dimension = z.number().finite().min(1).max(100000);
const coordinate = z.number().finite().min(-100000).max(100000);
/** Well-known audience-floor id (UUID form so walls can reference it like any platform). */
export const AUDIENCE_FLOOR_ID = '00000000-0000-4000-8000-000000000001';
// Example-only millimetre placeholders for a raised platform and stair unit. Not a measured venue.
export const EXAMPLE_PLATFORM_WIDTH = 4000;
export const EXAMPLE_PLATFORM_DEPTH = 2500;
export const EXAMPLE_PLATFORM_ELEVATION = 400;
export const EXAMPLE_STAIR_WIDTH = 1200;
export const EXAMPLE_STAIR_RUN = 2000;
export const EXAMPLE_STAIR_RISER = 200;
export const EDGE_TOLERANCE_MM = 1;

export const platformSchema = z.strictObject({
  id: z.uuid(), label: name,
  elevation: z.number().finite().min(1).max(100000),
  outline: venueOutlineSchema,
});
export type Platform = z.infer<typeof platformSchema>;
export const stairSchema = z.strictObject({
  id: z.uuid(), label: name,
  lowerSurfaceId: z.uuid(), upperSurfaceId: z.uuid(),
  x: coordinate, y: coordinate,
  rotation: z.number().finite().min(-360).max(360),
  width: dimension, run: dimension, riserHeight: dimension,
}).refine(stair => stair.lowerSurfaceId !== stair.upperSurfaceId, 'Stairs must connect two different surfaces');
export type StairUnit = z.infer<typeof stairSchema>;
export type SupportingSurface = { id: string; label: string; outline: PlanPoint[]; elevation: number };
export type PlacementKind = 'missing-surface' | 'unknown-surface' | 'ambiguous-edge';
export const placementDiagnosticSchema = z.strictObject({
  objectId: z.uuid(), kind: z.enum(['missing-surface', 'unknown-surface', 'ambiguous-edge']),
  message: z.string().trim().min(1).max(500),
});
export type PlacementDiagnostic = z.infer<typeof placementDiagnosticSchema>;

export function newPlatform(id: string, x: number, y: number): Platform {
  const hx = EXAMPLE_PLATFORM_WIDTH / 2, hy = EXAMPLE_PLATFORM_DEPTH / 2;
  return {
    id, label: 'Podest', elevation: EXAMPLE_PLATFORM_ELEVATION,
    outline: [{ x: x - hx, y: y - hy }, { x: x + hx, y: y - hy }, { x: x + hx, y: y + hy }, { x: x - hx, y: y + hy }],
  };
}

export function platformCentroid(outline: readonly PlanPoint[]) {
  const x = outline.reduce((sum, point) => sum + point.x, 0) / outline.length;
  const y = outline.reduce((sum, point) => sum + point.y, 0) / outline.length;
  return { x, y };
}

export function translatePlatformOutline(outline: readonly PlanPoint[], dx: number, dy: number): PlanPoint[] {
  const clamp = (value: number) => Math.max(-100000, Math.min(100000, value));
  return outline.map(point => ({ x: clamp(point.x + dx), y: clamp(point.y + dy) }));
}

export function rotatePlatformOutline(outline: readonly PlanPoint[], degrees: number, centre = platformCentroid(outline)): PlanPoint[] {
  const angle = degrees * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const clamp = (value: number) => Math.max(-100000, Math.min(100000, value));
  return outline.map(point => {
    const dx = point.x - centre.x, dy = point.y - centre.y;
    return { x: clamp(centre.x + dx * cosine - dy * sine), y: clamp(centre.y + dx * sine + dy * cosine) };
  });
}

export function platformBounds(outline: readonly PlanPoint[]) {
  const xs = outline.map(point => point.x), ys = outline.map(point => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...ys) - Math.min(...ys),
  };
}

export function axisAlignedPlatformOutline(x: number, y: number, width: number, depth: number, rotation = 0): PlanPoint[] {
  const base = [
    { x: x - width / 2, y: y - depth / 2 }, { x: x + width / 2, y: y - depth / 2 },
    { x: x + width / 2, y: y + depth / 2 }, { x: x - width / 2, y: y + depth / 2 },
  ];
  return rotation ? rotatePlatformOutline(base, rotation, { x, y }) : base;
}

export function newStair(id: string, lowerSurfaceId: string, upperSurfaceId: string, x: number, y: number): StairUnit {
  return {
    id, label: 'Treppe', lowerSurfaceId, upperSurfaceId, x, y, rotation: 0,
    width: EXAMPLE_STAIR_WIDTH, run: EXAMPLE_STAIR_RUN, riserHeight: EXAMPLE_STAIR_RISER,
  };
}

type VenueLevels = { width: number; depth: number; outline?: PlanPoint[]; platforms?: Platform[] };
type LayoutLevels = { platforms?: Platform[]; stairs?: StairUnit[] };

export function supportingSurfaces(venue: VenueLevels, layout?: LayoutLevels): SupportingSurface[] {
  return [
    { id: AUDIENCE_FLOOR_ID, label: 'Zuschauerboden', outline: measuredOutline(venue), elevation: 0 },
    ...(venue.platforms ?? []).map(platform => ({ ...platform })),
    ...(layout?.platforms ?? []).map(platform => ({ ...platform })),
  ];
}

/** Height comes only from an explicit surface id — never from plan position. */
export function surfaceElevation(surfaces: SupportingSurface[], surfaceId: string | undefined) {
  return surfaces.find(surface => surface.id === surfaceId)?.elevation ?? 0;
}

export function stairCorners(stair: Pick<StairUnit, 'x' | 'y' | 'rotation' | 'width' | 'run'>): PlanPoint[] {
  const angle = stair.rotation * Math.PI / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x = 0, y = 0]) => {
    const dx = x * stair.width / 2, dy = y * stair.run / 2;
    return { x: stair.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: stair.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  });
}
export function stairRise(stair: Pick<StairUnit, 'lowerSurfaceId' | 'upperSurfaceId'>, surfaces: SupportingSurface[]) {
  return Math.abs(surfaceElevation(surfaces, stair.upperSurfaceId) - surfaceElevation(surfaces, stair.lowerSurfaceId));
}

export function stairSteps(stair: StairUnit, surfaces: SupportingSurface[]) {
  const rise = stairRise(stair, surfaces);
  const count = Math.max(1, Math.round(rise / stair.riserHeight));
  const stepRise = rise / count, stepRun = stair.run / count;
  const base = surfaceElevation(surfaces, stair.lowerSurfaceId);
  const angle = stair.rotation * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return Array.from({ length: count }, (_, index) => {
    const localY = -stair.run / 2 + (index + 0.5) * stepRun;
    return {
      x: stair.x - localY * sine, y: base + (index + 0.5) * stepRise, z: stair.y + localY * cosine,
      width: stair.width, depth: stepRun, height: stepRise, rotationY: -angle,
    };
  });
}

function onSegment(a: PlanPoint, b: PlanPoint, point: PlanPoint, tolerance: number) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 0)) return Math.hypot(point.x - a.x, point.y - a.y) <= tolerance;
  const t = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (length * length);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + clamped * (b.x - a.x)), point.y - (a.y + clamped * (b.y - a.y))) <= tolerance;
}
function onBoundary(outline: PlanPoint[], point: PlanPoint) {
  return outline.some((start, index) => onSegment(start, outline[(index + 1) % outline.length]!, point, EDGE_TOLERANCE_MM));
}
function contains(outline: PlanPoint[], point: PlanPoint) {
  if (onBoundary(outline, point)) return true;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!, b = outline[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function topmost(point: PlanPoint, surfaces: SupportingSurface[]) {
  return surfaces.filter(surface => contains(surface.outline, point)).sort((a, b) => b.elevation - a.elevation)[0];
}

const messages: Record<PlacementKind, string> = {
  'missing-surface': 'Bitte eine Auflagefläche wählen. Ohne Auswahl wird die Höhe nicht stillschweigend gesetzt.',
  'unknown-surface': 'Die gewählte Auflagefläche ist nicht vorhanden.',
  'ambiguous-edge': 'Die Platzierung liegt an einer Kante zwischen unterschiedlichen Höhen und wird nicht stillschweigend angehoben.',
};

export function placementDiagnostic(
  object: { id: string; supportingSurfaceId?: string; corners: PlanPoint[] },
  surfaces: SupportingSurface[],
): PlacementDiagnostic | undefined {
  if (!object.supportingSurfaceId) return { objectId: object.id, kind: 'missing-surface', message: messages['missing-surface'] };
  if (!surfaces.some(surface => surface.id === object.supportingSurfaceId)) {
    return { objectId: object.id, kind: 'unknown-surface', message: messages['unknown-surface'] };
  }
  const elevations = new Set(object.corners.map(corner => topmost(corner, surfaces)?.elevation).filter((value): value is number => value !== undefined));
  const onEdge = object.corners.some(corner => surfaces.some(surface =>
    onBoundary(surface.outline, corner) && surface.elevation !== surfaceElevation(surfaces, object.supportingSurfaceId),
  ));
  if (elevations.size > 1 || onEdge) return { objectId: object.id, kind: 'ambiguous-edge', message: messages['ambiguous-edge'] };
}

export function layoutDiagnostics(
  layout: { walls: { id: string; supportingSurfaceId?: string; x: number; y: number; rotation: number; width: number; thickness: number }[];
    braces: { id: string; supportingSurfaceId?: string; x: number; y: number; rotation: number; footprintWidth: number; footprintDepth: number }[];
    platforms?: Platform[]; stairs?: StairUnit[];
    placeholders?: { id: string; supportingSurfaceId?: string; x: number; y: number; rotation: number; width: number; depth: number }[] },
  venue: VenueLevels,
): PlacementDiagnostic[] {
  const surfaces = supportingSurfaces(venue, layout);
  const found: PlacementDiagnostic[] = [];
  for (const wall of layout.walls) {
    const diagnostic = placementDiagnostic({
      id: wall.id, supportingSurfaceId: wall.supportingSurfaceId,
      corners: stairCorners({ x: wall.x, y: wall.y, rotation: wall.rotation, width: wall.width, run: wall.thickness }),
    }, surfaces);
    if (diagnostic) found.push(diagnostic);
  }
  for (const brace of layout.braces) {
    const diagnostic = placementDiagnostic({
      id: brace.id, supportingSurfaceId: brace.supportingSurfaceId,
      corners: stairCorners({ x: brace.x, y: brace.y, rotation: brace.rotation, width: brace.footprintWidth, run: brace.footprintDepth }),
    }, surfaces);
    if (diagnostic) found.push(diagnostic);
  }
  for (const stair of layout.stairs ?? []) {
    if (![stair.lowerSurfaceId, stair.upperSurfaceId].every(id => surfaces.some(surface => surface.id === id))) {
      found.push({ objectId: stair.id, kind: 'unknown-surface', message: messages['unknown-surface'] });
    }
  }
  for (const item of layout.placeholders ?? []) {
    const diagnostic = placementDiagnostic({
      id: item.id, supportingSurfaceId: item.supportingSurfaceId,
      corners: stairCorners({ x: item.x, y: item.y, rotation: item.rotation, width: item.width, run: item.depth }),
    }, surfaces);
    if (diagnostic) found.push(diagnostic);
  }
  return found;
}

export function uniqueLevelIds(platforms: Platform[], stairs: StairUnit[]) {
  const ids = [...platforms, ...stairs].map(item => item.id);
  return new Set(ids).size === ids.length;
}
