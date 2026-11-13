import { layoutSchema, type Layout, type LayoutObject, type PartFaceFinish } from './layout.js';
import type { PlatformSurfaces } from './levels.js';
import type { SelectableMember } from './selection.js';
import {
  applyUniformFinish, patchWallSurfaces, type SurfaceFinish, type WallSurfaces,
} from './surfaces.js';

export type PlanTransform = { x: number; y: number; rotation: number };
export const MIXED_PROPERTY = '__mixed__' as const;
export type MixedProperty = typeof MIXED_PROPERTY;

export function normalizeRotation(value: number) { return ((value + 180) % 360 + 360) % 360 - 180; }

export function selectionPivot(layout: Layout, selection: readonly SelectableMember[]) {
  const ids = new Set(selection.map(item => item.id));
  const points = layout.objects.filter(object => ids.has(object.id));
  if (!points.length) return;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

export function memberIdsByKind(selection: readonly SelectableMember[], kind: SelectableMember['kind']): string[] {
  return selection.flatMap(item => item.kind === kind ? [item.id] : []);
}

export function mixedPropertyValue(values: readonly (string | undefined)[]): string | MixedProperty {
  const normalized = values.map(value => value ?? '');
  if (!normalized.length) return '';
  const first = normalized[0]!;
  return normalized.every(value => value === first) ? first : MIXED_PROPERTY;
}

function patchObjects(layout: Layout, objectIds: readonly string[], patch: (object: LayoutObject) => LayoutObject): Layout {
  const ids = new Set(objectIds);
  return ids.size ? { ...layout, objects: layout.objects.map(object => ids.has(object.id) ? patch(object) : object) } : layout;
}

export function applyObjectFinishes(
  layout: Layout,
  objectIds: readonly string[],
  finishes: Readonly<Record<string, PartFaceFinish | undefined>>,
): Layout {
  return patchObjects(layout, objectIds, object => {
    const next = { ...(object.finishes ?? {}) };
    for (const [face, finish] of Object.entries(finishes)) {
      if (finish === undefined) delete next[face];
      else next[face] = finish;
    }
    if (!Object.keys(next).length) {
      const { finishes: _removed, ...rest } = object;
      return rest;
    }
    return { ...object, finishes: next };
  });
}

/** Kept as a user action name: paint the standard wall face traits uniformly. */
export function applyWallFinish(layout: Layout, objectIds: readonly string[], finish: string | undefined): Layout {
  const uniform = applyUniformFinish(finish ? { kind: 'library', ref: finish } : undefined);
  return applyObjectFinishes(layout, objectIds, {
    front: uniform?.front,
    back: uniform?.back,
    edge: uniform?.edge,
  });
}

export function applyPlatformFinish(layout: Layout, objectIds: readonly string[], finish: string | undefined): Layout {
  const value: SurfaceFinish | undefined = finish ? { kind: 'library', ref: finish } : undefined;
  return applyObjectFinishes(layout, objectIds, { top: value, sides: value });
}

export function applyPlatformSurfaces(
  layout: Layout,
  objectIds: readonly string[],
  surfaces: PlatformSurfaces | undefined,
): Layout {
  return applyObjectFinishes(layout, objectIds, { top: surfaces?.top, sides: surfaces?.sides });
}

export function applyVenuePlatformFinish<T extends { id: string; finish?: string }>(
  platforms: readonly T[], platformIds: readonly string[], finish: string | undefined,
): T[] {
  const ids = new Set(platformIds);
  return platforms.map(platform => {
    if (!ids.has(platform.id)) return platform;
    if (finish) return { ...platform, finish };
    const { finish: _removed, ...rest } = platform;
    return rest as T;
  });
}

function asWallSurfaces(object: LayoutObject): WallSurfaces | undefined {
  const front = object.finishes?.front;
  const back = object.finishes?.back;
  const edge = object.finishes?.edge;
  return {
    ...(front && !('kind' in front) ? { front } : {}),
    ...(back && !('kind' in back) ? { back } : {}),
    ...(edge && 'kind' in edge ? { edge } : {}),
  };
}

export function applyWallRal(
  layout: Layout,
  objectIds: readonly string[],
  paint: { frontRal?: string | undefined; backRal?: string | undefined },
): Layout {
  return patchObjects(layout, objectIds, object => {
    let surfaces = asWallSurfaces(object);
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
    return {
      ...object,
      finishes: {
        ...(object.finishes ?? {}),
        ...(surfaces?.front ? { front: surfaces.front } : {}),
        ...(surfaces?.back ? { back: surfaces.back } : {}),
        ...(surfaces?.edge ? { edge: surfaces.edge } : {}),
      },
    };
  });
}

export function applyWallSurfaces(
  layout: Layout,
  objectIds: readonly string[],
  surfaces: WallSurfaces | undefined,
): Layout {
  return applyObjectFinishes(layout, objectIds, {
    front: surfaces?.front,
    back: surfaces?.back,
    edge: surfaces?.edge,
  });
}

/** A complete candidate transform from a gesture's original document, never from its previous preview. */
export function transformSelection(layout: Layout, selection: readonly SelectableMember[], delta: PlanTransform): Layout {
  const pivot = selectionPivot(layout, selection);
  if (!pivot || ![delta.x, delta.y, delta.rotation].every(Number.isFinite)) return layout;
  const ids = new Set(selection.map(item => item.id));
  const radians = delta.rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const point = (object: LayoutObject) => ({
    x: pivot.x + (object.x - pivot.x) * cos - (object.y - pivot.y) * sin + delta.x,
    y: pivot.y + (object.x - pivot.x) * sin + (object.y - pivot.y) * cos + delta.y,
  });
  const candidate = {
    ...layout,
    objects: layout.objects.map(object => ids.has(object.id)
      ? { ...object, ...point(object), rotation: normalizeRotation(object.rotation + delta.rotation) }
      : object),
    groups: layout.groups?.map(group => group.members.every(member => ids.has(member.id))
      ? { ...group, rotation: normalizeRotation(group.rotation + delta.rotation) }
      : group),
  };
  return layoutSchema.safeParse(candidate).success ? candidate : layout;
}
