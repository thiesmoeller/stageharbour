import { AXIS_VECTORS, type AxisName } from '../../../shared/parts/inference.js';
import { add, cross, normalize, scale, type Vec3 } from '../../../shared/parts/math.js';
import { PART_LIMITS } from '../../../shared/parts/definition.js';

/** In-plane u axis for an axis-aligned drawing normal (same basis as Rechteck / Kreis). */
export function planeAxes(normal: Vec3): Vec3 {
  const n = normalize(normal);
  if (Math.abs(n.x) > 0.9) return { x: 0, y: 0, z: 1 };
  return { x: 1, y: 0, z: 0 };
}

/**
 * SketchUp arrow-key plane lock while drawing: Right = red/X, Left = blue/Z, Up = green/Y.
 * Locked axis becomes the plane normal, so Right/Left erect a rectangle into the air.
 */
export function axisFromArrowKey(key: string): AxisName | undefined {
  if (key === 'ArrowRight') return 'x';
  if (key === 'ArrowLeft') return 'z';
  if (key === 'ArrowUp') return 'y';
  return undefined;
}

/** Unit normal for a locked drawing plane (Y-up stage). */
export function drawingPlaneNormal(axis: AxisName): Vec3 {
  return AXIS_VECTORS[axis];
}

const PLANE_LOCK_LABEL: Readonly<Record<AxisName, string>> = {
  x: 'senkrecht (rote Achse)',
  y: 'waagrecht (grüne Achse)',
  z: 'senkrecht (blaue Achse)',
};

export function drawingPlaneLockLabel(axis: AxisName): string {
  return PLANE_LOCK_LABEL[axis];
}

/**
 * SketchUp-style regular n-gon vertices in the plane through `centre` with `normal`.
 * The first vertex lies along the plane's `u` axis; sides are clamped to 3…`PART_LIMITS.polygonPoints`.
 */
export function regularPolygonPoints(centre: Vec3, radius: number, sides: number, normal: Vec3): Vec3[] {
  const n = normalize(normal);
  const u = planeAxes(n);
  const v = cross(n, u);
  const count = Math.max(3, Math.min(PART_LIMITS.polygonPoints, Math.round(sides)));
  const points: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const angle = 2 * Math.PI * i / count;
    points.push(add(centre, add(scale(u, radius * Math.cos(angle)), scale(v, radius * Math.sin(angle)))));
  }
  return points;
}

/** Overlay ring for a circle draft (display only — the tool stores `shape: 'circle'`). */
export function circlePreviewPoints(centre: Vec3, radius: number, normal: Vec3, segments = 48): Vec3[] {
  return [...regularPolygonPoints(centre, radius, segments, normal), add(centre, scale(planeAxes(normalize(normal)), radius))];
}

/**
 * Lock a rectangle to a square when Shift is held or both extents match within `tolerance` mm.
 * Extents keep their signs; the larger absolute side wins.
 */
export function squareLockedExtents(
  du: number,
  dv: number,
  options: { shift: boolean; tolerance: number },
): { along: number; across: number; square: boolean } {
  const equal = Math.abs(Math.abs(du) - Math.abs(dv)) <= options.tolerance;
  const square = options.shift || equal;
  if (!square) return { along: du, across: dv, square: false };
  const side = Math.max(Math.abs(du), Math.abs(dv));
  return {
    along: (Math.sign(du) || 1) * side,
    across: (Math.sign(dv) || 1) * side,
    square: true,
  };
}

/** Whether a typed Maße value is a valid Vieleck side count. */
export function isPolygonSideCount(value: number): boolean {
  return Number.isInteger(value) && value >= 3 && value <= PART_LIMITS.polygonPoints;
}
