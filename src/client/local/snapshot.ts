import { z } from 'zod';
import { brandingSchema, roleSchema, type Branding } from '../../shared/contracts.js';
import { documentDraftSchema, type DocumentDraft } from '../../shared/exportDocument.js';
import { inventorySchema, type Inventory } from '../../shared/inventory.js';
import { layoutSchema, sceneTemplateSchema, venueGeometrySchema, type Layout, type SceneTemplate, type VenueGeometry } from '../../shared/layout.js';
import { leaseHolderSchema, type LeaseHolder } from '../../shared/leases.js';

export const SNAPSHOT_SCHEMA_VERSION = 1 as const;

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
});

export function parseSnapshot(data: unknown): LocalSnapshot {
  return localSnapshotSchema.parse(data);
}

export function serializeSnapshot(store: LocalSnapshot): LocalSnapshot {
  return parseSnapshot({
    ...store,
    savedAt: new Date().toISOString(),
  });
}
