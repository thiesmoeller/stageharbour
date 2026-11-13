import type { Vec2 } from '../../shared/parts/math.js';
import type { PartDefinition } from '../../shared/parts/definition.js';
import type { ResolvedOpening, ResolvedSheet } from '../../shared/parts/resolve.js';
import { openingParameterKeys, removeOpening, upsertOpening, type OpeningInput } from '../../shared/parts/openingParams.js';
import { uniqueKey } from './draft.js';

/**
 * Pure maths of the face sketcher. Sheet coordinates are the (u, v) of the resolved sheet, +v up.
 * The SVG of the sketcher uses y = -v, so `toSvg` / `fromSvg` are the only places that flip.
 */

export type Box = { x: number; y: number; width: number; height: number };
export type SketchShape = 'rect' | 'arch' | 'polygon';
export type SketchTool = 'select' | 'rect' | 'arch' | 'polygon';

/** One opening as the sketcher shows and edits it. */
export type SketchOpening = {
  key: string;
  shape: SketchShape;
  /** Loop in sheet coordinates (a rectangle or the arch outline for rect / arch). */
  points: Vec2[];
  bounds: Box;
};

export const SKETCH_SNAP_MM = 10;
export const SKETCH_MIN_SIZE_MM = 20;
export const OPENING_KEY_BASE = 'oeffnung';

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Handle = (typeof HANDLES)[number];

export const snap = (value: number, step = SKETCH_SNAP_MM): number => step > 0 ? Math.round(value / step) * step : value;

export const toSvg = (point: Vec2): Vec2 => ({ x: point.x, y: -point.y });
export const fromSvg = (point: Vec2): Vec2 => ({ x: point.x, y: -point.y });

export function sketchOpenings(solid: Pick<ResolvedSheet, 'openings'> | undefined): SketchOpening[] {
  return (solid?.openings ?? []).map((opening: ResolvedOpening) => ({
    key: opening.key, shape: opening.shape, points: opening.points, bounds: opening.bounds,
  }));
}

export function boundsOf(points: readonly Vec2[]): Box {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** SVG viewBox for the sheet with a margin, in SVG (y-down) coordinates. */
export function sketchViewBox(solid: Pick<ResolvedSheet, 'outline'> | undefined, margin = 0.08): Box {
  const box = solid?.outline.length ? boundsOf(solid.outline) : { x: 0, y: 0, width: 1000, height: 1000 };
  const pad = Math.max(box.width, box.height, 1) * margin;
  return { x: box.x - pad, y: -(box.y + box.height) - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
}

export function loopPath(loop: readonly Vec2[]): string {
  return loop.length ? `M${loop.map(point => `${round(point.x)} ${round(point.y)}`).join('L')}Z` : '';
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Polygon of a rect or arch box, matching the kernel: straight jambs and a semicircular crown. */
export function boxLoop(shape: 'rect' | 'arch', box: Box, segments = 24): Vec2[] {
  const { x, y, width, height } = box;
  if (shape === 'rect') {
    return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
  }
  const radius = width / 2;
  const springY = y + height - radius;
  const loop: Vec2[] = [{ x, y }, { x: x + width, y }];
  for (let step = 0; step <= segments; step++) {
    const angle = (step / segments) * Math.PI;
    loop.push({ x: x + radius + radius * Math.cos(angle), y: springY + radius * Math.sin(angle) });
  }
  return loop;
}

/** Arches need at least half their width as height. */
export function normalizeBox(shape: 'rect' | 'arch', box: Box): Box {
  const height = shape === 'arch' ? Math.max(box.height, box.width / 2) : box.height;
  return { ...box, height };
}

export function boxFromDrag(shape: 'rect' | 'arch', a: Vec2, b: Vec2, step = SKETCH_SNAP_MM): Box {
  const x1 = snap(Math.min(a.x, b.x), step), x2 = snap(Math.max(a.x, b.x), step);
  const y1 = snap(Math.min(a.y, b.y), step), y2 = snap(Math.max(a.y, b.y), step);
  return normalizeBox(shape, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}

export const isUsableBox = (box: Box, min = SKETCH_MIN_SIZE_MM): boolean => box.width >= min && box.height >= min;

/** Keeps a box inside `limit` by shifting it; boxes bigger than the limit stay anchored at its origin. */
export function clampBoxInside(box: Box, limit: Box): Box {
  const x = Math.max(limit.x, Math.min(box.x, limit.x + limit.width - box.width));
  const y = Math.max(limit.y, Math.min(box.y, limit.y + limit.height - box.height));
  return { ...box, x, y };
}

/** Intersection of `box` with `limit`; may be empty (zero or negative size). */
export function clipBox(box: Box, limit: Box): Box {
  const left = Math.max(box.x, limit.x), bottom = Math.max(box.y, limit.y);
  const right = Math.min(box.x + box.width, limit.x + limit.width), top = Math.min(box.y + box.height, limit.y + limit.height);
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

export function moveBox(box: Box, dx: number, dy: number, step = SKETCH_SNAP_MM): Box {
  return { ...box, x: snap(box.x + dx, step), y: snap(box.y + dy, step) };
}

export function movePoints(points: readonly Vec2[], dx: number, dy: number, step = SKETCH_SNAP_MM): Vec2[] {
  const sx = snap(dx, step), sy = snap(dy, step);
  return points.map(point => ({ x: point.x + sx, y: point.y + sy }));
}

export function handlePoint(box: Box, handle: Handle): Vec2 {
  const left = box.x, right = box.x + box.width, bottom = box.y, top = box.y + box.height;
  const midX = left + box.width / 2, midY = bottom + box.height / 2;
  switch (handle) {
    case 'nw': return { x: left, y: top };
    case 'n': return { x: midX, y: top };
    case 'ne': return { x: right, y: top };
    case 'e': return { x: right, y: midY };
    case 'se': return { x: right, y: bottom };
    case 's': return { x: midX, y: bottom };
    case 'sw': return { x: left, y: bottom };
    case 'w': return { x: left, y: midY };
  }
}

/** Drags one handle of `box` to `point`; the opposite edges stay put and the box never inverts. */
export function resizeBox(box: Box, handle: Handle, point: Vec2, shape: 'rect' | 'arch', step = SKETCH_SNAP_MM): Box {
  let left = box.x, right = box.x + box.width, bottom = box.y, top = box.y + box.height;
  const px = snap(point.x, step), py = snap(point.y, step);
  if (handle.includes('w')) left = Math.min(px, right - step);
  if (handle.includes('e')) right = Math.max(px, left + step);
  if (handle.includes('s')) bottom = Math.min(py, top - step);
  if (handle.includes('n')) top = Math.max(py, bottom + step);
  const next = normalizeBox(shape, { x: left, y: bottom, width: right - left, height: top - bottom });
  // An arch that had to grow upward keeps its bottom edge when the user pulled the bottom handle.
  return handle.includes('s') && shape === 'arch' && next.height > top - bottom
    ? { ...next, y: top - next.height }
    : next;
}

export function moveVertex(points: readonly Vec2[], index: number, point: Vec2, step = SKETCH_SNAP_MM): Vec2[] {
  return points.map((existing, position) => position === index ? { x: snap(point.x, step), y: snap(point.y, step) } : existing);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function cleanPolygon(points: readonly Vec2[], step = SKETCH_SNAP_MM): Vec2[] {
  const snapped = points.map(point => ({ x: snap(point.x, step), y: snap(point.y, step) }));
  return snapped.filter((point, index) => index === 0 || distance(point, snapped[index - 1]!) > 0);
}

/** A key for a new opening that collides with no hole, parameter or parameter group of the part. */
export function newOpeningKey(definition: PartDefinition, bodyKey: string): string {
  const body = definition.bodies.find(candidate => candidate.key === bodyKey);
  const holes = body?.kind === 'sheet' ? (body.holes ?? []).map(hole => hole.key) : [];
  const names = new Set([
    ...definition.parameters.map(parameter => parameter.key), ...(definition.derived ?? []).map(item => item.key),
  ]);
  const taken = [...holes];
  for (let guard = 0; guard < 500; guard++) {
    const key = uniqueKey(OPENING_KEY_BASE, taken);
    if (!Object.values(openingParameterKeys(key)).some(name => names.has(name))) return key;
    taken.push(key);
  }
  return uniqueKey(OPENING_KEY_BASE, taken);
}

export type OpeningGeometry =
  | { shape: 'rect' | 'arch'; box: Box }
  | { shape: 'polygon'; points: readonly Vec2[] };

export function openingInput(key: string, geometry: OpeningGeometry): OpeningInput {
  if (geometry.shape === 'polygon') {
    return { shape: 'polygon', key, points: geometry.points.map(point => [point.x, point.y] as const) };
  }
  const { box } = geometry;
  return { shape: geometry.shape, key, left: box.x, sill: box.y, width: box.width, height: box.height };
}

export function geometryOf(opening: SketchOpening): OpeningGeometry {
  return opening.shape === 'polygon'
    ? { shape: 'polygon', points: opening.points }
    : { shape: opening.shape, box: opening.bounds };
}

/**
 * Narrows the four parameters of a rect / arch opening to the drawn value. The save check tries the
 * ends of every free range, and a hole whose position may run to ±100 m is rejected at those ends;
 * a drawn opening is one concrete place, so only that place is checked. The ranges stay editable.
 */
function pinOpeningRanges(definition: PartDefinition, holeKey: string): PartDefinition {
  const names = new Set(Object.values(openingParameterKeys(holeKey)));
  return {
    ...definition,
    parameters: definition.parameters.map(parameter =>
      names.has(parameter.key) && parameter.range ? { ...parameter, range: { min: parameter.default, max: parameter.default } } : parameter),
  };
}

/** Writes one opening (hole formulas and parameter group) into the definition. */
export function writeOpening(definition: PartDefinition, bodyKey: string, key: string, geometry: OpeningGeometry): PartDefinition {
  const next = upsertOpening(definition, bodyKey, openingInput(key, geometry));
  return geometry.shape === 'polygon' ? next : pinOpeningRanges(next, key);
}

export function deleteOpening(definition: PartDefinition, bodyKey: string, key: string): PartDefinition {
  return removeOpening(definition, bodyKey, key);
}

/** Size text of a box; positions are measured from the lower-left corner of the sheet blank. */
export function describeBox(box: Box, origin: Vec2 = { x: 0, y: 0 }): string {
  const mm = (value: number) => `${Math.round(value)} mm`;
  return `Links ${mm(box.x - origin.x)} · Brüstung ${mm(box.y - origin.y)} · ${mm(box.width)} × ${mm(box.height)}`;
}
