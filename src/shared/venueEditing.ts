import { venueGeometrySchema, type VenueGeometry } from './layout.js';
import { platformCentroid } from './levels.js';
import { normalizeRotation, type PlanTransform } from './editing.js';

export function venueObjects(venue: VenueGeometry) {
  return [
    ...(venue.walls ?? []).map(item => ({ ...item, kind: 'wall' as const })),
    ...(venue.platforms ?? []).map(item => ({ ...item, ...platformCentroid(item.outline), kind: 'platform' as const })),
    ...(venue.stairs ?? []).map(item => ({ ...item, kind: 'stair' as const })),
    ...(venue.overheadBoxes ?? []).map(item => ({ ...item, kind: 'overhead' as const })),
    ...(venue.connectionPoints ?? []).map(item => ({ ...item, kind: 'pin' as const })),
    ...(venue.keepClearZones ?? []).map(item => ({ ...item, ...platformCentroid(item.polygon), kind: 'zone' as const })),
    ...(venue.cableRoutingCorridors ?? []).map(item => ({ ...item, ...platformCentroid(item.path), kind: 'corridor' as const })),
  ];
}
export function venueSelectionPivot(venue: VenueGeometry, ids: readonly string[]) {
  const selected = venueObjects(venue).filter(item => ids.includes(item.id));
  return selected.length ? { x: selected.reduce((sum, p) => sum + p.x, 0) / selected.length, y: selected.reduce((sum, p) => sum + p.y, 0) / selected.length } : undefined;
}
export function transformVenue(venue: VenueGeometry, ids: readonly string[], delta: PlanTransform): VenueGeometry {
  const pivot = venueSelectionPivot(venue, ids);
  if (!pivot) return venue;
  const cos = Math.cos(delta.rotation * Math.PI / 180), sin = Math.sin(delta.rotation * Math.PI / 180);
  const point = (p: { x: number; y: number }) => ({ x: pivot.x + (p.x - pivot.x) * cos - (p.y - pivot.y) * sin + delta.x, y: pivot.y + (p.x - pivot.x) * sin + (p.y - pivot.y) * cos + delta.y });
  const posed = <T extends { id: string; x: number; y: number }>(items: T[] | undefined) => items?.map(item => ids.includes(item.id) ? { ...item, ...point(item), ...('rotation' in item && typeof item.rotation === 'number' ? { rotation: normalizeRotation(item.rotation + delta.rotation) } : {}) } : item);
  const candidate = { ...venue, walls: posed(venue.walls), stairs: posed(venue.stairs), overheadBoxes: posed(venue.overheadBoxes), connectionPoints: posed(venue.connectionPoints),
    platforms: venue.platforms?.map(item => ids.includes(item.id) ? { ...item, outline: item.outline.map(point) } : item),
    keepClearZones: venue.keepClearZones?.map(item => ids.includes(item.id) ? { ...item, polygon: item.polygon.map(point) } : item),
    cableRoutingCorridors: venue.cableRoutingCorridors?.map(item => ids.includes(item.id) ? { ...item, path: item.path.map(point) } : item),
  };
  return venueGeometrySchema.safeParse(candidate).success ? candidate : venue;
}
