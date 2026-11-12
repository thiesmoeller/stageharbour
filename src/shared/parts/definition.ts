import { z } from 'zod';
import { surfaceFinishSchema } from '../surfaces.js';
import { FORMULA_MAX_LENGTH, FormulaError, formulaIdentifiers, isFormulaFunction, parseFormula } from './formula.js';
import { formulaIssue, issue, type PartIssue } from './issues.js';
import { definitionFormulaSites, repeatLevels, siteSubject } from './sites.js';

export const PART_SCHEMA_VERSION = 1;

export const PART_LIMITS = {
  parameters: 40, variants: 60, derived: 60, bodies: 120, children: 60, connectors: 40, hardware: 40,
  faces: 40, holes: 20, polygonPoints: 64, discreteValues: 50, repeatLevels: 3,
  /** Instances one repeat level may produce. */
  repeatCount: 200,
  /** Solids one resolved part may hold, children included. */
  solids: 4000,
  /** Nesting depth of child parts. */
  depth: 8,
  libraryMaterials: 500, libraryParts: 500,
} as const;

/** No body dimension may be smaller than this (mm). */
export const MIN_BODY_DIMENSION_MM = 1;
/** Coordinates and sizes of a resolved part stay within ± this (mm), like `layout.ts`. */
export const MAX_PART_COORDINATE_MM = 100000;

const name = z.string().trim().min(1).max(120);
const label = z.string().trim().min(1).max(80);
const description = z.string().trim().max(1000);
const value = z.number().min(-1_000_000).max(1_000_000);

/** Key of a body, child, variant, connector, face, hole or material. Never contains `/` or brackets. */
export const partKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/);

/** Name usable in formulas: parameter, derived value or repeat index. */
export const identifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/)
  .refine(key => !isReservedIdentifier(key), 'Der Name ist für Formeln reserviert');

export function isReservedIdentifier(key: string): boolean {
  return isFormulaFunction(key) || key in Object.prototype;
}

export const formulaSchema = z.union([value, z.string().trim().min(1).max(FORMULA_MAX_LENGTH)]);
const vec2Schema = z.tuple([formulaSchema, formulaSchema]);
const vec3Schema = z.tuple([formulaSchema, formulaSchema, formulaSchema]);
export type FormulaVec2 = z.infer<typeof vec2Schema>;
export type FormulaVec3 = z.infer<typeof vec3Schema>;

export const partRefSchema = z.strictObject({ id: z.uuid(), revision: z.int().positive().max(1_000_000) });
export type PartRef = z.infer<typeof partRefSchema>;
export const partRefKey = (ref: PartRef): string => `${ref.id}@${ref.revision}`;

export const PARAMETER_TYPES = ['length', 'count', 'angle', 'percent', 'toggle'] as const;
export const PARAMETER_SCOPES = ['variant', 'placement', 'state'] as const;
export const parameterTypeSchema = z.enum(PARAMETER_TYPES);
export const parameterScopeSchema = z.enum(PARAMETER_SCOPES);
export type ParameterType = z.infer<typeof parameterTypeSchema>;
export type ParameterScope = z.infer<typeof parameterScopeSchema>;
export const PARAMETER_TYPE_LABELS: Record<ParameterType, string> = {
  length: 'Länge (mm)', count: 'Anzahl', angle: 'Winkel (°)', percent: 'Prozent', toggle: 'Ja/Nein',
};
export const PARAMETER_SCOPE_LABELS: Record<ParameterScope, string> = {
  variant: 'Variante', placement: 'Platzierung', state: 'Zustand im Bühnenbild',
};

export const parameterSchema = z.strictObject({
  key: identifierSchema,
  label,
  /** `length` mm, `count` whole number, `angle` degrees, `percent`, `toggle` 0 or 1. */
  type: parameterTypeSchema,
  default: value,
  /** Who sets the value: the variant, the placement, or the Bühnenbild state (door open). */
  scope: parameterScopeSchema,
  /** Continuous domain. Exactly one of `range` and `values`; a toggle takes neither. */
  range: z.strictObject({ min: value, max: value, step: z.number().positive().max(1_000_000).optional() }).optional(),
  /** Discrete domain. */
  values: z.array(value).min(1).max(PART_LIMITS.discreteValues).optional(),
});
export type PartParameter = z.infer<typeof parameterSchema>;

export const variantSchema = z.strictObject({
  key: partKeySchema,
  label,
  /** Values for variant-scope parameters; parameters left out keep their default. */
  values: z.record(identifierSchema, value),
});
export type PartVariant = z.infer<typeof variantSchema>;

export const derivedSchema = z.strictObject({ key: identifierSchema, label: label.optional(), formula: formulaSchema });
export type PartDerived = z.infer<typeof derivedSchema>;

const repeatLevelSchema = z.strictObject({
  count: formulaSchema,
  /** Offset between neighbouring instances, in the frame of the owning part. */
  step: vec3Schema,
  /** Name of the zero-based index inside the repeated element; defaults to `i`, `j`, `k` by level. */
  index: identifierSchema.optional(),
});
/** One level, or up to three nested levels for grids. */
export const repeatSchema = z.union([repeatLevelSchema, z.array(repeatLevelSchema).min(1).max(PART_LIMITS.repeatLevels)]);
export type PartRepeatLevel = z.infer<typeof repeatLevelSchema>;
export type PartRepeat = z.infer<typeof repeatSchema>;

const bodyBase = {
  key: partKeySchema,
  label: label.optional(),
  /** Key of the stock material: hardware for a box, a profile for a beam, a sheet material for a sheet. */
  material: partKeySchema,
  /** The body exists when this is non-zero. */
  when: formulaSchema.optional(),
  repeat: repeatSchema.optional(),
};

export const boxBodySchema = z.strictObject({
  ...bodyBase,
  kind: z.literal('box'),
  size: vec3Schema,
  /** Centre of the box. */
  at: vec3Schema,
  /** Euler degrees in three.js XYZ order, about `pivot`. */
  rotation: vec3Schema.optional(),
  /** Point the rotation turns about; defaults to `at`. */
  pivot: vec3Schema.optional(),
});

export const beamBodySchema = z.strictObject({
  ...bodyBase,
  kind: z.literal('beam'),
  /** Ends of the centre line; the beam is cut square at both. */
  from: vec3Schema,
  to: vec3Schema,
  /** Cross-section width and height; defaults to the profile of the material. */
  section: vec2Schema.optional(),
  /** Degrees about the centre line. */
  roll: formulaSchema.optional(),
});

const rectFields = {
  /** Lower-left corner in sheet coordinates. */
  x: formulaSchema, y: formulaSchema, width: formulaSchema, height: formulaSchema,
};
const polygonPoints = z.array(vec2Schema).min(3).max(PART_LIMITS.polygonPoints);

export const sheetOutlineSchema = z.discriminatedUnion('shape', [
  z.strictObject({ shape: z.literal('rect'), ...rectFields }),
  z.strictObject({ shape: z.literal('polygon'), points: polygonPoints }),
]);

const holeBase = { key: partKeySchema, when: formulaSchema.optional() };
export const sheetHoleSchema = z.discriminatedUnion('shape', [
  z.strictObject({ shape: z.literal('rect'), ...holeBase, ...rectFields }),
  /** Straight jambs with a semicircular crown of radius `width / 2`; `height` includes the crown. */
  z.strictObject({ shape: z.literal('arch'), ...holeBase, ...rectFields }),
  z.strictObject({ shape: z.literal('polygon'), ...holeBase, points: polygonPoints }),
]);
export type SheetHole = z.infer<typeof sheetHoleSchema>;

export const SHEET_PLANES = ['xy', 'xz', 'yz'] as const;
export const SHEET_ANCHORS = ['face', 'centre', 'back'] as const;

export const sheetBodySchema = z.strictObject({
  ...bodyBase,
  kind: z.literal('sheet'),
  /**
   * Plane the outline is drawn in and the side the material lies on:
   * `xy` upright, outline (x, y), material towards +Z; `xz` lying, outline (x, z), material
   * downwards; `yz` upright across, outline (z, y), material towards -X.
   */
  plane: z.enum(SHEET_PLANES),
  /** Where the outline origin lies in the part. */
  at: vec3Schema,
  /** `face` (default): `at` lies on the front face; `centre`: mid-thickness; `back`: on the back face. */
  anchor: z.enum(SHEET_ANCHORS).optional(),
  rotation: vec3Schema.optional(),
  pivot: vec3Schema.optional(),
  /** Defaults to the thickness of the material. */
  thickness: formulaSchema.optional(),
  outline: sheetOutlineSchema,
  holes: z.array(sheetHoleSchema).max(PART_LIMITS.holes).optional(),
});

export const bodySchema = z.discriminatedUnion('kind', [boxBodySchema, beamBodySchema, sheetBodySchema]);
export type BoxBody = z.infer<typeof boxBodySchema>;
export type BeamBody = z.infer<typeof beamBodySchema>;
export type SheetBody = z.infer<typeof sheetBodySchema>;
export type PartBody = z.infer<typeof bodySchema>;
export type PartBodyKind = PartBody['kind'];

export const childSchema = z.strictObject({
  key: partKeySchema,
  label: label.optional(),
  part: partRefSchema,
  /** Variant of the child; without it the first variant is the starting point. */
  variant: partKeySchema.optional(),
  /** Parameter values of the child as formulas over this part's names; any scope may be set. */
  values: z.record(identifierSchema, formulaSchema).optional(),
  /** Where the child's origin goes. */
  at: vec3Schema,
  rotation: vec3Schema.optional(),
  pivot: vec3Schema.optional(),
  when: formulaSchema.optional(),
  repeat: repeatSchema.optional(),
});
export type PartChild = z.infer<typeof childSchema>;

export const BUILT_IN_CONNECTOR_KINDS = ['hinge-edge', 'brace-mount', 'deck-edge', 'leg-socket', 'floor'] as const;
export type BuiltInConnectorKind = (typeof BUILT_IN_CONNECTOR_KINDS)[number];
/** German label and, where a kind mates with one other kind, that partner. */
export const CONNECTOR_KINDS: Readonly<Record<BuiltInConnectorKind, { label: string; partner?: string }>> = {
  'hinge-edge': { label: 'Scharnierkante' },
  'brace-mount': { label: 'Stützenanschluss' },
  'deck-edge': { label: 'Podestkante' },
  'leg-socket': { label: 'Fußaufnahme' },
  floor: { label: 'Bodenauflage' },
};

export const connectorSchema = z.strictObject({
  key: partKeySchema,
  label: label.optional(),
  /** One of the built-in kinds or a kind of the group's own. */
  kind: partKeySchema,
  /** The one other kind this connector also mates with. */
  partner: partKeySchema.optional(),
  at: vec3Schema,
  /**
   * Direction, normalised on resolve. Point connectors (socket, mount, floor) point out of the
   * part towards their mate; edge connectors (those with `length`) run along the edge.
   */
  axis: vec3Schema,
  /** Extent along `axis` starting at `at`; omitted for a point connector. */
  length: formulaSchema.optional(),
  when: formulaSchema.optional(),
});
export type PartConnector = z.infer<typeof connectorSchema>;

type ConnectorLike = { kind: string; partner?: string };

export function connectorPartner(connector: ConnectorLike): string | undefined {
  if (connector.partner) return connector.partner;
  return Object.hasOwn(CONNECTOR_KINDS, connector.kind)
    ? CONNECTOR_KINDS[connector.kind as BuiltInConnectorKind].partner : undefined;
}

/** A connector kind mates with the same kind or with its one listed partner kind; nothing more. */
export function connectorsMate(a: ConnectorLike, b: ConnectorLike): boolean {
  return a.kind === b.kind || connectorPartner(a) === b.kind || connectorPartner(b) === a.kind;
}

export const PART_FACE_SIDES = ['front', 'back', 'left', 'right', 'top', 'bottom', 'edge', 'all'] as const;
export const partFaceSideSchema = z.enum(PART_FACE_SIDES);
export type PartFaceSide = z.infer<typeof partFaceSideSchema>;
const SHEET_SIDES: readonly PartFaceSide[] = ['front', 'back', 'edge', 'all'];
const BOX_SIDES: readonly PartFaceSide[] = ['front', 'back', 'left', 'right', 'top', 'bottom', 'all'];
/** Sides a face trait may name for a body kind. */
export const faceSidesOf = (kind: PartBodyKind): readonly PartFaceSide[] => kind === 'sheet' ? SHEET_SIDES : BOX_SIDES;

export const STOCK_MODES = ['item', 'count', 'none'] as const;
export const PLAN_SYMBOLS = ['footprint', 'solids', 'stair'] as const;

export const traitsSchema = z.strictObject({
  /** The top of this body is a supporting surface people and other parts stand on. */
  surface: z.strictObject({ body: partKeySchema }).optional(),
  /** Faces that take a surface finish. Sheets offer front, back and edge; boxes and beams their six sides. */
  faces: z.array(z.strictObject({
    key: partKeySchema, label, body: partKeySchema, side: partFaceSideSchema,
  })).max(PART_LIMITS.faces).optional(),
  /** `item`: labelled pieces; `count`: counted stock; `none`: not stocked. */
  stock: z.enum(STOCK_MODES),
  /** Hint for the plan painter; the kernel does not interpret it. Defaults to the footprint. */
  planSymbol: z.enum(PLAN_SYMBOLS).optional(),
});
export type PartTraits = z.infer<typeof traitsSchema>;
export type StockMode = PartTraits['stock'];

export const hardwareSchema = z.strictObject({
  material: partKeySchema,
  /** Pieces; rounded up to a whole number. */
  quantity: formulaSchema,
  when: formulaSchema.optional(),
});
export type PartHardware = z.infer<typeof hardwareSchema>;

/** Structure only. `partDefinitionSchema` adds the checks that span fields. */
export const partDefinitionShapeSchema = z.strictObject({
  id: z.uuid(),
  revision: z.int().positive().max(1_000_000),
  name,
  category: label,
  description: description.optional(),
  parameters: z.array(parameterSchema).max(PART_LIMITS.parameters),
  variants: z.array(variantSchema).max(PART_LIMITS.variants).optional(),
  /** Named formulas, evaluated in order. */
  derived: z.array(derivedSchema).max(PART_LIMITS.derived).optional(),
  bodies: z.array(bodySchema).max(PART_LIMITS.bodies),
  children: z.array(childSchema).max(PART_LIMITS.children).optional(),
  connectors: z.array(connectorSchema).max(PART_LIMITS.connectors).optional(),
  traits: traitsSchema,
  /** Things the geometry does not show: ballast, straps, hinges. */
  hardware: z.array(hardwareSchema).max(PART_LIMITS.hardware).optional(),
});
export type PartDefinition = z.infer<typeof partDefinitionShapeSchema>;

const dimension = z.number().min(MIN_BODY_DIMENSION_MM).max(10000);
const weight = z.number().min(0).max(100000);
const materialBase = {
  key: partKeySchema,
  name,
  description: description.optional(),
  /** Display colour where no finish applies, `#rrggbb`. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  finish: surfaceFinishSchema.optional(),
};

export const materialSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('profile'), ...materialBase,
    /** Cross-section in mm. */
    section: z.strictObject({ width: dimension, height: dimension }),
    weightKgPerM: weight,
  }),
  z.strictObject({ kind: z.literal('sheet'), ...materialBase, thickness: dimension, weightKgPerM2: weight }),
  z.strictObject({ kind: z.literal('hardware'), ...materialBase, weightKgPerPiece: weight }),
]);
export type PartMaterial = z.infer<typeof materialSchema>;
export type PartMaterialKind = PartMaterial['kind'];
export const MATERIAL_KIND_LABELS: Record<PartMaterialKind, string> = {
  profile: 'Profil', sheet: 'Platte', hardware: 'Zubehör',
};
/** Material kind each body kind draws from. */
export const BODY_MATERIAL_KIND: Record<PartBodyKind, PartMaterialKind> = { box: 'hardware', beam: 'profile', sheet: 'sheet' };

/** Lookups `resolvePart` and `validateDefinition` read materials and child definitions through. */
export type PartContext = {
  material(key: string): PartMaterial | undefined;
  part(ref: PartRef): PartDefinition | undefined;
};

export function createPartContext(source: { materials?: readonly PartMaterial[]; parts?: readonly PartDefinition[] }): PartContext {
  const materials = new Map((source.materials ?? []).map(material => [material.key, material]));
  const parts = new Map((source.parts ?? []).map(part => [partRefKey(part), part]));
  return { material: key => materials.get(key), part: ref => parts.get(partRefKey(ref)) };
}

/** The value of the parameter's domain nearest to `input`: clamped, snapped to the step or to a listed value. */
export function normalizeParameterValue(parameter: PartParameter, input: number): number {
  if (!Number.isFinite(input)) return parameter.default;
  if (parameter.type === 'toggle') return input !== 0 ? 1 : 0;
  let result = input;
  if (parameter.values?.length) {
    result = parameter.values.reduce((best, candidate) =>
      Math.abs(candidate - input) < Math.abs(best - input) ? candidate : best, parameter.values[0]!);
  } else if (parameter.range) {
    const { min, max, step } = parameter.range;
    result = Math.max(min, Math.min(max, input));
    if (step) {
      result = min + Math.round((result - min) / step) * step;
      if (result > max) result -= step;
    }
    if (parameter.type === 'count') result = Math.max(Math.ceil(min), Math.min(Math.floor(max), Math.round(result)));
  }
  return result;
}

const sameValue = (a: number, b: number) => Math.abs(a - b) <= 1e-9;

/** The variant-scope values a variant stands for: its own values over the parameter defaults. */
export function variantValues(definition: PartDefinition, variant: PartVariant | undefined): Record<string, number> {
  const values: Record<string, number> = {};
  for (const parameter of definition.parameters) {
    if (parameter.scope !== 'variant') continue;
    const own = variant && Object.hasOwn(variant.values, parameter.key) ? variant.values[parameter.key] : undefined;
    values[parameter.key] = own ?? parameter.default;
  }
  return values;
}

/** First variant whose values equal the given variant-scope values. */
export function matchVariant(definition: PartDefinition, values: Readonly<Record<string, number>>): PartVariant | undefined {
  return (definition.variants ?? []).find(variant =>
    Object.entries(variantValues(definition, variant)).every(([key, expected]) =>
      Object.hasOwn(values, key) && sameValue(values[key]!, expected)));
}

export type ConsistencyIssue = PartIssue & { location: (string | number)[] };

function duplicates(keys: readonly string[]): Map<string, number> {
  const seen = new Set<string>();
  const found = new Map<string, number>();
  keys.forEach((key, index) => {
    if (seen.has(key) && !found.has(key)) found.set(key, index);
    seen.add(key);
  });
  return found;
}

/**
 * Checks that span fields of one definition and need no catalog: unique keys, parameter
 * domains, variant values, formula syntax and names, evaluation order of `derived`, trait
 * references. Used by `partDefinitionSchema` and, with structured results, by `validateDefinition`.
 */
export function definitionConsistencyIssues(definition: PartDefinition): ConsistencyIssue[] {
  const found: ConsistencyIssue[] = [];
  const report = (location: (string | number)[], item: PartIssue) => found.push({ ...item, location });

  const parameterKeys = definition.parameters.map(parameter => parameter.key);
  for (const [key, index] of duplicates(parameterKeys)) {
    report(['parameters', index, 'key'], issue('error', 'duplicate-key', { parameter: key }, 'Der Schlüssel ist doppelt vergeben.'));
  }
  definition.parameters.forEach((parameter, index) => {
    const at = ['parameters', index];
    const subject = { parameter: parameter.key };
    const domain = (text: string) => report(at, issue('error', 'parameter-domain', subject, text));
    if (parameter.type === 'toggle') {
      if (parameter.range || parameter.values) domain('Ein Ja/Nein-Parameter hat weder Bereich noch Werteliste.');
      if (parameter.default !== 0 && parameter.default !== 1) domain('Der Standardwert muss 0 oder 1 sein.');
      return;
    }
    if (!parameter.range === !parameter.values) {
      domain('Entweder ein Bereich oder eine Werteliste ist anzugeben.');
      return;
    }
    if (parameter.range && parameter.range.min > parameter.range.max) domain('Der kleinste Wert liegt über dem größten.');
    if (parameter.values && new Set(parameter.values).size !== parameter.values.length) domain('Die Werteliste enthält doppelte Werte.');
    const whole = parameter.type !== 'count' || [
      parameter.default, ...(parameter.values ?? []),
      ...(parameter.range ? [parameter.range.min, parameter.range.max, parameter.range.step ?? 1] : []),
    ].every(Number.isInteger);
    if (!whole) domain('Eine Anzahl braucht ganze Zahlen.');
    else if (!sameValue(normalizeParameterValue(parameter, parameter.default), parameter.default)) {
      domain('Der Standardwert liegt nicht im Bereich oder in der Werteliste.');
    }
  });
  const parameters = new Map(definition.parameters.map(parameter => [parameter.key, parameter]));

  const variants = definition.variants ?? [];
  for (const [key, index] of duplicates(variants.map(variant => variant.key))) {
    report(['variants', index, 'key'], issue('error', 'duplicate-key', { variant: key }, 'Der Schlüssel ist doppelt vergeben.'));
  }
  variants.forEach((variant, index) => {
    for (const [key, number] of Object.entries(variant.values)) {
      const at = ['variants', index, 'values', key];
      const subject = { variant: variant.key, parameter: key };
      const parameter = parameters.get(key);
      if (!parameter) report(at, issue('error', 'variant-value', subject, `Der Parameter „${key}“ ist nicht definiert.`));
      else if (parameter.scope !== 'variant') {
        report(at, issue('error', 'variant-value', subject, `Der Parameter „${key}“ wird nicht von der Variante bestimmt.`));
      } else if (!sameValue(normalizeParameterValue(parameter, number), number)) {
        report(at, issue('error', 'variant-value', subject, `Der Wert für „${key}“ liegt nicht im Bereich oder in der Werteliste.`));
      }
    }
  });

  const derived = definition.derived ?? [];
  const derivedKeys = derived.map(item => item.key);
  for (const [key, index] of duplicates(derivedKeys)) {
    report(['derived', index, 'key'], issue('error', 'duplicate-key', { derived: key }, 'Der Schlüssel ist doppelt vergeben.'));
  }
  derived.forEach((item, index) => {
    if (parameters.has(item.key)) {
      report(['derived', index, 'key'], issue('error', 'duplicate-key', { derived: item.key }, 'Ein Parameter trägt denselben Namen.'));
    }
  });

  const elementKeys = [
    ...definition.bodies.map((body, index) => ({ key: body.key, at: ['bodies', index, 'key'], subject: { body: body.key } })),
    ...(definition.children ?? []).map((child, index) => ({ key: child.key, at: ['children', index, 'key'], subject: { child: child.key } })),
  ];
  for (const [, index] of duplicates(elementKeys.map(item => item.key))) {
    const item = elementKeys[index]!;
    report(item.at, issue('error', 'duplicate-key', item.subject, 'Der Schlüssel ist bei Körpern und Unterbauteilen doppelt vergeben.'));
  }
  for (const [key, index] of duplicates((definition.connectors ?? []).map(connector => connector.key))) {
    report(['connectors', index, 'key'], issue('error', 'duplicate-key', { connector: key }, 'Der Schlüssel ist doppelt vergeben.'));
  }
  for (const [key, index] of duplicates((definition.traits.faces ?? []).map(face => face.key))) {
    report(['traits', 'faces', index, 'key'], issue('error', 'duplicate-key', { face: key }, 'Der Schlüssel ist doppelt vergeben.'));
  }
  definition.bodies.forEach((body, index) => {
    if (body.kind !== 'sheet') return;
    for (const [key, holeIndex] of duplicates((body.holes ?? []).map(hole => hole.key))) {
      report(['bodies', index, 'holes', holeIndex, 'key'],
        issue('error', 'duplicate-key', { body: body.key, hole: key }, 'Der Schlüssel ist doppelt vergeben.'));
    }
  });

  const checkIndices = (repeat: PartDefinition['bodies'][number]['repeat'], at: (string | number)[], subject: { body?: string; child?: string }) => {
    const names = repeatLevels(repeat).map(level => level.index);
    names.forEach((indexName, level) => {
      if (parameters.has(indexName) || derivedKeys.includes(indexName) || names.indexOf(indexName) !== level) {
        report([...at, 'repeat'], issue('error', 'reserved-name', { ...subject, field: `repeat[${level}].index` },
          `Der Zähler „${indexName}“ ist bereits als Name vergeben; bitte unter „index“ einen anderen wählen.`));
      }
    });
  };
  definition.bodies.forEach((body, index) => checkIndices(body.repeat, ['bodies', index], { body: body.key }));
  (definition.children ?? []).forEach((child, index) => checkIndices(child.repeat, ['children', index], { child: child.key }));

  for (const site of definitionFormulaSites(definition)) {
    const subject = siteSubject(site);
    let names: string[];
    try {
      names = formulaIdentifiers(parseFormula(site.formula));
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      report(site.location, formulaIssue(subject, site.formula, error));
      continue;
    }
    const derivedIndex = site.owner.kind === 'derived' ? site.owner.index : derived.length;
    for (const identifier of names) {
      if (parameters.has(identifier) || site.indices.includes(identifier)) continue;
      const position = derivedKeys.indexOf(identifier);
      if (position >= 0 && position < derivedIndex) continue;
      if (position >= 0) {
        report(site.location, issue('error', 'forward-reference', subject, position === derivedIndex
          ? `Die Formel „${site.formula}“ verweist auf sich selbst.`
          : `Die Formel „${site.formula}“ verwendet „${identifier}“, das erst danach berechnet wird.`));
      } else {
        report(site.location, issue('error', 'unknown-name', subject,
          `Die Formel „${site.formula}“ verwendet den unbekannten Namen „${identifier}“.`));
      }
    }
  }

  const bodies = new Map(definition.bodies.map(body => [body.key, body]));
  const surface = definition.traits.surface;
  if (surface) {
    const body = bodies.get(surface.body);
    if (!body) {
      report(['traits', 'surface', 'body'], issue('error', 'trait-reference', { body: surface.body }, 'Die begehbare Fläche verweist auf einen Körper, den es nicht gibt.'));
    } else if (body.kind === 'beam') {
      report(['traits', 'surface', 'body'], issue('error', 'trait-reference', { body: surface.body }, 'Ein Profil kann keine begehbare Fläche sein; bitte Platte oder Quader wählen.'));
    }
  }
  (definition.traits.faces ?? []).forEach((face, index) => {
    const body = bodies.get(face.body);
    const subject = { face: face.key };
    if (!body) {
      report(['traits', 'faces', index, 'body'], issue('error', 'trait-reference', subject, `Der Körper „${face.body}“ ist nicht definiert.`));
    } else if (!faceSidesOf(body.kind).includes(face.side)) {
      report(['traits', 'faces', index, 'side'], issue('error', 'trait-reference', subject,
        `Die Seite „${face.side}“ gibt es bei diesem Körper nicht (möglich: ${faceSidesOf(body.kind).join(', ')}).`));
    }
  });

  if (!definition.bodies.length && !(definition.children ?? []).length) {
    report(['bodies'], issue('error', 'empty-part', {}, 'Ein Bauteil braucht mindestens einen Körper oder ein Unterbauteil.'));
  }
  return found;
}

/** A complete part definition: structure plus the cross-field checks. */
export const partDefinitionSchema = partDefinitionShapeSchema.superRefine((definition, context) => {
  for (const item of definitionConsistencyIssues(definition)) {
    context.addIssue({ code: 'custom', message: item.message, path: item.location });
  }
});

/** The file groups exchange: stock materials and the part definitions that use them. */
export const partLibrarySchema = z.strictObject({
  schemaVersion: z.literal(PART_SCHEMA_VERSION),
  materials: z.array(materialSchema).max(PART_LIMITS.libraryMaterials),
  parts: z.array(partDefinitionSchema).max(PART_LIMITS.libraryParts),
}).superRefine((library, context) => {
  for (const [key, index] of duplicates(library.materials.map(material => material.key))) {
    context.addIssue({ code: 'custom', message: `Material „${key}“ ist doppelt vorhanden.`, path: ['materials', index, 'key'] });
  }
  for (const [, index] of duplicates(library.parts.map(partRefKey))) {
    const part = library.parts[index]!;
    context.addIssue({ code: 'custom', message: `Bauteil „${part.name}“ ist mit Revision ${part.revision} doppelt vorhanden.`, path: ['parts', index, 'id'] });
  }
});
export type PartLibrary = z.infer<typeof partLibrarySchema>;

/**
 * JSON Schema (draft 2020-12) of a library file. It describes the structure; the cross-field
 * rules of `partDefinitionSchema` are only enforced by the zod schema.
 */
export function partLibraryJsonSchema(): Record<string, unknown> {
  return {
    title: 'StageHarbour Bauteilbibliothek',
    ...z.toJSONSchema(partLibrarySchema, { target: 'draft-2020-12', reused: 'ref' }),
  };
}
