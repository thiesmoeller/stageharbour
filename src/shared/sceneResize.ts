import { layoutSchema, venueGeometrySchema, type Layout, type LayoutObject, type VenueGeometry, type Wall } from './layout.js';
import type { LayoutPartIndex } from './layoutObjects.js';
import { AUDIENCE_FLOOR_ID, axisAlignedPlatformOutline, orientedPlatformBox, type Platform } from './levels.js';
import type { PartDefinition } from './parts/definition.js';
import { STARTER_PART_IDS } from './parts/starter/index.js';

export type ScenePushPullKind = 'wall' | 'platform';

type PartRole = 'wall' | 'deck' | 'boxPlatform';

function roleOf(partId: string): PartRole | undefined {
  if (partId === STARTER_PART_IDS.wall) return 'wall';
  if (partId === STARTER_PART_IDS.deck) return 'deck';
  if (partId === STARTER_PART_IDS.floatingPlatform || partId === STARTER_PART_IDS.solidPlatform) return 'boxPlatform';
  return undefined;
}

/** Which 3D faces of a placed part Größe ziehen may drag. Kisten and other props are not included. */
export function scenePushPullKind(definition: PartDefinition): ScenePushPullKind | undefined {
  const role = roleOf(definition.id);
  if (role === 'wall') return 'wall';
  if (role === 'deck' || role === 'boxPlatform') return 'platform';
  return undefined;
}

function lengthOf(object: LayoutObject, definition: PartDefinition, key: string): number {
  const stored = object.values?.[key];
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
  const variant = definition.variants?.find(item => item.key === object.variant);
  const fromVariant = variant?.values[key];
  if (typeof fromVariant === 'number' && Number.isFinite(fromVariant)) return fromVariant;
  return definition.parameters.find(item => item.key === key)?.default ?? 0;
}

function deckMeasures(object: LayoutObject, definition: PartDefinition) {
  const width = lengthOf(object, definition, 'BO') > 0 ? lengthOf(object, definition, 'BO') : lengthOf(object, definition, 'B');
  const depth = lengthOf(object, definition, 'TO') > 0 ? lengthOf(object, definition, 'TO') : lengthOf(object, definition, 'T');
  const height = lengthOf(object, definition, 'HO') > 0 ? lengthOf(object, definition, 'HO') : lengthOf(object, definition, 'H');
  return { width, depth, height };
}

function boxMeasures(object: LayoutObject, definition: PartDefinition) {
  return {
    width: lengthOf(object, definition, 'B'),
    depth: lengthOf(object, definition, 'T'),
    height: lengthOf(object, definition, 'H'),
  };
}

function supportBase(object: LayoutObject, byId: ReadonlyMap<string, LayoutObject>, index: LayoutPartIndex, seen = new Set<string>()): number {
  const support = object.support;
  if (!support || support === AUDIENCE_FLOOR_ID || seen.has(object.id)) return 0;
  const parent = byId.get(support);
  if (!parent) return 0;
  const definition = index.part(parent.part);
  if (!definition) return 0;
  const role = roleOf(definition.id);
  if (role !== 'deck' && role !== 'boxPlatform') return 0;
  seen.add(object.id);
  const size = role === 'deck' ? deckMeasures(parent, definition) : boxMeasures(parent, definition);
  return supportBase(parent, byId, index, seen) + size.height;
}

function tidy(value: number) {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 1e-3 ? rounded : Math.round(value * 1000) / 1000;
}

function wrapRotation(degrees: number) {
  const turns = Math.round(degrees / 360);
  const wrapped = degrees - turns * 360;
  return Math.abs(wrapped) < 1e-6 ? 0 : tidy(wrapped);
}

function snapParameter(definition: PartDefinition, key: string, value: number) {
  const spec = definition.parameters.find(item => item.key === key);
  if (spec?.values?.length) {
    return spec.values.reduce((best, item) => Math.abs(item - value) < Math.abs(best - value) ? item : best);
  }
  let next = Math.round(value);
  if (spec?.range) next = Math.min(spec.range.max, Math.max(spec.range.min, next));
  return Math.min(100000, Math.max(1, next));
}

/**
 * Venue-shaped stand-in so the existing face drag can run on scene walls and podiums.
 * Permanent Spielstätte walls stay out of this document: the scene command must not resize them.
 */
export function sceneResizeDocument(layout: Layout, venue: VenueGeometry, index?: LayoutPartIndex): VenueGeometry {
  if (!index) return venue;
  const byId = new Map(layout.objects.map(object => [object.id, object]));
  const walls: Wall[] = [];
  const platforms: Platform[] = [];
  for (const object of layout.objects) {
    const definition = index.part(object.part);
    if (!definition) continue;
    const role = roleOf(definition.id);
    if (role === 'wall') {
      walls.push({
        id: object.id, label: object.label, x: object.x, y: object.y, rotation: object.rotation,
        width: snapParameter(definition, 'B', lengthOf(object, definition, 'B')),
        height: snapParameter(definition, 'H', lengthOf(object, definition, 'H')),
        thickness: snapParameter(definition, 'D', lengthOf(object, definition, 'D')),
        supportingSurfaceId: AUDIENCE_FLOOR_ID,
      });
    } else if (role === 'deck' || role === 'boxPlatform') {
      const size = role === 'deck' ? deckMeasures(object, definition) : boxMeasures(object, definition);
      const base = supportBase(object, byId, index);
      platforms.push({
        id: object.id, label: object.label,
        elevation: Math.min(100000, Math.max(1, base + size.height)),
        outline: axisAlignedPlatformOutline(object.x, object.y, Math.max(1, size.width), Math.max(1, size.depth), object.rotation),
        ...(role === 'deck' ? { style: 'stageDeck' as const, deckGrain: 0 as const } : { style: 'floating' as const }),
        supportingSurfaceId: object.support && object.support !== object.id ? object.support : AUDIENCE_FLOOR_ID,
      });
    }
    if (walls.length >= 250 || platforms.length >= 250) break;
  }
  const parsed = venueGeometrySchema.safeParse({
    schemaVersion: 1, width: venue.width, depth: venue.depth, walls, platforms,
  });
  return parsed.success ? parsed.data : venue;
}

function heightValues(object: LayoutObject, definition: PartDefinition, height: number): LayoutObject['values'] {
  const next = { ...(object.values ?? {}) };
  delete next.BO;
  delete next.TO;
  delete next.HO;
  delete next.B;
  delete next.T;
  const fallback = definition.parameters.find(item => item.key === 'H')?.default;
  if (height === fallback) delete next.H;
  else next.H = height;
  return Object.keys(next).length ? next : undefined;
}

function deckVariant(definition: PartDefinition, width: number, depth: number) {
  for (const variant of definition.variants ?? []) {
    const along = variant.values.B, across = variant.values.T;
    if (along === width && across === depth) return { key: variant.key, turn: 0 };
    if (along === depth && across === width) return { key: variant.key, turn: 90 };
  }
  return undefined;
}

function samePiece(object: LayoutObject, next: LayoutObject) {
  return object.x === next.x && object.y === next.y && object.rotation === next.rotation
    && object.variant === next.variant
    && JSON.stringify(object.values ?? {}) === JSON.stringify(next.values ?? {});
}

/**
 * One podium, whatever the stock tiling. A catalog size is the matching variant.
 * Anything larger keeps the whole outline in BO/TO; seams and stock count the pieces.
 */
function podiumDeck(object: LayoutObject, definition: PartDefinition, platform: Platform, base: number): LayoutObject {
  const box = orientedPlatformBox(platform.outline);
  const width = Math.round(box.width);
  const depth = Math.round(box.depth);
  const height = snapParameter(definition, 'H', platform.elevation - base);
  const match = deckVariant(definition, width, depth);
  const sized = heightValues(object, definition, height);
  const values = match ? sized : { ...(sized ?? {}), BO: width, TO: depth };
  const { values: _previous, ...rest } = object;
  const next: LayoutObject = {
    ...rest,
    variant: match?.key ?? object.variant ?? '2x1',
    ...(values && Object.keys(values).length ? { values } : {}),
    x: tidy(box.x),
    y: tidy(box.y),
    rotation: wrapRotation(box.rotation + (match?.turn ?? 0)),
  };
  return samePiece(object, next) ? object : next;
}

function resizeObject(object: LayoutObject, definition: PartDefinition, resized: VenueGeometry, base: number): LayoutObject | LayoutObject[] {
  const role = roleOf(definition.id);
  if (role === 'wall') {
    const wall = resized.walls?.find(item => item.id === object.id);
    if (!wall) return object;
    const values = {
      ...(object.values ?? {}),
      B: snapParameter(definition, 'B', wall.width),
      H: snapParameter(definition, 'H', wall.height),
      D: snapParameter(definition, 'D', wall.thickness),
    };
    const next = { ...object, x: tidy(wall.x), y: tidy(wall.y), values };
    return samePiece(object, next) ? object : next;
  }
  const platform = resized.platforms?.find(item => item.id === object.id);
  if (!platform || (role !== 'deck' && role !== 'boxPlatform')) return object;
  if (role === 'deck') return podiumDeck(object, definition, platform, base);
  const box = orientedPlatformBox(platform.outline);
  const next = {
    ...object,
    x: tidy(box.x), y: tidy(box.y), rotation: wrapRotation(box.rotation),
    values: {
      ...(object.values ?? {}),
      B: snapParameter(definition, 'B', box.width),
      T: snapParameter(definition, 'T', box.depth),
      H: snapParameter(definition, 'H', platform.elevation - base),
    },
  };
  return samePiece(object, next) ? object : next;
}

/** Write face-drag results back onto scene parts. Spielstätte geometry in `resized` is ignored. */
export function resizedScene(layout: Layout, resized: VenueGeometry, index?: LayoutPartIndex): Layout {
  if (!index) return layout;
  const byId = new Map(layout.objects.map(object => [object.id, object]));
  const added = new Map<string, string[]>();
  let changed = false;
  const objects: LayoutObject[] = [];
  for (const object of layout.objects) {
    const definition = index.part(object.part);
    if (!definition || !roleOf(definition.id)) {
      objects.push(object);
      continue;
    }
    const next = resizeObject(object, definition, resized, supportBase(object, byId, index));
    const pieces = Array.isArray(next) ? next : [next];
    if (pieces.length !== 1 || pieces[0] !== object) changed = true;
    if (pieces.length > 1) added.set(object.id, pieces.slice(1).map(item => item.id));
    objects.push(...pieces);
  }
  if (!changed) return layout;
  const groups = layout.groups?.map(group => {
    const extra = group.members.flatMap(member => added.get(member.id) ?? []);
    if (!extra.length) return group;
    const members = [...group.members, ...extra.map(id => ({ kind: 'object' as const, id }))];
    return members.length > 250 ? group : { ...group, members };
  });
  const candidate = { ...layout, objects, ...(groups ? { groups } : {}) };
  return layoutSchema.safeParse(candidate).success ? candidate : layout;
}
