import { AUDIENCE_FLOOR_ID, layoutDiagnostics, type PlacementDiagnostic } from './levels.js';
import type { GroupMemberKind } from './groups.js';
import { keepClearWarnings, type KeepClearWarning } from './keepClear.js';
import type { Layout, VenueGeometry } from './layout.js';
import { overheadClearance, type OverheadWarning } from './overhead.js';

/**
 * Whole-scene clone for another scene in the same production. Placement records
 * get new ids so later edits cannot collide with the source document; `panelId`
 * and `assemblyNumber` stay so the copy reuses the same physical walls. Groups,
 * connections, and layout-owned platform and placeholder refs remap to those new ids. Venue
 * surfaces and the audience floor keep their ids. The copy shares the source
 * `riggingSetupId` (minted on the copy when the source has none). Pin changes
 * are `riggingNotes`; remounting is a new `riggingSetupId`. Compatibility stays
 * a crew check.
 */
export function duplicateLayout(layout: Layout, nextId: () => string): Layout {
  const source = structuredClone(layout);
  const wallMap = new Map(source.walls.map(wall => [wall.id, nextId()]));
  const braceMap = new Map(source.braces.map(brace => [brace.id, nextId()]));
  const platformMap = new Map((source.platforms ?? []).map(platform => [platform.id, nextId()]));
  const stairMap = new Map((source.stairs ?? []).map(stair => [stair.id, nextId()]));
  const placeholderMap = new Map((source.placeholders ?? []).map(item => [item.id, nextId()]));
  function memberId(kind: GroupMemberKind, id: string) {
    if (kind === 'wall') return wallMap.get(id) ?? id;
    if (kind === 'brace') return braceMap.get(id) ?? id;
    if (kind === 'stair') return stairMap.get(id) ?? id;
    return placeholderMap.get(id) ?? id;
  }
  function surfaceId(id: string) {
    if (id === AUDIENCE_FLOOR_ID) return id;
    return platformMap.get(id) ?? id;
  }
  return {
    ...source,
    walls: source.walls.map(wall => ({
      ...wall,
      id: wallMap.get(wall.id)!,
      supportingSurfaceId: wall.supportingSurfaceId ? surfaceId(wall.supportingSurfaceId) : wall.supportingSurfaceId,
    })),
    braces: source.braces.map(brace => ({
      ...brace,
      id: braceMap.get(brace.id)!,
      supportingSurfaceId: brace.supportingSurfaceId ? surfaceId(brace.supportingSurfaceId) : brace.supportingSurfaceId,
    })),
    platforms: source.platforms?.map(platform => ({
      ...platform,
      id: platformMap.get(platform.id)!,
      supportingSurfaceId: platform.supportingSurfaceId ? surfaceId(platform.supportingSurfaceId) : platform.supportingSurfaceId,
    })),
    stairs: source.stairs?.map(stair => ({
      ...stair,
      id: stairMap.get(stair.id)!,
      lowerSurfaceId: surfaceId(stair.lowerSurfaceId),
      upperSurfaceId: surfaceId(stair.upperSurfaceId),
    })),
    placeholders: source.placeholders?.map(item => ({
      ...item,
      id: placeholderMap.get(item.id)!,
      supportingSurfaceId: item.supportingSurfaceId ? surfaceId(item.supportingSurfaceId) : item.supportingSurfaceId,
    })),
    connections: source.connections?.map(connection => ({
      id: nextId(),
      a: wallMap.get(connection.a) ?? connection.a,
      b: wallMap.get(connection.b) ?? connection.b,
    })),
    groups: source.groups?.map(group => ({
      ...group,
      id: nextId(),
      members: group.members.map(member => ({ ...member, id: memberId(member.kind, member.id) })),
    })),
    riggingSetupId: source.riggingSetupId ?? nextId(),
  };
}

export type AdaptedLayout = {
  layout: Layout;
  unresolvedSupport: PlacementDiagnostic[];
  warnings: OverheadWarning[];
  unresolvedWarnings: KeepClearWarning[];
};

/**
 * Cross-production or destination-venue copy. Placement records get new ids;
 * `panelId` is cleared so current inventory can be assigned later. Movable
 * layout platforms, stairs, placeholders, walls, braces and groups transfer.
 * Source venue outlines, permanent equipment and constraints stay behind.
 * `surfaceMap` sends source venue surfaces onto explicitly chosen destination
 * surfaces; unmapped support becomes a missing-surface diagnostic. Destination
 * overhead and keep-clear warnings are computed from the destination venue.
 * The copy is a remount (`riggingSetupId` is always new). The source is only
 * read; callers must not require a lease on it.
 */
export function copyLayoutIntoVenue(
  layout: Layout, destination: VenueGeometry, surfaceMap: Readonly<Record<string, string>>, nextId: () => string,
): AdaptedLayout {
  const transferred = duplicateLayout(layout, nextId);
  const layoutPlatforms = new Set((transferred.platforms ?? []).map(platform => platform.id));
  function mappedSupport(id: string | undefined) {
    if (!id) return undefined;
    if (layoutPlatforms.has(id)) return id;
    if (Object.hasOwn(surfaceMap, id)) return surfaceMap[id];
    if (id === AUDIENCE_FLOOR_ID) return id;
    return undefined;
  }
  function mappedStairSurface(id: string) {
    if (layoutPlatforms.has(id)) return id;
    if (Object.hasOwn(surfaceMap, id)) return surfaceMap[id]!;
    return id;
  }
  function withoutPanel<T extends { panelId?: string }>(item: T) {
    const { panelId: _panelId, ...rest } = item;
    return rest;
  }
  const adapted: Layout = {
    ...transferred,
    walls: transferred.walls.map(wall => ({ ...withoutPanel(wall), supportingSurfaceId: mappedSupport(wall.supportingSurfaceId) })),
    braces: transferred.braces.map(brace => ({ ...brace, supportingSurfaceId: mappedSupport(brace.supportingSurfaceId) })),
    platforms: transferred.platforms?.map(platform => ({ ...platform, supportingSurfaceId: mappedSupport(platform.supportingSurfaceId) })),
    placeholders: transferred.placeholders?.map(item => ({ ...item, supportingSurfaceId: mappedSupport(item.supportingSurfaceId) })),
    stairs: transferred.stairs?.map(stair => ({
      ...stair, lowerSurfaceId: mappedStairSurface(stair.lowerSurfaceId), upperSurfaceId: mappedStairSurface(stair.upperSurfaceId),
    })),
    riggingSetupId: nextId(),
  };
  return {
    layout: adapted,
    unresolvedSupport: layoutDiagnostics(adapted, destination),
    warnings: overheadClearance(adapted, destination),
    unresolvedWarnings: keepClearWarnings(destination, adapted),
  };
}

/**
 * Named scene-template snapshot. Clones layout JSON including `wallTypes`, groups
 * and relative arrangement at capture time so later source millimetre edits cannot
 * change the stored template. Instantiating uses `copyLayoutIntoVenue` (clears
 * `panelId`, destination surfaces and conflicts). The source is only read.
 */
export function captureTemplateLayout(layout: Layout): Layout {
  return structuredClone(layout);
}

/**
 * Same-venue pin update. Placement ids, panel assignments and rigging stay;
 * support that no longer exists on the destination venue is cleared so
 * `layoutDiagnostics` reports a missing surface. Overhead and keep-clear are
 * recomputed against the destination. The source layout is only read.
 */
export function applyVenueVersion(layout: Layout, destination: VenueGeometry): AdaptedLayout {
  const layoutPlatforms = new Set((layout.platforms ?? []).map(platform => platform.id));
  const venueSurfaces = new Set((destination.platforms ?? []).map(platform => platform.id));
  function mappedSupport(id: string | undefined) {
    if (!id) return undefined;
    if (layoutPlatforms.has(id) || venueSurfaces.has(id) || id === AUDIENCE_FLOOR_ID) return id;
    return undefined;
  }
  const adapted: Layout = {
    ...layout,
    walls: layout.walls.map(wall => ({ ...wall, supportingSurfaceId: mappedSupport(wall.supportingSurfaceId) })),
    braces: layout.braces.map(brace => ({ ...brace, supportingSurfaceId: mappedSupport(brace.supportingSurfaceId) })),
    platforms: layout.platforms?.map(platform => ({ ...platform, supportingSurfaceId: mappedSupport(platform.supportingSurfaceId) })),
    placeholders: layout.placeholders?.map(item => ({ ...item, supportingSurfaceId: mappedSupport(item.supportingSurfaceId) })),
  };
  return {
    layout: adapted,
    unresolvedSupport: layoutDiagnostics(adapted, destination),
    warnings: overheadClearance(adapted, destination),
    unresolvedWarnings: keepClearWarnings(destination, adapted),
  };
}

/** A remount unscrews hinges; pin changes stay in `riggingNotes` on the same setup. */
export function remountRigging(layout: Layout, nextId: () => string): Layout {
  return { ...layout, riggingSetupId: nextId() };
}

export function copiedSceneName(name: string) {
  const suffix = ' (Kopie)';
  return `${name.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`;
}
