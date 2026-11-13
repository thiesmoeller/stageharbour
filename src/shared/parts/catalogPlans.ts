import type { CatalogIssue, PartDetail, PartRevisionInfo, PartSummary } from './catalog.js';
import {
  partRefKey, type PartContext, type PartDefinition, type PartMaterial, type PartRef, type StockMode,
} from './definition.js';
import { hasErrors } from './issues.js';
import { validateDefinition } from './validate.js';

/**
 * Pure rules of the part catalog that the server routes and the browser-local transport share.
 * Each function answers with data or a `CatalogFailure`; the two sides only differ in how they
 * read and write what the plan names.
 */

export type CatalogFailure = { status: 400 | 404 | 409 | 422; message: string; issues?: CatalogIssue[] };
export type Plan<T> = { ok: true; value: T } | { ok: false; failure: CatalogFailure };

export const planned = <T>(value: T): Plan<T> => ({ ok: true, value });
export const refused = (status: CatalogFailure['status'], message: string, issues?: CatalogIssue[]): Plan<never> =>
  ({ ok: false, failure: { status, message, ...(issues ? { issues } : {}) } });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** JSON with object keys in sorted order: equal content gives equal text, whatever the storage did to key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => isRecord(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : item);
}

/** Two definitions of the same part that differ at most in their revision number. */
export function sameDefinitionContent(a: PartDefinition, b: PartDefinition): boolean {
  return canonicalJson({ ...a, revision: 0 }) === canonicalJson({ ...b, revision: 0 });
}

export const compareNames = (a: string, b: string): number => a.localeCompare(b, 'de');
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** What the storage keeps about a part besides its revisions; timestamps are ISO strings. */
export type PartRecord = {
  id: string; name: string; category: string; latestRevision: number; favourite: boolean;
  archivedAt: string | null; updatedAt: string;
};

/** What a part list shows without opening the definition: the record plus variants and stock mode of the latest definition. */
export function buildPartSummary(record: PartRecord, definition: PartDefinition): PartSummary {
  return {
    id: record.id, name: record.name, category: record.category, latestRevision: record.latestRevision,
    archived: record.archivedAt !== null, favourite: record.favourite,
    variants: (definition.variants ?? []).map(variant => ({ key: variant.key, label: variant.label })),
    stock: definition.traits.stock satisfies StockMode,
    updatedAt: record.updatedAt,
  };
}

export function buildPartDetail(record: PartRecord, definition: PartDefinition, revisions: PartRevisionInfo[]): PartDetail {
  return { ...buildPartSummary(record, definition), definition, revisions: [...revisions].sort((a, b) => a.revision - b.revision) };
}

export const sortPartSummaries = (parts: readonly PartSummary[]): PartSummary[] =>
  [...parts].sort((a, b) => compareNames(a.name, b.name) || compareText(a.id, b.id));

export const sortMaterials = (materials: readonly PartMaterial[]): PartMaterial[] =>
  [...materials].sort((a, b) => compareText(a.kind, b.kind) || compareNames(a.name, b.name) || compareText(a.key, b.key));

/** Direct child parts of a definition, each exact revision once. */
export function childRefs(definition: PartDefinition): PartRef[] {
  const seen = new Map<string, PartRef>();
  for (const child of definition.children ?? []) seen.set(partRefKey(child.part), { id: child.part.id, revision: child.part.revision });
  return [...seen.values()];
}

/** Child references of a definition that has not been validated yet. */
export function rawChildRefs(input: unknown): PartRef[] {
  const children = (input as { children?: unknown } | null)?.children;
  if (!Array.isArray(children)) return [];
  return children.flatMap((child: unknown) => {
    const part = (child as { part?: { id?: unknown; revision?: unknown } } | null)?.part;
    return typeof part?.id === 'string' && typeof part.revision === 'number' && Number.isInteger(part.revision)
      ? [{ id: part.id, revision: part.revision }] : [];
  }).slice(0, 200);
}

/** Exact revisions and, transitively, the exact revisions their child parts reference, as far as `lookup` knows them. */
export function closureOf(seeds: readonly PartRef[], lookup: (ref: PartRef) => PartDefinition | undefined): PartDefinition[] {
  const found = new Map<string, PartDefinition>();
  const pending = [...seeds];
  for (let ref = pending.pop(); ref; ref = pending.pop()) {
    const key = partRefKey(ref);
    if (found.has(key)) continue;
    const definition = lookup(ref);
    if (!definition) continue;
    found.set(key, definition);
    pending.push(...childRefs(definition));
  }
  return [...found.values()];
}

export function referencedMaterialKeys(definition: PartDefinition): Set<string> {
  return new Set([...definition.bodies.map(body => body.material), ...(definition.hardware ?? []).map(item => item.material)]);
}

/** Checks a definition against the materials and parts of the workspace. */
export function checkDefinition(input: unknown, context: PartContext): Plan<PartDefinition> {
  const result = validateDefinition(input, context);
  if (!result.ok || !result.definition) {
    return refused(422, 'Das Bauteil ist nicht gültig.', result.issues);
  }
  return planned(result.definition);
}

/** First revision of a new part. The id comes from the definition; the revision is always 1. */
export function planCreatePart(input: unknown, context: PartContext, exists: (id: string) => boolean): Plan<PartDefinition> {
  const checked = checkDefinition(isRecord(input) ? { ...input, revision: 1 } : input, context);
  if (!checked.ok) return checked;
  if (exists(checked.value.id)) return refused(409, 'Ein Bauteil mit dieser ID gibt es bereits.');
  return planned(checked.value);
}

/**
 * Revision n + 1 of an existing part. The id in the definition must be the part's; the revision
 * in it is ignored and replaced, so the stored definition always carries its row's numbers.
 */
export function planSavePart(args: {
  partId: string; latestRevision: number; baseRevision: number; input: unknown; context: PartContext;
}): Plan<PartDefinition> {
  const { partId, latestRevision, baseRevision, input, context } = args;
  if (baseRevision !== latestRevision) {
    return refused(409, `Das Bauteil wurde inzwischen geändert (jetzt Revision ${latestRevision}). Bitte neu laden.`);
  }
  if (isRecord(input) && input.id !== undefined && input.id !== partId) {
    return refused(400, 'Die ID im Bauteil stimmt nicht mit dem Bauteil überein.');
  }
  return checkDefinition(isRecord(input) ? { ...input, id: partId, revision: latestRevision + 1 } : input, context);
}

export const COPY_SUFFIX = 'Kopie';
const NAME_MAX = 120;

/** `Name Kopie`, then `Name Kopie 2` … while the name is taken. */
export function duplicateName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const make = (suffix: string) => `${name.slice(0, NAME_MAX - suffix.length - 1).trimEnd()} ${suffix}`;
  let candidate = make(COPY_SUFFIX);
  for (let serial = 2; used.has(candidate); serial++) candidate = make(`${COPY_SUFFIX} ${serial}`);
  return candidate;
}

export function planDuplicatePart(source: PartDefinition, newId: string, takenNames: Iterable<string>): PartDefinition {
  return { ...structuredClone(source), id: newId, revision: 1, name: duplicateName(source.name, takenNames) };
}

export function partsUsingMaterial(key: string, definitions: readonly PartDefinition[]): PartDefinition[] {
  return definitions.filter(definition => referencedMaterialKeys(definition).has(key))
    .toSorted((a, b) => a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id));
}

const usedBy = (parts: readonly PartDefinition[]) => parts.slice(0, 5).map(part => `„${part.name}“`).join(', ')
  + (parts.length > 5 ? ` und ${parts.length - 5} weitere` : '');

/** Materials stay while a latest part revision names them. */
export function planMaterialDelete(
  key: string, existing: PartMaterial | undefined, latestDefinitions: readonly PartDefinition[],
): Plan<null> {
  if (!existing) return refused(404, 'Material nicht verfügbar.');
  const users = partsUsingMaterial(key, latestDefinitions);
  if (users.length) return refused(409, `Das Material wird noch von Bauteilen verwendet: ${usedBy(users)}.`);
  return planned(null);
}

/** Changing the kind of a material would break the parts that use it. */
export function planMaterialUpsert(
  material: PartMaterial, existing: PartMaterial | undefined, latestDefinitions: readonly PartDefinition[],
): Plan<{ created: boolean }> {
  if (existing && existing.kind !== material.kind) {
    const users = partsUsingMaterial(material.key, latestDefinitions);
    if (users.length) {
      return refused(409, `Das Material wird von Bauteilen verwendet und kann seine Art nicht ändern: ${usedBy(users)}.`);
    }
  }
  return planned({ created: !existing });
}
