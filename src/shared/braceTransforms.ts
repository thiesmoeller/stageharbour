import type { Brace } from './layout.js';

type Vec3 = { x: number; y: number; z: number };

export type BraceSolid = {
  id: string; label: string;
  size: Vec3; center: Vec3; rotationY: number;
  footprint: Vec3[]; ridge: [Vec3, Vec3];
};

// Millimetres, centre anchor, +x audience-right, +y away from the audience.
// The tall (wall-side) face is the local -Y edge of the rectangular footprint.
export function braceCorners(brace: Brace): { x: number; y: number }[] {
  const angle = brace.rotation * Math.PI / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x = 0, y = 0]) => {
    const dx = x * brace.footprintWidth / 2;
    const dy = y * brace.footprintDepth / 2;
    return { x: brace.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: brace.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  });
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
  };
}
