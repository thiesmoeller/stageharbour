export type Point = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

/**
 * Model-neutral oriented box in world millimetres. `rotation` is Euler XYZ in degrees (the Three.js
 * convention the editor renders with); +x audience-right, +y up, +z plan-y (away from the audience).
 * Comparison goes through the eight corner points, so any equivalent pose representation matches.
 */
export type NeutralBox = {
  part: string;
  center: Vec3;
  size: Vec3;
  rotation: Vec3;
};

export type NeutralSphere = { part: string; center: Vec3; radius: number };

export type NeutralPrism = { part: string; outline: Point[]; bottom: number; top: number };

export type NeutralFootprint = { kind: string; polygon: Point[] };
export type NeutralFootprints = Record<string, NeutralFootprint>;

export type NeutralElementSolids = {
  boxes: NeutralBox[];
  spheres?: NeutralSphere[];
  prisms?: NeutralPrism[];
};
export type NeutralSolids = Record<string, NeutralElementSolids>;

export type NeutralSurface = { id: string; outline: Point[]; elevation: number };
export type NeutralSurfaces = {
  surfaces: NeutralSurface[];
  elevations: Record<string, number>;
};

export type NeutralWarning = { family: string; kind: string; ids: string[]; message: string };

export type NeutralLists = Record<string, unknown>;
