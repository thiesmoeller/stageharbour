import type { Layout } from './layout.js';
import { braceCorners } from './braceTransforms.js';
import { wallCorners } from './layout.js';
import { placeholderCorners } from './placeholders.js';
import { stairCorners } from './levels.js';

type PlanPoint = { x: number; y: number };

export type ObjectOverlap = {
  aId: string; aLabel: string; bId: string; bLabel: string;
  message: string;
};

function distanceToSegment(point: PlanPoint, start: PlanPoint, end: PlanPoint) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(length > 0)) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)));
  return Math.hypot(point.x - (start.x + t * (end.x - start.x)), point.y - (start.y + t * (end.y - start.y)));
}

function onBoundary(outline: PlanPoint[], point: PlanPoint) {
  return outline.some((start, index) => distanceToSegment(point, start, outline[(index + 1) % outline.length]!) <= 1e-6);
}

/** Strict interior containment — boundary contact does not count. */
function containsStrict(outline: PlanPoint[], point: PlanPoint) {
  if (onBoundary(outline, point)) return false;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!, b = outline[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentsCrossProper(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint) {
  const orient = (p: PlanPoint, q: PlanPoint, r: PlanPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** True when footprints share interior area. Edge-only contact (snapped flush) is allowed. */
export function polygonsInteriorOverlap(a: PlanPoint[], b: PlanPoint[]) {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!, a1 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      if (segmentsCrossProper(a0, a1, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  if (a.some(point => containsStrict(b, point)) || b.some(point => containsStrict(a, point))) return true;
  const ca = centroid(a), cb = centroid(b);
  return containsStrict(a, cb) || containsStrict(b, ca);
}

function centroid(outline: PlanPoint[]) {
  return {
    x: outline.reduce((sum, point) => sum + point.x, 0) / outline.length,
    y: outline.reduce((sum, point) => sum + point.y, 0) / outline.length,
  };
}

type Footprint = { id: string; label: string; kind: string; polygon: PlanPoint[] };

function layoutFootprints(layout: Layout): Footprint[] {
  return [
    ...layout.walls.map(wall => ({ id: wall.id, label: wall.label, kind: 'Wand', polygon: wallCorners(wall) })),
    ...(layout.braces ?? []).map(brace => ({ id: brace.id, label: brace.label, kind: 'Stütze', polygon: braceCorners(brace) })),
    ...(layout.stairs ?? []).map(stair => ({ id: stair.id, label: stair.label, kind: 'Treppe', polygon: stairCorners(stair) })),
    ...(layout.placeholders ?? []).map(item => ({ id: item.id, label: item.label, kind: 'Platzhalter', polygon: placeholderCorners(item) })),
    ...(layout.platforms ?? []).map(platform => ({ id: platform.id, label: platform.label, kind: 'Podest', polygon: platform.outline })),
  ];
}

/** Pairwise interior overlaps among stage objects (edge contact excluded). */
export function objectOverlapWarnings(layout: Layout, ignoreIds: ReadonlySet<string> = new Set()): ObjectOverlap[] {
  const items = layoutFootprints(layout).filter(item => !ignoreIds.has(item.id));
  const found: ObjectOverlap[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!;
      if (!polygonsInteriorOverlap(a.polygon, b.polygon)) continue;
      found.push({
        aId: a.id, aLabel: a.label, bId: b.id, bLabel: b.label,
        message: `${a.kind} „${a.label}“ überschneidet ${b.kind} „${b.label}“.`,
      });
    }
  }
  return found;
}

/** Whether placing `candidate` into `layout` (replacing same id if present) would interior-overlap anything else. */
export function placementOverlaps(layout: Layout, candidate: Footprint): boolean {
  const others = layoutFootprints(layout).filter(item => item.id !== candidate.id);
  return others.some(item => polygonsInteriorOverlap(candidate.polygon, item.polygon));
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
