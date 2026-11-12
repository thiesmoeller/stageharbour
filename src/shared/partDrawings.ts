import type { ResolvedLayoutObject } from './layoutObjects.js';
import { add, convexHull, dot, quatAxes, scale, sub, type Vec2, type Vec3 } from './parts/math.js';
import { solidVertices, type ResolvedSheet } from './parts/resolve.js';

/**
 * Generic drawing primitives of placed parts. Painters (document studio, legacy PDF) only turn
 * these into strokes; nothing here knows a particular part.
 */

export type PlanStrokeKind = 'solid' | 'step' | 'opening' | 'leaf' | 'swing';
export type PlanStroke = { kind: PlanStrokeKind; points: Vec2[]; closed: boolean };

export type PlanSymbol = {
  objectId: string;
  label: string;
  /** Plan outline of the whole part. */
  footprint: Vec2[];
  centre: Vec2;
  elevation: number;
  /** Detail inside the footprint: projected solids, stair nosings, floor openings and door swings. */
  strokes: PlanStroke[];
};

const plan = (point: Vec3): Vec2 => ({ x: point.x, y: point.z });
const VERTICAL = 0.99;
/** Openings that start this close to the bottom of an upright sheet are walk-through gaps in the plan. */
const FLOOR_TOLERANCE_MM = 1;

export function polygonCentre(points: readonly Vec2[]): Vec2 {
  if (!points.length) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function arc(centre: Vec2, radius: number, from: number, to: number, segments = 12): Vec2[] {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = from + (to - from) * index / segments;
    return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
  });
}

type FloorOpening = { sheet: ResolvedSheet; start: number; end: number };

function uprightSheets(item: ResolvedLayoutObject): ResolvedSheet[] {
  return item.solids.filter((solid): solid is ResolvedSheet => solid.kind === 'sheet'
    && Math.abs(quatAxes(solid.rotation).y.y) > VERTICAL);
}

function floorOpenings(sheet: ResolvedSheet): FloorOpening[] {
  const bottom = Math.min(...sheet.outline.map(point => point.y));
  return sheet.openings
    .filter(opening => opening.bounds.y <= bottom + FLOOR_TOLERANCE_MM)
    .map(opening => ({ sheet, start: opening.bounds.x, end: opening.bounds.x + opening.bounds.width }));
}

function sheetPoint(sheet: ResolvedSheet, u: number, w: number): Vec2 {
  const axes = quatAxes(sheet.rotation);
  return plan(add(sheet.origin, add(scale(axes.x, u), scale(axes.z, w))));
}

/**
 * Plan symbol of a placed part. `footprint` draws the outline only, `solids` adds every solid
 * projected to the floor, `stair` adds the nosing lines of the steps. Floor-level cut-outs of
 * upright sheets show as gaps, and a hinge-edge connector of a child part beside such a gap
 * draws a quarter swing towards the front of the sheet.
 */
export function planSymbol(item: ResolvedLayoutObject): PlanSymbol {
  const strokes: PlanStroke[] = [];
  const mode = item.resolved.planSymbol;
  if (mode === 'solids' || mode === 'stair') {
    for (const solid of item.solids) {
      const hull = convexHull(solidVertices(solid).map(plan));
      if (hull.length >= 3) strokes.push({ kind: mode === 'stair' ? 'step' : 'solid', points: hull, closed: true });
    }
  }
  const openings = uprightSheets(item).flatMap(floorOpenings);
  for (const opening of openings) {
    strokes.push({
      kind: 'opening', closed: true,
      points: [
        sheetPoint(opening.sheet, opening.start, 0), sheetPoint(opening.sheet, opening.end, 0),
        sheetPoint(opening.sheet, opening.end, opening.sheet.thickness), sheetPoint(opening.sheet, opening.start, opening.sheet.thickness),
      ],
    });
  }
  for (const hinge of item.connectors) {
    if (hinge.kind !== 'hinge-edge' || !hinge.path.length || Math.abs(hinge.axis.y) < VERTICAL) continue;
    let best: { opening: FloorOpening; along: number; side: 1 | -1; distance: number } | undefined;
    for (const opening of openings) {
      const axes = quatAxes(opening.sheet.rotation);
      const along = dot(sub(hinge.position, opening.sheet.origin), axes.x);
      const toStart = Math.abs(along - opening.start);
      const toEnd = Math.abs(along - opening.end);
      const distance = Math.min(toStart, toEnd);
      if (best && best.distance <= distance) continue;
      best = { opening, along: toStart <= toEnd ? opening.start : opening.end, side: toStart <= toEnd ? 1 : -1, distance };
    }
    if (!best || best.distance > Math.max(50, best.opening.sheet.thickness * 3)) continue;
    const { sheet } = best.opening;
    const axes = quatAxes(sheet.rotation);
    const radius = best.opening.end - best.opening.start;
    const pivot = sheetPoint(sheet, best.along, 0);
    const closed = plan(scale(axes.x, best.side));
    const front = plan(scale(axes.z, -1));
    const from = Math.atan2(closed.y, closed.x);
    let to = Math.atan2(front.y, front.x);
    while (to - from > Math.PI) to -= 2 * Math.PI;
    while (from - to > Math.PI) to += 2 * Math.PI;
    strokes.push({ kind: 'leaf', closed: false, points: [pivot, { x: pivot.x + front.x * radius, y: pivot.y + front.y * radius }] });
    strokes.push({ kind: 'swing', closed: false, points: arc(pivot, radius, from, to) });
  }
  return {
    objectId: item.object.id, label: item.object.label, footprint: item.footprint,
    centre: polygonCentre(item.footprint), elevation: item.elevation, strokes,
  };
}

export type ElevationPolygon = { outline: Vec2[]; holes: Vec2[][] };
export type ElevationOutline = {
  /** Along the face from the audience's left, and height above the audience floor, in millimetres. */
  left: number; width: number; bottom: number; height: number;
  polygons: ElevationPolygon[];
  /** Bounding boxes of the cut-outs, relative to `left` and the audience floor. */
  openings: { id: string; left: number; sill: number; width: number; height: number }[];
};

const facingAxis = (facingDegrees: number) => {
  const radians = facingDegrees * Math.PI / 180;
  return { x: Math.cos(radians), z: Math.sin(radians) };
};

/**
 * The part seen square-on from one side of a face direction (plan rotation in degrees): its
 * `front` faces seen from the audience side, or its `back` faces seen from behind, projected
 * onto the vertical plane along the face direction. Parts without such faces show the outline
 * of their solids.
 */
export function elevationOutline(item: ResolvedLayoutObject, facingDegrees: number, side: 'front' | 'back' = 'front'): ElevationOutline {
  const axis = facingAxis(facingDegrees);
  const sign = side === 'back' ? -1 : 1;
  const project = (point: Vec3): Vec2 => ({ x: sign * (point.x * axis.x + point.z * axis.z), y: point.y });
  const planar = item.faces.filter(face => face.side === side && face.plane);
  const own = planar.filter(face => !face.key.includes('/'));
  const faces = own.length ? own : planar;
  const polygons: ElevationPolygon[] = [];
  const cutouts: Vec2[][] = [];
  for (const face of faces) {
    const plane = face.plane!;
    const at = (point: Vec2) => project(add(plane.origin, add(scale(plane.u, point.x), scale(plane.v, point.y))));
    if (plane.outline.length >= 3) polygons.push({ outline: plane.outline.map(at), holes: plane.holes.map(hole => hole.map(at)) });
    const solid = item.solids.find(candidate => candidate.id === face.solid);
    if (solid?.kind !== 'sheet') continue;
    for (const opening of solid.openings) {
      const { x, y, width, height } = opening.bounds;
      const corner = (u: number, v: number) => project(add(solid.origin, rotateSheet(solid, u, v)));
      cutouts.push([corner(x, y), corner(x + width, y), corner(x + width, y + height), corner(x, y + height)]);
    }
  }
  if (!polygons.length) {
    const hull = convexHull(item.solids.flatMap(solidVertices).map(project));
    if (hull.length >= 3) polygons.push({ outline: hull, holes: [] });
  }
  const points = polygons.flatMap(polygon => polygon.outline);
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const left = xs.length ? Math.min(...xs) : 0;
  const right = xs.length ? Math.max(...xs) : 0;
  const bottom = ys.length ? Math.min(...ys) : item.elevation;
  const top = ys.length ? Math.max(...ys) : item.elevation;
  const openings = cutouts.map((corners, index) => {
    const cx = corners.map(point => point.x);
    const cy = corners.map(point => point.y);
    return {
      id: `${item.object.id}:${index}`,
      left: Math.min(...cx) - left, sill: Math.min(...cy),
      width: Math.max(...cx) - Math.min(...cx), height: Math.max(...cy) - Math.min(...cy),
    };
  });
  return { left, width: right - left, bottom, height: top, polygons, openings };
}

function rotateSheet(sheet: ResolvedSheet, u: number, v: number): Vec3 {
  const axes = quatAxes(sheet.rotation);
  return add(scale(axes.x, u), scale(axes.y, v));
}
