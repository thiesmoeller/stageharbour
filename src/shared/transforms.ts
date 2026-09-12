import { braceSolid, type BraceSolid } from './braceTransforms.js';
import { type Layout, type VenueGeometry, type Wall } from './layout.js';
import { AUDIENCE_FLOOR_ID, stairRise, stairSteps, supportingSurfaces, surfaceElevation, type Platform, type StairUnit } from './levels.js';
import { placeholderSolid, type PlaceholderSolid } from './placeholders.js';
import { resolveWall, type Opening } from './wall-types.js';

export type Vec3 = { x: number; y: number; z: number };
export type WallSolid = {
  id: string; label: string;
  size: Vec3; center: Vec3; rotationY: number;
  corners: Vec3[]; frontNormal: Vec3;
  openings: Opening[];
};
export type StairSolid = { id: string; label: string; rise: number; steps: ReturnType<typeof stairSteps> };
export type StageModel = {
  floor: { width: number; depth: number };
  walls: WallSolid[];
  braces: BraceSolid[];
  placeholders: PlaceholderSolid[];
  platforms: Platform[];
  stairs: StairSolid[];
  audience: { position: Vec3; target: Vec3 };
  orbitTarget: Vec3;
};

// Millimetre 3D: +X audience-right, +Y up, +Z away from the audience.
// rotationY is Three.js Y-up yaw and equals -planRotation (radians).
export function wallSolid(wall: Wall & { openings?: Opening[] }, elevation = 0): WallSolid {
  const rotationY = -wall.rotation * Math.PI / 180;
  const center = { x: wall.x, y: elevation + wall.height / 2, z: wall.y };
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

export function stageModel(layout: Layout, venue: Pick<VenueGeometry, 'width' | 'depth' | 'outline' | 'platforms' | 'stairs' | 'walls' | 'wallTypes'>): StageModel {
  const types = layout.wallTypes ?? [];
  const surfaces = supportingSurfaces(venue, layout);
  const stairs: StairUnit[] = [...venue.stairs ?? [], ...layout.stairs ?? []];
  return {
    floor: { width: venue.width, depth: venue.depth },
    walls: [...(venue.walls ?? []).map(wall => wallSolid(resolveWall(wall, venue.wallTypes ?? []), surfaceElevation(surfaces, wall.supportingSurfaceId))), ...layout.walls.map(wall => wallSolid(resolveWall(wall, types), surfaceElevation(surfaces, wall.supportingSurfaceId)))],
    braces: (layout.braces ?? []).map(brace => braceSolid(brace, surfaceElevation(surfaces, brace.supportingSurfaceId))),
    placeholders: (layout.placeholders ?? []).map(item => placeholderSolid(item, surfaceElevation(surfaces, item.supportingSurfaceId))),
    platforms: surfaces.filter(surface => surface.id !== AUDIENCE_FLOOR_ID),
    stairs: stairs.map(stair => ({ id: stair.id, label: stair.label, rise: stairRise(stair, surfaces), steps: stairSteps(stair, surfaces) })),
    audience: { position: { x: venue.width / 2, y: 1600, z: -2000 }, target: { x: venue.width / 2, y: 1200, z: venue.depth / 2 } },
    orbitTarget: { x: venue.width / 2, y: 0, z: venue.depth / 2 },
  };
}
