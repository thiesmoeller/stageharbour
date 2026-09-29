import type { Ballast } from './ballast.js';
/** Cross-section of 40×40 mm stock used for Stützdreieck members. */
export const BRACE_TIMBER_MM = 40;

type Vec3 = { x: number; y: number; z: number };
type BracePose = {
  ballast?: Ballast;
  id: string; label: string;
  x: number; y: number; rotation: number;
  footprintWidth: number; footprintDepth: number; height: number;
};

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
  ballast: BallastBox[];
};

// Millimetres, centre anchor, +x audience-right, +y away from the audience.
// The tall (wall-side) face is the local -Y edge of the rectangular footprint.
export function braceCorners(brace: Pick<BracePose, 'x' | 'y' | 'rotation' | 'footprintWidth' | 'footprintDepth' | 'ballast'>): { x: number; y: number }[] {
  const angle = brace.rotation * Math.PI / 180;
  const bounds = braceBounds(brace);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x = 0, y = 0]) => {
    const dx = x < 0 ? bounds.minX : bounds.maxX;
    const dy = y < 0 ? bounds.minZ : bounds.maxZ;
    return { x: brace.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: brace.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  });
}

/**
 * Right-triangle frame from 40×40 stock: wall stile = height, floor rail = depth,
 * hypotenuse between their free ends. Coordinates are brace-local (origin at footprint
 * centre on the supporting surface); StageBraces applies world pose.
 */
export function braceMembers(brace: Pick<BracePose, 'footprintWidth' | 'footprintDepth' | 'height'>): BraceMember[] {
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

export function braceSolid(brace: BracePose, elevation = 0): BraceSolid {
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
    ballast: braceBallast(brace),
  };
}

export type BallastBox = { kind: 'slab' | 'strap' | 'buckle'; center: Vec3; size: Vec3; rotation: Vec3 };
type BallastPose = Pick<BracePose, 'footprintWidth' | 'footprintDepth' | 'ballast'>;
/** Simple boxes in brace-local millimetres; concrete dimensions never scale with the timber. */
export function braceBallast(brace: BallastPose): BallastBox[] {
  const mode = brace.ballast?.mode;
  if (!mode || mode === 'none') return [];
  const box = (kind: BallastBox['kind'], x: number, y: number, z: number, sx: number, sy: number, sz: number, rz = 0): BallastBox =>
    ({ kind, center: { x, y, z }, size: { x: sx, y: sy, z: sz }, rotation: { x: 0, y: 0, z: rz } });
  if (brace.ballast?.mode === 'single') {
    const sign = brace.ballast.side === 'right' ? 1 : -1;
    const angle = Math.asin(BRACE_TIMBER_MM / 400);
    // Lower face spans from rail top at its inner edge to the supporting floor at its outer edge.
    return [box('slab', sign * (brace.footprintWidth / 2 + 200 * Math.cos(angle) - 25 * Math.sin(angle)),
      20 + 25 * Math.cos(angle), 0, 400, 50, 400, -sign * angle)];
  }
  const offset = brace.footprintWidth / 2 + 15;
  const outer = offset + 25;
  return [
    ...[-1, 1].map(sign => box('slab', sign * offset, 240, 0, 50, 400, 400)),
    box('strap', 0, 443, 0, outer * 2 + 6, 6, 25),
    box('strap', 0, 37, 0, outer * 2 + 6, 6, 25),
    ...[-1, 1].map(sign => box('strap', sign * (outer + 3), 240, 0, 6, 412, 25)),
    box('buckle', outer + 9, 275, 0, 12, 40, 35),
  ];
}
export function ballastBoxBounds(box: BallastBox) {
  const halfX = (Math.abs(Math.cos(box.rotation.z)) * box.size.x + Math.abs(Math.sin(box.rotation.z)) * box.size.y) / 2;
  return { minX: box.center.x - halfX, maxX: box.center.x + halfX, minZ: box.center.z - box.size.z / 2, maxZ: box.center.z + box.size.z / 2 };
}
export function braceBounds(brace: BallastPose) {
  return braceBallast(brace).reduce((bounds, box) => {
    const b = ballastBoxBounds(box);
    return { minX: Math.min(bounds.minX, b.minX), maxX: Math.max(bounds.maxX, b.maxX), minZ: Math.min(bounds.minZ, b.minZ), maxZ: Math.max(bounds.maxZ, b.maxZ) };
  }, { minX: -brace.footprintWidth / 2, maxX: brace.footprintWidth / 2, minZ: -brace.footprintDepth / 2, maxZ: brace.footprintDepth / 2 });
}

/** Project slab boxes into world plan coordinates for the frozen drawing. */
export function braceSlabFootprints(brace: Pick<BracePose, 'x' | 'y' | 'rotation' | 'footprintWidth' | 'footprintDepth' | 'ballast'>) {
  const angle = brace.rotation * Math.PI / 180;
  return braceBallast(brace).filter(part => part.kind === 'slab').map(part => {
    const b = ballastBoxBounds(part);
    return [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]].map(([x = 0, y = 0]) =>
      ({ x: brace.x + x * Math.cos(angle) - y * Math.sin(angle), y: brace.y + x * Math.sin(angle) + y * Math.cos(angle) })) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  });
}
