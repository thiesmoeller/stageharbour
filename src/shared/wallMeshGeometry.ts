import { ExtrudeGeometry, Path, Shape } from 'three';
import type { Opening } from './wall-types.js';

/** Clockwise hole so Three.js cuts it out of a CCW outer contour. */
function openingHole(opening: Opening, hw: number, hh: number) {
  const hole = new Path();
  const x0 = -hw + opening.left, y0 = -hh + opening.sill;
  const x1 = x0 + opening.width, y1 = y0 + opening.height;
  hole.moveTo(x0, y0); hole.lineTo(x1, y0); hole.lineTo(x1, y1); hole.lineTo(x0, y1); hole.closePath();
  return hole;
}

/**
 * Build wall panel geometry (always ExtrudeGeometry so material slots stay stable
 * when openings are added or removed).
 */
export function buildWallPanelGeometry(size: { x: number; y: number; z: number }, openings: readonly Opening[] = []) {
  const shape = new Shape();
  const hw = size.x / 2, hh = size.y / 2;
  shape.moveTo(-hw, -hh); shape.lineTo(hw, -hh); shape.lineTo(hw, hh); shape.lineTo(-hw, hh); shape.closePath();
  for (const opening of openings) shape.holes.push(openingHole(opening, hw, hh));
  const geometry = new ExtrudeGeometry(shape, { depth: size.z, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -size.z / 2);
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  geometry.clearGroups();
  const triCount = index ? index.count : normal.count;
  for (let start = 0; start < triCount; start += 3) {
    const vertex = index ? index.getX(start) : start;
    const z = normal.getZ(vertex);
    geometry.addGroup(start, 3, z < -0.5 ? 1 : z > 0.5 ? 2 : 0);
  }
  return geometry;
}

/** How many index/vertex elements the material groups cover (for tests). */
export function wallGeometryGroupCoverage(geometry: ExtrudeGeometry) {
  const index = geometry.getIndex();
  const expected = index ? index.count : geometry.getAttribute('normal').count;
  const covered = geometry.groups.reduce((sum, group) => sum + group.count, 0);
  return { expected, covered, complete: covered === expected && expected > 0 };
}
