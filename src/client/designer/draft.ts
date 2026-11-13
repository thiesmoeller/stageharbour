import {
  BODY_MATERIAL_KIND,
  type PartBody, type PartBodyKind, type PartChild, type PartConnector, type PartDefinition, type PartHardware,
  type PartMaterial, type PartParameter, type PartRef, type PartVariant,
} from '../../shared/parts/definition.js';
import type { PartIssueSubject } from '../../shared/parts/issues.js';

/** What the inspector edits and the views highlight. */
export type DesignerSelection =
  | { kind: 'body'; key: string }
  | { kind: 'child'; key: string }
  | { kind: 'connector'; key: string }
  | { kind: 'hardware'; index: number };

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, position) => position !== index);
}

export function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  return list.map((current, position) => position === index ? item : current);
}

/** Moves one entry by `delta` places; out-of-range moves leave the list as it is. */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}

/** `base`, else `base-2`, `base-3` … while taken. */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let serial = 2; ; serial++) if (!used.has(`${base}-${serial}`)) return `${base}-${serial}`;
}

/** Like `uniqueKey`, but for formula names, which may not contain `-`. */
export function uniqueIdentifier(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let serial = 2; ; serial++) if (!used.has(`${base}${serial}`)) return `${base}${serial}`;
}

const elementKeys = (definition: PartDefinition) => [
  ...definition.bodies.map(body => body.key), ...(definition.children ?? []).map(child => child.key),
];
const formulaNames = (definition: PartDefinition) => [
  ...definition.parameters.map(parameter => parameter.key), ...(definition.derived ?? []).map(item => item.key),
];

export function firstMaterialKey(materials: readonly PartMaterial[], kind: PartMaterial['kind'], fallback: string): string {
  return materials.find(material => material.kind === kind)?.key ?? fallback;
}

/** A small, valid starting point: a top sheet on four legs whose size the placement sets. */
export function newPartDefinition(id: string, materials: readonly PartMaterial[]): PartDefinition {
  const sheet = firstMaterialKey(materials, 'sheet', 'sperrholz-12');
  const profile = firstMaterialKey(materials, 'profile', 'latte-40x40');
  return {
    id, revision: 1, name: 'Neues Bauteil', category: 'Eigene Bauteile',
    parameters: [
      { key: 'B', label: 'Breite', type: 'length', default: 1000, scope: 'placement', range: { min: 300, max: 3000, step: 10 } },
      { key: 'T', label: 'Tiefe', type: 'length', default: 600, scope: 'placement', range: { min: 300, max: 2000, step: 10 } },
      { key: 'H', label: 'Höhe', type: 'length', default: 500, scope: 'placement', range: { min: 100, max: 1500, step: 10 } },
    ],
    derived: [{ key: 'einzug', label: 'Beinachse ab Kante', formula: 40 }],
    bodies: [
      {
        kind: 'sheet', key: 'platte', label: 'Platte', material: sheet, plane: 'xz', at: [0, 'H', 0],
        outline: { shape: 'rect', x: '-B / 2', y: '-T / 2', width: 'B', height: 'T' },
      },
      {
        kind: 'beam', key: 'bein', label: 'Bein', material: profile,
        from: ['-(B / 2 - einzug)', 0, '-(T / 2 - einzug)'], to: ['-(B / 2 - einzug)', 'H - 20', '-(T / 2 - einzug)'],
        repeat: [{ count: 2, step: ['B - 2 * einzug', 0, 0] }, { count: 2, step: [0, 0, 'T - 2 * einzug'] }],
      },
    ],
    traits: { surface: { body: 'platte' }, stock: 'none' },
  };
}

export const BODY_KIND_LABELS: Record<PartBodyKind, string> = { box: 'Quader', beam: 'Profil', sheet: 'Platte' };

export function newBody(kind: PartBodyKind, definition: PartDefinition, materials: readonly PartMaterial[]): PartBody {
  const material = firstMaterialKey(materials, BODY_MATERIAL_KIND[kind], kind === 'box' ? 'gummifuss-50' : kind === 'beam' ? 'latte-40x40' : 'sperrholz-12');
  const key = uniqueKey(kind === 'box' ? 'quader' : kind === 'beam' ? 'profil' : 'platte', elementKeys(definition));
  if (kind === 'box') return { kind, key, material, size: [100, 100, 100], at: [0, 50, 0] };
  if (kind === 'beam') return { kind, key, material, from: [0, 0, 0], to: [0, 500, 0] };
  return { kind, key, material, plane: 'xy', at: [0, 0, 0], outline: { shape: 'rect', x: -250, y: 0, width: 500, height: 500 } };
}

export function newChild(definition: PartDefinition, part: PartDefinition): PartChild {
  const base = part.name.toLowerCase().replace(/[äöüß]/g, letter => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[letter]!)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'teil';
  const ref: PartRef = { id: part.id, revision: part.revision };
  return { key: uniqueKey(base, elementKeys(definition)), label: part.name, part: ref, at: [0, 0, 0] };
}

export function newConnector(definition: PartDefinition): PartConnector {
  const key = uniqueKey('verbinder', (definition.connectors ?? []).map(connector => connector.key));
  return { key, kind: 'floor', at: [0, 0, 0], axis: [0, -1, 0] };
}

export function newHardware(materials: readonly PartMaterial[]): PartHardware {
  return { material: firstMaterialKey(materials, 'hardware', 'betonplatte-400'), quantity: 1 };
}

export function newParameter(definition: PartDefinition): PartParameter {
  const key = uniqueIdentifier('P', formulaNames(definition));
  return { key, label: 'Neuer Parameter', type: 'length', default: 500, scope: 'placement', range: { min: 100, max: 1000 } };
}

export function newVariant(definition: PartDefinition): PartVariant {
  const variants = definition.variants ?? [];
  const values: Record<string, number> = {};
  for (const parameter of definition.parameters) if (parameter.scope === 'variant') values[parameter.key] = parameter.default;
  return { key: uniqueKey('variante', variants.map(variant => variant.key)), label: `Variante ${variants.length + 1}`, values };
}

export function newDerived(definition: PartDefinition) {
  return { key: uniqueIdentifier('wert', formulaNames(definition)), formula: 0 };
}

/**
 * Replaces one parameter and keeps the variants consistent with it: a renamed key moves in
 * every variant, and values disappear when the parameter stops being set by the variant.
 */
export function updateParameter(definition: PartDefinition, index: number, next: PartParameter): PartDefinition {
  const previous = definition.parameters[index];
  if (!previous) return definition;
  const variants = definition.variants?.map(variant => {
    const values = { ...variant.values };
    const had = Object.hasOwn(values, previous.key);
    const value = values[previous.key];
    if (had) delete values[previous.key];
    if (next.scope === 'variant') values[next.key] = had ? value! : next.default;
    return { ...variant, values };
  });
  return { ...definition, parameters: replaceAt(definition.parameters, index, next), ...(variants ? { variants } : {}) };
}

export function removeParameter(definition: PartDefinition, index: number): PartDefinition {
  const removed = definition.parameters[index];
  if (!removed) return definition;
  const variants = definition.variants?.map(variant => {
    const values = { ...variant.values };
    delete values[removed.key];
    return { ...variant, values };
  });
  return { ...definition, parameters: removeAt(definition.parameters, index), ...(variants ? { variants } : {}) };
}

/** Parameter with a new type: domain fields reset to what that type allows. */
export function withParameterType(parameter: PartParameter, type: PartParameter['type']): PartParameter {
  const { range: _range, values: _values, ...rest } = parameter;
  if (type === 'toggle') return { ...rest, type, default: parameter.default ? 1 : 0 };
  if (parameter.type === 'toggle') return { ...rest, type, default: 1, range: { min: 0, max: 1000 } };
  return { ...parameter, type };
}

/** Parameter switched between a range and a list of values, keeping its default inside. */
export function withParameterDomain(parameter: PartParameter, domain: 'range' | 'values'): PartParameter {
  const { range, values, ...rest } = parameter;
  if (parameter.type === 'toggle') return parameter;
  if (domain === 'values') return { ...rest, values: values ?? [parameter.default] };
  const list = values ?? [parameter.default];
  return { ...rest, range: range ?? { min: Math.min(...list), max: Math.max(...list) } };
}

/** Comma- or semicolon-separated numbers; German decimal commas are not supported because the comma separates. */
export function parseValueList(text: string): number[] {
  return text.split(/[;,\s]+/).map(item => item.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
}

/** A body's key changes everywhere the definition names it (traits). */
export function renameBodyReferences(definition: PartDefinition, from: string, to: string): PartDefinition {
  if (from === to) return definition;
  const traits = { ...definition.traits };
  if (traits.surface?.body === from) traits.surface = { body: to };
  if (traits.faces) traits.faces = traits.faces.map(face => face.body === from ? { ...face, body: to } : face);
  return { ...definition, traits };
}

export function removeBody(definition: PartDefinition, index: number): PartDefinition {
  const removed = definition.bodies[index];
  if (!removed) return definition;
  const traits = { ...definition.traits };
  if (traits.surface?.body === removed.key) delete traits.surface;
  if (traits.faces) traits.faces = traits.faces.filter(face => face.body !== removed.key);
  return { ...definition, bodies: removeAt(definition.bodies, index), traits };
}

type IssueLike = PartIssueSubject & { message: string; severity: 'error' | 'warning' };

/** Issues about the selected element, optionally only those of one field (`size[1]`, `repeat[0].count`, …). */
export function issuesForSelection<T extends IssueLike>(issues: readonly T[], selection: DesignerSelection, field?: string): T[] {
  return issues.filter(item => {
    if (item.path) return false;
    const owner = selection.kind === 'body' ? item.body === selection.key && item.hole === undefined
      : selection.kind === 'child' ? item.child === selection.key
        : selection.kind === 'connector' ? item.connector === selection.key
          : false;
    if (!owner) return false;
    return field === undefined || item.field === field || item.field?.startsWith(`${field}[`) === true;
  });
}

/** The selection an issue points at, if it names an element of this definition. */
export function selectionOfIssue(item: PartIssueSubject, definition: PartDefinition): DesignerSelection | undefined {
  if (item.path) {
    const key = item.path.split('/')[0]!.replace(/\[.*$/, '');
    return (definition.children ?? []).some(child => child.key === key) ? { kind: 'child', key } : undefined;
  }
  if (item.body !== undefined && definition.bodies.some(body => body.key === item.body)) return { kind: 'body', key: item.body };
  if (item.child !== undefined) return { kind: 'child', key: item.child };
  if (item.connector !== undefined) return { kind: 'connector', key: item.connector };
  if (item.hardware !== undefined) {
    const index = (definition.hardware ?? []).findIndex(entry => entry.material === item.hardware);
    if (index >= 0) return { kind: 'hardware', index };
  }
  return undefined;
}
