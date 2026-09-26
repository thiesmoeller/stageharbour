import { braceCorners } from './braceTransforms.js';
import { wallCorners } from './wallPlan.js';
import { placeholderCorners } from './placeholders.js';
import { stairCorners } from './levels.js';

type PlanPoint = { x: number; y: number };

/** Minimal layout shape for overlap checks — avoids importing layout.ts (ESM cycle). */
export type OverlapLayout = {
  walls: { id: string; label: string; x: number; y: number; rotation: number; width: number; thickness: number }[];
  braces?: { id: string; label: string; x: number; y: number; rotation: number; footprintWidth: number; footprintDepth: number }[];
  stairs?: { id: string; label: string; x: number; y: number; rotation: number; width: number; run: number }[];
  placeholders?: { id: string; label: string; x: number; y: number; rotation: number; width: number; depth: number }[];
  platforms?: { id: string; label: string; outline: PlanPoint[] }[];
};

export type ObjectOverlap = {
  aId: string; aLabel: string; bId: string; bLabel: string;
  message: string;
};

/** Millimetres. Projection overlap at or below this is treated as flush contact, not interior collision. */
export const OVERLAP_CONTACT_TOLERANCE_MM = 1;

/**
 * Square millimetres. Angled tip-on-face joints leave a thin corner wedge (≤ ~½·t²/tan15° ≈ 366 for 28 mm walls).
 * Real crossings and parallel bites are far larger; keep those as overlaps.
 */
export const OVERLAP_CONTACT_AREA_MM2 = 400;

function project(outline: PlanPoint[], axis: PlanPoint) {
  let min = Infinity, max = -Infinity;
  for (const point of outline) {
    const value = point.x * axis.x + point.y * axis.y;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

/**
 * Convex footprints only (wall/brace/stair/placeholder rectangles and convex podest outlines).
 * Returns the shallowest axis overlap depth: positive = penetration, zero/negative = flush or separated.
 */
export function polygonPenetration(a: PlanPoint[], b: PlanPoint[]) {
  if (a.length < 3 || b.length < 3) return 0;
  let penetration = Infinity;
  for (const outline of [a, b]) {
    for (let index = 0; index < outline.length; index++) {
      const start = outline[index]!, end = outline[(index + 1) % outline.length]!;
      const axis = { x: -(end.y - start.y), y: end.x - start.x };
      const length = Math.hypot(axis.x, axis.y);
      if (!(length > 0)) continue;
      axis.x /= length;
      axis.y /= length;
      const pa = project(a, axis), pb = project(b, axis);
      penetration = Math.min(penetration, pa.max - pb.min, pb.max - pa.min);
    }
  }
  return Number.isFinite(penetration) ? penetration : 0;
}

function cross(a: PlanPoint, b: PlanPoint, c: PlanPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function lineIntersect(p: PlanPoint, q: PlanPoint, a: PlanPoint, b: PlanPoint): PlanPoint {
  const dx1 = p.x - q.x, dy1 = p.y - q.y, dx2 = a.x - b.x, dy2 = a.y - b.y;
  const den = dx1 * dy2 - dy1 * dx2;
  const t = ((a.x - q.x) * dy2 - (a.y - q.y) * dx2) / den;
  return { x: q.x + t * dx1, y: q.y + t * dy1 };
}

/** Convex subject clipped to convex clip polygon (Sutherland–Hodgman). */
function clipConvex(subject: PlanPoint[], clip: PlanPoint[]) {
  let output = subject;
  for (let index = 0; index < clip.length; index++) {
    const a = clip[index]!, b = clip[(index + 1) % clip.length]!;
    const input = output;
    output = [];
    if (input.length === 0) break;
    for (let i = 0; i < input.length; i++) {
      const p = input[i]!, q = input[(i + 1) % input.length]!;
      const pIn = cross(a, b, p) >= -1e-9, qIn = cross(a, b, q) >= -1e-9;
      if (pIn && qIn) output.push(q);
      else if (pIn && !qIn) output.push(lineIntersect(p, q, a, b));
      else if (!pIn && qIn) {
        output.push(lineIntersect(p, q, a, b));
        output.push(q);
      }
    }
  }
  return output;
}

function polygonArea(outline: PlanPoint[]) {
  let sum = 0;
  for (let index = 0; index < outline.length; index++) {
    const a = outline[index]!, b = outline[(index + 1) % outline.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Intersection area of two convex footprints (mm²). */
export function polygonIntersectionArea(a: PlanPoint[], b: PlanPoint[]) {
  if (a.length < 3 || b.length < 3) return 0;
  return polygonArea(clipConvex(a, b));
}

/**
 * True when footprints share meaningful interior area.
 * Edge/corner contact and angled tip-on-face wedges stay allowed.
 */
export function polygonsInteriorOverlap(
  a: PlanPoint[],
  b: PlanPoint[],
  tolerance = OVERLAP_CONTACT_TOLERANCE_MM,
  maxContactArea = OVERLAP_CONTACT_AREA_MM2,
) {
  const penetration = polygonPenetration(a, b);
  if (penetration <= tolerance) return false;
  return polygonIntersectionArea(a, b) > maxContactArea;
}

type Footprint = { id: string; label: string; kind: string; polygon: PlanPoint[] };

function layoutFootprints(layout: OverlapLayout): Footprint[] {
  return [
    ...layout.walls.map(wall => ({ id: wall.id, label: wall.label, kind: 'Wand', polygon: wallCorners(wall) })),
    ...(layout.braces ?? []).map(brace => ({ id: brace.id, label: brace.label, kind: 'Stütze', polygon: braceCorners(brace) })),
    ...(layout.stairs ?? []).map(stair => ({ id: stair.id, label: stair.label, kind: 'Treppe', polygon: stairCorners(stair) })),
    ...(layout.placeholders ?? []).map(item => ({ id: item.id, label: item.label, kind: 'Platzhalter', polygon: placeholderCorners(item) })),
    ...(layout.platforms ?? []).map(platform => ({ id: platform.id, label: platform.label, kind: 'Podest', polygon: platform.outline })),
  ];
}

/** Podests are supporting surfaces: walls stand on them. Only podest–podest pairs collide. */
function footprintsCollide(a: Footprint, b: Footprint) {
  if (a.kind === 'Podest' || b.kind === 'Podest') return a.kind === 'Podest' && b.kind === 'Podest';
  return true;
}

/** Pairwise interior overlaps among stage objects (edge contact excluded). */
export function objectOverlapWarnings<T extends OverlapLayout>(layout: T, ignoreIds: ReadonlySet<string> = new Set()): ObjectOverlap[] {
  const items = layoutFootprints(layout).filter(item => !ignoreIds.has(item.id));
  const found: ObjectOverlap[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!;
      if (!footprintsCollide(a, b) || !polygonsInteriorOverlap(a.polygon, b.polygon)) continue;
      found.push({
        aId: a.id, aLabel: a.label, bId: b.id, bLabel: b.label,
        message: `${a.kind} „${a.label}“ überschneidet ${b.kind} „${b.label}“.`,
      });
    }
  }
  return found;
}

/** Ids of every object that participates in at least one interior overlap (for on-canvas tint). */
export function overlappingObjectIds<T extends OverlapLayout>(layout: T, ignoreIds: ReadonlySet<string> = new Set()): Set<string> {
  const ids = new Set<string>();
  for (const item of objectOverlapWarnings(layout, ignoreIds)) {
    ids.add(item.aId);
    ids.add(item.bId);
  }
  return ids;
}

/** Whether placing `candidate` into `layout` (replacing same id if present) would interior-overlap anything else. */
export function placementOverlaps<T extends OverlapLayout>(layout: T, candidate: Footprint): boolean {
  const others = layoutFootprints(layout).filter(item => item.id !== candidate.id);
  return others.some(item => footprintsCollide(candidate, item) && polygonsInteriorOverlap(candidate.polygon, item.polygon));
}

export function wallFootprint(wall: { id: string; label: string; x: number; y: number; rotation: number; width: number; thickness: number }): Footprint {
  return { id: wall.id, label: wall.label, kind: 'Wand', polygon: wallCorners(wall) };
}

export function braceFootprint(brace: { id: string; label: string; x: number; y: number; rotation: number; footprintWidth: number; footprintDepth: number }): Footprint {
  return { id: brace.id, label: brace.label, kind: 'Stütze', polygon: braceCorners(brace) };
}

export function stairFootprint(stair: { id: string; label: string; x: number; y: number; rotation: number; width: number; run: number }): Footprint {
  return { id: stair.id, label: stair.label, kind: 'Treppe', polygon: stairCorners(stair) };
}

export function placeholderFootprint(item: { id: string; label: string; x: number; y: number; rotation: number; width: number; depth: number }): Footprint {
  return { id: item.id, label: item.label, kind: 'Platzhalter', polygon: placeholderCorners(item) };
}

export function platformFootprint(platform: { id: string; label: string; outline: PlanPoint[] }): Footprint {
  return { id: platform.id, label: platform.label, kind: 'Podest', polygon: platform.outline };
}
