import { z } from 'zod';

const name = z.string().trim().min(1).max(120);
const dimension = z.number().finite().min(1).max(100000);
const alongPanel = z.number().finite().min(0).max(100000);
export const openingSchema = z.strictObject({
  id: z.uuid(),
  left: alongPanel, sill: alongPanel,
  width: dimension, height: dimension,
});
export type Opening = z.infer<typeof openingSchema>;
export const wallTypeSchema = z.strictObject({
  id: z.uuid(), name,
  width: dimension, height: dimension, thickness: dimension,
  openings: z.array(openingSchema).max(20).refine(
    openings => new Set(openings.map(opening => opening.id)).size === openings.length, 'Opening IDs must be unique',
  ),
}).refine(type => type.openings.every(opening =>
  opening.left + opening.width <= type.width && opening.sill + opening.height <= type.height
), 'Openings must lie inside the panel');
export type WallElementType = z.infer<typeof wallTypeSchema>;

export function newWallType(id: string): WallElementType {
  return { id, name: 'Wandtyp', width: 1200, height: 2400, thickness: 28, openings: [] };
}
export function newOpening(id: string): Opening {
  return { id, left: 200, sill: 0, width: 800, height: 2000 };
}

export type ResolvedWall = {
  id: string; label: string;
  x: number; y: number; rotation: number;
  width: number; height: number; thickness: number;
  typeId?: string; openings: Opening[];
};
export function resolveWall(wall: {
  id: string; label: string; x: number; y: number; rotation: number;
  width: number; height: number; thickness: number; typeId?: string;
}, types: WallElementType[]): ResolvedWall {
  const type = wall.typeId ? types.find(item => item.id === wall.typeId) : undefined;
  return { ...wall, width: type?.width ?? wall.width, height: type?.height ?? wall.height, thickness: type?.thickness ?? wall.thickness, openings: type?.openings ?? [] };
}
export function typesOf(layout: { wallTypes?: WallElementType[] }): WallElementType[] {
  return layout.wallTypes ?? [];
}
