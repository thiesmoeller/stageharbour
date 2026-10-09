import { layoutSchema, type Layout, type Wall } from './layout.js';
import { platformCentroid, type Platform, type PlatformSurfaces } from './levels.js';
import type { SelectableMember } from './selection.js';
import { applyUniformFinish, patchWallSurfaces, type WallSurfaces } from './surfaces.js';

export type PlanTransform = { x: number; y: number; rotation: number };
/** Sentinel for CAD-style multi-edit: selected objects disagree (Figma/Blender “—”). */
export const MIXED_PROPERTY = '__mixed__' as const;
export type MixedProperty = typeof MIXED_PROPERTY;

export function normalizeRotation(value: number) { return ((value + 180) % 360 + 360) % 360 - 180; }
export function selectionPivot(layout: Layout, selection: readonly SelectableMember[]) {
  const ids = new Set(selection.map(item => item.id));
  const points = [...layout.walls, ...layout.braces, ...layout.stairs ?? [], ...layout.placeholders ?? []].filter(item => ids.has(item.id));
  const centres = [...points, ...(layout.platforms ?? []).filter(item => ids.has(item.id)).map(item => platformCentroid(item.outline))];
  if (!centres.length) return;
  return { x: centres.reduce((sum, p) => sum + p.x, 0) / centres.length, y: centres.reduce((sum, p) => sum + p.y, 0) / centres.length };
}

export function memberIdsByKind(selection: readonly SelectableMember[], kind: SelectableMember['kind']): string[] {
  return selection.flatMap(item => item.kind === kind ? [item.id] : []);
}

/** Shared value, empty string, or MIXED_PROPERTY when selected values differ. */
export function mixedPropertyValue(values: readonly (string | undefined)[]): string | MixedProperty {
  const normalized = values.map(value => value ?? '');
  if (!normalized.length) return '';
  const first = normalized[0]!;
  return normalized.every(value => value === first) ? first : MIXED_PROPERTY;
}

/** Paint the same Pascal library finish onto every listed wall (front, back, edge). */
export function applyWallFinish(layout: Layout, wallIds: readonly string[], finish: string | undefined): Layout {
  const ids = new Set(wallIds);
  if (!ids.size) return layout;
  const walls = layout.walls.map(wall => {
    if (!ids.has(wall.id)) return wall;
    const surfaces = applyUniformFinish(finish ? { kind: 'library', ref: finish } : undefined);
    const { finish: _legacyFinish, frontRal: _fr, ...rest } = wall as Wall & { finish?: string; frontRal?: string };
    if (!surfaces) {
      const { surfaces: _s, ...cleared } = rest;
      return cleared;
    }
    return { ...rest, surfaces };
  });
  return { ...layout, walls };
}

/** Paint the same finish onto every listed platform id (or clear it). */
export function applyPlatformFinish(layout: Layout, platformIds: readonly string[], finish: string | undefined): Layout {
  const ids = new Set(platformIds);
  if (!ids.size || !layout.platforms?.length) return layout;
  const platforms = layout.platforms.map((platform: Platform) => {
    if (!ids.has(platform.id)) return platform;
    if (finish) return { ...platform, finish };
    const { finish: _removed, ...rest } = platform;
    return rest;
  });
  return { ...layout, platforms };
}

/** Apply top/side surfacing to every selected stage-layout podium. */
export function applyPlatformSurfaces(
  layout: Layout, platformIds: readonly string[], surfaces: PlatformSurfaces | undefined,
): Layout {
  const ids = new Set(platformIds);
  if (!ids.size || !layout.platforms?.length) return layout;
  return {
    ...layout,
    platforms: layout.platforms.map(platform => {
      if (!ids.has(platform.id)) return platform;
      const { finish: _legacy, surfaces: _old, ...rest } = platform;
      return surfaces ? { ...rest, surfaces } : rest;
    }),
  };
}

/** Apply finish to venue platforms by id (permanent Spielstätte podiums). */
export function applyVenuePlatformFinish<T extends { id: string; finish?: string }>(
  platforms: readonly T[], platformIds: readonly string[], finish: string | undefined,
): T[] {
  const ids = new Set(platformIds);
  if (!ids.size) return [...platforms];
  return platforms.map(platform => {
    if (!ids.has(platform.id)) return platform;
    if (finish) return { ...platform, finish };
    const { finish: _removed, ...rest } = platform;
    return rest as T;
  });
}

/** Apply the same RAL paint codes to every listed wall (or clear). */
export function applyWallRal(
  layout: Layout,
  wallIds: readonly string[],
  paint: { frontRal?: string | undefined; backRal?: string | undefined },
): Layout {
  const ids = new Set(wallIds);
  if (!ids.size) return layout;
  const walls = layout.walls.map(wall => {
    if (!ids.has(wall.id)) return wall;
    let surfaces = wall.surfaces;
    if ('frontRal' in paint) {
      surfaces = patchWallSurfaces(surfaces, 'front', {
        mode: 'full',
        full: paint.frontRal ? { kind: 'paint', ral: paint.frontRal } : null,
      });
    }
    if ('backRal' in paint) {
      surfaces = patchWallSurfaces(surfaces, 'back', {
        mode: 'full',
        full: paint.backRal ? { kind: 'paint', ral: paint.backRal } : null,
      });
    }
    const { finish: _f, frontRal: _fr, backRal: _br, ...rest } = wall as Wall & {
      finish?: string; frontRal?: string; backRal?: string;
    };
    if (!surfaces) {
      const { surfaces: _s, ...cleared } = rest;
      return cleared;
    }
    return { ...rest, surfaces };
  });
  return { ...layout, walls };
}

/** Replace or clear one face of wall surfacing on every listed wall. */
export function applyWallSurfaces(
  layout: Layout,
  wallIds: readonly string[],
  surfaces: WallSurfaces | undefined,
): Layout {
  const ids = new Set(wallIds);
  if (!ids.size) return layout;
  const walls = layout.walls.map(wall => {
    if (!ids.has(wall.id)) return wall;
    const { finish: _f, frontRal: _fr, backRal: _br, surfaces: _old, ...rest } = wall as Wall & {
      finish?: string; frontRal?: string; backRal?: string;
    };
    if (!surfaces) return rest;
    return { ...rest, surfaces };
  });
  return { ...layout, walls };
}

/** A complete candidate transform from a gesture's original document, never from its previous preview. */
export function transformSelection(layout: Layout, selection: readonly SelectableMember[], delta: PlanTransform): Layout {
  const pivot = selectionPivot(layout, selection);
  if (!pivot || ![delta.x, delta.y, delta.rotation].every(Number.isFinite)) return layout;
  const keys = new Set(selection.map(item => `${item.kind}:${item.id}`));
  const radians = delta.rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const point = (p: { x: number; y: number }) => ({ x: pivot.x + (p.x - pivot.x) * cos - (p.y - pivot.y) * sin + delta.x, y: pivot.y + (p.x - pivot.x) * sin + (p.y - pivot.y) * cos + delta.y });
  const posed = <T extends { id: string; x: number; y: number; rotation: number }>(items: T[], kind: string) => items.map(item => keys.has(`${kind}:${item.id}`) ? { ...item, ...point(item), rotation: normalizeRotation(item.rotation + delta.rotation) } : item);
  const candidate = {
    ...layout, walls: posed(layout.walls, 'wall'), braces: posed(layout.braces, 'brace'),
    stairs: layout.stairs && posed(layout.stairs, 'stair'), placeholders: layout.placeholders && posed(layout.placeholders, 'placeholder'),
    platforms: layout.platforms?.map(item => keys.has(`platform:${item.id}`) ? { ...item, outline: item.outline.map(point) } : item),
    groups: layout.groups?.map(group => group.members.every(member => keys.has(`${member.kind}:${member.id}`)) ? { ...group, rotation: normalizeRotation(group.rotation + delta.rotation) } : group),
  };
  return layoutSchema.safeParse(candidate).success ? candidate : layout;
}
