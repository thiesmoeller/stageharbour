import { z } from 'zod';
import { panelConnectionSchema } from './assembly.js';
import { cableRunsSchema } from './infrastructure.js';
import {
  braceSchema, layoutSchema, venueFixtureStateSchema, wallSchema, type Joint, type Layout, type LayoutObject,
} from './layout.js';
import { lightLooksSchema } from './hangPlan.js';
import { stageLightingSchema } from './lighting.js';
import { platformSchema, stairSchema } from './levels.js';
import { measureLinesSchema } from './measurements.js';
import { playDimensionsSchema } from './dimensionSchema.js';
import { placeholdersSchema, type PlaceholderKind } from './placeholders.js';
import { reportTemplatesSchema } from './reportTemplate.js';
import { wallPicturesSchema } from './wallPictures.js';
import { wallTypeSchema, resolveWall, type Opening, type WallElementType } from './wall-types.js';
import { migrateWallSurfaces, type WallSurfaces } from './surfaces.js';
import { orientedPlatformBox, surfaceElevation } from './levels.js';
import { STARTER_PART_IDS, STARTER_WALL, type PartDefinition, type PartRef } from './parts/index.js';

const legacyMemberSchema = z.strictObject({
  kind: z.enum(['wall', 'brace', 'stair', 'placeholder']),
  id: z.uuid(),
});
const legacyGroupSchema = z.strictObject({
  id: z.uuid(),
  members: z.array(legacyMemberSchema).min(2).max(250),
  rotation: z.number().finite().min(-360).max(360),
});

/** The one schema accepted by the conversion boundary. It is never used for writes. */
export const layoutV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  wallTypes: z.array(wallTypeSchema).max(250).optional(),
  walls: z.array(wallSchema).max(250),
  braces: z.array(braceSchema).max(250).default([]),
  platforms: z.array(platformSchema).max(250).optional(),
  stairs: z.array(stairSchema).max(250).optional(),
  placeholders: placeholdersSchema.optional(),
  connections: z.array(panelConnectionSchema).max(250).optional(),
  groups: z.array(legacyGroupSchema).max(250).optional(),
  cableRuns: cableRunsSchema.optional(),
  measureLines: measureLinesSchema.optional(),
  dimensions: playDimensionsSchema.optional(),
  wallPictures: wallPicturesSchema.optional(),
  reportTemplates: reportTemplatesSchema.optional(),
  lighting: stageLightingSchema.optional(),
  lightLooks: lightLooksSchema.optional(),
  activeLightLookId: z.uuid().optional(),
  riggingNotes: z.string().max(2000).optional(),
  riggingSetupId: z.uuid().optional(),
  venueFixtureState: venueFixtureStateSchema.optional(),
});
export type LayoutV1 = z.infer<typeof layoutV1Schema>;

export type MigratedWallPart = {
  part: PartRef;
  variant?: string;
  values?: Record<string, number>;
};

/**
 * Catalog seam used during one-time conversion. Installations may map an old workspace wall type
 * to a group-owned part; otherwise the stable starter Wandelement is used.
 */
export type LayoutMigrationPartIndex = {
  part(ref: PartRef): PartDefinition | undefined;
  wallPart?(type: WallElementType): MigratedWallPart | undefined;
};

const ref = (id: string): PartRef => ({ id, revision: 1 });

function wallVariant(type: Pick<WallElementType, 'name' | 'width' | 'thickness' | 'openings'>): string {
  const opening = type.openings[0];
  if (type.name === 'Halbe Wand' || (!opening && type.width <= 600 && type.thickness >= 200)) return 'half';
  if (opening?.profile === 'arch' || type.name === 'Bogen') return 'arch';
  if (opening?.hinge === 'left') return 'doorLeft';
  if (opening?.hinge === 'right') return 'doorRight';
  if (opening) return 'window';
  return 'plain';
}

function wallValues(type: Pick<WallElementType, 'width' | 'height' | 'thickness' | 'openings'>) {
  const opening = type.openings[0];
  return {
    B: type.width,
    H: type.height,
    D: type.thickness,
    ...(opening ? {
      openingLeft: opening.left,
      openingSill: Math.max(1, opening.sill),
      openingB: opening.width,
      openingH: opening.height,
    } : {}),
  };
}

function wallFinishes(surfaces: WallSurfaces | undefined): LayoutObject['finishes'] {
  if (!surfaces) return undefined;
  return {
    ...(surfaces.front ? { front: surfaces.front } : {}),
    ...(surfaces.back ? { back: surfaces.back } : {}),
    ...(surfaces.edge ? { edge: surfaces.edge } : {}),
  };
}

function doorOpening(openings: readonly Opening[]): Opening | undefined {
  return openings.find(opening => opening.hinge === 'left' || opening.hinge === 'right');
}

function ballastValue(ballast: z.infer<typeof braceSchema>['ballast']): number {
  if (!ballast || ballast.mode === 'none') return 0;
  if (ballast.mode === 'single') return 1;
  return 2;
}

const placeholderParts: Record<PlaceholderKind, string> = {
  table: STARTER_PART_IDS.table,
  chair: STARTER_PART_IDS.chair,
  person: STARTER_PART_IDS.person,
  speaker: STARTER_PART_IDS.speaker,
  box: STARTER_PART_IDS.box,
};

function platformHeight(
  platform: z.infer<typeof platformSchema>,
  all: readonly z.infer<typeof platformSchema>[],
): number {
  const base = platform.supportingSurfaceId
    ? surfaceElevation(all.map(item => ({ ...item })), platform.supportingSurfaceId)
    : 0;
  return Math.max(1, platform.elevation - base);
}

function endpointFor(
  wallId: string,
  otherId: string,
  walls: ReadonlyMap<string, { x: number; y: number; rotation: number }>,
) {
  const wall = walls.get(wallId), other = walls.get(otherId);
  if (!wall || !other) return 'rechts';
  const angle = wall.rotation * Math.PI / 180;
  const along = (other.x - wall.x) * Math.cos(angle) + (other.y - wall.y) * Math.sin(angle);
  return along < 0 ? 'links' : 'rechts';
}

/**
 * Convert one saved Bühnenbild. Object ids stay stable so dimensions, pictures and external links
 * survive; old wall-type ids deliberately disappear. The result is parsed by the v2 schema.
 */
export function layoutV1ToV2(input: LayoutV1, partIndex: LayoutMigrationPartIndex): Layout {
  const v1 = layoutV1Schema.parse(input);
  const types = new Map((v1.wallTypes ?? []).map(type => [type.id, type]));
  const walls = v1.walls.map(wall => {
    const resolved = resolveWall(wall, [...types.values()]);
    const type: WallElementType = {
      id: wall.typeId ?? wall.id,
      name: wall.label,
      width: resolved.width,
      height: resolved.height,
      thickness: resolved.thickness,
      openings: resolved.openings,
    };
    const mapped = wall.typeId ? partIndex.wallPart?.(types.get(wall.typeId) ?? type) : undefined;
    const variant = mapped?.variant ?? wallVariant(type);
    const values = { ...wallValues(type), ...(mapped?.values ?? {}) };
    const migrated = migrateWallSurfaces(wall);
    const open = doorOpening(resolved.openings);
    return {
      id: wall.id,
      label: wall.label,
      part: mapped?.part ?? ref(STARTER_WALL.id),
      variant,
      values,
      ...(open || wall.doorOpenPercent !== undefined ? { state: { open: wall.doorOpenPercent ?? 0 } } : {}),
      x: wall.x,
      y: wall.y,
      rotation: wall.rotation,
      ...(wall.supportingSurfaceId ? { support: wall.supportingSurfaceId } : {}),
      ...(wall.panelId ? { stockItemId: wall.panelId } : {}),
      ...(wallFinishes(migrated.surfaces) ? { finishes: wallFinishes(migrated.surfaces) } : {}),
      ...(wall.assemblyNumber !== undefined ? { assemblyNumber: wall.assemblyNumber } : {}),
    } satisfies LayoutObject;
  });

  const platforms = v1.platforms ?? [];
  const platformObjects: LayoutObject[] = platforms.map(platform => {
    const box = orientedPlatformBox(platform.outline);
    const style = platform.style ?? 'floating';
    const partId = style === 'stageDeck'
      ? STARTER_PART_IDS.deck
      : style === 'solid' ? STARTER_PART_IDS.solidPlatform : STARTER_PART_IDS.floatingPlatform;
    const height = platformHeight(platform, platforms);
    const deckVariant = style === 'stageDeck'
      ? (box.width === 2000 && box.depth === 500 ? '2x05'
        : box.width === 1000 && box.depth === 1000 ? '1x1'
          : box.width === 1000 && box.depth === 500 ? '1x05' : '2x1')
      : undefined;
    const values: Record<string, number> = style === 'stageDeck'
      ? { HO: height, BO: Math.round(box.width), TO: Math.round(box.depth) }
      : { B: box.width, T: box.depth, H: height };
    return {
      id: platform.id,
      label: platform.label,
      part: ref(partId),
      ...(deckVariant ? { variant: deckVariant } : {}),
      values,
      x: box.x,
      y: box.y,
      rotation: box.rotation,
      ...(platform.supportingSurfaceId ? { support: platform.supportingSurfaceId } : {}),
      ...(platform.surfaces ? {
        finishes: {
          ...(platform.surfaces.top ? { top: platform.surfaces.top } : {}),
          ...(platform.surfaces.sides ? { sides: platform.surfaces.sides } : {}),
        },
      } : {}),
    };
  });

  const elevation = new Map(platforms.map(platform => [platform.id, platform.elevation]));
  const stairObjects: LayoutObject[] = (v1.stairs ?? []).map(stair => ({
    id: stair.id,
    label: stair.label,
    part: ref(STARTER_PART_IDS.stair),
    values: {
      B: stair.width,
      T: stair.run,
      H: Math.abs((elevation.get(stair.upperSurfaceId) ?? 0) - (elevation.get(stair.lowerSurfaceId) ?? 0)),
      R: stair.riserHeight,
    },
    x: stair.x,
    y: stair.y,
    rotation: stair.rotation,
    support: stair.lowerSurfaceId,
  }));

  const objects: LayoutObject[] = [
    ...walls,
    ...v1.braces.map(brace => ({
      id: brace.id,
      label: brace.label,
      part: ref(STARTER_PART_IDS.brace),
      values: {
        B: brace.footprintWidth,
        TO: brace.footprintDepth,
        HO: brace.height,
        ballast: ballastValue(brace.ballast),
      },
      x: brace.x,
      y: brace.y,
      rotation: brace.rotation,
      ...(brace.supportingSurfaceId ? { support: brace.supportingSurfaceId } : {}),
    })),
    ...platformObjects,
    ...stairObjects,
    ...(v1.placeholders ?? []).map(item => ({
      id: item.id,
      label: item.label,
      part: ref(placeholderParts[item.kind]),
      values: { B: item.width, T: item.depth, H: item.height },
      ...(item.kind === 'chair' && item.seatedFigure ? { state: { seated: 1 } } : {}),
      x: item.x,
      y: item.y,
      rotation: item.rotation,
      ...(item.supportingSurfaceId ? { support: item.supportingSurfaceId } : {}),
    })),
  ];

  const wallPoses = new Map(v1.walls.map(wall => [wall.id, wall]));
  const joints: Joint[] = (v1.connections ?? []).map(connection => ({
    id: connection.id,
    a: { object: connection.a, connector: endpointFor(connection.a, connection.b, wallPoses) },
    b: { object: connection.b, connector: endpointFor(connection.b, connection.a, wallPoses) },
  }));
  const {
    schemaVersion: _schemaVersion,
    wallTypes: _wallTypes,
    walls: _walls,
    braces: _braces,
    platforms: _platforms,
    stairs: _stairs,
    placeholders: _placeholders,
    connections: _connections,
    groups: legacyGroups,
    reportTemplates: _reportTemplates,
    ...features
  } = v1;
  return layoutSchema.parse({
    ...features,
    schemaVersion: 2,
    objects,
    joints,
    ...(legacyGroups ? {
      groups: legacyGroups.map(group => ({
        ...group,
        members: group.members.map(member => ({ kind: 'object' as const, id: member.id })),
      })),
    } : {}),
  });
}

/** Parse a DB/local row and convert only the one obsolete schema version. */
export function migrateLayout(value: unknown, partIndex: LayoutMigrationPartIndex): Layout {
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version === 2) return layoutSchema.parse(value);
  if (version === 1) return layoutV1ToV2(layoutV1Schema.parse(value), partIndex);
  return layoutSchema.parse(value);
}
