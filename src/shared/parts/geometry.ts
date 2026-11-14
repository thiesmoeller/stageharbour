import { BufferGeometry, Float32BufferAttribute, Matrix4, ShapeUtils, Vector2 } from 'three';
import type { PartFaceSide } from './definition.js';
import { add, polygonBounds, rotate, signedArea, type Vec2, type Vec3 } from './math.js';
import { placementRotationY, type PartPlacement } from './place.js';
import type { PartMaterial } from './definition.js';
import type { ResolvedBeam, ResolvedPart, ResolvedSheet, ResolvedSolid } from './resolve.js';

/** Material group index of each side of a box or beam geometry. */
export const BOX_SIDE_SLOTS = { right: 0, left: 1, top: 2, bottom: 3, back: 4, front: 5 } as const;
/** Material group index of each side of a sheet geometry, in the order of `wallMeshGeometry.ts`. */
export const SHEET_SIDE_SLOTS = { edge: 0, front: 1, back: 2 } as const;

export type GeometryOptions = {
  /**
   * `face` (default): planar UVs from 0 to 1 across the bounding size of each face, as
   * `wallMeshGeometry.ts` does; the surface material scales the pattern from the face size.
   * `mm`: the same mapping left in millimetres.
   */
  uv?: 'face' | 'mm';
};

type SideMesh = { side: Exclude<PartFaceSide, 'all'>; indices: number[] };
type SolidMesh = { positions: number[]; normals: number[]; uvs: number[]; sides: SideMesh[] };

function meshWriter(origin: Vec3, solid: ResolvedSolid) {
  const mesh: SolidMesh = { positions: [], normals: [], uvs: [], sides: [] };
  const vertex = (local: Vec3, normal: Vec3, u: number, v: number): number => {
    const position = add(origin, rotate(solid.rotation, local));
    const direction = rotate(solid.rotation, normal);
    mesh.positions.push(position.x, position.y, position.z);
    mesh.normals.push(direction.x, direction.y, direction.z);
    mesh.uvs.push(u, v);
    return mesh.positions.length / 3 - 1;
  };
  const side = (name: SideMesh['side']): number[] => {
    const entry: SideMesh = { side: name, indices: [] };
    mesh.sides.push(entry);
    return entry.indices;
  };
  return { mesh, vertex, side };
}

function boxMesh(solid: Exclude<ResolvedSolid, ResolvedSheet>, options: GeometryOptions): SolidMesh {
  const { mesh, vertex, side } = meshWriter(solid.center, solid);
  const hx = solid.size.x / 2, hy = solid.size.y / 2, hz = solid.size.z / 2;
  const unit = options.uv !== 'mm';
  const span = (value: number, half: number) => unit ? (value + half) / (2 * half) : value + half;
  const uv = (point: Vec3, normal: Vec3): [number, number] =>
    normal.x !== 0 ? [span(point.z, hz), span(point.y, hy)]
      : normal.y !== 0 ? [span(point.x, hx), span(point.z, hz)]
        : [span(point.x, hx), span(point.y, hy)];
  const quad = (name: SideMesh['side'], normal: Vec3, corners: [number, number, number][]) => {
    const [a, b, c, d] = corners.map(([x, y, z]) => {
      const point = { x: x * hx, y: y * hy, z: z * hz };
      return vertex(point, normal, ...uv(point, normal));
    }) as [number, number, number, number];
    side(name).push(a, b, c, a, c, d);
  };
  quad('right', { x: 1, y: 0, z: 0 }, [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]);
  quad('left', { x: -1, y: 0, z: 0 }, [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]);
  quad('top', { x: 0, y: 1, z: 0 }, [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]);
  quad('bottom', { x: 0, y: -1, z: 0 }, [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]);
  quad('back', { x: 0, y: 0, z: 1 }, [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]);
  quad('front', { x: 0, y: 0, z: -1 }, [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]);
  return mesh;
}

/** Index of a point that lies on the segment between two others, strictly between its ends. */
function pointOnSegment(points: readonly Vec2[], from: number, to: number): number | undefined {
  const a = points[from]!, b = points[to]!;
  const dx = b.x - a.x, dy = b.y - a.y;
  const span = Math.hypot(dx, dy);
  if (!(span > 1e-6)) return undefined;
  let best: number | undefined;
  let bestAlong = Infinity;
  for (let index = 0; index < points.length; index++) {
    if (index === from || index === to) continue;
    const point = points[index]!;
    const along = ((point.x - a.x) * dx + (point.y - a.y) * dy) / span;
    if (along <= 1e-6 || along >= span - 1e-6 || along >= bestAlong) continue;
    if (Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / span > 1e-6) continue;
    best = index;
    bestAlong = along;
  }
  return best;
}

/**
 * Triangles over an outline with holes, as index triples into the outline points followed by
 * the hole points. Where three points lie in a line, ear clipping leaves a triangle edge
 * running past the middle one, sometimes with a triangle of no area beside it. Such edges
 * are split at the point and the flat triangles dropped, so that every point is a corner of
 * all triangles around it and the caps join the edge walls without gaps.
 */
function triangulateLoops(outline: readonly Vec2[], holes: readonly (readonly Vec2[])[]): [number, number, number][] {
  const points = [outline, ...holes].flat();
  const pending = ShapeUtils.triangulateShape(
    outline.map(point => new Vector2(point.x, point.y)),
    holes.map(hole => hole.map(point => new Vector2(point.x, point.y))),
  ).map(([a = 0, b = 0, c = 0]): [number, number, number] => [a, b, c]);
  const triangles: [number, number, number][] = [];
  for (let triangle = pending.pop(); triangle; triangle = pending.pop()) {
    let whole = true;
    for (let edge = 0; edge < 3 && whole; edge++) {
      const a = triangle[edge]!, b = triangle[(edge + 1) % 3]!, c = triangle[(edge + 2) % 3]!;
      const between = pointOnSegment(points, a, b);
      if (between === undefined) continue;
      whole = false;
      if (between !== c) pending.push([a, between, c], [between, b, c]);
    }
    if (whole) triangles.push(triangle);
  }
  return triangles;
}

function sheetMesh(solid: ResolvedSheet, options: GeometryOptions): SolidMesh {
  const { mesh, vertex, side } = meshWriter(solid.origin, solid);
  const bounds = polygonBounds(solid.outline);
  const unit = options.uv !== 'mm';
  const u = (x: number) => unit ? (x - bounds.minX) / bounds.width : x - bounds.minX;
  const v = (y: number) => unit ? (y - bounds.minY) / bounds.height : y - bounds.minY;
  const w = (depth: number) => unit ? depth / solid.thickness : depth;

  const loops = [solid.outline, ...solid.holes];
  const flat = loops.flat();
  const triangles = triangulateLoops(solid.outline, solid.holes);
  const cap = (name: 'front' | 'back', depth: number, normalZ: number) => {
    const normal = { x: 0, y: 0, z: normalZ };
    const base = flat.map(point => vertex({ x: point.x, y: point.y, z: depth }, normal, u(point.x), v(point.y)));
    const indices = side(name);
    for (const [a, b, c] of triangles) {
      const counterClockwise = signedArea([flat[a]!, flat[b]!, flat[c]!]) > 0;
      if (counterClockwise === normalZ > 0) indices.push(base[a]!, base[b]!, base[c]!);
      else indices.push(base[a]!, base[c]!, base[b]!);
    }
  };
  const rim = side('edge');
  for (const loop of loops) {
    loop.forEach((a: Vec2, index) => {
      const b = loop[(index + 1) % loop.length]!;
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      if (!(span > 0)) return;
      const normal = { x: (b.y - a.y) / span, y: -(b.x - a.x) / span, z: 0 };
      const upright = Math.abs(normal.x) > Math.abs(normal.y);
      const corner = (point: Vec2, depth: number) => vertex({ x: point.x, y: point.y, z: depth }, normal,
        upright ? w(depth) : u(point.x), upright ? v(point.y) : w(depth));
      const a0 = corner(a, 0), b0 = corner(b, 0), b1 = corner(b, solid.thickness), a1 = corner(a, solid.thickness);
      rim.push(a0, b0, b1, a0, b1, a1);
    });
  }
  cap('front', 0, -1);
  cap('back', solid.thickness, 1);
  return mesh;
}

/** Segments around a round or tube profile. */
export const ROUND_PROFILE_SEGMENTS = 24;

/** Side a direction across a beam belongs to: the box side whose normal it is nearest. */
function mantleSide(x: number, z: number): SideMesh['side'] {
  if (Math.abs(x) >= Math.abs(z)) return x >= 0 ? 'right' : 'left';
  return z >= 0 ? 'back' : 'front';
}

/**
 * A round rod or a tube along local +Y, its diameter the section width and height (an ellipse
 * when they differ). Mantle quads join the box side their normal points to, the end caps are
 * `top` (at `to`) and `bottom`, so picking and face slots work as for a square beam.
 */
function cylinderMesh(solid: ResolvedBeam & { profile: NonNullable<ResolvedBeam['profile']> }, options: GeometryOptions): SolidMesh {
  const { mesh, vertex } = meshWriter(solid.center, solid);
  const sides = new Map<SideMesh['side'], number[]>();
  const side = (name: SideMesh['side']) => {
    let indices = sides.get(name);
    if (!indices) {
      indices = [];
      sides.set(name, indices);
      mesh.sides.push({ side: name, indices });
    }
    return indices;
  };
  const rx = solid.size.x / 2, rz = solid.size.z / 2, hy = solid.size.y / 2;
  const wall = solid.profile.shape === 'tube' ? solid.profile.wall ?? rx / 5 : undefined;
  const inner = wall !== undefined && wall < Math.min(rx, rz) ? { x: rx - wall, z: rz - wall } : undefined;
  const unit = options.uv !== 'mm';
  const n = ROUND_PROFILE_SEGMENTS;
  const angle = (i: number) => 2 * Math.PI * i / n;
  const mantle = (radiusX: number, radiusZ: number, outward: boolean) => {
    for (let i = 0; i < n; i++) {
      const a0 = angle(i), a1 = angle(i + 1), mid = (a0 + a1) / 2;
      const normal = { x: Math.cos(mid) * (outward ? 1 : -1), y: 0, z: Math.sin(mid) * (outward ? 1 : -1) };
      const u0 = unit ? i / n : a0 * radiusX, u1 = unit ? (i + 1) / n : a1 * radiusX;
      const v = (y: number) => unit ? (y + hy) / (2 * hy) : y + hy;
      const point = (a: number, y: number) => ({ x: Math.cos(a) * radiusX, y, z: Math.sin(a) * radiusZ });
      const p00 = vertex(point(a0, -hy), normal, u0, v(-hy)), p10 = vertex(point(a1, -hy), normal, u1, v(-hy));
      const p11 = vertex(point(a1, hy), normal, u1, v(hy)), p01 = vertex(point(a0, hy), normal, u0, v(hy));
      const list = side(mantleSide(normal.x, normal.z));
      if (outward) list.push(p00, p01, p11, p00, p11, p10);
      else list.push(p00, p11, p01, p00, p10, p11);
    }
  };
  const cap = (name: 'top' | 'bottom', y: number) => {
    const normal = { x: 0, y: y > 0 ? 1 : -1, z: 0 };
    const uv = (x: number, z: number): [number, number] => unit ? [(x + rx) / (2 * rx), (z + rz) / (2 * rz)] : [x + rx, z + rz];
    const list = side(name);
    for (let i = 0; i < n; i++) {
      const a0 = angle(i), a1 = angle(i + 1);
      const outer0 = { x: Math.cos(a0) * rx, y, z: Math.sin(a0) * rz }, outer1 = { x: Math.cos(a1) * rx, y, z: Math.sin(a1) * rz };
      const o0 = vertex(outer0, normal, ...uv(outer0.x, outer0.z)), o1 = vertex(outer1, normal, ...uv(outer1.x, outer1.z));
      const up = y > 0;
      if (inner) {
        const inner0 = { x: Math.cos(a0) * inner.x, y, z: Math.sin(a0) * inner.z }, inner1 = { x: Math.cos(a1) * inner.x, y, z: Math.sin(a1) * inner.z };
        const i0 = vertex(inner0, normal, ...uv(inner0.x, inner0.z)), i1 = vertex(inner1, normal, ...uv(inner1.x, inner1.z));
        if (up) list.push(i0, o1, o0, i0, i1, o1);
        else list.push(i0, o0, o1, i0, o1, i1);
      } else {
        const c = vertex({ x: 0, y, z: 0 }, normal, ...uv(0, 0));
        if (up) list.push(c, o1, o0);
        else list.push(c, o0, o1);
      }
    }
  };
  mantle(rx, rz, true);
  if (inner) mantle(inner.x, inner.z, false);
  cap('top', hy);
  cap('bottom', -hy);
  return mesh;
}

function solidMesh(solid: ResolvedSolid, options: GeometryOptions): SolidMesh {
  if (solid.kind === 'sheet') return sheetMesh(solid, options);
  if (solid.kind === 'beam' && solid.profile) return cylinderMesh({ ...solid, profile: solid.profile }, options);
  return boxMesh(solid, options);
}

function toGeometry(positions: number[], normals: number[], uvs: number[], groups: { indices: number[]; slot: number }[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  const index: number[] = [];
  for (const group of groups) {
    geometry.addGroup(index.length, group.indices.length, group.slot);
    for (const value of group.indices) index.push(value);
  }
  geometry.setIndex(index);
  return geometry;
}

/** Material group index of a side in the geometry `buildSolidGeometry` returns for a solid. */
export function solidSideSlot(solid: Pick<ResolvedSolid, 'kind'>, side: PartFaceSide): number | undefined {
  const slots: Readonly<Record<string, number>> = solid.kind === 'sheet' ? SHEET_SIDE_SLOTS : BOX_SIDE_SLOTS;
  return Object.hasOwn(slots, side) ? slots[side] : undefined;
}

/**
 * Geometry of one solid in the coordinates the solid is given in (part-local or world),
 * millimetres, with flat normals, planar UVs and one material group per side: see
 * `BOX_SIDE_SLOTS` and `SHEET_SIDE_SLOTS`. Runs without DOM or WebGL.
 */
export function buildSolidGeometry(solid: ResolvedSolid, options: GeometryOptions = {}): BufferGeometry {
  const mesh = solidMesh(solid, options);
  const groups = mesh.sides
    .map(side => ({ indices: side.indices, slot: solidSideSlot(solid, side.side)! }))
    .sort((a, b) => a.slot - b.slot);
  return toGeometry(mesh.positions, mesh.normals, mesh.uvs, groups);
}

/** One entry of the material array a part mesh needs. */
export type PartGeometrySlot = {
  /** Material group index in the geometry. */
  index: number;
  /** Stock material of the solids drawn with this slot. */
  material: string;
  /** Face key (as in `ResolvedPart.faces`) when the slot is a finishable face. */
  face?: string;
};

export type PartGeometry = { geometry: BufferGeometry; slots: PartGeometrySlot[] };

/**
 * All solids of a resolved (or placed) part merged into one geometry. Triangles are grouped
 * by stock material; sides named by a `faces` trait get a group of their own so a finish
 * can replace the material there. A face for one side takes precedence over an `all` face.
 */
export function buildPartGeometry(part: Pick<ResolvedPart, 'solids' | 'faces'>, options: GeometryOptions = {}): PartGeometry {
  const faceOf = new Map<string, string>();
  for (const face of part.faces) {
    const key = `${face.solid}|${face.side}`;
    if (!faceOf.has(key)) faceOf.set(key, face.key);
  }
  const slots: PartGeometrySlot[] = [];
  const groups = new Map<string, { indices: number[]; slot: number }>();
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  for (const solid of part.solids) {
    const mesh = solidMesh(solid, options);
    const base = positions.length / 3;
    for (const value of mesh.positions) positions.push(value);
    for (const value of mesh.normals) normals.push(value);
    for (const value of mesh.uvs) uvs.push(value);
    for (const side of mesh.sides) {
      const face = faceOf.get(`${solid.id}|${side.side}`) ?? faceOf.get(`${solid.id}|all`);
      const key = face !== undefined ? `face|${face}|${solid.material}` : `material|${solid.material}`;
      let group = groups.get(key);
      if (!group) {
        group = { indices: [], slot: slots.length };
        groups.set(key, group);
        slots.push({ index: slots.length, material: solid.material, ...(face !== undefined ? { face } : {}) });
      }
      for (const index of side.indices) group.indices.push(base + index);
    }
  }
  return { geometry: toGeometry(positions, normals, uvs, [...groups.values()]), slots };
}

/**
 * Texture repeat of a material's finish on a face of the given size (mm), for geometry with
 * `uv: 'face'`. A `face` fit shows the artwork once across the face; a tiled finish repeats every
 * `scaleMm` (or `fallbackScaleMm` when the finish names no pattern size).
 */
export function finishRepeat(
  material: Pick<PartMaterial, 'finish' | 'finishFit'>, face: { width: number; height: number }, fallbackScaleMm = 1000,
): { x: number; y: number } {
  if (material.finishFit === 'face') return { x: 1, y: 1 };
  const finish = material.finish;
  const scaleMm = finish && finish.kind !== 'paint' && finish.scaleMm !== undefined ? finish.scaleMm : fallbackScaleMm;
  return { x: face.width / scaleMm, y: face.height / scaleMm };
}

/** three.js matrix that moves part-local geometry to its placement in the stage (millimetres). */
export function placementMatrix(placement: PartPlacement): Matrix4 {
  return new Matrix4().makeRotationY(placementRotationY(placement)).setPosition(placement.x, placement.elevation ?? 0, placement.y);
}
