import type { WallSolid } from '../../shared/transforms.js';
import { openingFlushSides } from '../../shared/wallMeshGeometry.js';
import type { Opening } from '../../shared/wall-types.js';

/** Pure helpers for Ausschnitt pick-handle geometry (unit-tested without three.js). */
export function openingJambSolids(wall: Pick<WallSolid, 'size' | 'openings'>) {
  const solids: { key: string; args: [number, number, number] }[] = [];
  for (const opening of wall.openings) {
    const flush = openingFlushSides(opening, wall.size);
    if (!flush.left && opening.left > 1) solids.push({ key: `${opening.id}-L`, args: [opening.left, wall.size.y, wall.size.z] });
    if (!flush.right && wall.size.x - opening.left - opening.width > 1) {
      solids.push({ key: `${opening.id}-R`, args: [wall.size.x - opening.left - opening.width, wall.size.y, wall.size.z] });
    }
    if (!flush.bottom && opening.sill > 1) solids.push({ key: `${opening.id}-B`, args: [opening.width, opening.sill, wall.size.z] });
    if (!flush.top && wall.size.y - opening.sill - opening.height > 1) {
      solids.push({ key: `${opening.id}-T`, args: [opening.width, wall.size.y - opening.sill - opening.height, wall.size.z] });
    }
  }
  return solids;
}

export function openingEdgeHandles(opening: Opening, wallZ: number) {
  return (['left', 'right', 'bottom', 'top'] as const).map(edge => ({
    edge,
    pushPullKind: 'wallOpening' as const,
    openingId: opening.id,
    thickness: edge === 'left' || edge === 'right' ? 48 : opening.width,
    height: edge === 'top' || edge === 'bottom' ? 48 : opening.height,
    depth: wallZ + 16,
  }));
}
