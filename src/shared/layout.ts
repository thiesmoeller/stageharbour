import { z } from 'zod';
import { leaseHolderSchema } from './leases.js';
import { AUDIENCE_FLOOR_ID, platformSchema, stairSchema, uniqueLevelIds } from './levels.js';
import { type Opening, wallTypeSchema } from './wall-types.js';
import { cableRoutingCorridorsSchema, connectionPointsSchema } from './infrastructure.js';
import { venueOutlineSchema, venueTraceSchema } from './venue.js';
import { panelConnectionSchema } from './assembly.js';
import { groupSchema, groupsReferenceLayout } from './groups.js';

const name = z.string().trim().min(1).max(120);
const dimension = z.number().finite().min(1).max(100000);
const coordinate = z.number().finite().min(-100000).max(100000);
export const wallSchema = z.strictObject({
  id: z.uuid(), label: name,
  x: coordinate, y: coordinate,
  rotation: z.number().finite().min(-360).max(360),
  width: dimension, height: dimension, thickness: dimension,
  typeId: z.uuid().optional(),
  panelId: z.uuid().optional(),
  supportingSurfaceId: z.uuid().optional(),
  assemblyNumber: z.number().int().positive().max(250).optional(),
});
export type Wall = z.infer<typeof wallSchema>;
// Example-only millimetre placeholders for a new weighted rear brace. Not measured inventory.
export const EXAMPLE_BRACE_FOOTPRINT_WIDTH = 600;
export const EXAMPLE_BRACE_FOOTPRINT_DEPTH = 800;
export const EXAMPLE_BRACE_HEIGHT = 1800;
export const braceSchema = z.strictObject({
  id: z.uuid(), label: name,
  x: coordinate, y: coordinate,
  rotation: z.number().finite().min(-360).max(360),
  footprintWidth: dimension, footprintDepth: dimension, height: dimension,
  supportingSurfaceId: z.uuid().optional(),
});
export type Brace = z.infer<typeof braceSchema>;
export const layoutSchema = z.strictObject({
  schemaVersion: z.literal(1),
  wallTypes: z.array(wallTypeSchema).max(250).refine(
    types => new Set(types.map(type => type.id)).size === types.length, 'Wall type IDs must be unique',
  ).optional(),
  walls: z.array(wallSchema).max(250).refine(walls => new Set(walls.map(wall => wall.id)).size === walls.length, 'Wall IDs must be unique'),
  braces: z.array(braceSchema).max(250).default([]).refine(braces => new Set(braces.map(brace => brace.id)).size === braces.length, 'Brace IDs must be unique'),
  platforms: z.array(platformSchema).max(250).optional(),
  stairs: z.array(stairSchema).max(250).optional(),
  connections: z.array(panelConnectionSchema).max(250).optional(),
  groups: z.array(groupSchema).max(250).optional(),
  riggingNotes: z.string().max(2000).optional(),
}).refine(layout => {
  const ids = new Set((layout.wallTypes ?? []).map(type => type.id));
  return layout.walls.every(wall => !wall.typeId || ids.has(wall.typeId));
}, 'Walls must reference a defined wall type').refine(
  layout => uniqueLevelIds(layout.platforms ?? [], layout.stairs ?? []), 'Platform and stair IDs must be unique',
).refine(layout => {
  const ids = new Set(layout.walls.map(wall => wall.id));
  return (layout.connections ?? []).every(connection => ids.has(connection.a) && ids.has(connection.b));
}, 'Connections must reference walls in the layout').refine(layout => {
  const numbers = layout.walls.flatMap(wall => wall.assemblyNumber == null ? [] : [wall.assemblyNumber]);
  return new Set(numbers).size === numbers.length;
}, 'Assembly numbers must be unique').refine(layout => {
  const pairs = (layout.connections ?? []).map(connection => connection.a < connection.b ? `${connection.a}:${connection.b}` : `${connection.b}:${connection.a}`);
  return new Set(pairs).size === pairs.length;
}, 'Connection pairs must be unique').refine(layout => groupsReferenceLayout(layout), 'Groups must reference unique layout members');
export type Layout = z.infer<typeof layoutSchema>;
export const venueGeometrySchema = z.strictObject({
  schemaVersion: z.literal(1), width: dimension, depth: dimension,
  outline: venueOutlineSchema.optional(), trace: venueTraceSchema.optional(),
  connectionPoints: connectionPointsSchema.optional(),
  cableRoutingCorridors: cableRoutingCorridorsSchema.optional(),
  platforms: z.array(platformSchema).max(250).optional(),
  stairs: z.array(stairSchema).max(250).optional(),
}).refine(venue => uniqueLevelIds(venue.platforms ?? [], venue.stairs ?? []), 'Platform and stair IDs must be unique');
export type VenueGeometry = z.infer<typeof venueGeometrySchema>;
export const saveVenueSchema = z.strictObject({ venue: venueGeometrySchema });
export const createSceneSchema = z.strictObject({
  productionName: name, venueName: name, sceneName: name,
  width: dimension, depth: dimension,
});
export const sceneSummarySchema = z.object({ id: z.uuid(), name, productionName: name, venueName: name, lease: leaseHolderSchema.nullable() });
export const sceneSchema = sceneSummarySchema.extend({
  revision: z.number().int().nonnegative(),
  venueVersionId: z.uuid(),
  venue: venueGeometrySchema,
  layout: layoutSchema,
});
export type Scene = z.infer<typeof sceneSchema>;
export const sceneListSchema = z.array(sceneSummarySchema);
export const saveLayoutSchema = z.strictObject({ revision: z.number().int().nonnegative(), layout: layoutSchema });

export function newWall(id: string, x: number, y: number): Wall {
  return { id, label: 'Wand', x, y, rotation: 0, width: 1200, height: 2400, thickness: 28, supportingSurfaceId: AUDIENCE_FLOOR_ID };
}
export function newBrace(id: string, x: number, y: number): Brace {
  return {
    id, label: 'Stütze', x, y, rotation: 0,
    footprintWidth: EXAMPLE_BRACE_FOOTPRINT_WIDTH,
    footprintDepth: EXAMPLE_BRACE_FOOTPRINT_DEPTH,
    height: EXAMPLE_BRACE_HEIGHT,
    supportingSurfaceId: AUDIENCE_FLOOR_ID,
  };
}

function planPoint(wall: Pick<Wall, 'x' | 'y' | 'rotation'>, dx: number, dy: number) {
  const angle = wall.rotation * Math.PI / 180;
  return { x: wall.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: wall.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

// Millimetres, centre anchor, +x audience-right, +y away from the audience.
// Positive rotation is counterclockwise in the plan's Cartesian coordinates.
export function wallCorners(wall: Pick<Wall, 'x' | 'y' | 'rotation' | 'width' | 'thickness'>): { x: number; y: number }[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x = 0, y = 0]) => planPoint(wall, x * wall.width / 2, y * wall.thickness / 2));
}

// Opening left is millimetres from the panel's left edge when facing the plywood front.
export function openingCorners(wall: Pick<Wall, 'x' | 'y' | 'rotation' | 'width' | 'thickness'>, opening: Pick<Opening, 'left' | 'width'>): { x: number; y: number }[] {
  const left = -wall.width / 2 + opening.left;
  return [[left, -1], [left + opening.width, -1], [left + opening.width, 1], [left, 1]].map(([x = 0, y = 0]) => planPoint(wall, x, y * wall.thickness / 2));
}
