import { AUDIENCE_FLOOR_ID, type PlacementDiagnostic } from './levels.js';
import type { KeepClearWarning } from './keepClear.js';
import type { DimensionAnchor } from './dimensionSchema.js';
import type { Layout, VenueGeometry } from './layout.js';
import type { OverheadWarning } from './overhead.js';
import { measuredOutline } from './venue.js';
import { pruneVenueFixtureState } from './venueFixtures.js';

function remapDimensionAnchor<T extends Record<string, unknown>>(anchor: T, ids: ReadonlyMap<string, string>): T {
  for (const key of ['wallId', 'platformId', 'braceId'] as const) {
    const value = anchor[key];
    if (typeof value === 'string' && ids.has(value)) return { ...anchor, [key]: ids.get(value) } as T;
  }
  return anchor;
}

/** Clone a v2 scene document while preserving references inside the clone. */
export function duplicateLayout(layout: Layout, nextId: () => string): Layout {
  const source = structuredClone(layout);
  const ids = new Map(source.objects.map(object => [object.id, nextId()]));
  const groupIds = new Map((source.groups ?? []).map(group => [group.id, nextId()]));
  return {
    ...source,
    objects: source.objects.map(object => ({
      ...object,
      id: ids.get(object.id)!,
      ...(object.support && ids.has(object.support) ? { support: ids.get(object.support)! } : {}),
    })),
    joints: source.joints.map(joint => ({
      ...joint,
      ...(joint.id ? { id: nextId() } : {}),
      a: { ...joint.a, object: ids.get(joint.a.object) ?? joint.a.object },
      b: { ...joint.b, object: ids.get(joint.b.object) ?? joint.b.object },
    })),
    groups: source.groups?.map(group => ({
      ...group,
      id: groupIds.get(group.id)!,
      members: group.members.map(member => ({ ...member, id: ids.get(member.id) ?? member.id })),
    })),
    dimensions: source.dimensions?.map(dimension => ({
      ...dimension,
      a: remapDimensionAnchor(dimension.a, ids),
      b: remapDimensionAnchor(dimension.b, ids),
    })),
    wallPictures: source.wallPictures?.map(picture => ({
      ...picture,
      id: nextId(),
      wallId: ids.get(picture.wallId) ?? picture.wallId,
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

function adaptationDiagnostics(layout: Layout, destination: VenueGeometry): PlacementDiagnostic[] {
  const internal = new Set(layout.objects.map(object => object.id));
  const venue = new Set([
    AUDIENCE_FLOOR_ID,
    ...(destination.platforms ?? []).map(platform => platform.id),
  ]);
  const diagnostics: PlacementDiagnostic[] = [];
  for (const object of layout.objects) {
    if (!object.support) {
      diagnostics.push({
        objectId: object.id,
        kind: 'missing-surface',
        message: 'Bitte eine Auflagefläche wählen. Ohne Auswahl wird die Höhe nicht stillschweigend gesetzt.',
      });
      continue;
    }
    if (!internal.has(object.support) && !venue.has(object.support)) {
      diagnostics.push({
        objectId: object.id,
        kind: 'unknown-surface',
        message: 'Die gewählte Auflagefläche ist nicht vorhanden.',
      });
    }
  }
  return diagnostics;
}

/** A venue-owned dimension anchor in the destination venue, or undefined when it has no counterpart there. */
function venueAnchor(anchor: DimensionAnchor, destination: VenueGeometry, surfaceMap: Readonly<Record<string, string>>): DimensionAnchor | undefined {
  switch (anchor.kind) {
    case 'outline': return anchor.index < measuredOutline(destination).length ? anchor : undefined;
    case 'outlineEdge': return anchor.edge < measuredOutline(destination).length ? anchor : undefined;
    case 'wall': case 'wallEdge':
      return anchor.scope === 'scene' || (destination.walls ?? []).some(wall => wall.id === anchor.wallId) ? anchor : undefined;
    case 'platform': case 'platformEdge': {
      if (anchor.scope === 'scene') return anchor;
      const platformId = surfaceMap[anchor.platformId];
      return platformId && (destination.platforms ?? []).some(platform => platform.id === platformId) ? { ...anchor, platformId } : undefined;
    }
    case 'brace': return anchor;
  }
}

/**
 * Copy to another venue. Object-owned support chains survive; venue-owned support ids and
 * dimension anchors are mapped explicitly, and dimensions to venue parts without a counterpart
 * are dropped. Physical stock assignments are deliberately cleared.
 */
export function copyLayoutIntoVenue(
  layout: Layout,
  destination: VenueGeometry,
  surfaceMap: Readonly<Record<string, string>>,
  nextId: () => string,
): AdaptedLayout {
  const transferred = duplicateLayout(layout, nextId);
  const internal = new Set(transferred.objects.map(object => object.id));
  const objects = transferred.objects.map(object => {
    const { stockItemId: _stockItemId, ...withoutStock } = object;
    if (!object.support || internal.has(object.support)) return withoutStock;
    const support = Object.hasOwn(surfaceMap, object.support)
      ? surfaceMap[object.support]
      : object.support === AUDIENCE_FLOOR_ID ? AUDIENCE_FLOOR_ID : undefined;
    return { ...withoutStock, support };
  });
  const dimensions = transferred.dimensions?.flatMap(dimension => {
    const a = venueAnchor(dimension.a, destination, surfaceMap);
    const b = venueAnchor(dimension.b, destination, surfaceMap);
    return a && b ? [{ ...dimension, a, b }] : [];
  });
  const adapted = pruneVenueFixtureState({
    ...transferred,
    objects,
    ...(dimensions ? { dimensions } : {}),
    riggingSetupId: nextId(),
  }, destination);
  return {
    layout: adapted,
    unresolvedSupport: adaptationDiagnostics(adapted, destination),
    // Generic geometry checks run after the caller resolves the destination catalog (layoutObjects.ts).
    warnings: [],
    unresolvedWarnings: [],
  };
}

export function captureTemplateLayout(layout: Layout): Layout {
  return structuredClone(layout);
}

export function applyVenueVersion(layout: Layout, destination: VenueGeometry): AdaptedLayout {
  const internal = new Set(layout.objects.map(object => object.id));
  const venueSurfaces = new Set([
    AUDIENCE_FLOOR_ID,
    ...(destination.platforms ?? []).map(platform => platform.id),
  ]);
  const objects = layout.objects.map(object => {
    if (!object.support || internal.has(object.support) || venueSurfaces.has(object.support)) return object;
    const { support: _support, ...rest } = object;
    return rest;
  });
  const adapted = pruneVenueFixtureState({ ...layout, objects }, destination);
  return {
    layout: adapted,
    unresolvedSupport: adaptationDiagnostics(adapted, destination),
    warnings: [],
    unresolvedWarnings: [],
  };
}

export function remountRigging(layout: Layout, nextId: () => string): Layout {
  return { ...layout, riggingSetupId: nextId() };
}

export function copiedSceneName(name: string) {
  const suffix = ' (Kopie)';
  return `${name.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`;
}
