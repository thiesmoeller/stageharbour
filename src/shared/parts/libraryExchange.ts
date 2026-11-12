import type { CatalogIssue, ImportReport, ImportedPart } from './catalog.js';
import {
  PART_SCHEMA_VERSION, createPartContext, partLibrarySchema, partRefKey,
  type PartContext, type PartDefinition, type PartLibrary, type PartMaterial, type PartRef,
} from './definition.js';
import { hasErrors } from './issues.js';
import {
  canonicalJson, childRefs, compareNames, partsUsingMaterial, planned, refused, referencedMaterialKeys, sameDefinitionContent,
  type Plan,
} from './catalogPlans.js';
import { validateLibrary, type LibraryIssue } from './validate.js';

/** Library files: what an export contains and how an import merges into a workspace. */

export const LIBRARY_FILE_SUFFIX = '.stageharbour-parts.json';

const TRANSLITERATION: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** `bauteile-<workspace>-<yyyy-mm-dd>.stageharbour-parts.json`, ASCII only. */
export function libraryFilename(workspaceName: string, now: Date): string {
  const slug = workspaceName.toLowerCase().replace(/[äöüß]/g, letter => TRANSLITERATION[letter]!)
    .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return `bauteile-${slug || 'arbeitsbereich'}-${now.toISOString().slice(0, 10)}${LIBRARY_FILE_SUFFIX}`;
}

/**
 * The library document for some parts: their definitions, the exact child revisions they
 * reference (transitively) and every material any of them names. Ordered by name so equal
 * content gives an equal file.
 */
export function buildLibraryExport(args: {
  roots: readonly PartDefinition[];
  part(ref: PartRef): PartDefinition | undefined;
  material(key: string): PartMaterial | undefined;
}): PartLibrary {
  const included = new Map<string, PartDefinition>();
  const visit = (definition: PartDefinition) => {
    const key = partRefKey(definition);
    if (included.has(key)) return;
    included.set(key, definition);
    for (const ref of childRefs(definition)) {
      const child = args.part(ref);
      if (child) visit(child);
    }
  };
  args.roots.forEach(visit);
  const parts = [...included.values()].sort((a, b) =>
    compareNames(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.revision - b.revision);
  const keys = new Set(parts.flatMap(part => [...referencedMaterialKeys(part)]));
  const materials = [...keys].sort().flatMap(key => {
    const found = args.material(key);
    return found ? [found] : [];
  });
  return { schemaVersion: PART_SCHEMA_VERSION, materials, parts };
}

/** What the workspace holds, as far as an import needs to know. */
export type ImportWorkspace = {
  materials: ReadonlyMap<string, PartMaterial>;
  /** Every stored revision, by part id and revision number. */
  revisions: ReadonlyMap<string, ReadonlyMap<number, PartDefinition>>;
};

export type ImportPartWrite = {
  /** Carries the revision number it is stored under. */
  definition: PartDefinition;
  /** The part id was unknown: a part row is created. Otherwise a revision is added to the row. */
  newPart: boolean;
};

export type ImportPlan = {
  materials: { create: PartMaterial[]; overwrite: PartMaterial[] };
  parts: ImportPartWrite[];
  report: ImportReport;
};

const latestOf = (revisions: ReadonlyMap<number, PartDefinition>) => Math.max(...revisions.keys());

/** Latest definition of every part: what material guards and listings look at. */
export function latestDefinitions(revisions: ImportWorkspace['revisions']): PartDefinition[] {
  return [...revisions.values()].map(byRevision => byRevision.get(latestOf(byRevision))!);
}

function remapChildren(definition: PartDefinition, remap: ReadonlyMap<string, PartRef>): PartDefinition {
  if (!definition.children?.length) return definition;
  return {
    ...definition,
    children: definition.children.map(child => {
      const target = remap.get(partRefKey(child.part));
      return target ? { ...child, part: { id: target.id, revision: target.revision } } : child;
    }),
  };
}

function sameMaterial(a: PartMaterial, b: PartMaterial): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * Merge a library file into a workspace.
 *
 * - Materials the workspace lacks are created. Present ones are kept, or replaced when
 *   `overwriteMaterials` is set; identical ones count as skipped either way.
 * - Parts are processed children first. A part id the workspace does not know is created and
 *   keeps the revision numbers of the file. For a known id, the newest revision in the file is
 *   compared with the workspace's latest: identical content is skipped, anything else becomes
 *   revision n + 1. Older revisions in the file, which only exist because another part uses
 *   them, are matched against every stored revision and added only when none is identical.
 * - Child references of imported parts are rewritten to the revision numbers the workspace
 *   ended up with.
 * - A part that fails validation, or uses one that does, is rejected with its issues; the rest
 *   is still planned. The caller applies the plan in one transaction.
 *
 * A file that is not a library at all, or a change that would break parts in use, fails as a whole.
 */
export function planLibraryImport(args: {
  input: unknown; overwriteMaterials: boolean; workspace: ImportWorkspace;
}): Plan<ImportPlan> {
  const { workspace } = args;
  const structure = partLibrarySchema.safeParse(args.input);
  if (!structure.success) {
    const checked = validateLibrary(args.input);
    return refused(422, 'Die Datei ist keine gültige Bauteilbibliothek.', checked.issues);
  }
  const file = structure.data;

  const materialReport = { created: [] as string[], overwritten: [] as string[], skipped: [] as string[] };
  const create: PartMaterial[] = [];
  const overwrite: PartMaterial[] = [];
  const latest = latestDefinitions(workspace.revisions);
  for (const material of file.materials) {
    const existing = workspace.materials.get(material.key);
    if (!existing) {
      create.push(material);
      materialReport.created.push(material.key);
    } else if (!args.overwriteMaterials || sameMaterial(existing, material)) {
      materialReport.skipped.push(material.key);
    } else {
      const users = existing.kind !== material.kind ? partsUsingMaterial(material.key, latest) : [];
      if (users.length) {
        return refused(409, `Das Material „${material.key}“ wird von Bauteilen verwendet und kann seine Art nicht ändern.`);
      }
      overwrite.push(material);
      materialReport.overwritten.push(material.key);
    }
  }

  const applied = new Map<string, PartMaterial>();
  for (const material of [...create, ...overwrite]) applied.set(material.key, material);
  const context: PartContext = createPartContext({
    materials: [...workspace.materials.values()].filter(material => !applied.has(material.key)),
    parts: [...workspace.revisions.values()].flatMap(byRevision => [...byRevision.values()]),
  });
  const checked = validateLibrary({ ...file, materials: [...applied.values()] }, context);
  const issuesByPart = new Map<string, LibraryIssue[]>();
  for (const item of checked.issues) {
    if (!item.part) continue;
    const key = partRefKey(item.part);
    issuesByPart.set(key, [...(issuesByPart.get(key) ?? []), item]);
  }

  const entries = new Map(file.parts.map(part => [partRefKey(part), part]));
  const rejected = new Map<string, CatalogIssue[]>();
  for (const [key, items] of issuesByPart) {
    if (hasErrors(items)) rejected.set(key, items);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const part of entries.values()) {
      const key = partRefKey(part);
      if (rejected.has(key)) continue;
      const broken = childRefs(part).map(ref => entries.get(partRefKey(ref))).find(child => child && rejected.has(partRefKey(child)));
      if (!broken) continue;
      const child = part.children!.find(item => partRefKey(item.part) === partRefKey(broken))!;
      rejected.set(key, [{
        severity: 'error', code: 'unknown-part', child: child.key, part: { id: part.id, revision: part.revision }, partName: part.name,
        message: `Bauteil „${part.name}“: Unterbauteil „${child.key}“ („${broken.name}“) wurde abgelehnt.`,
      }]);
      changed = true;
    }
  }

  const order: PartDefinition[] = [];
  const visited = new Set<string>();
  const sorted = [...entries.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.revision - b.revision);
  const walk = (part: PartDefinition) => {
    const key = partRefKey(part);
    if (visited.has(key)) return;
    visited.add(key);
    for (const older of sorted) if (older.id === part.id && older.revision < part.revision) walk(older);
    for (const ref of childRefs(part)) {
      const child = entries.get(partRefKey(ref));
      if (child) walk(child);
    }
    order.push(part);
  };
  sorted.forEach(walk);

  const newestInFile = new Map<string, number>();
  for (const part of file.parts) newestInFile.set(part.id, Math.max(newestInFile.get(part.id) ?? 0, part.revision));

  const stored = new Map([...workspace.revisions].map(([id, byRevision]) => [id, new Map(byRevision)]));
  const knownBefore = new Set(stored.keys());
  const remap = new Map<string, PartRef>();
  const writes: ImportPartWrite[] = [];
  const report: ImportReport = { created: [], revised: [], skipped: [], rejected: [], materials: materialReport };

  for (const part of order) {
    const key = partRefKey(part);
    if (rejected.has(key)) continue;
    const content = remapChildren(part, remap);
    const entry = (revision: number): ImportedPart => ({ id: part.id, name: part.name, fileRevision: part.revision, revision });
    const revisions = stored.get(part.id);
    if (!knownBefore.has(part.id)) {
      const definition = { ...content, revision: part.revision };
      writes.push({ definition, newPart: !revisions });
      stored.set(part.id, new Map([...(revisions ?? []), [part.revision, definition]]));
      remap.set(key, { id: part.id, revision: part.revision });
      report.created.push(entry(part.revision));
      continue;
    }
    const current = revisions!;
    const newest = part.revision === newestInFile.get(part.id);
    const candidates = newest ? [current.get(latestOf(current))!] : [...current.values()];
    const same = candidates.find(candidate => sameDefinitionContent(candidate, content));
    if (same) {
      remap.set(key, { id: part.id, revision: same.revision });
      report.skipped.push(entry(same.revision));
      continue;
    }
    const revision = latestOf(current) + 1;
    const definition = { ...content, revision };
    writes.push({ definition, newPart: false });
    current.set(revision, definition);
    remap.set(key, { id: part.id, revision });
    report.revised.push(entry(revision));
  }

  for (const part of sorted) {
    const issues = rejected.get(partRefKey(part));
    if (issues) report.rejected.push({ id: part.id, name: part.name, fileRevision: part.revision, issues });
  }
  return planned({ materials: { create, overwrite }, parts: writes, report });
}

export type StarterExisting = {
  materialKeys: ReadonlySet<string>;
  parts: ReadonlyMap<string, { latestRevision: number; revisions: ReadonlySet<number> }>;
};

/**
 * What a workspace lacks of the starter library. Present materials and parts are never touched:
 * a part that exists keeps its own edits, and a starter revision newer than the part's latest is
 * not added on top of them. A missing revision at or below the latest is filled in so that
 * parts referencing it still resolve.
 */
export function planStarterLibrary(starter: PartLibrary, existing: StarterExisting): { materials: PartMaterial[]; parts: ImportPartWrite[] } {
  const materials = starter.materials.filter(material => !existing.materialKeys.has(material.key));
  const parts: ImportPartWrite[] = [];
  const created = new Set<string>();
  for (const definition of [...starter.parts].sort((a, b) => a.revision - b.revision)) {
    const known = existing.parts.get(definition.id);
    if (!known) {
      parts.push({ definition, newPart: !created.has(definition.id) });
      created.add(definition.id);
    } else if (!known.revisions.has(definition.revision) && definition.revision <= known.latestRevision) {
      parts.push({ definition, newPart: false });
    }
  }
  return { materials, parts };
}
