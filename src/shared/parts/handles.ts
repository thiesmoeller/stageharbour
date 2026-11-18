import type { Formula } from './formula.js';
import { calculateFormula } from './formula.js';
import type { PartBody, PartChild, PartDefinition, PartFaceSide } from './definition.js';
import {
  add, dot, normalize, quatAxes, quatMultiply, rotate, scale, signedArea, sub, type Quat, type Vec2, type Vec3,
} from './math.js';
import { ANCHOR_OFFSET, PLANE_ROTATION, type ResolvedPart, type ResolvedSolid } from './resolve.js';
import { repeatLevels } from './sites.js';

/**
 * Direct-modelling handles. Each body kind declares which handles it offers and how a drag
 * changes its fields; tools only read the declaration and never ask for the body kind.
 */

/** Path of a field inside a body or child: `['size', 1]`, `['outline', 'points', 2, 0]`. */
export type FieldPath = readonly (string | number)[];

/** The field changes by `dot(coefficient, delta)` for a drag `delta` in part millimetres. */
export type HandleWrite = {
  path: FieldPath;
  coefficient: Vec3;
  /** Value an optional field that is missing starts from, such as a beam section from its profile. */
  initial?: number;
};

export type HandleKind = 'face' | 'point' | 'edge' | 'rotation';

export type Handle = {
  /** `<solid id>:<name>`, unique in the resolved part. */
  id: string;
  solid: string;
  body: string;
  /** Repeat index of the solid, for formulas that read the repeat index. */
  index: number[];
  kind: HandleKind;
  /** Stable inside the body: `side:top`, `edge:2`, `point:to`, `rotate:y`. */
  name: string;
  label: string;
  /** In part millimetres. */
  position: Vec3;
  /**
   * Face and edge: the outward direction a drag moves along. Point: the normal of the plane the
   * point slides in. Rotation: the axis.
   */
  axis: Vec3;
  /** The picked side the handle answers. */
  side?: PartFaceSide;
  /** Edge handles: the edge, to find the nearest one under the pointer. */
  segment?: readonly [Vec3, Vec3];
  writes: HandleWrite[];
  /** What the drag measures, for the live label and the value box. */
  measure?: { label: string; value: number; path?: FieldPath };
};

const UNIT_X: Vec3 = { x: 1, y: 0, z: 0 };
const UNIT_Y: Vec3 = { x: 0, y: 1, z: 0 };
const UNIT_Z: Vec3 = { x: 0, y: 0, z: 1 };
const AXES: readonly Vec3[] = [UNIT_X, UNIT_Y, UNIT_Z];
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const component = (v: Vec3, axis: number) => axis === 0 ? v.x : axis === 1 ? v.y : v.z;
const conjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export const pathKey = (path: FieldPath) => path.reduce<string>((text, part) =>
  typeof part === 'number' ? `${text}[${part}]` : text ? `${text}.${part}` : part, '');

/** Names a formula of the body can read: parameters, derived values and the repeat indices of the instance. */
export function elementScope(
  resolved: Pick<ResolvedPart, 'values' | 'derived'>,
  element?: Pick<PartBody | PartChild, 'repeat'>,
  index: readonly number[] = [],
): Map<string, number> {
  const scope = new Map<string, number>([...Object.entries(resolved.values), ...Object.entries(resolved.derived)]);
  repeatLevels(element?.repeat).forEach((level, position) => scope.set(level.index, index[position] ?? 0));
  return scope;
}

function evaluated(formula: Formula | undefined, scope: ReadonlyMap<string, number>): number | undefined {
  if (formula === undefined) return undefined;
  try {
    const value = calculateFormula(formula, scope);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes that shift a pose point (`at`, `pivot`) by `factor` times a drag along `direction`.
 * Without a pivot `at` is in the part frame; with one it is turned by `pose` about the pivot.
 */
function shiftWrites(field: 'at' | 'pivot' | 'from' | 'to', direction: Vec3, factor: number, pose?: Quat): HandleWrite[] {
  const local = pose ? rotate(conjugate(pose), direction) : direction;
  return [0, 1, 2].map(axis => ({ path: [field, axis], coefficient: scale(direction, factor * component(local, axis)) }));
}

/** Writes of a free move by any vector: every component of the point follows. */
const freeWrites = (field: 'at' | 'pivot' | 'from' | 'to'): HandleWrite[] =>
  [0, 1, 2].map(axis => ({ path: [field, axis], coefficient: AXES[axis]! }));

/** Writes that move a whole body or child by a drag vector. */
export function moveWrites(element: PartBody | PartChild): HandleWrite[] {
  if ('kind' in element && element.kind === 'beam') return [...freeWrites('from'), ...freeWrites('to')];
  return [...freeWrites('at'), ...(element.pivot ? freeWrites('pivot') : [])];
}

const BOX_SIDES: readonly { side: PartFaceSide; axis: number; sign: 1 | -1; label: string }[] = [
  { side: 'right', axis: 0, sign: 1, label: 'Rechte Seite' },
  { side: 'left', axis: 0, sign: -1, label: 'Linke Seite' },
  { side: 'top', axis: 1, sign: 1, label: 'Oberseite' },
  { side: 'bottom', axis: 1, sign: -1, label: 'Unterseite' },
  { side: 'back', axis: 2, sign: 1, label: 'Rückseite' },
  { side: 'front', axis: 2, sign: -1, label: 'Vorderseite' },
];
const BOX_MEASURES = ['Breite', 'Höhe', 'Tiefe'];

function rotationHandles(base: Pick<Handle, 'solid' | 'body' | 'index'>, centre: Vec3): Handle[] {
  return (['x', 'y', 'z'] as const).map((name, axis) => ({
    ...base, id: `${base.solid}:rotate:${name}`, kind: 'rotation' as const, name: `rotate:${name}`,
    label: `Drehen um ${name.toUpperCase()}`, position: centre, axis: AXES[axis]!, writes: [],
  }));
}

function boxHandles(body: Extract<PartBody, { kind: 'box' | 'mesh' }>, solid: Extract<ResolvedSolid, { kind: 'box' }>): Handle[] {
  const base = { solid: solid.id, body: body.key, index: solid.index };
  const axes = quatAxes(solid.rotation);
  const local = [axes.x, axes.y, axes.z];
  const pose = body.pivot ? solid.rotation : undefined;
  const faces = BOX_SIDES.map(({ side, axis, sign, label }): Handle => {
    const normal = scale(local[axis]!, sign);
    const half = component(solid.size, axis) / 2;
    return {
      ...base, id: `${solid.id}:side:${side}`, kind: 'face', name: `side:${side}`, label, side,
      position: add(solid.center, scale(normal, half)), axis: normal,
      writes: [{ path: ['size', axis], coefficient: normal }, ...shiftWrites('at', normal, 0.5, pose)],
      measure: { label: BOX_MEASURES[axis]!, value: component(solid.size, axis), path: ['size', axis] },
    };
  });
  return [...faces, ...rotationHandles(base, solid.center)];
}

function beamHandles(body: Extract<PartBody, { kind: 'beam' }>, solid: Extract<ResolvedSolid, { kind: 'beam' }>): Handle[] {
  const base = { solid: solid.id, body: body.key, index: solid.index };
  const axes = quatAxes(solid.rotation);
  const direction = axes.y;
  const end = (side: 'top' | 'bottom'): Handle => {
    const normal = side === 'top' ? direction : scale(direction, -1);
    const field = side === 'top' ? 'to' : 'from';
    return {
      ...base, id: `${solid.id}:side:${side}`, kind: 'face', name: `side:${side}`, label: side === 'top' ? 'Ende' : 'Anfang', side,
      position: side === 'top' ? solid.to : solid.from, axis: normal, writes: shiftWrites(field, normal, 1),
      measure: { label: 'Länge', value: solid.length },
    };
  };
  const section = (side: PartFaceSide, axis: 0 | 2, sign: 1 | -1): Handle => {
    const normal = scale(axis === 0 ? axes.x : axes.z, sign);
    const slot = axis === 0 ? 0 : 1;
    const value = axis === 0 ? solid.size.x : solid.size.z;
    return {
      ...base, id: `${solid.id}:side:${side}`, kind: 'face', name: `side:${side}`, label: 'Seite', side,
      position: add(solid.center, scale(normal, value / 2)), axis: normal,
      writes: [
        { path: ['section', slot], coefficient: normal, initial: value },
        ...shiftWrites('from', normal, 0.5), ...shiftWrites('to', normal, 0.5),
      ],
      measure: { label: axis === 0 ? 'Querschnittsbreite' : 'Querschnittshöhe', value, path: ['section', slot] },
    };
  };
  const points = (['from', 'to'] as const).map((field): Handle => ({
    ...base, id: `${solid.id}:point:${field}`, kind: 'point', name: `point:${field}`, label: field === 'from' ? 'Anfangspunkt' : 'Endpunkt',
    position: solid[field], axis: UNIT_Y, writes: freeWrites(field),
  }));
  return [
    end('top'), end('bottom'),
    section('right', 0, 1), section('left', 0, -1), section('back', 2, 1), section('front', 2, -1),
    ...points, ...rotationHandles(base, solid.center),
  ];
}

function sheetHandles(
  body: Extract<PartBody, { kind: 'sheet' }>, solid: Extract<ResolvedSolid, { kind: 'sheet' }>, scope: ReadonlyMap<string, number>,
): Handle[] {
  const base = { solid: solid.id, body: body.key, index: solid.index };
  const axes = quatAxes(solid.rotation);
  const pose = body.pivot ? quatMultiply(solid.rotation, conjugate(PLANE_ROTATION[body.plane])) : undefined;
  const offset = ANCHOR_OFFSET[body.anchor ?? 'face'];
  const at = (point: Vec2, w: number) => add(solid.origin, rotate(solid.rotation, { x: point.x, y: point.y, z: w }));
  const inPlane = (u: number, v: number) => add(scale(axes.x, u), scale(axes.y, v));
  const centre = solid.outline.reduce((sum, point) => ({ x: sum.x + point.x / solid.outline.length, y: sum.y + point.y / solid.outline.length }), { x: 0, y: 0 });
  const flat = Math.abs(axes.z.y) >= 0.5;
  const thickness = { label: flat ? 'Höhe' : 'Stärke', value: solid.thickness, path: ['thickness'] as FieldPath };
  const back: Handle = {
    ...base, id: `${solid.id}:side:back`, kind: 'face', name: 'side:back', label: 'Rückseite', side: 'back',
    position: at(centre, solid.thickness), axis: axes.z,
    writes: [{ path: ['thickness'], coefficient: axes.z, initial: solid.thickness }, ...shiftWrites('at', axes.z, -offset, pose)],
    measure: thickness,
  };
  const frontNormal = scale(axes.z, -1);
  const front: Handle = {
    ...base, id: `${solid.id}:side:front`, kind: 'face', name: 'side:front', label: 'Vorderseite', side: 'front',
    position: at(centre, 0), axis: frontNormal,
    writes: [{ path: ['thickness'], coefficient: frontNormal, initial: solid.thickness }, ...shiftWrites('at', frontNormal, 1 + offset, pose)],
    measure: thickness,
  };
  const mid = solid.thickness / 2;
  const edges: Handle[] = [];
  const points: Handle[] = [];
  const outline = body.outline;
  if (outline.shape === 'rect') {
    const x = evaluated(outline.x, scope), y = evaluated(outline.y, scope);
    const width = evaluated(outline.width, scope), height = evaluated(outline.height, scope);
    if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
      const corner = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
      const rectEdge = (name: string, from: Vec2, to: Vec2, normal: Vec3, writes: HandleWrite[], measure: Handle['measure']): Handle => ({
        ...base, id: `${solid.id}:edge:${name}`, kind: 'edge', name: `edge:${name}`, label: 'Kante', side: 'edge',
        position: at({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, mid), axis: normal,
        segment: [at(from, mid), at(to, mid)], writes, measure,
      });
      const widthMeasure = { label: 'Breite', value: width, path: ['outline', 'width'] as FieldPath };
      const heightMeasure = { label: 'Höhe', value: height, path: ['outline', 'height'] as FieldPath };
      const left = scale(axes.x, -1), down = scale(axes.y, -1);
      edges.push(
        rectEdge('right', corner[1]!, corner[2]!, axes.x, [{ path: ['outline', 'width'], coefficient: axes.x }], widthMeasure),
        rectEdge('top', corner[2]!, corner[3]!, axes.y, [{ path: ['outline', 'height'], coefficient: axes.y }], heightMeasure),
        rectEdge('left', corner[3]!, corner[0]!, left,
          [{ path: ['outline', 'x'], coefficient: axes.x }, { path: ['outline', 'width'], coefficient: left }], widthMeasure),
        rectEdge('bottom', corner[0]!, corner[1]!, down,
          [{ path: ['outline', 'y'], coefficient: axes.y }, { path: ['outline', 'height'], coefficient: down }], heightMeasure),
      );
    }
  } else if (outline.shape === 'circle') {
    const cx = evaluated(outline.cx, scope), cy = evaluated(outline.cy, scope), r = evaluated(outline.r, scope);
    if (cx !== undefined && cy !== undefined && r !== undefined) {
      const rim: Vec2 = { x: cx + r, y: cy };
      const tangent: Vec2 = { x: cx + r, y: cy + Math.max(r * 0.15, 1) };
      points.push({
        ...base, id: `${solid.id}:point:centre`, kind: 'point', name: 'point:centre', label: 'Mittelpunkt',
        position: at({ x: cx, y: cy }, mid), axis: axes.z,
        writes: [
          { path: ['outline', 'cx'], coefficient: axes.x },
          { path: ['outline', 'cy'], coefficient: axes.y },
        ],
      });
      edges.push({
        ...base, id: `${solid.id}:edge:radius`, kind: 'edge', name: 'edge:radius', label: 'Radius', side: 'edge',
        position: at(rim, mid), axis: axes.x,
        segment: [at(rim, mid), at(tangent, mid)],
        writes: [{ path: ['outline', 'r'], coefficient: axes.x }],
        measure: { label: 'Radius', value: r, path: ['outline', 'r'] },
      });
    }
  } else {
    const values = outline.points.map(point => ({ x: evaluated(point[0], scope), y: evaluated(point[1], scope) }));
    if (values.every(point => point.x !== undefined && point.y !== undefined)) {
      const loop = values as Vec2[];
      const turn = signedArea(loop) >= 0 ? 1 : -1;
      loop.forEach((from, index) => {
        const next = (index + 1) % loop.length;
        const to = loop[next]!;
        const along = normalize({ x: to.x - from.x, y: to.y - from.y, z: 0 });
        const outward = { x: along.y * turn, y: -along.x * turn };
        const normal = inPlane(outward.x, outward.y);
        edges.push({
          ...base, id: `${solid.id}:edge:${index}`, kind: 'edge', name: `edge:${index}`, label: 'Kante', side: 'edge',
          position: at({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, mid), axis: normal,
          segment: [at(from, mid), at(to, mid)],
          writes: [index, next].flatMap(point => [
            { path: ['outline', 'points', point, 0], coefficient: scale(normal, outward.x) },
            { path: ['outline', 'points', point, 1], coefficient: scale(normal, outward.y) },
          ]),
        });
        points.push({
          ...base, id: `${solid.id}:point:${index}`, kind: 'point', name: `point:${index}`, label: 'Eckpunkt',
          position: at(from, mid), axis: axes.z,
          writes: [
            { path: ['outline', 'points', index, 0], coefficient: axes.x },
            { path: ['outline', 'points', index, 1], coefficient: axes.y },
          ],
        });
      });
    }
  }
  return [front, back, ...edges, ...points, ...rotationHandles(base, at(centre, mid))];
}

/** Handles of one solid of the definition's own bodies; solids of children have none. */
export function solidHandles(definition: PartDefinition, resolved: Pick<ResolvedPart, 'values' | 'derived'>, solid: ResolvedSolid): Handle[] {
  if (solid.path.length) return [];
  const body = definition.bodies.find(item => item.key === solid.body);
  if (!body) return [];
  if ((body.kind === 'box' || body.kind === 'mesh') && solid.kind === 'box') return boxHandles(body, solid);
  if (body.kind === 'beam' && solid.kind === 'beam') return beamHandles(body, solid);
  if (body.kind === 'sheet' && solid.kind === 'sheet') return sheetHandles(body, solid, elementScope(resolved, body, solid.index));
  return [];
}

export function partHandles(definition: PartDefinition, resolved: ResolvedPart): Handle[] {
  return resolved.solids.flatMap(solid => solidHandles(definition, resolved, solid));
}

function distanceToSegment(point: Vec3, [a, b]: readonly [Vec3, Vec3]): number {
  const ab = sub(b, a);
  const span = dot(ab, ab);
  const t = span > 0 ? Math.min(1, Math.max(0, dot(sub(point, a), ab) / span)) : 0;
  const closest = add(a, scale(ab, t));
  return Math.hypot(point.x - closest.x, point.y - closest.y, point.z - closest.z);
}

/** The face or edge handle a pick of `side` at `point` grabs: an edge pick takes the nearest edge. */
export function handleForPick(handles: readonly Handle[], solid: string, side: PartFaceSide, point: Vec3 = ZERO): Handle | undefined {
  const candidates = handles.filter(handle => handle.solid === solid && handle.side === side && handle.kind !== 'point');
  if (candidates.length < 2) return candidates[0];
  return candidates.reduce((best, handle) => {
    const distance = handle.segment ? distanceToSegment(point, handle.segment) : Math.hypot(...Object.values(sub(point, handle.position)));
    const bestDistance = best.segment ? distanceToSegment(point, best.segment) : Math.hypot(...Object.values(sub(point, best.position)));
    return distance < bestDistance ? handle : best;
  });
}
