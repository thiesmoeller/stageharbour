import { z } from 'zod';

const name = z.string().trim().min(1).max(120);
const dimension = z.number().finite().min(1).max(100000);
const coordinate = z.number().finite().min(-100000).max(100000);
export const wallSchema = z.strictObject({
  id: z.uuid(), label: name,
  x: coordinate, y: coordinate,
  rotation: z.number().finite().min(-360).max(360),
  width: dimension, height: dimension, thickness: dimension,
});
export type Wall = z.infer<typeof wallSchema>;
export const layoutSchema = z.strictObject({
  schemaVersion: z.literal(1),
  walls: z.array(wallSchema).max(250).refine(walls => new Set(walls.map(wall => wall.id)).size === walls.length, 'Wall IDs must be unique'),
});
export type Layout = z.infer<typeof layoutSchema>;
export const venueGeometrySchema = z.strictObject({ schemaVersion: z.literal(1), width: dimension, depth: dimension });
export const createSceneSchema = z.strictObject({
  productionName: name, venueName: name, sceneName: name,
  width: dimension, depth: dimension,
});
export const sceneSummarySchema = z.object({ id: z.uuid(), name, productionName: name, venueName: name });
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
  return { id, label: 'Wand', x, y, rotation: 0, width: 1200, height: 2400, thickness: 28 };
}

// Millimetres, centre anchor, +x audience-right, +y away from the audience.
// Positive rotation is counterclockwise in the plan's Cartesian coordinates.
export function wallCorners(wall: Wall): { x: number; y: number }[] {
  const angle = wall.rotation * Math.PI / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x = 0, y = 0]) => {
    const dx = x * wall.width / 2;
    const dy = y * wall.thickness / 2;
    return { x: wall.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: wall.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  });
}
