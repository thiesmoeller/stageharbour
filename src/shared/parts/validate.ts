import { z } from 'zod';
import {
  BODY_MATERIAL_KIND, MATERIAL_KIND_LABELS, PART_LIMITS,
  createPartContext, definitionConsistencyIssues, partDefinitionShapeSchema, partLibrarySchema, partRefKey,
  type PartContext, type PartDefinition, type PartLibrary, type PartParameter, type PartRef, type PartVariant,
} from './definition.js';
import { formatNumber, hasErrors, issue, type PartIssue } from './issues.js';
import { resolvePartConfiguration } from './resolve.js';
import { formulaSiteParameters } from './sites.js';

export type DefinitionValidation = {
  /** No error-level issue was found. */
  ok: boolean;
  /** The parsed definition; present when its structure is valid. */
  definition?: PartDefinition;
  issues: PartIssue[];
  /** Parameter combinations that were resolved. */
  evaluated: number;
  /** True when the combinations were too many to resolve all of them. */
  sampled: boolean;
};

export type ValidateOptions = {
  /** Upper bound for the full combinations resolved per variant. Default 256. */
  maxCombinationsPerVariant?: number;
  /** Upper bound for the full combinations resolved over all variants. Default 4096. */
  maxCombinations?: number;
};

const german = z.locales.de().localeError;

function schemaIssues(error: z.ZodError): PartIssue[] {
  return error.issues.map(item => {
    const field = item.path.map(String).join('.');
    return { severity: 'error' as const, code: 'schema' as const, message: field ? `${field}: ${item.message}` : item.message, ...(field ? { field } : {}) };
  });
}

function staticContextIssues(definition: PartDefinition, context: PartContext): PartIssue[] {
  const found: PartIssue[] = [];
  const material = (key: string, expected: 'profile' | 'sheet' | 'hardware', subject: { body?: string; hardware?: string }) => {
    const known = context.material(key);
    if (!known) {
      found.push(issue('error', 'unknown-material', { ...subject, material: key }, `Das Material „${key}“ ist nicht vorhanden.`));
    } else if (known.kind !== expected) {
      found.push(issue('error', 'material-kind', { ...subject, material: key },
        `Das Material „${known.name}“ ist ${MATERIAL_KIND_LABELS[known.kind]}, gebraucht wird ${MATERIAL_KIND_LABELS[expected]}.`));
    }
  };
  for (const body of definition.bodies) material(body.material, BODY_MATERIAL_KIND[body.kind], { body: body.key });
  for (const item of definition.hardware ?? []) material(item.material, 'hardware', { hardware: item.material });

  /** Levels of child parts below a definition, or the reason the tree is not usable. */
  const explored = new Map<string, number>();
  const depthBelow = (current: PartDefinition, trail: string[]): number | 'cycle' | 'missing' => {
    const known = explored.get(partRefKey(current));
    if (known !== undefined) return known;
    let deepest = 0;
    for (const child of current.children ?? []) {
      const next = context.part(child.part);
      if (!next) return 'missing';
      if (trail.includes(next.id)) return 'cycle';
      const below = depthBelow(next, [...trail, next.id]);
      if (typeof below !== 'number') return below;
      deepest = Math.max(deepest, below + 1);
    }
    explored.set(partRefKey(current), deepest);
    return deepest;
  };

  for (const child of definition.children ?? []) {
    const subject = { child: child.key };
    const target = context.part(child.part);
    if (!target) {
      found.push(issue('error', 'unknown-part', subject, `Das Bauteil ${child.part.id} (Revision ${child.part.revision}) ist nicht vorhanden.`));
      continue;
    }
    if (target.id === definition.id) {
      found.push(issue('error', 'child-cycle', subject, `„${definition.name}“ enthält sich selbst.`));
      continue;
    }
    const below = depthBelow(target, [definition.id, target.id]);
    if (below === 'cycle') {
      found.push(issue('error', 'child-cycle', subject, `„${target.name}“ enthält über seine Unterbauteile wieder „${definition.name}“ oder sich selbst.`));
    } else if (below === 'missing') {
      found.push(issue('error', 'unknown-part', subject, `„${target.name}“ verweist auf ein Unterbauteil, das nicht vorhanden ist.`));
    } else if (below + 1 > PART_LIMITS.depth) {
      found.push(issue('error', 'child-depth', subject, `Unterbauteile sind tiefer als ${PART_LIMITS.depth} Ebenen verschachtelt.`));
    }
    if (child.variant !== undefined && !(target.variants ?? []).some(variant => variant.key === child.variant)) {
      found.push(issue('error', 'unknown-variant', { ...subject, variant: child.variant },
        `„${target.name}“ hat keine Variante „${child.variant}“.`));
    }
    for (const key of Object.keys(child.values ?? {})) {
      if (!target.parameters.some(parameter => parameter.key === key)) {
        found.push(issue('error', 'unknown-parameter', { ...subject, parameter: key, field: `values.${key}` },
          `„${target.name}“ hat keinen Parameter „${key}“.`));
      }
    }
  }
  return found;
}

type Trial = { values: Record<string, number>; varied: string[] };

function candidates(parameter: PartParameter, endsOnly: boolean): number[] {
  if (parameter.type === 'toggle') return [0, 1];
  if (parameter.values?.length) {
    return endsOnly ? [...new Set([parameter.values[0]!, parameter.values[parameter.values.length - 1]!])] : [...parameter.values];
  }
  return parameter.range ? [...new Set([parameter.range.min, parameter.range.max])] : [parameter.default];
}

/** Deterministic 32-bit generator (mulberry32) for sampling combinations. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Parameter settings to resolve for one variant: the defaults, each free parameter alone at
 * every value of its domain (range ends or listed values), then the combinations of those
 * values. Too many combinations are cut down to range ends and, beyond that, to the two
 * extreme corners plus a fixed pseudo-random sample.
 */
function trials(free: readonly PartParameter[], budget: number): { list: Trial[]; sampled: boolean } {
  const list: Trial[] = [];
  const seen = new Set<string>();
  const push = (values: Record<string, number>) => {
    const varied = free.filter(parameter => Object.hasOwn(values, parameter.key) && values[parameter.key] !== parameter.default)
      .map(parameter => parameter.key);
    const key = varied.map(name => `${name}=${values[name]}`).join(';');
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ values: Object.fromEntries(varied.map(name => [name, values[name]!])), varied });
  };
  push({});
  for (const parameter of free) for (const value of candidates(parameter, false)) push({ [parameter.key]: value });

  const size = (options: number[][]) => options.reduce((product, option) => product * option.length, 1);
  let options = free.map(parameter => candidates(parameter, false));
  let sampled = false;
  if (size(options) > budget) {
    sampled = true;
    options = free.map(parameter => candidates(parameter, true));
  }
  const pick = (choose: (option: number[], position: number) => number) =>
    push(Object.fromEntries(free.map((parameter, position) => [parameter.key, choose(options[position]!, position)])));
  if (size(options) <= budget) {
    const total = size(options);
    for (let combination = 0; combination < total; combination++) {
      let rest = combination;
      pick(option => {
        const value = option[rest % option.length]!;
        rest = Math.floor(rest / option.length);
        return value;
      });
    }
  } else {
    pick(option => option[0]!);
    pick(option => option[option.length - 1]!);
    const random = generator(0x5a17e9a0);
    for (let sample = 2; sample < budget; sample++) pick(option => option[Math.floor(random() * option.length)]!);
  }
  return { list, sampled };
}

const issueKey = (item: PartIssue) => [item.code, item.path, item.body, item.hole, item.child, item.connector, item.hardware,
  item.derived, item.material, item.face, item.field].join('|');

type Drivers = { byElement: Map<string, string[]>; byField: { owner: string; hole?: string; field: string; parameters: string[] }[] };

function driversOf(definition: PartDefinition): Drivers {
  const byElement = new Map<string, string[]>();
  const byField: Drivers['byField'] = [];
  for (const { site, parameters } of formulaSiteParameters(definition)) {
    const owner = `${site.owner.kind}:${site.owner.key}`;
    const known = byElement.get(owner) ?? [];
    for (const parameter of parameters) if (!known.includes(parameter)) known.push(parameter);
    byElement.set(owner, known);
    byField.push({ owner, ...(site.hole !== undefined ? { hole: site.hole } : {}), field: site.field, parameters });
  }
  return { byElement, byField };
}

function ownerKey(item: PartIssue): string | undefined {
  if (item.path) return `child:${item.path.split('/')[0]!.replace(/\[.*$/, '')}`;
  if (item.body !== undefined) return `body:${item.body}`;
  if (item.child !== undefined) return `child:${item.child}`;
  if (item.connector !== undefined) return `connector:${item.connector}`;
  if (item.hardware !== undefined) return `hardware:${item.hardware}`;
  if (item.derived !== undefined) return `derived:${item.derived}`;
  return undefined;
}

/**
 * Parameters that drive what an issue is about: those of the field it names when that field
 * has any, otherwise those of the whole element. Issues inside a child part belong to the
 * child element of this definition.
 */
function issueDrivers(item: PartIssue, drivers: Drivers): string[] {
  const owner = ownerKey(item);
  if (!owner) return [];
  if (!item.path && item.field !== undefined) {
    const found: string[] = [];
    for (const entry of drivers.byField) {
      const sameField = entry.field === item.field || entry.field.startsWith(`${item.field}[`);
      if (entry.owner !== owner || entry.hole !== item.hole || !sameField) continue;
      for (const parameter of entry.parameters) if (!found.includes(parameter)) found.push(parameter);
    }
    if (found.length) return found;
  }
  return drivers.byElement.get(owner) ?? [];
}

/**
 * Check a definition before it is saved as a revision: structure, unique keys, formulas and
 * the names they use, materials, child parts (present, acyclic), trait references, and then
 * a resolve at every variant combined with the ends of every range and every listed value.
 * Any error there (a body under 1 mm, a non-finite value, a cut-out that splits its sheet)
 * rejects the definition; the issue names the body and the parameter that drives it.
 */
export function validateDefinition(input: unknown, context: PartContext, options: ValidateOptions = {}): DefinitionValidation {
  const parsed = partDefinitionShapeSchema.safeParse(input, { error: german });
  if (!parsed.success) return { ok: false, issues: schemaIssues(parsed.error), evaluated: 0, sampled: false };
  const definition = parsed.data;
  const issues: PartIssue[] = [
    ...definitionConsistencyIssues(definition).map(({ location: _location, ...item }) => item),
    ...staticContextIssues(definition, context),
  ];
  if (hasErrors(issues)) return { ok: false, definition, issues, evaluated: 0, sampled: false };

  const variants: (PartVariant | undefined)[] = definition.variants?.length ? definition.variants : [undefined];
  const free = definition.parameters.filter(parameter => !definition.variants?.length || parameter.scope !== 'variant');
  const defaults = new Map(definition.parameters.map(parameter => [parameter.key, parameter.default]));
  const order = definition.parameters.map(parameter => parameter.key);
  const drivers = driversOf(definition);
  const budget = Math.max(8, Math.min(
    options.maxCombinationsPerVariant ?? 256,
    Math.floor((options.maxCombinations ?? 4096) / variants.length),
  ));
  const plan = trials(free, budget);
  const seen = new Set<string>();
  let evaluated = 0;

  for (const variant of variants) {
    for (const trial of plan.list) {
      const resolved = resolvePartConfiguration(definition, { variant: variant?.key, values: trial.values }, context);
      evaluated++;
      for (const item of resolved.issues) {
        if (item.code === 'value-adjusted') continue;
        const key = issueKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        const driving = issueDrivers(item, drivers);
        const parameter = trial.varied.find(name => driving.includes(name)) ?? driving[0] ?? trial.varied[0];
        const shown = order.filter(name => driving.length ? driving.includes(name) : trial.varied.includes(name));
        const setting = shown.map(name => `${name} = ${formatNumber(resolved.values[name] ?? defaults.get(name) ?? 0)}`).join(', ');
        const where = [setting, variant ? `Variante „${variant.label}“` : ''].filter(Boolean).join(', ');
        issues.push({
          ...item,
          message: where ? `${item.message.replace(/\.$/, '')}. Tritt auf bei ${where}.` : item.message,
          ...(parameter !== undefined && item.parameter === undefined ? { parameter } : {}),
          ...(variant && item.variant === undefined ? { variant: variant.key } : {}),
        });
      }
    }
  }
  return { ok: !hasErrors(issues), definition, issues, evaluated, sampled: plan.sampled };
}

export type LibraryIssue = PartIssue & { part?: PartRef; partName?: string };
export type LibraryValidation = { ok: boolean; library?: PartLibrary; issues: LibraryIssue[] };

/**
 * Check a library file: structure, then every part against the materials and parts of the
 * file itself. `fallback` supplies what the file may leave out, such as the materials a
 * workspace already has.
 */
export function validateLibrary(input: unknown, fallback?: PartContext, options: ValidateOptions = {}): LibraryValidation {
  const parsed = partLibrarySchema.safeParse(input, { error: german });
  if (!parsed.success) return { ok: false, issues: schemaIssues(parsed.error) };
  const library = parsed.data;
  const own = createPartContext(library);
  const context: PartContext = {
    material: key => own.material(key) ?? fallback?.material(key),
    part: ref => own.part(ref) ?? fallback?.part(ref),
  };
  const issues: LibraryIssue[] = [];
  for (const part of library.parts) {
    const { id, revision, name } = part;
    for (const item of validateDefinition(part, context, options).issues) {
      issues.push({ ...item, message: `Bauteil „${name}“: ${item.message}`, part: { id, revision }, partName: name });
    }
  }
  return { ok: !hasErrors(issues), library, issues };
}
