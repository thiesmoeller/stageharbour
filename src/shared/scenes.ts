import { AUDIENCE_FLOOR_ID } from './levels.js';
import type { Layout } from './layout.js';

/**
 * Whole-scene clone for another scene in the same production. Placement records
 * get new ids so later edits cannot collide with the source document; `panelId`
 * and `assemblyNumber` stay so the copy reuses the same physical walls. Groups,
 * connections, and layout-owned platform refs remap to those new ids. Venue
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
  function memberId(kind: 'wall' | 'brace' | 'stair', id: string) {
    return (kind === 'wall' ? wallMap : kind === 'brace' ? braceMap : stairMap).get(id) ?? id;
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
    platforms: source.platforms?.map(platform => ({ ...platform, id: platformMap.get(platform.id)! })),
    stairs: source.stairs?.map(stair => ({
      ...stair,
      id: stairMap.get(stair.id)!,
      lowerSurfaceId: surfaceId(stair.lowerSurfaceId),
      upperSurfaceId: surfaceId(stair.upperSurfaceId),
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

/** A remount unscrews hinges; pin changes stay in `riggingNotes` on the same setup. */
export function remountRigging(layout: Layout, nextId: () => string): Layout {
  return { ...layout, riggingSetupId: nextId() };
}

export function copiedSceneName(name: string) {
  const suffix = ' (Kopie)';
  return `${name.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`;
}
