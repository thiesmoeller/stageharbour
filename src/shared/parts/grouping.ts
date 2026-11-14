import { formulaIdentifiers, parseFormula, type Formula } from './formula.js';
import {
  variantValues, type PartBody, type PartChild, type PartDefinition, type PartParameter,
} from './definition.js';
import { roundMm, uniqueElementKey } from './directEdit.js';
import type { ResolvedPart } from './resolve.js';
import { definitionFormulaSites } from './sites.js';

/**
 * Two ways to group. „Gruppe“ stores an inline definition on the child (`group`): it is not a
 * library entry, and everything inside follows the child's move and rotation. „In die Bibliothek“
 * (`makeChildFromBodies`) publishes a reusable Komponente. „Auflösen“ copies either back.
 */

export type GroupResult =
  | { ok: true; parent: PartDefinition; child: PartDefinition; childKey: string }
  | { ok: false; message: string };
export type ExplodeResult = { ok: true; definition: PartDefinition } | { ok: false; message: string };

const IDENTIFIER_START = /[A-Za-z]/;
const IDENTIFIER_PART = /[A-Za-z0-9_]/;

/** Renames whole identifiers of a formula; function names and numbers stay. */
export function renameFormula(formula: Formula, names: ReadonlyMap<string, string>): Formula {
  if (typeof formula === 'number' || !names.size) return formula;
  let result = '';
  let position = 0;
  while (position < formula.length) {
    const char = formula[position]!;
    const previous = position > 0 ? formula[position - 1]! : '';
    if (IDENTIFIER_START.test(char) && !IDENTIFIER_PART.test(previous) && previous !== '.') {
      let end = position + 1;
      while (end < formula.length && IDENTIFIER_PART.test(formula[end]!)) end++;
      const name = formula.slice(position, end);
      let after = end;
      while (formula[after] === ' ') after++;
      result += formula[after] === '(' ? name : names.get(name) ?? name;
      position = end;
      continue;
    }
    result += char;
    position++;
  }
  return result;
}

function setAt(target: unknown, location: readonly (string | number)[], value: Formula) {
  let current = target as Record<string | number, unknown>;
  for (const part of location.slice(0, -1)) current = current[part] as Record<string | number, unknown>;
  current[location[location.length - 1]!] = value;
}

/** Copies a definition with every formula renamed. */
function renamedDefinition(definition: PartDefinition, names: ReadonlyMap<string, string>): PartDefinition {
  const copy = structuredClone(definition);
  for (const site of definitionFormulaSites(definition)) setAt(copy, site.location, renameFormula(site.formula, names));
  return copy;
}

const asIdentifier = (key: string) => {
  const cleaned = key.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^[^A-Za-z]+/, '');
  return cleaned || 'teil';
};

function slug(name: string): string {
  return name.toLowerCase().replace(/[äöüß]/g, letter => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[letter]!)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'teil';
}

/**
 * The selected bodies become a new part in the same frame, placed as one child at the origin.
 * Names the bodies read from this part become parameters of the new part, passed through the
 * child's `values`; faces and the walkable surface on those bodies move with them.
 */
export function makeChildFromBodies(
  definition: PartDefinition, resolved: Pick<ResolvedPart, 'derived'>, bodyKeys: readonly string[], part: { id: string; name: string },
): GroupResult {
  const wanted = new Set(bodyKeys);
  const moved = definition.bodies.filter(body => wanted.has(body.key));
  if (!moved.length) return { ok: false, message: 'Erst Körper auswählen.' };
  if (moved.length !== wanted.size) return { ok: false, message: 'Nur Körper dieses Bauteils lassen sich zusammenfassen.' };

  const read = new Set<string>();
  for (const site of definitionFormulaSites({ ...definition, bodies: moved })) {
    if (site.owner.kind !== 'body' || typeof site.formula === 'number') continue;
    try {
      for (const name of formulaIdentifiers(parseFormula(site.formula))) if (!site.indices.includes(name)) read.add(name);
    } catch { /* an invalid formula reads nothing */ }
  }
  const parameters: PartParameter[] = [];
  for (const parameter of definition.parameters) {
    if (!read.has(parameter.key)) continue;
    const { scope: _scope, ...rest } = parameter;
    parameters.push({ ...rest, scope: 'placement' });
  }
  for (const item of definition.derived ?? []) {
    if (!read.has(item.key)) continue;
    const value = roundMm(resolved.derived[item.key] ?? 0);
    parameters.push({
      key: item.key, label: item.label ?? item.key, type: 'length', default: value, scope: 'placement',
      range: { min: Math.min(-100_000, value), max: Math.max(100_000, value) },
    });
  }
  const passed = parameters.map(parameter => parameter.key);

  const faces = (definition.traits.faces ?? []).filter(face => wanted.has(face.body));
  const surface = definition.traits.surface && wanted.has(definition.traits.surface.body) ? definition.traits.surface : undefined;
  const child: PartDefinition = {
    id: part.id, revision: 1, name: part.name, category: definition.category,
    parameters, bodies: structuredClone(moved),
    traits: { stock: 'none', ...(faces.length ? { faces } : {}), ...(surface ? { surface } : {}) },
  };

  const traits = { ...definition.traits };
  if (surface) delete traits.surface;
  if (faces.length) {
    const left = (definition.traits.faces ?? []).filter(face => !wanted.has(face.body));
    if (left.length) traits.faces = left;
    else delete traits.faces;
  }
  const childKey = uniqueElementKey({ ...definition, bodies: definition.bodies.filter(body => !wanted.has(body.key)) }, slug(part.name));
  const placed: PartChild = {
    key: childKey, label: part.name, part: { id: part.id, revision: 1 }, at: [0, 0, 0],
    ...(passed.length ? { values: Object.fromEntries(passed.map(key => [key, key])) } : {}),
  };
  const parent: PartDefinition = {
    ...definition, bodies: definition.bodies.filter(body => !wanted.has(body.key)), traits,
    children: [...(definition.children ?? []), placed],
  };
  return { ok: true, parent, child, childKey };
}

/**
 * The selected bodies and groups become one inline Gruppe at the origin. A handle grouped into a
 * door then follows the door's move and rotation. Nothing is written to the library.
 */
export function makeGroup(
  definition: PartDefinition, resolved: Pick<ResolvedPart, 'derived'>, keys: readonly string[], part: { id: string; name: string },
): GroupResult {
  const wanted = new Set(keys);
  const movedBodies = definition.bodies.filter(body => wanted.has(body.key));
  const movedChildren = (definition.children ?? []).filter(child => wanted.has(child.key));
  if (!movedBodies.length && !movedChildren.length) return { ok: false, message: 'Erst Körper oder Gruppen auswählen.' };
  if (movedBodies.length + movedChildren.length !== wanted.size) {
    return { ok: false, message: 'Nur Körper und Gruppen dieses Bauteils lassen sich zusammenfassen.' };
  }

  const held: PartDefinition = {
    id: part.id, revision: 1, name: part.name, category: definition.category,
    parameters: [], bodies: structuredClone(movedBodies),
    ...(movedChildren.length ? { children: structuredClone(movedChildren) } : {}),
    traits: { stock: 'none' },
  };
  const lifted = makeChildFromBodies(
    { ...definition, bodies: [...movedBodies, ...definition.bodies.filter(body => !wanted.has(body.key))] },
    resolved, movedBodies.map(body => body.key), part,
  );
  const childDefinition: PartDefinition = lifted.ok
    ? { ...lifted.child, id: part.id, name: part.name, traits: { ...lifted.child.traits, stock: 'none' } }
    : held;
  if (movedChildren.length) childDefinition.children = structuredClone(movedChildren);
  if (!childDefinition.bodies.length && !(childDefinition.children ?? []).length) {
    return { ok: false, message: 'Die Gruppe wäre leer.' };
  }

  const passed = childDefinition.parameters.map(parameter => parameter.key);
  const traits = { ...definition.traits };
  const faces = (definition.traits.faces ?? []).filter(face => wanted.has(face.body));
  if (definition.traits.surface && wanted.has(definition.traits.surface.body)) delete traits.surface;
  if (faces.length) {
    const left = (definition.traits.faces ?? []).filter(face => !wanted.has(face.body));
    if (left.length) traits.faces = left;
    else delete traits.faces;
  }
  const remainingBodies = definition.bodies.filter(body => !wanted.has(body.key));
  const remainingChildren = (definition.children ?? []).filter(child => !wanted.has(child.key));
  const childKey = uniqueElementKey({ ...definition, bodies: remainingBodies, children: remainingChildren }, slug(part.name));
  const placed: PartChild = {
    key: childKey, label: part.name, group: childDefinition, at: [0, 0, 0],
    ...(passed.length ? { values: Object.fromEntries(passed.map(key => [key, key])) } : {}),
  };
  const parent: PartDefinition = {
    ...definition, bodies: remainingBodies, traits,
    children: [...remainingChildren, placed],
  };
  return { ok: true, parent, child: childDefinition, childKey };
}

function plus(formula: Formula, offset: Formula): Formula {
  if (offset === 0) return formula;
  if (typeof formula === 'number' && typeof offset === 'number') return roundMm(formula + offset);
  if (typeof offset === 'number') return offset < 0 ? `${formula} - ${-offset}` : `${formula} + ${offset}`;
  if (formula === 0) return offset;
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(offset.trim()) ? `${formula} + ${offset.trim()}` : `${formula} + (${offset})`;
}

function shifted<T extends readonly Formula[]>(point: T, offset: readonly Formula[]): T {
  return point.map((value, axis) => plus(value, offset[axis]!)) as unknown as T;
}

function shiftBody(body: PartBody, offset: readonly Formula[]): PartBody {
  if (body.kind === 'beam') return { ...body, from: shifted(body.from, offset), to: shifted(body.to, offset) };
  return { ...body, at: shifted(body.at, offset), ...(body.pivot ? { pivot: shifted(body.pivot, offset) } : {}) };
}

const both = (a: Formula | undefined, b: Formula | undefined): Formula | undefined =>
  a === undefined ? b : b === undefined ? a : `(${a}) * (${b})`;

/**
 * Replaces a child by copies of its bodies, nested children and hardware. Its parameters and
 * derived values become derived values of this part, prefixed with the child's key.
 */
export function explodeChild(definition: PartDefinition, childKey: string, childDefinition: PartDefinition): ExplodeResult {
  const child = definition.children?.find(item => item.key === childKey);
  if (!child) return { ok: false, message: 'Das Unterbauteil gibt es nicht mehr.' };
  if (child.repeat) return { ok: false, message: 'Ein wiederholtes Unterbauteil lässt sich nicht auflösen.' };
  if (child.rotation && child.rotation.some(angle => angle !== 0)) {
    return { ok: false, message: 'Ein gedrehtes Unterbauteil lässt sich noch nicht auflösen.' };
  }

  const taken = new Set([...definition.parameters.map(item => item.key), ...(definition.derived ?? []).map(item => item.key)]);
  const prefix = `${asIdentifier(child.key)}_`;
  const renames = new Map<string, string>();
  const claim = (key: string) => {
    let name = `${prefix}${key}`.slice(0, 40);
    for (let serial = 2; taken.has(name); serial++) name = `${prefix}${key}${serial}`.slice(0, 40);
    taken.add(name);
    renames.set(key, name);
    return name;
  };
  const chosen = childDefinition.variants?.find(variant => variant.key === child.variant) ?? childDefinition.variants?.[0];
  const fromVariant = variantValues(childDefinition, chosen);
  const derived = [...(definition.derived ?? [])];
  for (const parameter of childDefinition.parameters) {
    const name = claim(parameter.key);
    derived.push({ key: name, label: parameter.label, formula: child.values?.[parameter.key] ?? fromVariant[parameter.key] ?? parameter.default });
  }
  for (const item of childDefinition.derived ?? []) claim(item.key);
  const renamed = renamedDefinition(childDefinition, renames);
  for (const item of renamed.derived ?? []) derived.push({ ...item, key: renames.get(item.key)! });

  const bodies = [...definition.bodies];
  const keyed = (base: string) => uniqueElementKey({ ...definition, bodies, children: [...(definition.children ?? []), ...extraChildren] }, base);
  const extraChildren: PartChild[] = [];
  for (const body of renamed.bodies) {
    const when = both(child.when, body.when);
    bodies.push({ ...shiftBody(body, child.at), key: keyed(`${child.key}-${body.key}`), ...(when !== undefined ? { when } : {}) });
  }
  for (const nested of renamed.children ?? []) {
    const when = both(child.when, nested.when);
    extraChildren.push({
      ...nested, key: keyed(`${child.key}-${nested.key}`), at: shifted(nested.at, child.at),
      ...(nested.pivot ? { pivot: shifted(nested.pivot, child.at) } : {}), ...(when !== undefined ? { when } : {}),
    });
  }
  const hardware = [...(definition.hardware ?? []), ...(renamed.hardware ?? []).map(item => {
    const when = both(child.when, item.when);
    return { ...item, ...(when !== undefined ? { when } : {}) };
  })];
  const children = [...(definition.children ?? []).filter(item => item.key !== childKey), ...extraChildren];
  const next: PartDefinition = { ...definition, bodies };
  if (derived.length) next.derived = derived; else delete next.derived;
  if (children.length) next.children = children; else delete next.children;
  if (hardware.length) next.hardware = hardware; else delete next.hardware;
  return { ok: true, definition: next };
}
