import type { Brace } from './layout.js';
import { BRACE_TIMBER_MM } from './layout.js';

type Vec3 = { x: number; y: number; z: number };

/** One 40×40 timber of the wall/floor/diagonal triangle, in brace-local millimetres. */
export type BraceMember = {
  kind: 'wall' | 'floor' | 'diagonal';
  /** Local centre: +X width, +Y up, +Z toward the floor tip (away from the wall face). */
  center: Vec3;
  size: Vec3;
  /** Local Euler radians; box is authored along +Y before rotation. */
  rotation: Vec3;
};

export type BraceSolid = {
  id: string; label: string;
  size: Vec3; center: Vec3; rotationY: number;
  footprint: Vec3[]; ridge: [Vec3, Vec3];
  members: BraceMember[];
};

// Millimetres, centre anchor, +x audience-right, +y away from the audience.
// The tall (wall-side) face is the local -Y edge of the rectangular footprint.
export function braceCorners(brace: Pick<Brace, 'x' | 'y' | 'rotation' | 'footprintWidth' | 'footprintDepth'>): { x: number; y: number }[] {
  const angle = brace.rotation * Math.PI / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x = 0, y = 0]) => {
    const dx = x * brace.footprintWidth / 2;
    const dy = y * brace.footprintDepth / 2;
    return { x: brace.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: brace.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  });
}

/**
 * Right-triangle frame from 40×40 stock: wall stile = height, floor rail = depth,
 * hypotenuse between their free ends. Coordinates are brace-local (origin at footprint
 * centre on the supporting surface); StageBraces applies world pose.
 */
export function braceMembers(brace: Pick<Brace, 'footprintWidth' | 'footprintDepth' | 'height'>): BraceMember[] {
  const timber = BRACE_TIMBER_MM;
  const width = brace.footprintWidth;
  const depth = brace.footprintDepth;
  const height = brace.height;
  const wallZ = -depth / 2 + timber / 2;
  const tipZ = depth / 2 - timber / 2;
  const floorY = timber / 2;
  const topY = height - timber / 2;
  const diagonalLength = Math.hypot(tipZ - wallZ, topY - floorY);
  const pitch = Math.atan2(tipZ - wallZ, topY - floorY);
  return [
    {
      kind: 'wall',
      center: { x: 0, y: height / 2, z: wallZ },
      size: { x: width, y: height, z: timber },
      rotation: { x: 0, y: 0, z: 0 },
    },
    {
      kind: 'floor',
      center: { x: 0, y: floorY, z: 0 },
      size: { x: width, y: timber, z: depth },
      rotation: { x: 0, y: 0, z: 0 },
    },
    {
      kind: 'diagonal',
      center: { x: 0, y: (floorY + topY) / 2, z: (wallZ + tipZ) / 2 },
      size: { x: width, y: diagonalLength, z: timber },
      // Box along +Y; negative pitch leans the top toward the floor tip (+Z).
      rotation: { x: -pitch, y: 0, z: 0 },
    },
  ];
}

export function braceSolid(brace: Brace, elevation = 0): BraceSolid {
  const rotationY = -brace.rotation * Math.PI / 180;
  const [a, b, c, d] = braceCorners(brace);
  if (!a || !b || !c || !d) throw new Error('Brace footprint must resolve to four corners.');
  const footprint = [a, b, c, d].map(point => ({ x: point.x, y: elevation, z: point.y }));
  return {
    id: brace.id, label: brace.label,
    size: { x: brace.footprintWidth, y: brace.height, z: brace.footprintDepth },
    center: { x: brace.x, y: elevation + brace.height / 2, z: brace.y },
    rotationY,
    footprint,
    ridge: [{ x: a.x, y: elevation + brace.height, z: a.y }, { x: b.x, y: elevation + brace.height, z: b.y }],
    members: braceMembers(brace),
  };
}
