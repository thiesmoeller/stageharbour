import { z } from 'zod';
import { openingSchema } from '../../shared/wall-types.js';
import { physicalFinishSchema } from '../../shared/surfaces.js';
import { planStarterLibrary } from '../../shared/parts/libraryExchange.js';
import {
  materialSchema, partDefinitionShapeSchema, partKeySchema, identifierSchema, type PartDefinition, type PartMaterial,
} from '../../shared/parts/definition.js';
import { STARTER_LIBRARY } from '../../shared/parts/starter/index.js';
import { variantColumn } from '../../shared/parts/stock.js';

/** The part catalog as the browser-local workspace stores it: the tables of the server, as plain lists. */

const timestamp = z.iso.datetime();

const localPartSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(120),
  latestRevision: z.int().positive(),
  favourite: z.boolean(),
  archivedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type LocalPart = z.infer<typeof localPartSchema>;

const localRevisionSchema = z.strictObject({
  partId: z.uuid(),
  revision: z.int().positive(),
  definition: partDefinitionShapeSchema,
  createdAt: timestamp,
  /** Null for the starter library, which no person wrote. */
  authorName: z.string().nullable(),
});
export type LocalPartRevision = z.infer<typeof localRevisionSchema>;

const localStockItemSchema = z.strictObject({
  id: z.uuid(),
  label: z.string().min(1).max(120),
  partId: z.uuid(),
  variantKey: partKeySchema.nullable(),
  values: z.record(identifierSchema, z.number().finite()),
  usable: z.boolean(),
  notes: z.string().max(500).nullable(),
  cutouts: z.array(openingSchema),
  finish: physicalFinishSchema.nullable(),
  archivedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type LocalStockItem = z.infer<typeof localStockItemSchema>;

const localStockCountSchema = z.strictObject({
  id: z.uuid(),
  materialKey: partKeySchema.nullable(),
  partId: z.uuid().nullable(),
  variantKey: partKeySchema.nullable(),
  quantity: z.int().min(0),
  updatedAt: timestamp,
});
export type LocalStockCount = z.infer<typeof localStockCountSchema>;

const firstDuplicate = (values: readonly string[]): string | undefined => {
  const seen = new Set<string>();
  return values.find(value => seen.size === seen.add(value).size);
};

export const localCatalogSchema = z.strictObject({
  parts: z.array(localPartSchema),
  revisions: z.array(localRevisionSchema),
  materials: z.array(materialSchema),
  stockItems: z.array(localStockItemSchema),
  stockCounts: z.array(localStockCountSchema),
}).superRefine((catalog, context) => {
  const problem = (message: string, path: (string | number)[]) => context.addIssue({ code: 'custom', message, path });
  const partIds = new Set(catalog.parts.map(part => part.id));
  if (partIds.size !== catalog.parts.length) problem('Doppelte Bauteil-ID.', ['parts']);
  const revisionKeys = catalog.revisions.map(item => `${item.partId}@${item.revision}`);
  if (firstDuplicate(revisionKeys)) problem('Doppelte Revision.', ['revisions']);
  catalog.revisions.forEach((item, index) => {
    if (!partIds.has(item.partId)) problem('Revision ohne Bauteil.', ['revisions', index, 'partId']);
    if (item.definition.id !== item.partId || item.definition.revision !== item.revision) {
      problem('Die Definition trägt nicht die Nummern ihrer Revision.', ['revisions', index, 'definition']);
    }
  });
  const stored = new Set(revisionKeys);
  catalog.parts.forEach((part, index) => {
    if (!stored.has(`${part.id}@${part.latestRevision}`)) problem('Die neueste Revision fehlt.', ['parts', index, 'latestRevision']);
  });
  if (firstDuplicate(catalog.materials.map(item => item.key))) problem('Doppeltes Material.', ['materials']);
  const materialKeys = new Set(catalog.materials.map(item => item.key));
  const activeLabels = catalog.stockItems.filter(item => item.archivedAt === null).map(item => item.label);
  if (firstDuplicate(activeLabels)) problem('Doppeltes Etikett.', ['stockItems']);
  catalog.stockItems.forEach((item, index) => {
    if (!partIds.has(item.partId)) problem('Bestandsstück ohne Bauteil.', ['stockItems', index, 'partId']);
  });
  if (firstDuplicate(catalog.stockItems.map(item => item.id))) problem('Doppelte Bestandsstück-ID.', ['stockItems']);
  const targets = catalog.stockCounts.map(item => item.materialKey !== null
    ? `m:${item.materialKey}` : `p:${item.partId}:${variantColumn(item.variantKey)}`);
  if (firstDuplicate(targets)) problem('Doppelter Bestand.', ['stockCounts']);
  catalog.stockCounts.forEach((item, index) => {
    const byMaterial = item.materialKey !== null;
    if (byMaterial === (item.partId !== null)) problem('Ein Bestand zählt entweder ein Material oder ein Bauteil.', ['stockCounts', index]);
    if (byMaterial && !materialKeys.has(item.materialKey!)) problem('Bestand ohne Material.', ['stockCounts', index, 'materialKey']);
    if (item.partId !== null && !partIds.has(item.partId)) problem('Bestand ohne Bauteil.', ['stockCounts', index, 'partId']);
  });
});
export type LocalCatalog = z.infer<typeof localCatalogSchema>;

export const emptyCatalog = (): LocalCatalog => ({ parts: [], revisions: [], materials: [], stockItems: [], stockCounts: [] });

export const definitionsByRevision = (catalog: LocalCatalog): Map<string, Map<number, PartDefinition>> => {
  const byPart = new Map<string, Map<number, PartDefinition>>();
  for (const item of catalog.revisions) {
    const revisions = byPart.get(item.partId) ?? new Map<number, PartDefinition>();
    revisions.set(item.revision, item.definition);
    byPart.set(item.partId, revisions);
  }
  return byPart;
};

export const materialsByKey = (catalog: LocalCatalog): Map<string, PartMaterial> =>
  new Map(catalog.materials.map(item => [item.key, item]));

/** Adds what the catalog lacks of the starter library; what exists, including edits, stays as it is. */
export function ensureStarterCatalog(catalog: LocalCatalog, now: Date): LocalCatalog {
  const stamp = now.toISOString();
  const revisions = definitionsByRevision(catalog);
  const plan = planStarterLibrary(STARTER_LIBRARY, {
    materialKeys: new Set(catalog.materials.map(item => item.key)),
    parts: new Map([...revisions].map(([id, byRevision]) => [id, {
      latestRevision: catalog.parts.find(part => part.id === id)?.latestRevision ?? 0,
      revisions: new Set(byRevision.keys()),
    }])),
  });
  const next: LocalCatalog = structuredClone(catalog);
  next.materials.push(...plan.materials);
  for (const { definition, newPart } of plan.parts) {
    if (newPart) {
      const latest = Math.max(...plan.parts.filter(write => write.definition.id === definition.id).map(write => write.definition.revision));
      next.parts.push({
        id: definition.id, name: definition.name, category: definition.category, latestRevision: latest,
        favourite: false, archivedAt: null, createdAt: stamp, updatedAt: stamp,
      });
    }
    next.revisions.push({ partId: definition.id, revision: definition.revision, definition, createdAt: stamp, authorName: null });
  }
  return next;
}
