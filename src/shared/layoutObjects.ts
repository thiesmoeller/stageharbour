import type { Layout, LayoutObject } from './layout.js';
import { resolveSupportingSurfaceId, supportingSurfaces, type SupportingSurface } from './levels.js';
import {
  createPartContext, partRefKey, placeFootprint, placePlanPoint, placeResolvedPart, resolvePart,
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
  /**
   * Venue floor and podiums. An object with no `support` stands on the highest of these
   * or of another object's walkable surface under its footprint.
   */
  automaticSupports?: readonly SupportingSurface[];
};

/** Venue floor and podiums, for callers that resolve a Bühnenbild in that room. */
export function layoutSupportOptions(
  venue: Parameters<typeof supportingSurfaces>[0],
): ResolveLayoutOptions {
  const surfaces = supportingSurfaces(venue);
  return {
    supportElevations: new Map(surfaces.map(surface => [surface.id, surface.elevation])),
    automaticSupports: surfaces,
  };
}

type ResolvedLocal = { object: LayoutObject; definition: PartDefinition; resolved: ResolvedPart };

/**
 * Support id for every object that has none: the topmost venue podium or other part
 * surface under its footprint. Parents are chosen so two parts cannot stand on each other.
 */
function automaticSupportParents(
  local: ReadonlyMap<string, ResolvedLocal>,
  venueSurfaces: readonly SupportingSurface[],
  options: ResolveLayoutOptions,
): Map<string, string> {
  const autoIds = [...local.values()]
    .filter(item => !item.object.support)
    .map(item => item.object.id)
    .sort();
  const parents = new Map<string, string>();
  if (!autoIds.length) return parents;

  const pointer = (id: string): string | undefined => local.get(id)?.object.support ?? parents.get(id);

  const originOf = (id: string, stack: string[] = []): number => {
    if (!local.has(id)) return externalSupport(options, id) ?? 0;
    if (stack.includes(id)) return 0;
    const support = pointer(id);
    if (!support) return 0;
    if (!local.has(support)) return externalSupport(options, support) ?? 0;
    stack.push(id);
    const base = originOf(support, stack);
    stack.pop();
    const parent = local.get(support)!;
    const top = parent.resolved.surfaces.length
      ? Math.max(...parent.resolved.surfaces.map(surface => surface.elevation))
      : 0;
    return base + top;
  };

  const standsOn = (supporterId: string, dependentId: string): boolean => {
    const seen = new Set<string>();
    let cursor: string | undefined = supporterId;
    while (cursor && local.has(cursor)) {
      if (cursor === dependentId) return true;
      if (seen.has(cursor)) return false;
      seen.add(cursor);
      cursor = pointer(cursor);
    }
    return false;
  };

  for (let pass = 0; pass < autoIds.length + 1; pass += 1) {
    let changed = false;
    for (const id of autoIds) {
      const item = local.get(id)!;
      const placement = { x: item.object.x, y: item.object.y, rotation: item.object.rotation };
      const footprint = placeFootprint(item.resolved, placement);
      const candidates: SupportingSurface[] = venueSurfaces.map(surface => ({ ...surface }));
      for (const other of local.values()) {
        if (other.object.id === id || !other.resolved.surfaces.length || standsOn(other.object.id, id)) continue;
        const origin = originOf(other.object.id);
        const otherPlacement = { x: other.object.x, y: other.object.y, rotation: other.object.rotation };
        for (const surface of other.resolved.surfaces) {
          candidates.push({
            id: other.object.id,
            label: other.object.label,
            outline: surface.outline.map(point => placePlanPoint(point, otherPlacement)),
            elevation: origin + surface.elevation,
          });
        }
      }
      const chosen = resolveSupportingSurfaceId(footprint, candidates);
      if (parents.get(id) !== chosen) {
        parents.set(id, chosen);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return parents;
}

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

  const autoParent = options?.automaticSupports
    ? automaticSupportParents(local, options.automaticSupports, options)
    : new Map<string, string>();

  const elevations = new Map<string, number>();
  const visiting = new Set<string>();
  const elevationOf = (objectId: string): number => {
    const known = elevations.get(objectId);
    if (known !== undefined) return known;
    const item = local.get(objectId);
    if (!item) return 0;
    const support = item.object.support ?? autoParent.get(objectId);
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
