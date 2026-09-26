import { ExtrudeGeometry, Path, Shape } from 'three';
import type { Opening } from './wall-types.js';

export type OpeningFlush = { left: boolean; right: boolean; bottom: boolean; top: boolean };

const FLUSH_EPS = 0.5;

/** Which panel edges this opening sits flush against (implicit open sides). */
export function openingFlushSides(opening: Opening, size: { x: number; y: number }, eps = FLUSH_EPS): OpeningFlush {
  return {
    left: opening.left <= eps,
    right: opening.left + opening.width >= size.x - eps,
    bottom: opening.sill <= eps,
    top: opening.sill + opening.height >= size.y - eps,
  };
}

export function openingTouchesBoundary(opening: Opening, size: { x: number; y: number }, eps = FLUSH_EPS) {
  const flush = openingFlushSides(opening, size, eps);
  return flush.left || flush.right || flush.bottom || flush.top;
}

type Rect = { x0: number; y0: number; x1: number; y1: number };
type Pt = { x: number; y: number };

function openingRect(opening: Opening, hw: number, hh: number): Rect {
  return {
    x0: -hw + opening.left,
    y0: -hh + opening.sill,
    x1: -hw + opening.left + opening.width,
    y1: -hh + opening.sill + opening.height,
  };
}

function uniqueSorted(values: number[]) {
  return [...new Set(values.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
}

/**
 * Orthogonal outer contour of a panel rectangle minus flush openings (CCW, solid on the left).
 * Interior-only openings must not be passed here — they become Shape holes instead.
 */
export function panelOuterContour(size: { x: number; y: number }, flushOpenings: readonly Opening[]): Pt[] {
  const hw = size.x / 2, hh = size.y / 2;
  if (!flushOpenings.length) {
    return [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
  }
  const voids = flushOpenings.map(opening => openingRect(opening, hw, hh));
  const xs = uniqueSorted([-hw, hw, ...voids.flatMap(v => [v.x0, v.x1])]);
  const ys = uniqueSorted([-hh, hh, ...voids.flatMap(v => [v.y0, v.y1])]);
  const cols = xs.length - 1, rows = ys.length - 1;
  if (cols < 1 || rows < 1) {
    return [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
  }
  const solid: boolean[][] = Array.from({ length: cols }, (_, i) => Array.from({ length: rows }, (_, j) => {
    const cx = (xs[i]! + xs[i + 1]!) / 2;
    const cy = (ys[j]! + ys[j + 1]!) / 2;
    return !voids.some(v => cx > v.x0 && cx < v.x1 && cy > v.y0 && cy < v.y1);
  }));
  if (!solid.some(col => col.some(Boolean))) {
    // Degenerate: nothing left — fall back to a thin lintel strip so ExtrudeGeometry stays valid.
    const lintel = Math.min(1, size.y);
    return [
      { x: -hw, y: hh - lintel }, { x: hw, y: hh - lintel }, { x: hw, y: hh }, { x: -hw, y: hh },
    ];
  }
  return traceSolidOutline(xs, ys, solid);
}

/**
 * Axis-aligned solid boxes for shadow casting. ExtrudeGeometry notches/holes cast
 * filled “ghost” shadows under the stage’s mirrored (-X) scene graph; boxes do not.
 */
export function wallShadowVolumes(
  size: { x: number; y: number; z: number },
  openings: readonly Opening[] = [],
): { position: [number, number, number]; size: [number, number, number] }[] {
  const hw = size.x / 2, hh = size.y / 2;
  if (!openings.length) {
    return [{ position: [0, 0, 0], size: [size.x, size.y, size.z] }];
  }
  const voids = openings.map(opening => {
    const rect = openingRect(opening, hw, hh);
    return {
      x0: Math.max(-hw, rect.x0), y0: Math.max(-hh, rect.y0),
      x1: Math.min(hw, rect.x1), y1: Math.min(hh, rect.y1),
    };
  }).filter(v => v.x1 - v.x0 > 1e-6 && v.y1 - v.y0 > 1e-6);
  if (!voids.length) {
    return [{ position: [0, 0, 0], size: [size.x, size.y, size.z] }];
  }
  const xs = uniqueSorted([-hw, hw, ...voids.flatMap(v => [v.x0, v.x1])]);
  const ys = uniqueSorted([-hh, hh, ...voids.flatMap(v => [v.y0, v.y1])]);
  const volumes: { position: [number, number, number]; size: [number, number, number] }[] = [];
  // Merge contiguous solid cells per row into fewer boxes (cleaner shadows, fewer draw calls).
  for (let j = 0; j < ys.length - 1; j++) {
    const y0 = ys[j]!, y1 = ys[j + 1]!, h = y1 - y0;
    if (h < 1e-6) continue;
    let runStart: number | undefined;
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i]!, x1 = xs[i + 1]!;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const solid = !voids.some(v => cx > v.x0 && cx < v.x1 && cy > v.y0 && cy < v.y1);
      if (solid) {
        if (runStart === undefined) runStart = x0;
      } else if (runStart !== undefined) {
        const w = x0 - runStart;
        if (w > 1e-6) volumes.push({ position: [(runStart + x0) / 2, cy, 0], size: [w, h, size.z] });
        runStart = undefined;
      }
    }
    if (runStart !== undefined) {
      const xEnd = xs[xs.length - 1]!;
      const w = xEnd - runStart;
      if (w > 1e-6) volumes.push({ position: [(runStart + xEnd) / 2, (y0 + y1) / 2, 0], size: [w, h, size.z] });
    }
  }
  if (!volumes.length) {
    // Degenerate: keep a thin lintel so the wall still grounds a shadow.
    const lintel = Math.min(1, size.y);
    return [{ position: [0, hh - lintel / 2, 0], size: [size.x, lintel, size.z] }];
  }
  return volumes;
}

function key(x: number, y: number) {
  return `${x},${y}`;
}

/** Chain axis-aligned boundary edges of solid cells into one CCW loop. */
function traceSolidOutline(xs: number[], ys: number[], solid: boolean[][]): Pt[] {
  type Edge = { x0: number; y0: number; x1: number; y1: number };
  const edges: Edge[] = [];
  const cols = solid.length, rows = solid[0]!.length;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (!solid[i]![j]) continue;
      // Bottom: walk left → right
      if (j === 0 || !solid[i]![j - 1]) edges.push({ x0: xs[i]!, y0: ys[j]!, x1: xs[i + 1]!, y1: ys[j]! });
      // Right: walk bottom → top
      if (i === cols - 1 || !solid[i + 1]![j]) edges.push({ x0: xs[i + 1]!, y0: ys[j]!, x1: xs[i + 1]!, y1: ys[j + 1]! });
      // Top: walk right → left
      if (j === rows - 1 || !solid[i]![j + 1]) edges.push({ x0: xs[i + 1]!, y0: ys[j + 1]!, x1: xs[i]!, y1: ys[j + 1]! });
      // Left: walk top → bottom
      if (i === 0 || !solid[i - 1]![j]) edges.push({ x0: xs[i]!, y0: ys[j + 1]!, x1: xs[i]!, y1: ys[j]! });
    }
  }
  const byStart = new Map<string, Edge[]>();
  for (const edge of edges) {
    const k = key(edge.x0, edge.y0);
    const list = byStart.get(k) ?? [];
    list.push(edge);
    byStart.set(k, list);
  }
  // Prefer starting at the overall bottom-left corner of the outline.
  let start = edges[0]!;
  for (const edge of edges) {
    if (edge.y0 < start.y0 - 1e-9 || (Math.abs(edge.y0 - start.y0) < 1e-9 && edge.x0 < start.x0)) start = edge;
  }
  const loop: Pt[] = [{ x: start.x0, y: start.y0 }];
  let current = start;
  const used = new Set<Edge>();
  for (let n = 0; n < edges.length + 2; n++) {
    used.add(current);
    loop.push({ x: current.x1, y: current.y1 });
    if (Math.abs(current.x1 - start.x0) < 1e-9 && Math.abs(current.y1 - start.y0) < 1e-9) break;
    const nexts = (byStart.get(key(current.x1, current.y1)) ?? []).filter(edge => !used.has(edge));
    const next = nexts[0];
    if (!next) break;
    current = next;
  }
  // Drop duplicate closing point if present.
  if (loop.length > 1) {
    const a = loop[0]!, b = loop[loop.length - 1]!;
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) loop.pop();
  }
  return mergeCollinear(loop);
}

function mergeCollinear(points: Pt[]): Pt[] {
  if (points.length < 3) return points;
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length]!;
    const cur = points[i]!;
    const next = points[(i + 1) % points.length]!;
    const ax = cur.x - prev.x, ay = cur.y - prev.y;
    const bx = next.x - cur.x, by = next.y - cur.y;
    // Drop middle point when direction does not turn.
    if (Math.abs(ax * by - ay * bx) < 1e-6) continue;
    out.push(cur);
  }
  return out.length >= 3 ? out : points;
}

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
 *
 * Openings that touch a panel edge become notches in the outer contour; fully inset
 * openings remain Shape holes.
 */
export function buildWallPanelGeometry(size: { x: number; y: number; z: number }, openings: readonly Opening[] = []) {
  const hw = size.x / 2, hh = size.y / 2;
  const flush: Opening[] = [];
  const inset: Opening[] = [];
  for (const opening of openings) {
    if (openingTouchesBoundary(opening, size)) flush.push(opening);
    else inset.push(opening);
  }
  const shape = new Shape();
  const contour = panelOuterContour(size, flush);
  const first = contour[0]!;
  shape.moveTo(first.x, first.y);
  for (let i = 1; i < contour.length; i++) shape.lineTo(contour[i]!.x, contour[i]!.y);
  shape.closePath();
  for (const opening of inset) shape.holes.push(openingHole(opening, hw, hh));
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
