import { z } from 'zod';
import { ApiError, request } from './api.js';
import { materialSchema, type PartMaterial } from '../shared/parts/definition.js';
import {
  importReportSchema, libraryExportSchema, materialListSchema, partDetailSchema, partRevisionSchema, partSummarySchema,
  resolvedPartsSchema, stockCountSchema, stockCountsSchema, stockItemSchema, stockItemsSchema, unprocessableSchema,
  type CatalogIssue, type CreateStockItemRequest, type ExportLibraryRequest, type ImportLibraryRequest, type ImportReport,
  type LibraryExport, type PartDetail, type PartRevisionRecord, type PartSummary, type ResolvedParts, type SetStockCountRequest,
  type StockCount, type StockItem, type UpdateStockItemRequest,
} from '../shared/parts/catalog.js';
import type { PartRef } from '../shared/parts/definition.js';

/** Typed access to the part catalog, materials, library files and stock. Works against the server and local mode alike. */

const parts = (workspaceId: string) => `/api/workspaces/${workspaceId}/parts`;
const stock = (workspaceId: string) => `/api/workspaces/${workspaceId}/stock`;
const archivedQuery = (includeArchived: boolean | undefined) => includeArchived ? '?includeArchived=true' : '';

export async function listParts(workspaceId: string, options: { includeArchived?: boolean } = {}): Promise<PartSummary[]> {
  return z.array(partSummarySchema).parse(await request(`${parts(workspaceId)}${archivedQuery(options.includeArchived)}`));
}

export async function getPart(workspaceId: string, partId: string): Promise<PartDetail> {
  return partDetailSchema.parse(await request(`${parts(workspaceId)}/${partId}`));
}

export async function getPartRevision(workspaceId: string, partId: string, revision: number): Promise<PartRevisionRecord> {
  return partRevisionSchema.parse(await request(`${parts(workspaceId)}/${partId}/revisions/${revision}`));
}

/** Creates a part from a definition; its revision number is set to 1. Rejected definitions fail with issues, see `catalogIssues`. */
export async function createPart(workspaceId: string, definition: unknown): Promise<PartDetail> {
  return partDetailSchema.parse(await request(parts(workspaceId), { definition }));
}

/** Saves a new revision; `baseRevision` is the revision the edit started from and fails with 409 when it is stale. */
export async function savePart(workspaceId: string, partId: string, baseRevision: number, definition: unknown): Promise<PartDetail> {
  return partDetailSchema.parse(await request(`${parts(workspaceId)}/${partId}/revisions`, { baseRevision, definition }));
}

export async function archivePart(workspaceId: string, partId: string): Promise<PartSummary> {
  return partSummarySchema.parse(await request(`${parts(workspaceId)}/${partId}/archive`, undefined, 'POST'));
}

export async function unarchivePart(workspaceId: string, partId: string): Promise<PartSummary> {
  return partSummarySchema.parse(await request(`${parts(workspaceId)}/${partId}/unarchive`, undefined, 'POST'));
}

export async function setPartFavourite(workspaceId: string, partId: string, favourite: boolean): Promise<PartSummary> {
  return partSummarySchema.parse(await request(`${parts(workspaceId)}/${partId}/favourite`, { favourite }, 'PUT'));
}

export async function duplicatePart(workspaceId: string, partId: string): Promise<PartDetail> {
  return partDetailSchema.parse(await request(`${parts(workspaceId)}/${partId}/duplicate`, undefined, 'POST'));
}

/** Exact revisions in one call; refs the workspace does not hold come back as `missing`. */
export async function resolveParts(workspaceId: string, refs: readonly PartRef[]): Promise<ResolvedParts> {
  return resolvedPartsSchema.parse(await request(`${parts(workspaceId)}/resolve`, { refs }));
}

export async function listMaterials(workspaceId: string): Promise<PartMaterial[]> {
  return materialListSchema.parse(await request(`/api/workspaces/${workspaceId}/materials`));
}

export async function saveMaterial(workspaceId: string, material: PartMaterial): Promise<PartMaterial> {
  return materialSchema.parse(await request(
    `/api/workspaces/${workspaceId}/materials/${encodeURIComponent(material.key)}`, material, 'PUT'));
}

export async function deleteMaterial(workspaceId: string, key: string): Promise<void> {
  await request(`/api/workspaces/${workspaceId}/materials/${encodeURIComponent(key)}`, undefined, 'DELETE');
}

export async function exportLibrary(workspaceId: string, options: ExportLibraryRequest = {}): Promise<LibraryExport> {
  return libraryExportSchema.parse(await request(`/api/workspaces/${workspaceId}/library/export`, options));
}

/** Imports a library document atomically. A document that does not validate fails with 422 and issues. */
export async function importLibrary(workspaceId: string, library: unknown, options: Pick<ImportLibraryRequest, 'overwriteMaterials'> = {}): Promise<ImportReport> {
  return importReportSchema.parse(await request(`/api/workspaces/${workspaceId}/library/import`, { library, ...options }));
}

export async function fetchPartLibrarySchema(): Promise<unknown> {
  return request('/api/schemas/part-library.schema.json');
}

export async function listStockItems(workspaceId: string, options: { includeArchived?: boolean } = {}): Promise<StockItem[]> {
  return stockItemsSchema.parse(await request(`${stock(workspaceId)}/items${archivedQuery(options.includeArchived)}`));
}

export async function createStockItem(workspaceId: string, item: CreateStockItemRequest): Promise<StockItem> {
  return stockItemSchema.parse(await request(`${stock(workspaceId)}/items`, item));
}

export async function updateStockItem(workspaceId: string, itemId: string, changes: UpdateStockItemRequest): Promise<StockItem> {
  return stockItemSchema.parse(await request(`${stock(workspaceId)}/items/${itemId}`, changes, 'PATCH'));
}

export async function archiveStockItem(workspaceId: string, itemId: string): Promise<StockItem> {
  return stockItemSchema.parse(await request(`${stock(workspaceId)}/items/${itemId}/archive`, undefined, 'POST'));
}

export async function unarchiveStockItem(workspaceId: string, itemId: string): Promise<StockItem> {
  return stockItemSchema.parse(await request(`${stock(workspaceId)}/items/${itemId}/unarchive`, undefined, 'POST'));
}

export async function listStockCounts(workspaceId: string): Promise<StockCount[]> {
  return stockCountsSchema.parse(await request(`${stock(workspaceId)}/counts`));
}

export async function setStockCount(workspaceId: string, count: SetStockCountRequest): Promise<StockCount> {
  return stockCountSchema.parse(await request(`${stock(workspaceId)}/counts`, count, 'PUT'));
}

/** The structured issues of a rejected definition or library, or an empty list for any other failure. */
export function catalogIssues(error: unknown): CatalogIssue[] {
  if (!(error instanceof ApiError) || error.status !== 422) return [];
  const body = unprocessableSchema.safeParse(error.details);
  return body.success ? body.data.issues ?? [] : [];
}
