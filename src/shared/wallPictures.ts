import { z } from 'zod';

const dimension = z.number().finite().min(1).max(100000);

/**
 * Image attached to a wall face (typically hung on fishing wire / Schnur).
 * Pose follows the host wall; heightAboveFloor is the bottom edge of the picture.
 */
export const wallPictureSchema = z.strictObject({
  id: z.uuid(),
  wallId: z.uuid(),
  face: z.enum(['front', 'back']).default('front'),
  assetId: z.uuid(),
  /** Offset along wall from left edge (mm). */
  along: z.number().finite().min(0).max(100000),
  heightAboveFloor: z.number().finite().min(0).max(100000),
  width: dimension,
  height: dimension,
  note: z.string().trim().max(200).optional(),
});
export type WallPicture = z.infer<typeof wallPictureSchema>;
export const wallPicturesSchema = z.array(wallPictureSchema).max(250)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Wall picture IDs must be unique');

export function newWallPicture(id: string, wallId: string, assetId: string, extras?: Partial<WallPicture>): WallPicture {
  return {
    id, wallId, assetId, face: extras?.face ?? 'front',
    along: extras?.along ?? 200,
    heightAboveFloor: extras?.heightAboveFloor ?? 1200,
    width: extras?.width ?? 600,
    height: extras?.height ?? 800,
    note: extras?.note ?? 'Auf Angelschnur',
  };
}
