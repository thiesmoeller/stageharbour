import { type Layout, type Wall } from './layout.js';
import { resolveWall, type Opening } from './wall-types.js';

export type Vec3 = { x: number; y: number; z: number };
export type WallSolid = {
  id: string; label: string;
  size: Vec3; center: Vec3; rotationY: number;
  corners: Vec3[]; frontNormal: Vec3;
  openings: Opening[];
};
export type StageModel = {
  floor: { width: number; depth: number };
  walls: WallSolid[];
  audience: { position: Vec3; target: Vec3 };
  orbitTarget: Vec3;
};

// Millimetre 3D: +X audience-right, +Y up, +Z away from the audience.
// rotationY is Three.js Y-up yaw and equals -planRotation (radians).
export function wallSolid(wall: Wall & { openings?: Opening[] }): WallSolid {
  const rotationY = -wall.rotation * Math.PI / 180;
  const center = { x: wall.x, y: wall.height / 2, z: wall.y };
  const size = { x: wall.width, y: wall.height, z: wall.thickness };
  const cosine = Math.cos(rotationY), sine = Math.sin(rotationY);
  const corners = [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]].map(([lx = 0, ly = 0, lz = 0]) => {
    const x = lx * size.x / 2, y = ly * size.y / 2, z = lz * size.z / 2;
    return { x: center.x + x * cosine + z * sine, y: center.y + y, z: center.z - x * sine + z * cosine };
  });
  const plan = wall.rotation * Math.PI / 180;
  return {
    id: wall.id, label: wall.label, size, center, rotationY, corners, openings: wall.openings ?? [],
    frontNormal: { x: Math.sin(plan), y: 0, z: -Math.cos(plan) },
  };
}

export function stageModel(layout: Layout, venue: { width: number; depth: number }): StageModel {
  const types = layout.wallTypes ?? [];
  return {
    floor: { width: venue.width, depth: venue.depth },
    walls: layout.walls.map(wall => wallSolid(resolveWall(wall, types))),
    audience: { position: { x: venue.width / 2, y: 1600, z: -2000 }, target: { x: venue.width / 2, y: 1200, z: venue.depth / 2 } },
    orbitTarget: { x: venue.width / 2, y: 0, z: venue.depth / 2 },
  };
}
