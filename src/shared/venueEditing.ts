import { venueGeometrySchema, wallCorners, type VenueGeometry } from './layout.js';
import { platformCentroid, reassignVenueSupports, stairCorners } from './levels.js';
import { placeholderCorners } from './placeholders.js';
import { normalizeRotation, type PlanTransform } from './editing.js';
import { resolveWall } from './wall-types.js';
import { boundsContain, type PlanBounds } from './selection.js';
import { overheadBoxCorners } from './overhead.js';
import { trussCorners, type Truss } from './truss.js';
import { curtainCorners } from './curtains.js';
import { type HangPlan, type LightingFixture } from './hangPlan.js';

export function venueObjects(venue: VenueGeometry) {
  return [
    ...(venue.walls ?? []).map(item => ({ ...item, kind: 'wall' as const })),
    ...(venue.platforms ?? []).map(item => ({ ...item, ...platformCentroid(item.outline), kind: 'platform' as const })),
    ...(venue.stairs ?? []).map(item => ({ ...item, kind: 'stair' as const })),
    ...(venue.placeholders ?? []).map(item => ({ ...item, kind: 'placeholder' as const })),
    ...(venue.overheadBoxes ?? []).map(item => ({ ...item, kind: 'overhead' as const })),
    ...(venue.trusses ?? []).map(item => ({ ...item, kind: 'truss' as const })),
    ...(venue.curtains ?? []).map(item => ({ ...item, kind: 'curtain' as const })),
    ...(venue.connectionPoints ?? []).map(item => ({ ...item, kind: 'pin' as const })),
    ...(venue.keepClearZones ?? []).map(item => ({ ...item, ...platformCentroid(item.polygon), kind: 'zone' as const })),
    ...(venue.cableRoutingCorridors ?? []).map(item => ({ ...item, ...platformCentroid(item.path), kind: 'corridor' as const })),
  ];
}
export type VenueObject = ReturnType<typeof venueObjects>[number];
export function venueObjectFootprint(item: VenueObject, venue: VenueGeometry) {
  switch (item.kind) {
    case 'wall': return wallCorners(resolveWall(item, venue.wallTypes ?? []));
    case 'platform': return item.outline;
    case 'stair': return stairCorners(item);
    case 'placeholder': return placeholderCorners(item);
    case 'zone': return item.polygon;
    case 'corridor': return item.path;
    case 'pin': return [{ x: item.x - 65, y: item.y - 65 }, { x: item.x + 65, y: item.y + 65 }];
    case 'overhead': return overheadBoxCorners(item);
    case 'truss': return trussCorners(item);
    case 'curtain': return curtainCorners(item);
  }
}
export function venueObjectsInBounds(venue: VenueGeometry, bounds: PlanBounds) {
  return venueObjects(venue).filter(item => {
    const points = venueObjectFootprint(item, venue);
    if (!points.length) return false;
    const box = {
      minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
      minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)),
    };
    return boundsContain(bounds, box);
  }).map(item => item.id);
}

const objectFields = ['walls', 'platforms', 'stairs', 'placeholders', 'overheadBoxes', 'trusses', 'curtains', 'connectionPoints', 'keepClearZones', 'cableRoutingCorridors'] as const;
/** Offset is applied in paste; the editor supplies cursor delta so copies follow the pointer. */
export type VenueClipboard = { source: VenueGeometry; ids: string[]; cut: boolean; offset: { x: number; y: number } };
export function copyVenueSelection(venue: VenueGeometry, ids: readonly string[], cut = false): VenueClipboard | undefined {
  const selected = venueObjects(venue).filter(item => ids.includes(item.id)).map(item => item.id);
  return selected.length ? { source: structuredClone(venue), ids: selected, cut, offset: { x: 0, y: 0 } } : undefined;
}
/** Cut removes first; paste restores identities. Dependent platform references block the cut. */
export function cutVenueSelection(venue: VenueGeometry, ids: readonly string[]) {
  const clipboard = copyVenueSelection(venue, ids, true);
  if (!clipboard) return { venue, blocked: false as const };
  const removed = removeVenueSelection(venue, ids);
  return removed.blocked ? { venue, blocked: true as const } : { venue: removed.venue, clipboard, blocked: false as const };
}
/** Keep hang fixtures whose hang points still exist on remaining trusses. */
export function pruneHangPlan(plan: HangPlan | undefined, trusses: readonly Truss[]): HangPlan {
  const valid = new Set(trusses.flatMap(truss => truss.hangPoints.map(point => point.id)));
  return { fixtures: (plan?.fixtures ?? []).filter(fixture => valid.has(fixture.hangPointId)) };
}

/** Deletion is atomic: retaining a dependent object must not leave an unknown platform reference. */
export function removeVenueSelection(venue: VenueGeometry, ids: readonly string[]): { venue: VenueGeometry; blocked: boolean } {
  const platforms = new Set((venue.platforms ?? []).filter(p => ids.includes(p.id)).map(p => p.id));
  const dependent = [...venue.walls ?? [], ...venue.keepClearZones ?? [], ...venue.placeholders ?? [], ...venue.platforms ?? []].some(item => !ids.includes(item.id) && item.supportingSurfaceId && platforms.has(item.supportingSurfaceId))
    || (venue.stairs ?? []).some(item => !ids.includes(item.id) && (platforms.has(item.lowerSurfaceId) || platforms.has(item.upperSurfaceId)));
  if (dependent) return { venue, blocked: true };
  const next = { ...venue };
  for (const key of objectFields) Object.assign(next, { [key]: venue[key]?.filter(item => !ids.includes(item.id)) });
  next.hangPlan = pruneHangPlan(venue.hangPlan, next.trusses ?? []);
  return { venue: next, blocked: false };
}
/** Clipboard stays within its venue draft; selected platform references are remapped together.
 *  Copy remaps truss hang-point and lighting-fixture IDs so Scheinwerfer stay attached. */
export function pasteVenueSelection(
  venue: VenueGeometry,
  clipboard: VenueClipboard,
  id: () => string,
  offset = clipboard.offset,
) {
  const ids = new Map(clipboard.ids.map(old => [old, clipboard.cut ? old : id()]));
  const hangPointIds = new Map<string, string>();
  if (!clipboard.cut) {
    for (const truss of clipboard.source.trusses ?? []) {
      if (!ids.has(truss.id)) continue;
      for (const hang of truss.hangPoints) hangPointIds.set(hang.id, id());
    }
  }
  const source = transformVenue(clipboard.source, clipboard.ids, { x: offset.x, y: offset.y, rotation: 0 });
  // Never silently paste at the original location when a non-zero offset exceeded coordinate limits.
  if ((offset.x || offset.y) && source === clipboard.source) return { venue, ids: [] as string[] };
  const next = { ...venue };
  for (const key of objectFields) {
    const added = source[key]?.filter(item => ids.has(item.id)).map(item => {
      const copy = { ...item, id: ids.get(item.id)! };
      if ('supportingSurfaceId' in copy && copy.supportingSurfaceId) copy.supportingSurfaceId = ids.get(copy.supportingSurfaceId) ?? copy.supportingSurfaceId;
      if ('lowerSurfaceId' in copy) { copy.lowerSurfaceId = ids.get(copy.lowerSurfaceId) ?? copy.lowerSurfaceId; copy.upperSurfaceId = ids.get(copy.upperSurfaceId) ?? copy.upperSurfaceId; }
      if ('panelId' in copy && !clipboard.cut) { delete copy.panelId; delete copy.finishAssignment; delete copy.assemblyNumber; }
      if (key === 'trusses' && !clipboard.cut) {
        (copy as Truss).hangPoints = (item as Truss).hangPoints.map(hang => ({
          ...hang,
          id: hangPointIds.get(hang.id) ?? hang.id,
        }));
      }
      return copy;
    }) ?? [];
    Object.assign(next, { [key]: [...venue[key] ?? [], ...added] });
  }
  const existingFixtureIds = new Set((venue.hangPlan?.fixtures ?? []).map(fixture => fixture.id));
  const addedFixtures: LightingFixture[] = [];
  for (const fixture of source.hangPlan?.fixtures ?? []) {
    const nextTrussId = ids.get(fixture.trussId);
    if (!nextTrussId) continue;
    if (clipboard.cut) {
      if (existingFixtureIds.has(fixture.id)) continue;
      addedFixtures.push({ ...fixture, trussId: nextTrussId });
      continue;
    }
    const nextHangId = hangPointIds.get(fixture.hangPointId);
    if (!nextHangId) continue;
    addedFixtures.push({
      ...fixture,
      id: id(),
      trussId: nextTrussId,
      hangPointId: nextHangId,
    });
  }
  if (addedFixtures.length || venue.hangPlan || source.hangPlan) {
    next.hangPlan = {
      fixtures: [...(venue.hangPlan?.fixtures ?? []), ...addedFixtures],
    };
  }
  const all = venueObjects(next).map(item => item.id);
  if (new Set(all).size !== all.length || !venueGeometrySchema.safeParse(next).success) return { venue, ids: [] as string[] };
  return { venue: next, ids: [...ids.values()] };
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
  const candidate = { ...venue, walls: posed(venue.walls), stairs: posed(venue.stairs), placeholders: posed(venue.placeholders),
    overheadBoxes: posed(venue.overheadBoxes), trusses: posed(venue.trusses), curtains: posed(venue.curtains),
    connectionPoints: posed(venue.connectionPoints),
    platforms: venue.platforms?.map(item => ids.includes(item.id) ? { ...item, outline: item.outline.map(point) } : item),
    keepClearZones: venue.keepClearZones?.map(item => ids.includes(item.id) ? { ...item, polygon: item.polygon.map(point) } : item),
    cableRoutingCorridors: venue.cableRoutingCorridors?.map(item => ids.includes(item.id) ? { ...item, path: item.path.map(point) } : item),
  };
  return venueGeometrySchema.safeParse(candidate).success ? reassignVenueSupports(candidate) : venue;
}
