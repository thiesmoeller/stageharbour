import { z } from 'zod';
import { physicalFinishSchema, wallSurfacesSchema } from '../surfaces.js';
import { openingSchema } from '../wall-types.js';
import {
  STOCK_MODES, identifierSchema, materialSchema, partDefinitionShapeSchema, partKeySchema, partLibrarySchema, partRefSchema,
} from './definition.js';

/** Request and response contracts of the part catalog, materials, library files and stock. */

export const CATALOG_LIMITS = {
  /** Refs one bulk resolve call may carry. */
  resolveRefs: 200,
  /** Parts one export may select. */
  exportParts: 500,
  stockCount: 1_000_000,
  cutouts: 20,
} as const;

const timestamp = z.iso.datetime();
const label = z.string().trim().min(1).max(120);
const notes = z.string().trim().max(500);
const variantKey = partKeySchema;

/** A finding about a definition or a library, as the routes return it. `code` is a `PartIssueCode`. */
export const catalogIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
  parameter: z.string().optional(),
  derived: z.string().optional(),
  variant: z.string().optional(),
  body: z.string().optional(),
  hole: z.string().optional(),
  child: z.string().optional(),
  connector: z.string().optional(),
  hardware: z.string().optional(),
  face: z.string().optional(),
  material: z.string().optional(),
  field: z.string().optional(),
  formula: z.object({ code: z.string(), position: z.number(), source: z.string() }).optional(),
  part: partRefSchema.optional(),
  partName: z.string().optional(),
});
export type CatalogIssue = z.infer<typeof catalogIssueSchema>;

/** Body of a 422 answer: the message plus, for definitions and libraries, the structured issues. */
export const unprocessableSchema = z.object({ message: z.string(), issues: z.array(catalogIssueSchema).optional() });
export type Unprocessable = z.infer<typeof unprocessableSchema>;

export const partIdParamsSchema = z.object({ workspaceId: z.uuid(), partId: z.uuid() });
export const partRevisionParamsSchema = z.object({
  workspaceId: z.uuid(), partId: z.uuid(), revision: z.coerce.number().int().positive().max(1_000_000),
});
export const materialParamsSchema = z.object({ workspaceId: z.uuid(), key: partKeySchema });
export const stockItemParamsSchema = z.object({ workspaceId: z.uuid(), itemId: z.uuid() });

export const listPartsQuerySchema = z.object({ includeArchived: z.enum(['true', 'false']).optional() });
export const includesArchived = (query: z.infer<typeof listPartsQuerySchema>): boolean => query.includeArchived === 'true';

export const partVariantSummarySchema = z.strictObject({ key: partKeySchema, label: z.string() });
export type PartVariantSummary = z.infer<typeof partVariantSummarySchema>;

export const partSummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  category: z.string(),
  latestRevision: z.int().positive(),
  archived: z.boolean(),
  favourite: z.boolean(),
  variants: z.array(partVariantSummarySchema),
  stock: z.enum(STOCK_MODES),
  updatedAt: timestamp,
});
export type PartSummary = z.infer<typeof partSummarySchema>;

export const partRevisionInfoSchema = z.strictObject({
  revision: z.int().positive(),
  createdAt: timestamp,
  authorName: z.string().nullable(),
});
export type PartRevisionInfo = z.infer<typeof partRevisionInfoSchema>;

export const partDetailSchema = partSummarySchema.extend({
  /** The latest revision. */
  definition: partDefinitionShapeSchema,
  revisions: z.array(partRevisionInfoSchema),
});
export type PartDetail = z.infer<typeof partDetailSchema>;

export const partRevisionSchema = partRevisionInfoSchema.extend({
  partId: z.uuid(),
  definition: partDefinitionShapeSchema,
});
export type PartRevisionRecord = z.infer<typeof partRevisionSchema>;

/** `definition` is checked by `validateDefinition`, which answers with structured issues. */
export const createPartSchema = z.strictObject({ definition: z.unknown() });
export type CreatePartRequest = z.infer<typeof createPartSchema>;

export const savePartSchema = z.strictObject({
  /** The revision the editor started from; the save fails with 409 when a newer one exists. */
  baseRevision: z.int().positive().max(1_000_000),
  definition: z.unknown(),
});
export type SavePartRequest = z.infer<typeof savePartSchema>;

export const favouriteSchema = z.strictObject({ favourite: z.boolean() });

export const resolvePartsSchema = z.strictObject({
  refs: z.array(partRefSchema).min(1).max(CATALOG_LIMITS.resolveRefs),
});
export type ResolvePartsRequest = z.infer<typeof resolvePartsSchema>;
export const resolvedPartsSchema = z.strictObject({
  definitions: z.array(partDefinitionShapeSchema),
  missing: z.array(partRefSchema),
});
export type ResolvedParts = z.infer<typeof resolvedPartsSchema>;

export const materialListSchema = z.array(materialSchema);

export const exportLibrarySchema = z.strictObject({
  /** Parts to export; without it every part that is not archived. */
  partIds: z.array(z.uuid()).max(CATALOG_LIMITS.exportParts).optional(),
});
export type ExportLibraryRequest = z.infer<typeof exportLibrarySchema>;
export const libraryExportSchema = z.strictObject({ filename: z.string(), library: partLibrarySchema });
export type LibraryExport = z.infer<typeof libraryExportSchema>;

export const importLibrarySchema = z.strictObject({
  /** A `partLibrarySchema` document; checked by `validateLibrary`. */
  library: z.unknown(),
  /** Replace materials the workspace already has; by default they are kept. */
  overwriteMaterials: z.boolean().optional(),
});
export type ImportLibraryRequest = z.infer<typeof importLibrarySchema>;

const importedPartSchema = z.strictObject({
  id: z.uuid(), name: z.string(),
  /** Revision number inside the imported file. */
  fileRevision: z.int().positive(),
  /** Revision the part has in the workspace after the import. */
  revision: z.int().positive(),
});
export const importReportSchema = z.strictObject({
  created: z.array(importedPartSchema),
  revised: z.array(importedPartSchema),
  skipped: z.array(importedPartSchema),
  rejected: z.array(z.strictObject({
    id: z.uuid(), name: z.string(), fileRevision: z.int().positive(), issues: z.array(catalogIssueSchema),
  })),
  materials: z.strictObject({
    created: z.array(partKeySchema), overwritten: z.array(partKeySchema), skipped: z.array(partKeySchema),
  }),
});
export type ImportReport = z.infer<typeof importReportSchema>;
export type ImportedPart = z.infer<typeof importedPartSchema>;

/** Values of the stock item's own, placement-scope parameters. */
const stockValuesSchema = z.record(identifierSchema, z.number().finite().min(-1_000_000).max(1_000_000));
const cutoutsSchema = z.array(openingSchema).max(CATALOG_LIMITS.cutouts);
const finishInputSchema = z.strictObject({ surfaces: wallSurfacesSchema, description: z.string().trim().max(300) });

export const stockItemSchema = z.strictObject({
  id: z.uuid(),
  label,
  partId: z.uuid(),
  partName: z.string(),
  variantKey: variantKey.nullable(),
  variantLabel: z.string().nullable(),
  values: stockValuesSchema,
  /** False while the piece is broken or lent out. */
  usable: z.boolean(),
  notes: notes.nullable(),
  /** Technical cut-outs (cable outlets) of this physical piece. */
  cutouts: cutoutsSchema,
  /** What the piece is painted or covered with now; null while unknown. */
  finish: physicalFinishSchema.nullable(),
  archived: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type StockItem = z.infer<typeof stockItemSchema>;

export const createStockItemSchema = z.strictObject({
  label,
  partId: z.uuid(),
  variantKey: variantKey.nullable().optional(),
  values: stockValuesSchema.optional(),
  usable: z.boolean().optional(),
  notes: notes.nullable().optional(),
  cutouts: cutoutsSchema.optional(),
  finish: finishInputSchema.nullable().optional(),
});
export type CreateStockItemRequest = z.infer<typeof createStockItemSchema>;

export const updateStockItemSchema = z.strictObject({
  label: label.optional(),
  variantKey: variantKey.nullable().optional(),
  values: stockValuesSchema.optional(),
  usable: z.boolean().optional(),
  notes: notes.nullable().optional(),
  cutouts: cutoutsSchema.optional(),
  finish: finishInputSchema.nullable().optional(),
}).refine(body => Object.values(body).some(value => value !== undefined), 'Mindestens ein Feld ist anzugeben.');
export type UpdateStockItemRequest = z.infer<typeof updateStockItemSchema>;

export const stockItemsSchema = z.array(stockItemSchema);

export const stockCountSchema = z.strictObject({
  id: z.uuid(),
  /** Set for hardware counted by material, such as Betonplatte. */
  materialKey: partKeySchema.nullable(),
  /** Set for count-stocked parts, such as Steckfuß. */
  partId: z.uuid().nullable(),
  variantKey: variantKey.nullable(),
  name: z.string(),
  variantLabel: z.string().nullable(),
  quantity: z.int().min(0).max(CATALOG_LIMITS.stockCount),
  updatedAt: timestamp,
});
export type StockCount = z.infer<typeof stockCountSchema>;
export const stockCountsSchema = z.array(stockCountSchema);

const quantity = z.int().min(0).max(CATALOG_LIMITS.stockCount);
export const setStockCountSchema = z.union([
  z.strictObject({ materialKey: partKeySchema, quantity }),
  z.strictObject({ partId: z.uuid(), variantKey: variantKey.nullable().optional(), quantity }),
]);
export type SetStockCountRequest = z.infer<typeof setStockCountSchema>;
