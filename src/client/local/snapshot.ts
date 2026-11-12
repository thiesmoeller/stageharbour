import { z } from 'zod';
import { brandingSchema, roleSchema, type Branding } from '../../shared/contracts.js';
import { documentDraftSchema, type DocumentDraft } from '../../shared/exportDocument.js';
import { inventorySchema, type Inventory } from '../../shared/inventory.js';
import { layoutSchema, sceneTemplateSchema, venueGeometrySchema, type Layout, type SceneTemplate, type VenueGeometry } from '../../shared/layout.js';
import { leaseHolderSchema, type LeaseHolder } from '../../shared/leases.js';
import { ensureStarterCatalog, emptyCatalog, localCatalogSchema, type LocalCatalog } from './catalog.js';

/** 2 added the part catalog; version 1 files are upgraded on read. */
export const SNAPSHOT_SCHEMA_VERSION = 2 as const;

export type LocalUser = { id: string; name: string; email: string };
export type LocalWorkspace = { id: string; name: string; role: z.infer<typeof roleSchema> };
export type LocalProduction = { id: string; name: string };
export type LocalVenue = { id: string; name: string };
export type LocalVenueVersion = {
  id: string;
  venueId: string;
  geometry: VenueGeometry;
  createdAt: string;
};
export type LocalScene = {
  id: string;
  name: string;
  productionId: string;
  venueVersionId: string;
  revision: number;
  layout: Layout;
  lease: LeaseHolder | null;
};
export type LocalInventory = Inventory;

export type LocalSnapshot = {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  savedAt: string;
  user: LocalUser;
  workspace: LocalWorkspace;
  branding: Branding;
  productions: LocalProduction[];
  scenes: LocalScene[];
  venues: LocalVenue[];
  venueVersions: LocalVenueVersion[];
  inventory: LocalInventory;
  documentDrafts: Record<string, DocumentDraft>;
  sceneTemplates: SceneTemplate[];
  catalog: LocalCatalog;
};

const localUserSchema = z.strictObject({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(120),
  email: z.email(),
});

const localWorkspaceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  role: roleSchema,
});

const localProductionSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(120),
});

const localVenueSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(120),
});

const localVenueVersionSchema = z.strictObject({
  id: z.uuid(),
  venueId: z.uuid(),
  geometry: venueGeometrySchema,
  createdAt: z.string().datetime(),
});

const localSceneSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  productionId: z.uuid(),
  venueVersionId: z.uuid(),
  revision: z.number().int().nonnegative(),
  layout: layoutSchema,
  lease: leaseHolderSchema.nullable(),
});

export const localSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  savedAt: z.string().datetime(),
  user: localUserSchema,
  workspace: localWorkspaceSchema,
  branding: brandingSchema,
  productions: z.array(localProductionSchema),
  scenes: z.array(localSceneSchema),
  venues: z.array(localVenueSchema),
  venueVersions: z.array(localVenueVersionSchema),
  inventory: inventorySchema,
  documentDrafts: z.record(z.uuid(), documentDraftSchema),
  sceneTemplates: z.array(sceneTemplateSchema),
  catalog: localCatalogSchema,
});

/** Files and stored snapshots of version 1 have no catalog; they get the starter library. */
function upgradeSnapshot(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || (data as { schemaVersion?: unknown }).schemaVersion !== 1) return data;
  const old = data as Record<string, unknown>;
  const savedAt = typeof old.savedAt === 'string' && !Number.isNaN(Date.parse(old.savedAt)) ? new Date(old.savedAt) : new Date();
  return { ...old, schemaVersion: SNAPSHOT_SCHEMA_VERSION, catalog: ensureStarterCatalog(emptyCatalog(), savedAt) };
}

export function parseSnapshot(data: unknown): LocalSnapshot {
  return localSnapshotSchema.parse(upgradeSnapshot(data));
}

export function serializeSnapshot(store: LocalSnapshot): LocalSnapshot {
  return parseSnapshot({
    ...store,
    savedAt: new Date().toISOString(),
  });
}
