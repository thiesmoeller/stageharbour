import { z } from 'zod';
import { venueOutlineSchema } from './venue.js';
import { AUDIENCE_FLOOR_ID } from './levels.js';

const name = z.string().trim().min(1).max(120);
// Example-only millimetre placeholders for a keep-clear zone. Not a measured venue constraint.
export const EXAMPLE_KEEP_CLEAR_WIDTH = 2000;
export const EXAMPLE_KEEP_CLEAR_DEPTH = 1000;
export const EXAMPLE_KEEP_CLEAR_REASON = 'Notausgang';
/** Millimetres. Polygons whose closest points are at most this far apart count as overlapping, so exact edge contact and floating-point rotation still warn. A larger gap does not. */
export const KEEP_CLEAR_CONTACT_TOLERANCE_MM = 1;

export const keepClearZoneSchema = z.strictObject({
  id: z.uuid(), label: name, reason: name, supportingSurfaceId: z.uuid(),
  polygon: venueOutlineSchema,
});
export type KeepClearZone = z.infer<typeof keepClearZoneSchema>;
export const keepClearZonesSchema = z.array(keepClearZoneSchema).max(250)
  .refine(zones => new Set(zones.map(zone => zone.id)).size === zones.length, 'Keep-clear zone IDs must be unique');

export function newKeepClearZone(id: string, supportingSurfaceId: string, x: number, y: number): KeepClearZone {
  const hx = EXAMPLE_KEEP_CLEAR_WIDTH / 2, hy = EXAMPLE_KEEP_CLEAR_DEPTH / 2;
  return {
    id, label: 'Freihaltezone', reason: EXAMPLE_KEEP_CLEAR_REASON, supportingSurfaceId,
    polygon: [{ x: x - hx, y: y - hy }, { x: x + hx, y: y - hy }, { x: x + hx, y: y + hy }, { x: x - hx, y: y + hy }],
  };
}

export const keepClearObjectKindSchema = z.enum(['wall', 'brace', 'platform', 'stair']);
export type KeepClearObjectKind = z.infer<typeof keepClearObjectKindSchema>;
export const keepClearWarningSchema = z.strictObject({
  kind: z.literal('keep-clear-overlap'),
  zoneId: z.uuid(), zoneLabel: name, objectId: z.uuid(), objectLabel: name,
  objectKind: keepClearObjectKindSchema, message: z.string().min(1).max(500),
});
export type KeepClearWarning = z.infer<typeof keepClearWarningSchema>;

type PlanPoint = { x: number; y: number };
type LayoutObjects = {
  walls: { id: string; label: string; x: number; y: number; rotation: number; width: number; thickness: number; supportingSurfaceId?: string }[];
  braces: { id: string; label: string; x: number; y: number; rotation: number; footprintWidth: number; footprintDepth: number; supportingSurfaceId?: string }[];
  platforms?: { id: string; label: string; outline: PlanPoint[] }[];
  stairs?: { id: string; label: string; lowerSurfaceId: string; upperSurfaceId: string; x: number; y: number; rotation: number; width: number; run: number }[];
};
type VenueZones = { keepClearZones?: KeepClearZone[] };

const kindLabel: Record<KeepClearObjectKind, string> = {
  wall: 'Wand', brace: 'Stütze', platform: 'Podest', stair: 'Treppe',
};

function footprint(object: { x: number; y: number; rotation: number; width: number; depth: number }): PlanPoint[] {
  const angle = object.rotation * Math.PI / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x = 0, y = 0]) => {
    const dx = x * object.width / 2, dy = y * object.depth / 2;
    return { x: object.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: object.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  });
}

function distanceToSegment(point: PlanPoint, start: PlanPoint, end: PlanPoint) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(length > 0)) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)));
  return Math.hypot(point.x - (start.x + t * (end.x - start.x)), point.y - (start.y + t * (end.y - start.y)));
}

function contains(outline: PlanPoint[], point: PlanPoint) {
  if (outline.some((start, index) => distanceToSegment(point, start, outline[(index + 1) % outline.length]!) <= 1e-9)) return true;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!, b = outline[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint) {
  const orient = (p: PlanPoint, q: PlanPoint, r: PlanPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return [c, d].some(point => distanceToSegment(point, a, b) <= 1e-9)
    || [a, b].some(point => distanceToSegment(point, c, d) <= 1e-9);
}

function polygonGap(a: PlanPoint[], b: PlanPoint[]) {
  let gap = Infinity;
  for (let i = 0; i < a.length; i++) {
    const start = a[i]!, end = a[(i + 1) % a.length]!;
    for (const point of b) gap = Math.min(gap, distanceToSegment(point, start, end));
  }
  for (let i = 0; i < b.length; i++) {
    const start = b[i]!, end = b[(i + 1) % b.length]!;
    for (const point of a) gap = Math.min(gap, distanceToSegment(point, start, end));
  }
  return gap;
}

export function polygonsOverlap(a: PlanPoint[], b: PlanPoint[], tolerance = KEEP_CLEAR_CONTACT_TOLERANCE_MM) {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!, a1 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a0, a1, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  if (a.some(point => contains(b, point)) || b.some(point => contains(a, point))) return true;
  return polygonGap(a, b) <= tolerance;
}

function warning(zone: KeepClearZone, object: { id: string; label: string; kind: KeepClearObjectKind }): KeepClearWarning {
  return {
    kind: 'keep-clear-overlap', zoneId: zone.id, zoneLabel: zone.label,
    objectId: object.id, objectLabel: object.label, objectKind: object.kind,
    message: `Freihaltezone „${zone.label}“ überschneidet ${kindLabel[object.kind]} „${object.label}“.`,
  };
}

export function keepClearWarnings(venue: VenueZones, layout: LayoutObjects): KeepClearWarning[] {
  const found: KeepClearWarning[] = [];
  const objects: { id: string; label: string; kind: KeepClearObjectKind; surfaces: string[]; polygon: PlanPoint[] }[] = [
    ...layout.walls.map(wall => ({
      id: wall.id, label: wall.label, kind: 'wall' as const,
      surfaces: wall.supportingSurfaceId ? [wall.supportingSurfaceId] : [],
      polygon: footprint({ x: wall.x, y: wall.y, rotation: wall.rotation, width: wall.width, depth: wall.thickness }),
    })),
    ...layout.braces.map(brace => ({
      id: brace.id, label: brace.label, kind: 'brace' as const,
      surfaces: brace.supportingSurfaceId ? [brace.supportingSurfaceId] : [],
      polygon: footprint({ x: brace.x, y: brace.y, rotation: brace.rotation, width: brace.footprintWidth, depth: brace.footprintDepth }),
    })),
    ...(layout.platforms ?? []).map(platform => ({
      id: platform.id, label: platform.label, kind: 'platform' as const,
      surfaces: [AUDIENCE_FLOOR_ID], polygon: platform.outline,
    })),
    ...(layout.stairs ?? []).map(stair => ({
      id: stair.id, label: stair.label, kind: 'stair' as const,
      surfaces: [stair.lowerSurfaceId, stair.upperSurfaceId],
      polygon: footprint({ x: stair.x, y: stair.y, rotation: stair.rotation, width: stair.width, depth: stair.run }),
    })),
  ];
  for (const zone of venue.keepClearZones ?? []) {
    for (const object of objects) {
      if (!object.surfaces.includes(zone.supportingSurfaceId)) continue;
      if (polygonsOverlap(zone.polygon, object.polygon)) found.push(warning(zone, object));
    }
  }
  return found;
}
