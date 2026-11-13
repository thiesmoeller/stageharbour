import type { Formula } from './formula.js';
import { formulaIdentifiers, parseFormula } from './formula.js';
import {
  MAX_PART_COORDINATE_MM, PART_LIMITS,
  type PartDefinition, type PartParameter, type SheetHole,
} from './definition.js';
import { definitionFormulaSites } from './sites.js';

export type OpeningParameterKeys = {
  left: string;
  sill: string;
  width: string;
  height: string;
};

export type RectOpeningInput = {
  key: string;
  left: number;
  sill: number;
  width: number;
  height: number;
  /** Omit to keep an existing condition; use `null` to remove it. */
  when?: Formula | null;
};

export type PolygonOpeningInput = {
  key: string;
  points: readonly (readonly [number, number])[];
  /** Omit to keep an existing condition; use `null` to remove it. */
  when?: Formula | null;
};

export type OpeningInput =
  | ({ shape: 'rect' } & RectOpeningInput)
  | ({ shape: 'arch' } & RectOpeningInput)
  | ({ shape: 'polygon' } & PolygonOpeningInput);

const SUFFIXES = { left: 'Left', sill: 'Sill', width: 'B', height: 'H' } as const;
const MAX_BASE_LENGTH = 40 - Math.max(...Object.values(SUFFIXES).map(suffix => suffix.length));

function hashKey(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function parameterBase(holeKey: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(holeKey)) {
    throw new TypeError(`Ungültiger Öffnungsschlüssel „${holeKey}“.`);
  }
  let base = /^[A-Za-z]/.test(holeKey) ? '' : 'h_';
  for (const character of holeKey) {
    base += character === '_' ? '_u' : character === '-' ? '_h' : character === '.' ? '_d' : character;
  }
  if (base.length <= MAX_BASE_LENGTH) return base;
  return `${base.slice(0, MAX_BASE_LENGTH - 9)}_${hashKey(holeKey)}`;
}

/** Stable formula-safe parameter names owned by one sheet-hole key. */
export function openingParameterKeys(holeKey: string): OpeningParameterKeys {
  const base = parameterBase(holeKey);
  return {
    left: `${base}${SUFFIXES.left}`,
    sill: `${base}${SUFFIXES.sill}`,
    width: `${base}${SUFFIXES.width}`,
    height: `${base}${SUFFIXES.height}`,
  };
}

function finiteInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} muss zwischen ${min} und ${max} liegen.`);
  }
}

function dimensionsOf(input: RectOpeningInput): Record<keyof OpeningParameterKeys, number> {
  finiteInRange('Linke Kante', input.left, -MAX_PART_COORDINATE_MM, MAX_PART_COORDINATE_MM);
  finiteInRange('Brüstung', input.sill, -MAX_PART_COORDINATE_MM, MAX_PART_COORDINATE_MM);
  finiteInRange('Breite', input.width, 1, MAX_PART_COORDINATE_MM);
  finiteInRange('Höhe', input.height, 1, MAX_PART_COORDINATE_MM);
  return { left: input.left, sill: input.sill, width: input.width, height: input.height };
}

function openingParameter(key: string, label: string, value: number, position: boolean): PartParameter {
  return {
    key,
    label,
    type: 'length',
    default: value,
    scope: 'placement',
    range: position
      ? { min: -MAX_PART_COORDINATE_MM, max: MAX_PART_COORDINATE_MM }
      : { min: 1, max: MAX_PART_COORDINATE_MM },
  };
}

/** Create or refresh the four placement parameters used by a rectangular or arched opening. */
export function ensureOpeningParameters(definition: PartDefinition, input: RectOpeningInput): PartDefinition {
  const keys = openingParameterKeys(input.key);
  const values = dimensionsOf(input);
  const next = new Map<string, PartParameter>([
    [keys.left, openingParameter(keys.left, `${input.key} · Linke Kante`, values.left, true)],
    [keys.sill, openingParameter(keys.sill, `${input.key} · Brüstung`, values.sill, true)],
    [keys.width, openingParameter(keys.width, `${input.key} · Breite`, values.width, false)],
    [keys.height, openingParameter(keys.height, `${input.key} · Höhe`, values.height, false)],
  ]);
  const parameters = definition.parameters.map(parameter => next.get(parameter.key) ?? parameter);
  for (const parameter of next.values()) {
    if (!definition.parameters.some(existing => existing.key === parameter.key)) parameters.push(parameter);
  }
  return { ...definition, parameters };
}

function condition(
  existing: SheetHole | undefined,
  requested: Formula | null | undefined,
): { when?: Formula } {
  const when = requested === undefined ? existing?.when : requested ?? undefined;
  return when === undefined ? {} : { when };
}

function upsertHole(definition: PartDefinition, bodyKey: string, hole: SheetHole): PartDefinition {
  const bodyIndex = definition.bodies.findIndex(body => body.key === bodyKey);
  if (bodyIndex < 0) throw new TypeError(`Körper „${bodyKey}“ wurde nicht gefunden.`);
  const body = definition.bodies[bodyIndex]!;
  if (body.kind !== 'sheet') throw new TypeError(`Körper „${bodyKey}“ ist keine Platte.`);
  const holes = [...(body.holes ?? [])];
  const holeIndex = holes.findIndex(existing => existing.key === hole.key);
  if (holeIndex < 0) holes.push(hole);
  else holes[holeIndex] = hole;
  const bodies = [...definition.bodies];
  bodies[bodyIndex] = { ...body, holes };
  return { ...definition, bodies };
}

function existingHole(definition: PartDefinition, bodyKey: string, holeKey: string): SheetHole | undefined {
  const body = definition.bodies.find(candidate => candidate.key === bodyKey);
  return body?.kind === 'sheet' ? body.holes?.find(hole => hole.key === holeKey) : undefined;
}

function upsertParametricOpening(
  definition: PartDefinition,
  bodyKey: string,
  shape: 'rect' | 'arch',
  input: RectOpeningInput,
): PartDefinition {
  const withParameters = ensureOpeningParameters(definition, input);
  const keys = openingParameterKeys(input.key);
  return upsertHole(withParameters, bodyKey, {
    shape,
    key: input.key,
    ...condition(existingHole(definition, bodyKey, input.key), input.when),
    x: keys.left,
    y: keys.sill,
    width: keys.width,
    height: keys.height,
  });
}

export function upsertRectOpening(
  definition: PartDefinition,
  bodyKey: string,
  input: RectOpeningInput,
): PartDefinition {
  return upsertParametricOpening(definition, bodyKey, 'rect', input);
}

export function upsertArchOpening(
  definition: PartDefinition,
  bodyKey: string,
  input: RectOpeningInput,
): PartDefinition {
  return upsertParametricOpening(definition, bodyKey, 'arch', input);
}

function referencedParameterGroup(definition: PartDefinition, keys: ReadonlySet<string>): boolean {
  for (const site of definitionFormulaSites(definition)) {
    try {
      if (formulaIdentifiers(parseFormula(site.formula)).some(identifier => keys.has(identifier))) return true;
    } catch {
      const formula = site.formula;
      if (typeof formula === 'string' && [...keys].some(key =>
        new RegExp(`(^|[^A-Za-z0-9_])${key}([^A-Za-z0-9_]|$)`).test(formula))) return true;
    }
  }
  return false;
}

function removeUnreferencedParameterGroup(definition: PartDefinition, holeKey: string): PartDefinition {
  const keys = new Set(Object.values(openingParameterKeys(holeKey)));
  if (referencedParameterGroup(definition, keys)) return definition;
  if (!definition.parameters.some(parameter => keys.has(parameter.key))) return definition;
  const parameters = definition.parameters.filter(parameter => !keys.has(parameter.key));
  const variants = definition.variants?.map(variant => {
    const values = { ...variant.values };
    for (const key of keys) delete values[key];
    return { ...variant, values };
  });
  return { ...definition, parameters, ...(variants ? { variants } : {}) };
}

/**
 * Polygon vertices stay as literal sheet coordinates. This avoids four parameters per vertex and
 * lets the later sketcher move vertices directly while the hole key remains the stable association.
 */
export function upsertPolygonOpening(
  definition: PartDefinition,
  bodyKey: string,
  input: PolygonOpeningInput,
): PartDefinition {
  if (input.points.length < 3 || input.points.length > PART_LIMITS.polygonPoints) {
    throw new RangeError(`Ein Polygon braucht 3 bis ${PART_LIMITS.polygonPoints} Punkte.`);
  }
  const points = input.points.map(([x, y]) => {
    finiteInRange('Polygonpunkt X', x, -MAX_PART_COORDINATE_MM, MAX_PART_COORDINATE_MM);
    finiteInRange('Polygonpunkt Y', y, -MAX_PART_COORDINATE_MM, MAX_PART_COORDINATE_MM);
    return [x, y] as [number, number];
  });
  const withHole = upsertHole(definition, bodyKey, {
    shape: 'polygon',
    key: input.key,
    ...condition(existingHole(definition, bodyKey, input.key), input.when),
    points,
  });
  return removeUnreferencedParameterGroup(withHole, input.key);
}

export function upsertOpening(
  definition: PartDefinition,
  bodyKey: string,
  input: OpeningInput,
): PartDefinition {
  if (input.shape === 'rect') return upsertRectOpening(definition, bodyKey, input);
  if (input.shape === 'arch') return upsertArchOpening(definition, bodyKey, input);
  return upsertPolygonOpening(definition, bodyKey, input);
}

export function removeOpening(
  definition: PartDefinition,
  bodyKey: string,
  holeKey: string,
): PartDefinition {
  const bodyIndex = definition.bodies.findIndex(body => body.key === bodyKey);
  if (bodyIndex < 0) throw new TypeError(`Körper „${bodyKey}“ wurde nicht gefunden.`);
  const body = definition.bodies[bodyIndex]!;
  if (body.kind !== 'sheet') throw new TypeError(`Körper „${bodyKey}“ ist keine Platte.`);
  if (!body.holes?.some(hole => hole.key === holeKey)) return definition;
  const holes = body.holes.filter(hole => hole.key !== holeKey);
  const bodies = [...definition.bodies];
  if (holes.length) {
    bodies[bodyIndex] = { ...body, holes };
  } else {
    const { holes: _holes, ...withoutHoles } = body;
    bodies[bodyIndex] = withoutHoles;
  }
  return removeUnreferencedParameterGroup({ ...definition, bodies }, holeKey);
}
