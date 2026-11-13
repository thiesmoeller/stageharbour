import { formulaIdentifiers, parseFormula, type Formula } from './formula.js';
import type { PartIssueSubject } from './issues.js';
import type { PartDefinition, PartRepeat, PartRepeatLevel } from './definition.js';

export const DEFAULT_REPEAT_INDEX_NAMES = ['i', 'j', 'k'] as const;

export type ResolvedRepeatLevel = Omit<PartRepeatLevel, 'index'> & { index: string };

/** Repeat levels as a list, each with its index name. */
export function repeatLevels(repeat: PartRepeat | undefined): ResolvedRepeatLevel[] {
  if (!repeat) return [];
  const levels = Array.isArray(repeat) ? repeat : [repeat];
  return levels.map((level, position) => ({ ...level, index: level.index ?? DEFAULT_REPEAT_INDEX_NAMES[position] ?? `i${position}` }));
}

export type FormulaSiteOwner = {
  kind: 'derived' | 'body' | 'child' | 'connector' | 'hardware';
  key: string;
  /** Position in the owning list of the definition. */
  index: number;
};

/** One place in a definition that holds a formula. */
export type FormulaSite = {
  owner: FormulaSiteOwner;
  /** Hole of a sheet the formula belongs to. */
  hole?: string;
  /** Field relative to the owner, such as `size[1]`, `outline.width` or `repeat[0].count`. */
  field: string;
  /** Path of the formula inside the definition object. */
  location: (string | number)[];
  formula: Formula;
  /** Repeat index names the formula may read in addition to parameters and derived values. */
  indices: string[];
};

export function siteSubject(site: Pick<FormulaSite, 'owner' | 'hole' | 'field'>): PartIssueSubject {
  const key = site.owner.key;
  switch (site.owner.kind) {
    case 'derived': return { derived: key };
    case 'body': return site.hole !== undefined ? { body: key, hole: site.hole, field: site.field } : { body: key, field: site.field };
    case 'child': return { child: key, field: site.field };
    case 'connector': return { connector: key, field: site.field };
    case 'hardware': return { hardware: key, field: site.field };
  }
}

/** Every formula of a definition with its owner, for validation, dependency analysis and renaming. */
export function definitionFormulaSites(definition: PartDefinition): FormulaSite[] {
  const sites: FormulaSite[] = [];
  type Target = { owner: FormulaSiteOwner; base: (string | number)[]; indices: string[]; hole?: string };
  const one = (target: Target, field: string, path: (string | number)[], formula: Formula | undefined) => {
    if (formula === undefined) return;
    sites.push({ owner: target.owner, hole: target.hole, field, location: [...target.base, ...path], formula, indices: target.indices });
  };
  const list = (target: Target, field: string, path: (string | number)[], formulas: readonly Formula[] | undefined) => {
    formulas?.forEach((formula, index) => one(target, `${field}[${index}]`, [...path, index], formula));
  };
  const points = (target: Target, field: string, path: (string | number)[], items: readonly (readonly Formula[])[]) => {
    items.forEach((point, index) => list(target, `${field}[${index}]`, [...path, index], point));
  };
  const repeat = (target: Target, value: PartRepeat | undefined): string[] => {
    const levels = repeatLevels(value);
    levels.forEach((level, position) => {
      const outer = { ...target, indices: levels.slice(0, position).map(item => item.index) };
      const path = Array.isArray(value) ? ['repeat', position] : ['repeat'];
      one(outer, `repeat[${position}].count`, [...path, 'count'], level.count);
      list(outer, `repeat[${position}].step`, [...path, 'step'], level.step);
    });
    return levels.map(level => level.index);
  };

  (definition.derived ?? []).forEach((item, index) => {
    one({ owner: { kind: 'derived', key: item.key, index }, base: ['derived', index], indices: [] }, 'formula', ['formula'], item.formula);
  });

  definition.bodies.forEach((body, index) => {
    const outer: Target = { owner: { kind: 'body', key: body.key, index }, base: ['bodies', index], indices: [] };
    const target = { ...outer, indices: repeat(outer, body.repeat) };
    one(target, 'when', ['when'], body.when);
    if (body.kind === 'box') {
      list(target, 'size', ['size'], body.size);
      list(target, 'at', ['at'], body.at);
      list(target, 'rotation', ['rotation'], body.rotation);
      list(target, 'pivot', ['pivot'], body.pivot);
    } else if (body.kind === 'beam') {
      list(target, 'from', ['from'], body.from);
      list(target, 'to', ['to'], body.to);
      list(target, 'section', ['section'], body.section);
      one(target, 'roll', ['roll'], body.roll);
    } else {
      list(target, 'at', ['at'], body.at);
      list(target, 'rotation', ['rotation'], body.rotation);
      list(target, 'pivot', ['pivot'], body.pivot);
      one(target, 'thickness', ['thickness'], body.thickness);
      const shape = (owner: Target, field: string, path: (string | number)[], value: typeof body.outline) => {
        if (value.shape === 'polygon') {
          points(owner, `${field}.points`, [...path, 'points'], value.points);
        } else {
          for (const name of ['x', 'y', 'width', 'height'] as const) one(owner, `${field}.${name}`, [...path, name], value[name]);
        }
      };
      shape(target, 'outline', ['outline'], body.outline);
      (body.holes ?? []).forEach((hole, holeIndex) => {
        const holeTarget = { ...target, hole: hole.key };
        const path = ['holes', holeIndex];
        one(holeTarget, 'when', [...path, 'when'], hole.when);
        if (hole.shape === 'polygon') points(holeTarget, 'points', [...path, 'points'], hole.points);
        else for (const name of ['x', 'y', 'width', 'height'] as const) one(holeTarget, name, [...path, name], hole[name]);
      });
    }
  });

  (definition.children ?? []).forEach((child, index) => {
    const outer: Target = { owner: { kind: 'child', key: child.key, index }, base: ['children', index], indices: [] };
    const target = { ...outer, indices: repeat(outer, child.repeat) };
    one(target, 'when', ['when'], child.when);
    list(target, 'at', ['at'], child.at);
    list(target, 'rotation', ['rotation'], child.rotation);
    list(target, 'pivot', ['pivot'], child.pivot);
    for (const [key, formula] of Object.entries(child.values ?? {})) one(target, `values.${key}`, ['values', key], formula);
  });

  (definition.connectors ?? []).forEach((connector, index) => {
    const target: Target = { owner: { kind: 'connector', key: connector.key, index }, base: ['connectors', index], indices: [] };
    one(target, 'when', ['when'], connector.when);
    list(target, 'at', ['at'], connector.at);
    list(target, 'axis', ['axis'], connector.axis);
    one(target, 'length', ['length'], connector.length);
  });

  (definition.hardware ?? []).forEach((hardware, index) => {
    const target: Target = { owner: { kind: 'hardware', key: hardware.material, index }, base: ['hardware', index], indices: [] };
    one(target, 'quantity', ['quantity'], hardware.quantity);
    one(target, 'when', ['when'], hardware.when);
  });
  return sites;
}

/** The parameters every formula of a definition reads, directly or through derived values. */
export function formulaSiteParameters(definition: PartDefinition): { site: FormulaSite; parameters: string[] }[] {
  const parameterKeys = new Set(definition.parameters.map(parameter => parameter.key));
  const derivedParameters = new Map<string, string[]>();
  const expand = (names: readonly string[]): string[] => {
    const found: string[] = [];
    for (const name of names) {
      const through = parameterKeys.has(name) ? [name] : derivedParameters.get(name) ?? [];
      for (const key of through) if (!found.includes(key)) found.push(key);
    }
    return found;
  };
  const identifiers = (formula: Formula): string[] => {
    try { return formulaIdentifiers(parseFormula(formula)); } catch { return []; }
  };
  return definitionFormulaSites(definition).map(site => {
    const parameters = expand(identifiers(site.formula));
    if (site.owner.kind === 'derived') derivedParameters.set(site.owner.key, parameters);
    return { site, parameters };
  });
}

/**
 * Parameters each element depends on, directly or through derived values. Keys are
 * `body:<key>`, `child:<key>`, `connector:<key>`, `hardware:<material>` and `derived:<key>`.
 */
export function definitionDependencies(definition: PartDefinition): Map<string, string[]> {
  const dependencies = new Map<string, string[]>();
  for (const { site, parameters } of formulaSiteParameters(definition)) {
    const key = `${site.owner.kind}:${site.owner.key}`;
    const known = dependencies.get(key) ?? [];
    for (const parameter of parameters) if (!known.includes(parameter)) known.push(parameter);
    dependencies.set(key, known);
  }
  return dependencies;
}
