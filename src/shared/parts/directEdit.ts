import { calculateFormula, type Formula } from './formula.js';
import {
  PART_LIMITS, normalizeParameterValue, type BeamBody, type BoxBody, type PartBody, type PartChild,
  type PartDefinition, type SheetBody,
} from './definition.js';
import { elementScope, moveWrites, pathKey, type FieldPath, type Handle, type HandleWrite } from './handles.js';
import {
  add, cross, dot, eulerDegreesFromQuat, isSimplePolygon, length, polygonArea, normalize, quatAxes, quatFromAxisAngle, quatFromBasis, quatFromEulerDegrees,
  quatMultiply, rotate, scale, sub, type Quat, type Vec2, type Vec3,
} from './math.js';
import { ANCHOR_OFFSET, solidFace, type ResolvedPart, type ResolvedSheet, type ResolvedSolid } from './resolve.js';

/**
 * Direct edits of a definition from drags in the 3D view. A field holding a number takes the new
 * number. A field holding a bare parameter name moves that parameter (its value in the active
 * variant for variant scope, else its default). Any other formula wins: the edit is refused,
 * unless the formula already lands on the dragged value once the parameters have moved.
 */

export type EditTarget = { body: string; index?: readonly number[] } | { child: string; index?: readonly number[] };
export type LockedField = { path: string; formula: string };
export type EditResult =
  | { ok: true; definition: PartDefinition; parameters: string[] }
  | { ok: false; reason: 'locked' | 'range' | 'missing' | 'invalid'; message: string; locked?: LockedField[] };

type Resolved = Pick<ResolvedPart, 'values' | 'derived' | 'variant' | 'solids'>;
type FieldSet = { path: FieldPath; value: number };
type EditFailure = Extract<EditResult, { ok: false }>;

const EPS = 1e-6;
/** A formula that follows the drag may miss it by rounding. */
const FOLLOW_EPS = 1e-3;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

export const roundMm = (value: number) => {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

function normalizeAngle(degrees: number): number {
  let angle = ((degrees + 180) % 360 + 360) % 360 - 180;
  if (angle <= -180 + EPS) angle = 180;
  return roundMm(angle);
}

const fail = (reason: EditFailure['reason'], message: string, locked?: LockedField[]): EditFailure =>
  ({ ok: false, reason, message, ...(locked ? { locked } : {}) });

function findElement(definition: PartDefinition, target: EditTarget): PartBody | PartChild | undefined {
  return 'body' in target
    ? definition.bodies.find(body => body.key === target.body)
    : definition.children?.find(child => child.key === target.child);
}

function readPath(element: unknown, path: FieldPath): unknown {
  let current = element;
  for (const part of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

/** The formula at `path` of a body or child, when it is one; numbers and missing fields give `undefined`. */
export function fieldFormula(definition: PartDefinition, target: EditTarget, path: FieldPath): string | undefined {
  const element = findElement(definition, target);
  const value = element && readPath(element, path);
  return typeof value === 'string' ? value : undefined;
}

function evaluate(formula: Formula, scope: ReadonlyMap<string, number>): number | undefined {
  try {
    const value = calculateFormula(formula, scope);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Parameters with new values, the derived values recomputed over them. */
function scopeWith(
  definition: PartDefinition, resolved: Resolved, element: PartBody | PartChild, index: readonly number[], values: Record<string, number>,
): Map<string, number> {
  const scope = elementScope({ values: { ...resolved.values, ...values }, derived: {} }, element, index);
  for (const item of definition.derived ?? []) {
    const value = evaluate(item.formula, scope);
    if (value !== undefined) scope.set(item.key, value);
  }
  return scope;
}

/** What an optional field that is missing stands for. */
function missingValue(element: PartBody | PartChild, path: FieldPath, solid: ResolvedSolid | undefined): number | undefined {
  const [field, slot] = path;
  if (field === 'rotation' || field === 'roll') return 0;
  if (field === 'section' && solid?.kind === 'beam') return slot === 0 ? solid.size.x : solid.size.z;
  if (field === 'thickness' && solid?.kind === 'sheet') return solid.thickness;
  return undefined;
}

function missingArray(field: string | number, solid: ResolvedSolid | undefined): number[] | undefined {
  if (field === 'rotation') return [0, 0, 0];
  if (field === 'section' && solid?.kind === 'beam') return [roundMm(solid.size.x), roundMm(solid.size.z)];
  return undefined;
}

function writePath(element: Record<string | number, unknown>, path: FieldPath, value: number, solid: ResolvedSolid | undefined) {
  let current: Record<string | number, unknown> = element;
  for (let position = 0; position < path.length - 1; position++) {
    const part = path[position]!;
    if (current[part] === undefined) {
      const created = missingArray(part, solid);
      if (!created) throw new Error(`missing field ${pathKey(path)}`);
      current[part] = created;
    }
    current = current[part] as Record<string | number, unknown>;
  }
  current[path[path.length - 1]!] = value;
}

function solidOf(resolved: Resolved, target: EditTarget): ResolvedSolid | undefined {
  if (!('body' in target)) return undefined;
  const index = target.index ?? [];
  return resolved.solids.find(solid => !solid.path.length && solid.body === target.body && solid.index.join() === index.join())
    ?? resolved.solids.find(solid => !solid.path.length && solid.body === target.body);
}

function rangeText(definition: PartDefinition, key: string): string {
  const parameter = definition.parameters.find(item => item.key === key)!;
  if (parameter.values?.length) return `„${parameter.label}“ erlaubt nur ${parameter.values.join(', ')}.`;
  if (parameter.range) return `„${parameter.label}“ liegt zwischen ${parameter.range.min} und ${parameter.range.max}${parameter.range.step ? ` in Schritten von ${parameter.range.step}` : ''}.`;
  return `„${parameter.label}“ erlaubt diesen Wert nicht.`;
}

/** Sets fields of a body or child to absolute values under the formula rule. */
export function setFields(definition: PartDefinition, resolved: Resolved, target: EditTarget, sets: readonly FieldSet[]): EditResult {
  const element = findElement(definition, target);
  if (!element) return fail('missing', 'Das Element gibt es nicht mehr.');
  const index = target.index ?? [];
  const solid = solidOf(resolved, target);
  const scope = scopeWith(definition, resolved, element, index, {});
  const numbers: FieldSet[] = [];
  const requests = new Map<string, number>();
  const pending: { path: FieldPath; formula: string; value: number }[] = [];
  const locked: LockedField[] = [];
  const parameters = new Map(definition.parameters.map(parameter => [parameter.key, parameter]));

  for (const { path, value } of sets) {
    const formula = readPath(element, path) as Formula | undefined;
    const current = formula === undefined ? missingValue(element, path, solid) : evaluate(formula, scope);
    if (current === undefined) {
      if (formula === undefined) return fail('missing', `Das Feld ${pathKey(path)} fehlt.`);
      locked.push({ path: pathKey(path), formula: String(formula) });
      continue;
    }
    if (Math.abs(value - current) <= EPS) continue;
    if (formula === undefined || typeof formula === 'number') {
      numbers.push({ path, value });
      continue;
    }
    const name = formula.trim();
    if (IDENTIFIER.test(name) && parameters.has(name)) {
      const target = resolved.values[name]! + (value - current);
      const earlier = requests.get(name);
      if (earlier !== undefined && Math.abs(earlier - target) > FOLLOW_EPS) locked.push({ path: pathKey(path), formula });
      else requests.set(name, target);
      continue;
    }
    pending.push({ path, formula, value });
  }

  for (const [key, value] of requests) {
    const parameter = parameters.get(key)!;
    const settled = normalizeParameterValue(parameter, value);
    // Snap to step / listed values; only refuse when the drag leaves the allowed min/max or list.
    if (parameter.values?.length) {
      if (Math.abs(settled - value) > FOLLOW_EPS) return fail('range', rangeText(definition, key));
      continue;
    }
    if (parameter.range && (value < parameter.range.min - FOLLOW_EPS || value > parameter.range.max + FOLLOW_EPS)) {
      return fail('range', rangeText(definition, key));
    }
  }
  if (pending.length) {
    const moved = scopeWith(definition, resolved, element, index, Object.fromEntries(requests));
    for (const item of pending) {
      const value = evaluate(item.formula, moved);
      if (value === undefined || Math.abs(value - item.value) > FOLLOW_EPS) locked.push({ path: pathKey(item.path), formula: item.formula });
    }
  }
  if (locked.length) {
    const fields = locked.map(item => `${item.path} = ${item.formula}`).join(', ');
    return fail('locked', `Gesperrt durch die Formel ${fields}.`, locked);
  }

  const next = structuredClone(definition);
  const editable = findElement(next, target) as unknown as Record<string | number, unknown>;
  for (const { path, value } of numbers) {
    writePath(editable, path, path[0] === 'rotation' || path[0] === 'roll' ? normalizeAngle(value) : roundMm(value), solid);
  }
  const variant = next.variants?.find(item => item.key === resolved.variant);
  for (const [key, value] of requests) {
    const parameter = next.parameters.find(item => item.key === key)!;
    const settled = roundMm(normalizeParameterValue(parameter, value));
    if (parameter.scope === 'variant' && variant) variant.values[key] = settled;
    else parameter.default = settled;
  }
  return { ok: true, definition: next, parameters: [...requests.keys()] };
}

/** Applies linear handle writes for a drag `delta` in part millimetres. */
export function applyWrites(
  definition: PartDefinition, resolved: Resolved, target: EditTarget, writes: readonly HandleWrite[], delta: Vec3,
): EditResult {
  const element = findElement(definition, target);
  if (!element) return fail('missing', 'Das Element gibt es nicht mehr.');
  const scope = scopeWith(definition, resolved, element, target.index ?? [], {});
  const solid = solidOf(resolved, target);
  const merged = new Map<string, { path: FieldPath; change: number; initial?: number }>();
  for (const write of writes) {
    const key = pathKey(write.path);
    const change = dot(write.coefficient, delta);
    const known = merged.get(key);
    if (known) known.change += change;
    else merged.set(key, { path: write.path, change, initial: write.initial });
  }
  const sets: FieldSet[] = [];
  for (const { path, change, initial } of merged.values()) {
    if (Math.abs(change) <= EPS) continue;
    const formula = readPath(element, path) as Formula | undefined;
    const current = formula === undefined ? initial ?? missingValue(element, path, solid) : evaluate(formula, scope);
    if (current === undefined) {
      if (formula === undefined) return fail('missing', `Das Feld ${pathKey(path)} fehlt.`);
      return fail('locked', `Gesperrt durch die Formel ${pathKey(path)} = ${formula}.`, [{ path: pathKey(path), formula: String(formula) }]);
    }
    sets.push({ path, value: current + change });
  }
  return setFields(definition, resolved, target, sets);
}

const targetOf = (handle: Pick<Handle, 'body' | 'index'>): EditTarget => ({ body: handle.body, index: handle.index });

/** Pushes or pulls a face or edge handle by `distance` along its axis. */
export function pushPullFace(definition: PartDefinition, resolved: Resolved, handle: Handle, distance: number): EditResult {
  return applyWrites(definition, resolved, targetOf(handle), handle.writes, scale(handle.axis, distance));
}

/**
 * Ctrl+Drücken/Ziehen: leave the face, add a new body extruded from it by `distance`.
 * Box and beam faces become a new box; sheet front/back keep the outline as a new thick sheet.
 */
export function pushPullNewBody(definition: PartDefinition, resolved: Resolved, handle: Handle, distance: number): EditResult {
  if (Math.abs(distance) < 1) return fail('invalid', 'Der Abstand ist zu klein.');
  if (handle.kind !== 'face' || !handle.side) {
    return fail('invalid', 'Nur Flächen lassen sich als neuer Körper ziehen (Strg beim Ziehen).');
  }
  const solid = resolved.solids.find(item => item.id === handle.solid);
  const body = definition.bodies.find(item => item.key === handle.body);
  if (!solid || !body || body.kind === 'mesh' || !('material' in body)) {
    return fail('missing', 'Das Element gibt es nicht mehr.');
  }
  if (body.kind === 'sheet' && solid.kind === 'sheet' && (handle.side === 'front' || handle.side === 'back')) {
    const added = extrudeNewSheet(definition, body, solid, handle.side, handle.axis, distance);
    return added.ok ? { ok: true, definition: added.definition, parameters: [] } : added;
  }
  const face = solidFace(solid, handle.side);
  if (!face?.plane) return fail('invalid', 'Nur Flächen lassen sich als neuer Körper ziehen (Strg beim Ziehen).');
  const { origin, u, v, outline } = face.plane;
  const xs = outline.map(point => point.x);
  const ys = outline.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  if (!(maxX - minX >= 1 && maxY - minY >= 1)) return fail('invalid', 'Die Fläche ist zu klein.');
  const corner = add(origin, add(scale(u, minX), scale(v, minY)));
  const opposite = add(origin, add(scale(u, maxX), scale(v, maxY)));
  const added = addBoxFromRect(definition, { corner, opposite, u, normal: handle.axis, height: distance }, body.material);
  return added.ok ? { ok: true, definition: added.definition, parameters: [] } : added;
}

/** Resolved outline as plain numbers so the new body is not tied to the source's B/T formulas. */
function bakedSheetOutline(solid: ResolvedSheet): SheetBody['outline'] {
  const bounds = axisAlignedRectBounds(solid.outline);
  if (bounds) {
    return {
      shape: 'rect',
      x: roundMm(bounds.minU),
      y: roundMm(bounds.minV),
      width: roundMm(bounds.maxU - bounds.minU),
      height: roundMm(bounds.maxV - bounds.minV),
    };
  }
  return {
    shape: 'polygon',
    points: solid.outline.map(point => [roundMm(point.x), roundMm(point.y)] as [number, number]),
  };
}

/** A new sheet whose front sits on the pulled face and whose thickness is `|distance|`. */
function extrudeNewSheet(
  definition: PartDefinition,
  body: SheetBody,
  solid: ResolvedSheet,
  side: 'front' | 'back',
  axis: Vec3,
  distance: number,
): AddResult {
  const thickness = roundMm(Math.abs(distance));
  const axes = quatAxes(solid.rotation);
  const faceOrigin = side === 'back' ? add(solid.origin, scale(axes.z, solid.thickness)) : solid.origin;
  const outward = scale(axis, Math.sign(distance) || 1);
  // Material grows along local +z; place the front on the face when that matches the pull.
  const solidOrigin = dot(axes.z, outward) >= 0 ? faceOrigin : add(faceOrigin, scale(outward, thickness));
  const anchor = body.anchor ?? 'face';
  const at = add(solidOrigin, scale(axes.z, -ANCHOR_OFFSET[anchor] * thickness));
  // Bake pose + outline to numbers: cloning formulas (Neu-Tisch `B`/`T`) would lock side pulls to the table.
  const copy: SheetBody = {
    kind: 'sheet',
    key: uniqueElementKey(definition, body.key),
    material: body.material,
    plane: body.plane,
    anchor,
    thickness,
    at: rounded(at),
    outline: bakedSheetOutline(solid),
    ...(body.label ? { label: body.label } : {}),
    ...(body.displayOnly ? { displayOnly: true } : {}),
    ...(body.rotation ? { rotation: structuredClone(body.rotation) } : {}),
    ...(body.pivot ? { pivot: structuredClone(body.pivot) } : {}),
  };
  return withBody(definition, copy);
}

/** Sets what a handle measures to `value`, as typed into the value box. */
export function setHandleMeasure(definition: PartDefinition, resolved: Resolved, handle: Handle, value: number): EditResult {
  if (!handle.measure) return fail('invalid', 'Dieser Griff hat kein Maß.');
  return pushPullFace(definition, resolved, handle, value - handle.measure.value);
}

/** Moves a point handle (a beam end, a polygon corner) by a vector. */
export function moveVertex(definition: PartDefinition, resolved: Resolved, handle: Handle, delta: Vec3): EditResult {
  return applyWrites(definition, resolved, targetOf(handle), handle.writes, delta);
}

/** The fields a drag of the handle would be refused by, or none. */
export function handleLocks(definition: PartDefinition, resolved: Resolved, handle: Handle): LockedField[] {
  const probe = handle.kind === 'point' ? normalize(cross(handle.axis, { x: 0.3, y: 0.5, z: 0.7 })) : handle.axis;
  const result = applyWrites(definition, resolved, targetOf(handle), handle.writes, scale(probe, 10));
  return result.ok ? [] : result.locked ?? [];
}

function moveElement(definition: PartDefinition, resolved: Resolved, target: EditTarget, delta: Vec3): EditResult {
  const element = findElement(definition, target);
  if (!element) return fail('missing', 'Das Element gibt es nicht mehr.');
  return applyWrites(definition, resolved, target, moveWrites(element), delta);
}

export const moveBody = (definition: PartDefinition, resolved: Resolved, body: string, delta: Vec3, index?: readonly number[]) =>
  moveElement(definition, resolved, { body, index }, delta);
export const moveChild = (definition: PartDefinition, resolved: Resolved, child: string, delta: Vec3) =>
  moveElement(definition, resolved, { child }, delta);

/** Bodies and groups a move, rotate or copy acts on together. */
export type SelectionTargets = { bodies: readonly string[]; children: readonly string[] };

function eachTarget(
  definition: PartDefinition, resolved: Resolved, targets: SelectionTargets,
  apply: (current: PartDefinition, target: EditTarget) => EditResult,
): EditResult {
  let current = definition;
  const parameters: string[] = [];
  const run = (target: EditTarget) => {
    const result = apply(current, target);
    if (!result.ok) return result;
    current = result.definition;
    parameters.push(...result.parameters);
    return undefined;
  };
  for (const body of targets.bodies) {
    const failed = run({ body });
    if (failed) return failed;
  }
  for (const child of targets.children) {
    const failed = run({ child });
    if (failed) return failed;
  }
  return { ok: true, definition: current, parameters };
}

/** Moves every selected body and group by the same vector. */
export function moveSelection(definition: PartDefinition, resolved: Resolved, targets: SelectionTargets, delta: Vec3): EditResult {
  return eachTarget(definition, resolved, targets, (current, target) => moveElement(current, resolved, target, delta));
}

/** Turns every selected body and group by the same angle about one pivot. */
export function rotateSelection(
  definition: PartDefinition, resolved: Resolved, targets: SelectionTargets, axis: Vec3, degrees: number, pivot?: Vec3,
): EditResult {
  return eachTarget(definition, resolved, targets, (current, target) => rotateElement(current, resolved, target, axis, degrees, pivot));
}

function cloneTargets(definition: PartDefinition, targets: SelectionTargets): { definition: PartDefinition; targets: SelectionTargets } | EditFailure {
  const next = structuredClone(definition);
  const bodies: string[] = [];
  const children: string[] = [];
  for (const key of targets.bodies) {
    const body = next.bodies.find(item => item.key === key);
    if (!body) return fail('missing', 'Das Element gibt es nicht mehr.');
    const copy = structuredClone(body);
    copy.key = uniqueElementKey(next, `${key}-kopie`);
    next.bodies.push(copy);
    bodies.push(copy.key);
  }
  for (const key of targets.children) {
    const child = next.children?.find(item => item.key === key);
    if (!child) return fail('missing', 'Das Element gibt es nicht mehr.');
    const copy = structuredClone(child);
    copy.key = uniqueElementKey(next, `${key}-kopie`);
    next.children = [...(next.children ?? []), copy];
    children.push(copy.key);
  }
  return { definition: next, targets: { bodies, children } };
}

/** Copies the selection and moves the copies by `delta`. The originals stay. */
export function copySelection(definition: PartDefinition, resolved: Resolved, targets: SelectionTargets, delta: Vec3): EditResult {
  const cloned = cloneTargets(definition, targets);
  if ('ok' in cloned) return cloned;
  return moveSelection(cloned.definition, resolved, cloned.targets, delta);
}

/** Copies the selection and turns the copies about `pivot`. The originals stay. */
export function copyRotateSelection(
  definition: PartDefinition, resolved: Resolved, targets: SelectionTargets, axis: Vec3, degrees: number, pivot?: Vec3,
): EditResult {
  const cloned = cloneTargets(definition, targets);
  if ('ok' in cloned) return cloned;
  return rotateSelection(cloned.definition, resolved, cloned.targets, axis, degrees, pivot);
}

const UNIT_AXES: readonly Vec3[] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];

/**
 * Euler angles after turning by `degrees` about a part axis. Turning about X adds to X; about Y
 * adds to Y while X is zero; about Z adds to Z while X and Y are zero; else the angles are
 * recomputed from the combined rotation.
 */
function turnedAngles(angles: Vec3, axis: Vec3, degrees: number, turn: Quat, rotation: Quat): Vec3 {
  const unit = UNIT_AXES.findIndex(candidate => Math.abs(dot(candidate, axis) - 1) <= 1e-9);
  if (unit === 0) return { ...angles, x: angles.x + degrees };
  if (unit === 1 && Math.abs(angles.x) <= EPS) return { ...angles, y: angles.y + degrees };
  if (unit === 2 && Math.abs(angles.x) <= EPS && Math.abs(angles.y) <= EPS) return { ...angles, z: angles.z + degrees };
  return eulerDegreesFromQuat(quatMultiply(turn, rotation));
}

function rotateElement(
  definition: PartDefinition, resolved: Resolved, target: EditTarget, axis: Vec3, degrees: number, pivot?: Vec3,
): EditResult {
  const element = findElement(definition, target);
  if (!element) return fail('missing', 'Das Element gibt es nicht mehr.');
  if (!(length(axis) > EPS)) return fail('invalid', 'Die Drehachse hat die Länge null.');
  const unit = normalize(axis);
  const turn = quatFromAxisAngle(unit, degrees * Math.PI / 180);
  const scope = scopeWith(definition, resolved, element, target.index ?? [], {});
  const vector = (formulas: readonly Formula[] | undefined) => {
    if (!formulas) return undefined;
    const [x, y, z] = formulas.map(formula => evaluate(formula, scope));
    return x === undefined || y === undefined || z === undefined ? null : { x, y, z };
  };
  const sets: FieldSet[] = [];
  const point = (field: 'at' | 'from' | 'to', value: Vec3) => {
    sets.push({ path: [field, 0], value: value.x }, { path: [field, 1], value: value.y }, { path: [field, 2], value: value.z });
  };
  const turnAbout = (centre: Vec3, value: Vec3) => add(centre, rotate(turn, sub(value, centre)));

  if ('kind' in element && element.kind === 'beam') {
    const from = vector(element.from), to = vector(element.to);
    if (!from || !to) return fail('locked', 'Die Enden der Latte lassen sich nicht berechnen.');
    const centre = pivot ?? scale(add(from, to), 0.5);
    point('from', turnAbout(centre, from));
    point('to', turnAbout(centre, to));
    return setFields(definition, resolved, target, sets);
  }
  const posed = element as BoxBody | SheetBody | PartChild;
  const at = vector(posed.at);
  const own = posed.pivot ? vector(posed.pivot) : undefined;
  const angles = posed.rotation ? vector(posed.rotation) : { x: 0, y: 0, z: 0 };
  if (!at || own === null || !angles) return fail('locked', 'Lage oder Drehung lassen sich nicht berechnen.');
  const rotation = quatFromEulerDegrees(angles.x, angles.y, angles.z);
  const translation = own ? add(own, rotate(rotation, sub(at, own))) : at;
  const moved = turnAbout(pivot ?? translation, translation);
  const nextAngles = turnedAngles(angles, unit, degrees, turn, rotation);
  const nextRotation = quatFromEulerDegrees(nextAngles.x, nextAngles.y, nextAngles.z);
  const nextAt = own ? add(own, rotate({ ...nextRotation, x: -nextRotation.x, y: -nextRotation.y, z: -nextRotation.z }, sub(moved, own))) : moved;
  point('at', nextAt);
  sets.push(
    { path: ['rotation', 0], value: nextAngles.x }, { path: ['rotation', 1], value: nextAngles.y }, { path: ['rotation', 2], value: nextAngles.z },
  );
  const result = setFields(definition, resolved, target, sets.map(item => item.path[0] === 'rotation'
    ? { ...item, value: closestAngle(item.value, readPath(element, item.path), scope) }
    : item));
  return result;
}

/** An angle written as the equivalent nearest the current one, so a formula `w` is not refused for 360°. */
function closestAngle(value: number, formula: unknown, scope: ReadonlyMap<string, number>): number {
  const current = formula === undefined ? 0 : evaluate(formula as Formula, scope);
  if (current === undefined) return value;
  return current + normalizeAngle(value - current);
}

export const rotateBody = (
  definition: PartDefinition, resolved: Resolved, body: string, axis: Vec3, degrees: number, pivot?: Vec3, index?: readonly number[],
) => rotateElement(definition, resolved, { body, index }, axis, degrees, pivot);
export const rotateChild = (definition: PartDefinition, resolved: Resolved, child: string, axis: Vec3, degrees: number, pivot?: Vec3) =>
  rotateElement(definition, resolved, { child }, axis, degrees, pivot);

const elementKeys = (definition: PartDefinition) => new Set([
  ...definition.bodies.map(body => body.key), ...(definition.children ?? []).map(child => child.key),
]);

export function uniqueElementKey(definition: PartDefinition, base: string): string {
  const taken = elementKeys(definition);
  if (!taken.has(base)) return base;
  for (let serial = 2; ; serial++) if (!taken.has(`${base}-${serial}`)) return `${base}-${serial}`;
}

export type AddResult = { ok: true; definition: PartDefinition; key: string } | EditFailure;

const withBody = (definition: PartDefinition, body: PartBody): AddResult =>
  ({ ok: true, definition: { ...definition, bodies: [...definition.bodies, body] }, key: body.key });
const rounded = (point: Vec3): [number, number, number] => [roundMm(point.x), roundMm(point.y), roundMm(point.z)];
const axisAligned = (v: Vec3) => [v.x, v.y, v.z].filter(value => Math.abs(Math.abs(value) - 1) <= 1e-6).length === 1;

/**
 * A box on a drawn rectangle: `corner` and `opposite` span it in the plane through `corner` with
 * in-plane axis `u` and normal `normal`; it rises `height` along the normal.
 */
export function addBoxFromRect(
  definition: PartDefinition,
  rect: { corner: Vec3; opposite: Vec3; u: Vec3; normal: Vec3; height: number },
  material: string,
): AddResult {
  const n = normalize(rect.normal), u = normalize(rect.u);
  const v = cross(n, u);
  const span = sub(rect.opposite, rect.corner);
  const du = dot(span, u), dv = dot(span, v);
  if (Math.abs(du) < 1 || Math.abs(dv) < 1 || Math.abs(rect.height) < 1) return fail('invalid', 'Das Rechteck ist zu klein.');
  const centre = add(add(rect.corner, add(scale(u, du / 2), scale(v, dv / 2))), scale(n, rect.height / 2));
  const key = uniqueElementKey(definition, 'quader');
  if (axisAligned(u) && axisAligned(n)) {
    const abs = (w: Vec3) => ({ x: Math.abs(w.x), y: Math.abs(w.y), z: Math.abs(w.z) });
    const size = add(add(scale(abs(u), Math.abs(du)), scale(abs(v), Math.abs(dv))), scale(abs(n), Math.abs(rect.height)));
    return withBody(definition, { kind: 'box', key, material, size: rounded(size), at: rounded(centre) });
  }
  const angles = eulerDegreesFromQuat(quatFromBasis(u, n, cross(u, n)));
  return withBody(definition, {
    kind: 'box', key, material, size: [roundMm(Math.abs(du)), roundMm(Math.abs(rect.height)), roundMm(Math.abs(dv))],
    at: rounded(centre), rotation: [normalizeAngle(angles.x), normalizeAngle(angles.y), normalizeAngle(angles.z)],
  });
}

/**
 * A sheet face on a drawn rectangle. Push/pull then sets its thickness. The corners lie in the
 * plane through `corner` with in-plane axis `u` and normal `normal`.
 */
export function addFaceFromRect(
  definition: PartDefinition,
  rect: { corner: Vec3; opposite: Vec3; u: Vec3; normal: Vec3 },
  material: string,
): AddResult {
  const n = normalize(rect.normal), u = normalize(rect.u);
  const v = cross(n, u);
  const span = sub(rect.opposite, rect.corner);
  const du = dot(span, u), dv = dot(span, v);
  if (Math.abs(du) < 1 || Math.abs(dv) < 1) return fail('invalid', 'Das Rechteck ist zu klein.');
  const point = (along: number, across: number) => add(rect.corner, add(scale(u, along), scale(v, across)));
  return addSheetFromOutline(definition, {
    points: [point(0, 0), point(du, 0), point(du, dv), point(0, dv)],
    normal: n,
  }, material);
}

/**
 * A sheet face on a drawn circle. Push/pull then sets its thickness. The circle lies in the plane
 * through `centre` with axis-aligned `normal`; material lies on the side the normal points to.
 */
export function addFaceFromCircle(
  definition: PartDefinition,
  circle: { centre: Vec3; radius: number; normal: Vec3; segments?: number },
  material: string,
): AddResult {
  const n = normalize(circle.normal);
  if (!axisAligned(n)) return fail('invalid', 'Kreise gehen nur auf waagrechten oder geraden senkrechten Flächen.');
  if (!(circle.radius >= 1)) return fail('invalid', 'Der Kreis ist zu klein.');
  let plane: SheetBody['plane'], anchor: NonNullable<SheetBody['anchor']>, at: [number, number, number], flat: (p: Vec3) => Vec2;
  if (Math.abs(n.y) > 0.5) {
    plane = 'xz'; anchor = n.y > 0 ? 'back' : 'face'; at = [0, roundMm(circle.centre.y), 0]; flat = p => ({ x: p.x, y: p.z });
  } else if (Math.abs(n.z) > 0.5) {
    plane = 'xy'; anchor = n.z > 0 ? 'face' : 'back'; at = [0, 0, roundMm(circle.centre.z)]; flat = p => ({ x: p.x, y: p.y });
  } else {
    plane = 'yz'; anchor = n.x < 0 ? 'face' : 'back'; at = [roundMm(circle.centre.x), 0, 0]; flat = p => ({ x: p.z, y: p.y });
  }
  const centre = flat(circle.centre);
  const segments = circle.segments === undefined
    ? undefined
    : Math.max(3, Math.min(PART_LIMITS.polygonPoints, Math.round(circle.segments)));
  const body: SheetBody = {
    kind: 'sheet', key: uniqueElementKey(definition, 'platte'), material, plane, at,
    ...(anchor !== 'face' ? { anchor } : {}),
    outline: {
      shape: 'circle', cx: roundMm(centre.x), cy: roundMm(centre.y), r: roundMm(circle.radius),
      ...(segments !== undefined ? { segments } : {}),
    },
  };
  return withBody(definition, body);
}

/**
 * A sheet on a drawn outline lying on a face with an axis-aligned `normal`; the material lies on
 * the side the normal points to, the drawn loop on its back face.
 */
export function addSheetFromOutline(definition: PartDefinition, outline: { points: readonly Vec3[]; normal: Vec3 }, material: string): AddResult {
  const n = normalize(outline.normal);
  if (!axisAligned(n)) return fail('invalid', 'Vielecke gehen nur auf waagrechten oder geraden senkrechten Flächen.');
  if (outline.points.length < 3) return fail('invalid', 'Ein Vieleck braucht mindestens drei Punkte.');
  const first = outline.points[0]!;
  let plane: SheetBody['plane'], anchor: NonNullable<SheetBody['anchor']>, at: [number, number, number], flat: (p: Vec3) => Vec2;
  if (Math.abs(n.y) > 0.5) {
    plane = 'xz'; anchor = n.y > 0 ? 'back' : 'face'; at = [0, roundMm(first.y), 0]; flat = p => ({ x: p.x, y: p.z });
  } else if (Math.abs(n.z) > 0.5) {
    plane = 'xy'; anchor = n.z > 0 ? 'face' : 'back'; at = [0, 0, roundMm(first.z)]; flat = p => ({ x: p.x, y: p.y });
  } else {
    plane = 'yz'; anchor = n.x < 0 ? 'face' : 'back'; at = [roundMm(first.x), 0, 0]; flat = p => ({ x: p.z, y: p.y });
  }
  const points = outline.points.map(point => flat(point)).map(point => ({ x: roundMm(point.x), y: roundMm(point.y) }));
  if (!isSimplePolygon(points) || polygonArea(points) < 1) return fail('invalid', 'Das Vieleck kreuzt sich selbst oder ist zu klein.');
  const body: SheetBody = {
    kind: 'sheet', key: uniqueElementKey(definition, 'platte'), material, plane, at,
    ...(anchor !== 'face' ? { anchor } : {}),
    outline: { shape: 'polygon', points: points.map(point => [point.x, point.y] as [number, number]) },
  };
  return withBody(definition, body);
}

export function addBeam(definition: PartDefinition, from: Vec3, to: Vec3, material: string): AddResult {
  if (length(sub(to, from)) < 1) return fail('invalid', 'Die Latte ist zu kurz.');
  const body: BeamBody = { kind: 'beam', key: uniqueElementKey(definition, 'latte'), material, from: rounded(from), to: rounded(to) };
  return withBody(definition, body);
}

export type SplitResult =
  | { ok: true; definition: PartDefinition; keys: [string, string] }
  | EditFailure;

const AXIS_ALIGN = 0.9;

/** Local axis of a solid that best matches `direction`, or `undefined` when none is close enough. */
export function alignedSolidAxis(solid: ResolvedSolid, direction: Vec3): { axis: Vec3; index: 0 | 1 | 2 } | undefined {
  const n = normalize(direction);
  const axes = quatAxes(solid.rotation);
  const candidates: { axis: Vec3; index: 0 | 1 | 2; score: number }[] = [
    { axis: axes.x, index: 0, score: Math.abs(dot(n, axes.x)) },
    { axis: axes.y, index: 1, score: Math.abs(dot(n, axes.y)) },
    { axis: axes.z, index: 2, score: Math.abs(dot(n, axes.z)) },
  ];
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!;
  if (best.score < AXIS_ALIGN) return undefined;
  const sign = Math.sign(dot(n, best.axis)) || 1;
  return { axis: scale(best.axis, sign), index: best.index };
}

function retargetTraits(definition: PartDefinition, from: string, to: string): PartDefinition['traits'] {
  const traits = { ...definition.traits };
  if (traits.surface?.body === from) traits.surface = { body: to };
  if (traits.faces) traits.faces = traits.faces.map(face => face.body === from ? { ...face, body: to } : face);
  return traits;
}

/**
 * Axis-aligned through-cut: replace one box or rect sheet with two bodies that can be
 * Drücken/Ziehen independently. `cutNormal` picks the split axis; `cutPoint` places the plane.
 */
export function splitBody(
  definition: PartDefinition,
  resolved: Resolved,
  bodyKey: string,
  cutNormal: Vec3,
  cutPoint: Vec3,
): SplitResult {
  const index = definition.bodies.findIndex(item => item.key === bodyKey);
  const body = definition.bodies[index];
  const solid = resolved.solids.find(item => item.body === bodyKey && item.path.length === 0);
  if (!body || !solid || body.kind === 'mesh') return fail('missing', 'Der Körper fehlt oder lässt sich nicht teilen.');
  if (body.repeat) return fail('invalid', 'Kopierte Körper lassen sich nicht teilen — bitte die Wiederholung auflösen.');
  const aligned = alignedSolidAxis(solid, cutNormal);
  if (!aligned) return fail('invalid', 'Die Teilung muss waagrecht oder senkrecht zu einer Kante liegen.');

  if (body.kind === 'box' && solid.kind === 'box') {
    const sizeVec = [solid.size.x, solid.size.y, solid.size.z] as const;
    const extent = sizeVec[aligned.index]!;
    if (extent < 2) return fail('invalid', 'Der Körper ist zu dünn zum Teilen.');
    const local = dot(sub(cutPoint, solid.center), aligned.axis);
    const half = extent / 2;
    const cut = Math.min(half - 1, Math.max(-half + 1, local));
    const sizeA = roundMm(cut + half);
    const sizeB = roundMm(half - cut);
    if (sizeA < 1 || sizeB < 1) return fail('invalid', 'Beide Teile müssen mindestens 1 mm dick sein.');
    const centerA = add(solid.center, scale(aligned.axis, -half + sizeA / 2));
    const centerB = add(solid.center, scale(aligned.axis, half - sizeB / 2));
    const sizeA3 = [...sizeVec] as [number, number, number];
    const sizeB3 = [...sizeVec] as [number, number, number];
    sizeA3[aligned.index] = sizeA;
    sizeB3[aligned.index] = sizeB;
    // Keep the original key on the first half; reserve it so the second half gets `…-2`.
    const keyA = body.key;
    const keyB = uniqueElementKey(definition, body.key);
    const boxMeta = () => ({
      kind: 'box' as const, material: body.material,
      ...(body.label ? { label: body.label } : {}),
      ...(body.displayOnly ? { displayOnly: true } : {}),
      ...(body.rotation ? { rotation: structuredClone(body.rotation) } : {}),
      ...(body.pivot ? { pivot: structuredClone(body.pivot) } : {}),
    });
    const a: BoxBody = { ...boxMeta(), key: keyA, size: rounded({ x: sizeA3[0], y: sizeA3[1], z: sizeA3[2] }), at: rounded(centerA) };
    const b: BoxBody = { ...boxMeta(), key: keyB, size: rounded({ x: sizeB3[0], y: sizeB3[1], z: sizeB3[2] }), at: rounded(centerB) };
    const bodies = [...definition.bodies.slice(0, index), a, b, ...definition.bodies.slice(index + 1)];
    return { ok: true, definition: { ...definition, bodies, traits: retargetTraits(definition, body.key, keyA) }, keys: [keyA, keyB] };
  }

  if (body.kind === 'sheet' && solid.kind === 'sheet') {
    if (body.holes?.length) return fail('invalid', 'Platten mit Ausschnitten lassen sich so nicht teilen.');
    // Sheet local: axes.x = outline u, axes.y = outline v, axes.z = thickness (front → back).
    const bounds = axisAlignedRectBounds(solid.outline);
    if (!bounds) return fail('invalid', 'Nur rechteckige Platten lassen sich teilen.');
    const { minU, maxU, minV, maxV } = bounds;
    const width = maxU - minU, height = maxV - minV;
    const local = rotate(conjugate(solid.rotation), sub(cutPoint, solid.origin));
    // Keep the original key on the first half; reserve it so the second half gets `…-2`.
    const keyA = body.key;
    const keyB = uniqueElementKey(definition, body.key);
    // Every nested field must be cloned — shared `at`/`outline` arrays stay aliased through
    // structuredClone in setFields, so a push/pull on one half would move the other.
    const sheetMeta = () => ({
      kind: 'sheet' as const, material: body.material, plane: body.plane,
      ...(body.label ? { label: body.label } : {}),
      ...(body.rotation ? { rotation: structuredClone(body.rotation) } : {}),
      ...(body.pivot ? { pivot: structuredClone(body.pivot) } : {}),
      ...(body.displayOnly ? { displayOnly: true } : {}),
    });
    const rectOutline = (x: number, y: number, w: number, h: number) => (
      { shape: 'rect' as const, x, y, width: w, height: h }
    );

    if (aligned.index === 2) {
      const T = solid.thickness;
      if (T < 2) return fail('invalid', 'Die Platte ist zu dünn zum Teilen.');
      const axes = quatAxes(solid.rotation);
      // Always measure front → back along the sheet's +thickness, ignoring preferred-normal flip.
      const along = dot(sub(cutPoint, solid.origin), axes.z);
      const cut = Math.min(T - 1, Math.max(1, along));
      const thickA = roundMm(cut);
      const thickB = roundMm(T - cut);
      if (thickA < 1 || thickB < 1) return fail('invalid', 'Beide Teile müssen mindestens 1 mm dick sein.');
      // Front-anchored stacks: A keeps the front face, B starts where A ends.
      const a: SheetBody = {
        ...sheetMeta(), key: keyA, anchor: 'face', thickness: thickA,
        outline: rectOutline(roundMm(minU), roundMm(minV), roundMm(width), roundMm(height)),
        at: rounded(solid.origin),
      };
      const b: SheetBody = {
        ...sheetMeta(), key: keyB, anchor: 'face', thickness: thickB,
        outline: rectOutline(roundMm(minU), roundMm(minV), roundMm(width), roundMm(height)),
        at: rounded(add(solid.origin, scale(axes.z, thickA))),
      };
      const nextBodies = [...definition.bodies.slice(0, index), a, b, ...definition.bodies.slice(index + 1)];
      return { ok: true, definition: { ...definition, bodies: nextBodies, traits: retargetTraits(definition, body.key, keyA) }, keys: [keyA, keyB] };
    }

    const cutU = aligned.index === 0 ? local.x : local.y;
    const min = aligned.index === 0 ? minU : minV;
    const max = aligned.index === 0 ? maxU : maxV;
    const span = max - min;
    if (span < 2) return fail('invalid', 'Die Platte ist zu schmal zum Teilen.');
    const cut = Math.min(max - 1, Math.max(min + 1, cutU));
    const spanA = roundMm(cut - min);
    const spanB = roundMm(max - cut);
    if (spanA < 1 || spanB < 1) return fail('invalid', 'Beide Teile müssen mindestens 1 mm breit sein.');
    const outlineA = aligned.index === 0
      ? rectOutline(roundMm(min), roundMm(minV), spanA, roundMm(height))
      : rectOutline(roundMm(minU), roundMm(min), roundMm(width), spanA);
    const outlineB = aligned.index === 0
      ? rectOutline(roundMm(cut), roundMm(minV), spanB, roundMm(height))
      : rectOutline(roundMm(minU), roundMm(cut), roundMm(width), spanB);
    const thickness = typeof body.thickness === 'number' ? body.thickness : solid.thickness;
    const a: SheetBody = {
      ...sheetMeta(), key: keyA, outline: outlineA, at: structuredClone(body.at), thickness,
      ...(body.anchor ? { anchor: body.anchor } : {}),
    };
    const b: SheetBody = {
      ...sheetMeta(), key: keyB, outline: outlineB, at: structuredClone(body.at), thickness,
      ...(body.anchor ? { anchor: body.anchor } : {}),
    };
    const nextBodies = [...definition.bodies.slice(0, index), a, b, ...definition.bodies.slice(index + 1)];
    return { ok: true, definition: { ...definition, bodies: nextBodies, traits: retargetTraits(definition, body.key, keyA) }, keys: [keyA, keyB] };
  }

  return fail('invalid', 'Nur Quader und rechteckige Platten lassen sich teilen.');
}

function conjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Bounds of an axis-aligned rectangle in sheet UV, from a rect outline or a 4-corner polygon. */
function axisAlignedRectBounds(outline: readonly Vec2[]): { minU: number; maxU: number; minV: number; maxV: number } | undefined {
  if (outline.length < 3) return undefined;
  const xs = outline.map(p => p.x), ys = outline.map(p => p.y);
  const minU = Math.min(...xs), maxU = Math.max(...xs);
  const minV = Math.min(...ys), maxV = Math.max(...ys);
  if (!(maxU - minU >= 1 && maxV - minV >= 1)) return undefined;
  // Every vertex must sit on the AABB rim (axis-aligned rectangle, not a diamond).
  const onRim = (p: Vec2) => {
    const onVertical = (Math.abs(p.x - minU) <= EPS || Math.abs(p.x - maxU) <= EPS) && p.y >= minV - EPS && p.y <= maxV + EPS;
    const onHorizontal = (Math.abs(p.y - minV) <= EPS || Math.abs(p.y - maxV) <= EPS) && p.x >= minU - EPS && p.x <= maxU + EPS;
    return onVertical || onHorizontal;
  };
  if (!outline.every(onRim)) return undefined;
  return { minU, maxU, minV, maxV };
}

const formulaNames = (definition: PartDefinition) => new Set([
  ...definition.parameters.map(parameter => parameter.key), ...(definition.derived ?? []).map(item => item.key),
]);

/** A formula name from a German label: `Höhe` → `hoehe`, unique among the names of the definition. */
export function identifierFromLabel(definition: PartDefinition, label: string): string {
  const base = label.toLowerCase().replace(/[äöüß]/g, letter => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[letter]!)
    .replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+|_+$/g, '').slice(0, 30) || 'option';
  const taken = formulaNames(definition);
  if (!taken.has(base)) return base;
  for (let serial = 2; ; serial++) if (!taken.has(`${base}${serial}`)) return `${base}${serial}`;
}

function newLengthParameter(key: string, label: string, value: number) {
  const settled = roundMm(value);
  return {
    key, label, type: 'length' as const, default: settled, scope: 'placement' as const,
    range: { min: Math.min(1, settled), max: Math.max(10_000, Math.ceil(settled * 2)) },
  };
}

/** `base + ratio · name`, written the way an author would. */
function linearFormula(base: number, ratio: number, name: string): Formula {
  const magnitude = Math.abs(ratio);
  const term = magnitude === 1 ? name : magnitude === 0.5 ? `${name} / 2` : `${name} * ${roundMm(magnitude)}`;
  const start = roundMm(base);
  if (start === 0) return ratio < 0 ? `-${term}` : term;
  return `${start} ${ratio < 0 ? '-' : '+'} ${term}`;
}

export type BindResult = { ok: true; definition: PartDefinition; parameter: string } | EditFailure;

/**
 * „Als Option freigeben“ for a single field: a new parameter takes the field's current value and
 * the field reads the parameter.
 */
export function bindFieldToParameter(
  definition: PartDefinition, resolved: Resolved, target: EditTarget, path: FieldPath, label: string,
): BindResult {
  const element = findElement(definition, target);
  if (!element) return fail('missing', 'Das Element gibt es nicht mehr.');
  const formula = readPath(element, path) as Formula | undefined;
  if (typeof formula === 'string' && IDENTIFIER.test(formula.trim()) && formulaNames(definition).has(formula.trim())) {
    return { ok: true, definition, parameter: formula.trim() };
  }
  if (typeof formula === 'string') return fail('locked', `Das Feld folgt schon der Formel ${formula}.`, [{ path: pathKey(path), formula }]);
  const current = formula ?? missingValue(element, path, solidOf(resolved, target));
  if (current === undefined) return fail('missing', `Das Feld ${pathKey(path)} fehlt.`);
  const key = identifierFromLabel(definition, label);
  const next = structuredClone(definition);
  next.parameters.push(newLengthParameter(key, label, current));
  const editable = findElement(next, target) as unknown as Record<string | number, unknown>;
  writePathFormula(editable, path, key, solidOf(resolved, target));
  return { ok: true, definition: next, parameter: key };
}

function writePathFormula(element: Record<string | number, unknown>, path: FieldPath, formula: Formula, solid: ResolvedSolid | undefined) {
  writePath(element, path, 0, solid);
  let current: Record<string | number, unknown> = element;
  for (const part of path.slice(0, -1)) current = current[part] as Record<string | number, unknown>;
  current[path[path.length - 1]!] = formula;
}

/**
 * „Als Option freigeben“ for what a handle measures: the measured field reads a new parameter,
 * and the fields that move with it (the centre of a box whose top is pulled) follow it by
 * formula, so the opposite face stays where it is when the option changes.
 */
export function bindMeasureToParameter(definition: PartDefinition, resolved: Resolved, handle: Handle): BindResult {
  const measured = handle.measure?.path;
  if (!handle.measure || !measured) return fail('invalid', 'Dieses Maß lässt sich nicht als Option freigeben.');
  const target = targetOf(handle);
  const bound = bindFieldToParameter(definition, resolved, target, measured, handle.measure.label);
  if (!bound.ok || bound.definition === definition) return bound;
  const key = bound.parameter;
  const lead = handle.writes.find(write => pathKey(write.path) === pathKey(measured));
  const leadRate = lead ? dot(lead.coefficient, handle.axis) : 0;
  if (!leadRate) return bound;
  const next = bound.definition;
  const editable = findElement(next, target) as unknown as Record<string | number, unknown>;
  const original = findElement(definition, target)!;
  for (const write of handle.writes) {
    if (write === lead) continue;
    const rate = dot(write.coefficient, handle.axis);
    if (Math.abs(rate) <= EPS) continue;
    const formula = readPath(original, write.path);
    if (typeof formula !== 'number') continue;
    const ratio = rate / leadRate;
    writePathFormula(editable, write.path, linearFormula(formula - ratio * handle.measure.value, ratio, key), solidOf(resolved, target));
  }
  return { ok: true, definition: next, parameter: key };
}
