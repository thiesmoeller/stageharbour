import type { Layout, LayoutObject } from './layout.js';
import {
  createPartContext, partRefKey, placeResolvedPart, resolvePart,
  type PartContext, type PartDefinition, type PartIssue, type PartMaterial, type PartRef, type PlacedPart, type ResolvedPart,
} from './parts/index.js';

export type LayoutPartIndex = {
  context: PartContext;
  part(ref: PartRef): PartDefinition | undefined;
  latestRevision(partId: string): number | undefined;
};

export function createLayoutPartIndex(source: {
  parts: readonly PartDefinition[];
  materials: readonly PartMaterial[];
}): LayoutPartIndex {
  const byRef = new Map(source.parts.map(part => [partRefKey(part), part]));
  const latest = new Map<string, number>();
  for (const part of source.parts) latest.set(part.id, Math.max(latest.get(part.id) ?? 0, part.revision));
  return {
    context: createPartContext(source),
    part: ref => byRef.get(partRefKey(ref)),
    latestRevision: id => latest.get(id),
  };
}

export type ResolvedLayoutObject = PlacedPart & {
  object: LayoutObject;
  definition: PartDefinition;
  resolved: ResolvedPart;
  /** Elevation of the object's origin above the audience floor. */
  elevation: number;
};

export type LayoutObjectResolutionIssue =
  | { kind: 'missing-part'; objectId: string; part: PartRef; message: string }
  | { kind: 'unknown-support'; objectId: string; support: string; message: string }
  | { kind: 'support-cycle'; objectId: string; support: string; message: string }
  | { kind: 'part'; objectId: string; issue: PartIssue; message: string };

export type LayoutObjectResolution = {
  objects: ResolvedLayoutObject[];
  byId: ReadonlyMap<string, ResolvedLayoutObject>;
  issues: LayoutObjectResolutionIssue[];
};

export type ResolveLayoutOptions = {
  /** Venue-owned surfaces, keyed by id, with absolute elevation in millimetres. */
  supportElevations?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
};

function externalSupport(options: ResolveLayoutOptions | undefined, id: string): number | undefined {
  const source = options?.supportElevations;
  if (!source) return undefined;
  return typeof (source as ReadonlyMap<string, number>).get === 'function'
    ? (source as ReadonlyMap<string, number>).get(id)
    : (source as Readonly<Record<string, number>>)[id];
}

/**
 * The single scene seam for plan, 3D, checks and later outputs. Definitions resolve once, support
 * chains are evaluated against part surface traits, and every returned solid/face/connector is in
 * world millimetres.
 */
export function resolveLayoutObjectDetails(
  layout: Layout,
  index: LayoutPartIndex,
  options?: ResolveLayoutOptions,
): LayoutObjectResolution {
  const issues: LayoutObjectResolutionIssue[] = [];
  const local = new Map<string, { object: LayoutObject; definition: PartDefinition; resolved: ResolvedPart }>();
  for (const object of layout.objects) {
    const definition = index.part(object.part);
    if (!definition) {
      issues.push({
        kind: 'missing-part',
        objectId: object.id,
        part: object.part,
        message: `Bauteil ${object.part.id} (Revision ${object.part.revision}) für „${object.label}“ fehlt.`,
      });
      continue;
    }
    const resolved = resolvePart(definition, {
      variant: object.variant,
      values: object.values,
      state: object.state,
    }, index.context);
    local.set(object.id, { object, definition, resolved });
    for (const issue of resolved.issues) {
      issues.push({ kind: 'part', objectId: object.id, issue, message: `„${object.label}“: ${issue.message}` });
    }
  }

  const elevations = new Map<string, number>();
  const visiting = new Set<string>();
  const elevationOf = (objectId: string): number => {
    const known = elevations.get(objectId);
    if (known !== undefined) return known;
    const item = local.get(objectId);
    if (!item) return 0;
    const support = item.object.support;
    if (!support) {
      elevations.set(objectId, 0);
      return 0;
    }
    const external = externalSupport(options, support);
    if (external !== undefined) {
      elevations.set(objectId, external);
      return external;
    }
    const parent = local.get(support);
    if (!parent) {
      issues.push({
        kind: 'unknown-support',
        objectId,
        support,
        message: `„${item.object.label}“ verweist auf eine unbekannte Auflagefläche.`,
      });
      elevations.set(objectId, 0);
      return 0;
    }
    if (visiting.has(objectId)) {
      issues.push({
        kind: 'support-cycle',
        objectId,
        support,
        message: `Die Auflagekette von „${item.object.label}“ enthält einen Kreis.`,
      });
      elevations.set(objectId, 0);
      return 0;
    }
    visiting.add(objectId);
    const base = elevationOf(parent.object.id);
    visiting.delete(objectId);
    const top = parent.resolved.surfaces.length
      ? Math.max(...parent.resolved.surfaces.map(surface => surface.elevation))
      : 0;
    const result = base + top;
    elevations.set(objectId, result);
    return result;
  };

  const objects: ResolvedLayoutObject[] = [];
  for (const object of layout.objects) {
    const item = local.get(object.id);
    if (!item) continue;
    const elevation = elevationOf(object.id);
    objects.push({
      ...placeResolvedPart(item.resolved, {
        x: object.x,
        y: object.y,
        rotation: object.rotation,
        elevation,
      }),
      object,
      definition: item.definition,
      resolved: item.resolved,
      elevation,
    });
  }
  return { objects, byId: new Map(objects.map(object => [object.object.id, object])), issues };
}

/** Convenience form used by renderers and geometry-only checks. */
export function resolveLayoutObjects(
  layout: Layout,
  index: LayoutPartIndex,
  options?: ResolveLayoutOptions,
): ResolvedLayoutObject[] {
  return resolveLayoutObjectDetails(layout, index, options).objects;
}

export function newerPartRevision(object: LayoutObject, index: LayoutPartIndex): number | undefined {
  const latest = index.latestRevision(object.part.id);
  return latest !== undefined && latest > object.part.revision ? latest : undefined;
}
