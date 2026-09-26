import { ExtrudeGeometry, Float32BufferAttribute, Path, Shape } from 'three';
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
 * Material group indices for wall panels (stable across opening edits):
 * 0 edge · 1 front lower · 2 front upper · 3 back lower · 4 back upper.
 * Without a split, lower and upper groups still exist but cover the full face heights.
 */
export const WALL_MAT_EDGE = 0;
export const WALL_MAT_FRONT_LOWER = 1;
export const WALL_MAT_FRONT_UPPER = 2;
export const WALL_MAT_BACK_LOWER = 3;
export const WALL_MAT_BACK_UPPER = 4;
export const WALL_MATERIAL_SLOT_COUNT = 5;

/**
 * Build wall panel geometry (always ExtrudeGeometry so material slots stay stable
 * when openings are added or removed).
 *
 * Openings that touch a panel edge become notches in the outer contour; fully inset
 * openings remain Shape holes. Optional horizontal splits band front/back faces.
 */
export function buildWallPanelGeometry(
  size: { x: number; y: number; z: number },
  openings: readonly Opening[] = [],
  splits?: { frontMm?: number; backMm?: number },
) {
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
  applyWallPanelUVs(geometry, size);
  const normal = geometry.getAttribute('normal');
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const index = geometry.getIndex();
  geometry.clearGroups();
  const frontSplitY = splits?.frontMm !== undefined ? -hh + Math.max(1, Math.min(size.y - 1, splits.frontMm)) : undefined;
  const backSplitY = splits?.backMm !== undefined ? -hh + Math.max(1, Math.min(size.y - 1, splits.backMm)) : undefined;
  const triCount = index ? index.count : position.count;
  const buckets: number[][] = Array.from({ length: WALL_MATERIAL_SLOT_COUNT }, () => []);
  const extraPos: number[] = [];
  const extraNormal: number[] = [];
  const extraUv: number[] = [];
  const readVert = (i: number): BandVert => ({
    x: position.getX(i), y: position.getY(i), z: position.getZ(i),
    nx: normal.getX(i), ny: normal.getY(i), nz: normal.getZ(i),
    u: uv.getX(i), v: uv.getY(i),
  });
  const pushVert = (vert: BandVert): number => {
    const i = position.count + extraPos.length / 3;
    extraPos.push(vert.x, vert.y, vert.z);
    extraNormal.push(vert.nx, vert.ny, vert.nz);
    extraUv.push(vert.u, vert.v);
    return i;
  };
  const emitTri = (slot: number, a: BandVert, b: BandVert, c: BandVert, reuse: [number, number, number] | null) => {
    if (reuse) {
      buckets[slot]!.push(...reuse);
      return;
    }
    buckets[slot]!.push(pushVert(a), pushVert(b), pushVert(c));
  };
  for (let start = 0; start < triCount; start += 3) {
    const i0 = index ? index.getX(start) : start;
    const i1 = index ? index.getX(start + 1) : start + 1;
    const i2 = index ? index.getX(start + 2) : start + 2;
    const v0 = readVert(i0), v1 = readVert(i1), v2 = readVert(i2);
    const nz = (v0.nz + v1.nz + v2.nz) / 3;
    if (nz < -0.5) {
      assignBandedFace(WALL_MAT_FRONT_LOWER, WALL_MAT_FRONT_UPPER, frontSplitY, v0, v1, v2, [i0, i1, i2], emitTri);
    } else if (nz > 0.5) {
      assignBandedFace(WALL_MAT_BACK_LOWER, WALL_MAT_BACK_UPPER, backSplitY, v0, v1, v2, [i0, i1, i2], emitTri);
    } else {
      buckets[WALL_MAT_EDGE]!.push(i0, i1, i2);
    }
  }
  if (extraPos.length) {
    const mergedPos = new Float32Array(position.count * 3 + extraPos.length);
    mergedPos.set(position.array as Float32Array);
    mergedPos.set(extraPos, position.count * 3);
    const mergedNormal = new Float32Array(normal.count * 3 + extraNormal.length);
    mergedNormal.set(normal.array as Float32Array);
    mergedNormal.set(extraNormal, normal.count * 3);
    const mergedUv = new Float32Array(uv.count * 2 + extraUv.length);
    mergedUv.set(uv.array as Float32Array);
    mergedUv.set(extraUv, uv.count * 2);
    geometry.setAttribute('position', new Float32BufferAttribute(mergedPos, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(mergedNormal, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(mergedUv, 2));
  }
  const ordered: number[] = [];
  for (let slot = 0; slot < WALL_MATERIAL_SLOT_COUNT; slot++) {
    const tris = buckets[slot]!;
    if (!tris.length) {
      // Keep an empty group so material slot indices stay stable for WallMesh.
      geometry.addGroup(ordered.length, 0, slot);
      continue;
    }
    const groupStart = ordered.length;
    ordered.push(...tris);
    geometry.addGroup(groupStart, tris.length, slot);
  }
  geometry.setIndex(ordered);
  return geometry;
}

type BandVert = { x: number; y: number; z: number; nx: number; ny: number; nz: number; u: number; v: number };

function lerpBandVert(a: BandVert, b: BandVert, t: number): BandVert {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    nx: a.nx + (b.nx - a.nx) * t,
    ny: a.ny + (b.ny - a.ny) * t,
    nz: a.nz + (b.nz - a.nz) * t,
    u: a.u + (b.u - a.u) * t,
    v: a.v + (b.v - a.v) * t,
  };
}

function clipPolygonAtY(poly: BandVert[], splitY: number, keepBelow: boolean): BandVert[] {
  if (!poly.length) return [];
  const out: BandVert[] = [];
  const inside = (y: number) => (keepBelow ? y <= splitY : y >= splitY);
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!, prev = poly[(i + poly.length - 1) % poly.length]!;
    const curIn = inside(cur.y), prevIn = inside(prev.y);
    if (curIn !== prevIn) {
      const t = (splitY - prev.y) / (cur.y - prev.y);
      out.push(lerpBandVert(prev, cur, t));
    }
    if (curIn) out.push(cur);
  }
  return out;
}

function fanTriangles(poly: BandVert[]): BandVert[][] {
  if (poly.length < 3) return [];
  const tris: BandVert[][] = [];
  for (let i = 1; i < poly.length - 1; i++) tris.push([poly[0]!, poly[i]!, poly[i + 1]!]);
  return tris;
}

function assignBandedFace(
  lowerSlot: number,
  upperSlot: number,
  splitY: number | undefined,
  v0: BandVert, v1: BandVert, v2: BandVert,
  indices: [number, number, number],
  emitTri: (
    slot: number, a: BandVert, b: BandVert, c: BandVert, reuse: [number, number, number] | null,
  ) => void,
) {
  if (splitY === undefined) {
    emitTri(lowerSlot, v0, v1, v2, indices);
    return;
  }
  const maxY = Math.max(v0.y, v1.y, v2.y);
  const minY = Math.min(v0.y, v1.y, v2.y);
  if (maxY <= splitY) {
    emitTri(lowerSlot, v0, v1, v2, indices);
    return;
  }
  if (minY >= splitY) {
    emitTri(upperSlot, v0, v1, v2, indices);
    return;
  }
  const tri = [v0, v1, v2];
  for (const part of fanTriangles(clipPolygonAtY(tri, splitY, true))) {
    emitTri(lowerSlot, part[0]!, part[1]!, part[2]!, null);
  }
  for (const part of fanTriangles(clipPolygonAtY(tri, splitY, false))) {
    emitTri(upperSlot, part[0]!, part[1]!, part[2]!, null);
  }
}

/** Planar UVs in panel millimetres: u along width, v along height (0 at floor-left). */
export function applyWallPanelUVs(geometry: ExtrudeGeometry, size: { x: number; y: number; z: number }) {
  const hw = size.x / 2, hh = size.y / 2, hz = size.z / 2;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uvs = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
    let u: number, v: number;
    if (nz >= nx && nz >= ny) {
      u = (x + hw) / size.x;
      v = (y + hh) / size.y;
    } else if (ny >= nx) {
      u = (x + hw) / size.x;
      v = (z + hz) / size.z;
    } else {
      u = (z + hz) / size.z;
      v = (y + hh) / size.y;
    }
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
}

/** How many index/vertex elements the material groups cover (for tests). */
export function wallGeometryGroupCoverage(geometry: ExtrudeGeometry) {
  const index = geometry.getIndex();
  const expected = index ? index.count : geometry.getAttribute('normal').count;
  const covered = geometry.groups.reduce((sum, group) => sum + group.count, 0);
  return { expected, covered, complete: covered === expected && expected > 0 };
}
