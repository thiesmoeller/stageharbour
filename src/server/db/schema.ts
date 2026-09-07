import { pgTable, text, timestamp, boolean, uuid, pgEnum, primaryKey, index, uniqueIndex, integer, jsonb, foreignKey } from 'drizzle-orm/pg-core';
import type { ConstructionSnapshot } from '../../shared/export.js';
import type { Layout, VenueGeometry } from '../../shared/layout.js';
import type { LeaseKind } from '../../shared/leases.js';
import type { WallElementType } from '../../shared/wall-types.js';

const dates = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Better Auth's core tables. Membership is deliberately separate from identity.
export const user = pgTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  ...dates(),
});
export const session = pgTable('auth_session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  ...dates(),
}, table => [index('session_user_idx').on(table.userId)]);
export const account = pgTable('auth_account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  ...dates(),
}, table => [index('account_user_idx').on(table.userId), uniqueIndex('account_provider_idx').on(table.providerId, table.accountId)]);
export const verification = pgTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...dates(),
}, table => [index('verification_identifier_idx').on(table.identifier)]);

export const workspace = pgTable('workspace', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const workspaceRole = pgEnum('workspace_role', ['administrator', 'editor', 'viewer']);
export const membership = pgTable('membership', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: workspaceRole('role').notNull(),
}, table => [primaryKey({ columns: [table.workspaceId, table.userId] }), index('membership_user_idx').on(table.userId)]);
export const invitation = pgTable('invitation', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: workspaceRole('role').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('invitation_workspace_id').on(table.workspaceId, table.id),
  uniqueIndex('invitation_token_hash').on(table.tokenHash),
  index('invitation_workspace_email_idx').on(table.workspaceId, table.email),
]);
export const passwordReset = pgTable('password_reset', {
  id: uuid('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('password_reset_token_hash').on(table.tokenHash),
  index('password_reset_user_idx').on(table.userId),
]);

export const venue = pgTable('venue', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => workspace.id),
  name: text('name').notNull(),
}, t => [uniqueIndex('venue_workspace_id').on(t.workspaceId, t.id)]);
export const venueVersion = pgTable('venue_version', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull(), venueId: uuid('venue_id').notNull(),
  geometry: jsonb('geometry').notNull().$type<VenueGeometry>(),
}, t => [uniqueIndex('venue_version_workspace_id').on(t.workspaceId, t.id),
  foreignKey({ columns: [t.workspaceId, t.venueId], foreignColumns: [venue.workspaceId, venue.id] })]);
export const production = pgTable('production', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => workspace.id), name: text('name').notNull(),
}, t => [uniqueIndex('production_workspace_id').on(t.workspaceId, t.id)]);
export const adaptation = pgTable('venue_adaptation', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull(),
  productionId: uuid('production_id').notNull(), venueVersionId: uuid('venue_version_id').notNull(),
}, t => [uniqueIndex('adaptation_workspace_id').on(t.workspaceId, t.id),
  foreignKey({ columns: [t.workspaceId, t.productionId], foreignColumns: [production.workspaceId, production.id] }),
  foreignKey({ columns: [t.workspaceId, t.venueVersionId], foreignColumns: [venueVersion.workspaceId, venueVersion.id] })]);
export const scene = pgTable('scene', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull(), adaptationId: uuid('adaptation_id').notNull(),
  name: text('name').notNull(), revision: integer('revision').notNull().default(0),
  layout: jsonb('layout').notNull().$type<Layout>(),
}, t => [index('scene_workspace_idx').on(t.workspaceId), uniqueIndex('scene_workspace_id').on(t.workspaceId, t.id),
  foreignKey({ columns: [t.workspaceId, t.adaptationId], foreignColumns: [adaptation.workspaceId, adaptation.id] })]);
export const editingLease = pgTable('editing_lease', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspace.id),
  resourceKind: text('resource_kind').notNull().$type<LeaseKind>(),
  resourceId: uuid('resource_id').notNull(),
  holderUserId: text('holder_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.workspaceId, t.resourceKind, t.resourceId] }),
  index('editing_lease_holder_idx').on(t.holderUserId), index('editing_lease_expiry_idx').on(t.expiresAt)]);
export const constructionExportStatus = pgEnum('construction_export_status', ['pending', 'ready', 'failed']);
export const constructionPlanRevision = pgTable('construction_plan_revision', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull(), sceneId: uuid('scene_id').notNull(),
  name: text('name').notNull(), scale: integer('scale').notNull(),
  status: constructionExportStatus('status').notNull(),
  snapshot: jsonb('snapshot').notNull().$type<ConstructionSnapshot>(),
  storageKey: text('storage_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('construction_plan_scene_idx').on(t.workspaceId, t.sceneId),
  uniqueIndex('construction_plan_workspace_id').on(t.workspaceId, t.id),
  foreignKey({ columns: [t.workspaceId, t.sceneId], foreignColumns: [scene.workspaceId, scene.id] })]);
export const venueReference = pgTable('venue_reference', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspace.id),
  kind: text('kind').notNull().$type<'image' | 'pdf'>(),
  mediaType: text('media_type').notNull(),
  originalName: text('original_name').notNull(),
  storageKey: text('storage_key').notNull(),
  pageCount: integer('page_count'),
  pixelWidth: integer('pixel_width'),
  pixelHeight: integer('pixel_height'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('venue_reference_workspace_id').on(t.workspaceId, t.id)]);
export const inventoryWallType = pgTable('inventory_wall_type', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => workspace.id),
  definition: jsonb('definition').notNull().$type<WallElementType>(),
}, t => [uniqueIndex('inventory_wall_type_workspace_id').on(t.workspaceId, t.id)]);
export const inventoryPanel = pgTable('inventory_panel', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull(),
  typeId: uuid('type_id').notNull(), label: text('label').notNull(),
  available: boolean('available').notNull().default(true), note: text('note'),
}, t => [
  uniqueIndex('inventory_panel_workspace_id').on(t.workspaceId, t.id),
  uniqueIndex('inventory_panel_workspace_label').on(t.workspaceId, t.label),
  index('inventory_panel_type_idx').on(t.workspaceId, t.typeId),
  foreignKey({ columns: [t.workspaceId, t.typeId], foreignColumns: [inventoryWallType.workspaceId, inventoryWallType.id] }),
]);
export const sceneTemplate = pgTable('scene_template', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => workspace.id),
  name: text('name').notNull(),
  layout: jsonb('layout').notNull().$type<Layout>(),
  sourceSurfaces: jsonb('source_surfaces').notNull().$type<{ id: string; label: string }[]>(),
}, t => [
  uniqueIndex('scene_template_workspace_id').on(t.workspaceId, t.id),
  index('scene_template_workspace_idx').on(t.workspaceId),
]);
