import { applyTransform, boundsOf, quatFromAxisAngle, rotate, type Bounds3, type RigidTransform, type Vec2, type Vec3 } from './math.js';
import {
  solidVertices, transformConnector, transformSolid,
  type ResolvedConnector, type ResolvedFace, type ResolvedPart, type ResolvedSolid, type ResolvedSurface,
} from './resolve.js';

/**
 * Where a part stands in a Bühnenbild: plan millimetres (+x audience-right, +y away from the
 * audience), rotation in degrees counter-clockwise in the plan, and the height of the
 * supporting surface.
 */
export type PartPlacement = { x: number; y: number; rotation: number; elevation?: number };

/**
 * A resolved part in world space: +X audience-right, +Y up, +Z away from the audience,
 * so world x = plan x and world z = plan y.
 */
export type PlacedPart = {
  placement: Required<PartPlacement>;
  /** three.js yaw of the part in radians; equals minus the plan rotation. */
  rotationY: number;
  /** Part-local to world. */
  transform: RigidTransform;
  /** Plan polygon, same corner order as the resolved footprint. */
  footprint: Vec2[];
  bounds: Bounds3;
  solids: ResolvedSolid[];
  connectors: ResolvedConnector[];
  /** Plan polygons with absolute elevation. */
  surfaces: ResolvedSurface[];
  faces: ResolvedFace[];
};

/** A point of the part-local plan (x, y = part z) in the plan of the Bühnenbild. */
export function placePlanPoint(point: Vec2, placement: PartPlacement): Vec2 {
  const angle = placement.rotation * Math.PI / 180;
  return {
    x: placement.x + point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: placement.y + point.x * Math.sin(angle) + point.y * Math.cos(angle),
  };
}

export function placementRotationY(placement: Pick<PartPlacement, 'rotation'>): number {
  return -placement.rotation * Math.PI / 180;
}

/** Part-local to world transform of a placement. */
export function placementTransform(placement: PartPlacement): RigidTransform {
  return {
    rotation: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, placementRotationY(placement)),
    translation: { x: placement.x, y: placement.elevation ?? 0, z: placement.y },
  };
}

/** A part-local point in world space. */
export function placePoint(point: Vec3, placement: PartPlacement): Vec3 {
  const plan = placePlanPoint({ x: point.x, y: point.z }, placement);
  return { x: plan.x, y: (placement.elevation ?? 0) + point.y, z: plan.y };
}

/** Plan footprint of a placement without placing the solids. */
export function placeFootprint(resolved: Pick<ResolvedPart, 'footprint'>, placement: PartPlacement): Vec2[] {
  return resolved.footprint.map(point => placePlanPoint(point, placement));
}

/** Footprint, solids, connectors, surfaces and faces of a resolved part at a placement. */
export function placeResolvedPart(resolved: ResolvedPart, placement: PartPlacement): PlacedPart {
  const elevation = placement.elevation ?? 0;
  const transform = placementTransform(placement);
  const solids = resolved.solids.map(solid => transformSolid(solid, transform));
  const loop = (points: readonly Vec2[]) => points.map(point => placePlanPoint(point, placement));
  return {
    placement: { ...placement, elevation },
    rotationY: placementRotationY(placement),
    transform,
    footprint: placeFootprint(resolved, placement),
    bounds: boundsOf(solids.flatMap(solidVertices)),
    solids,
    connectors: resolved.connectors.map(connector => transformConnector(connector, transform)),
    surfaces: resolved.surfaces.map(surface => ({
      ...surface, outline: loop(surface.outline), holes: surface.holes.map(loop), elevation: surface.elevation + elevation,
    })),
    faces: resolved.faces.map(face => face.plane ? {
      ...face,
      plane: {
        ...face.plane,
        origin: applyTransform(transform, face.plane.origin),
        u: rotate(transform.rotation, face.plane.u),
        v: rotate(transform.rotation, face.plane.v),
        normal: rotate(transform.rotation, face.plane.normal),
      },
    } : face),
  };
}
