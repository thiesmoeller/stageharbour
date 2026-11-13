import { and, eq, inArray } from 'drizzle-orm';
import { planStarterLibrary } from '../../shared/parts/libraryExchange.js';
import { STARTER_LIBRARY } from '../../shared/parts/starter/index.js';
import { material, partDefinition, partRevision, workspace } from '../db/schema.js';
import type { Store } from './data.js';

/**
 * Makes sure the workspace holds the starter parts and materials under their fixed ids. Only what
 * is missing is inserted, so running it again, or after a group edited a starter part, changes
 * nothing. Returns how many materials and part revisions were added.
 */
export async function ensureStarterLibrary(store: Store, workspaceId: string, now = new Date()) {
  const [known] = await store.select({ id: workspace.id }).from(workspace).where(eq(workspace.id, workspaceId));
  if (!known) return { materials: 0, revisions: 0 };
  const materials = await store.select({ key: material.key }).from(material).where(eq(material.workspaceId, workspaceId));
  const ids = [...new Set(STARTER_LIBRARY.parts.map(part => part.id))];
  const parts = await store.select({ id: partDefinition.id, latestRevision: partDefinition.latestRevision }).from(partDefinition)
    .where(and(eq(partDefinition.workspaceId, workspaceId), inArray(partDefinition.id, ids)));
  const revisions = await store.select({ partId: partRevision.partId, revision: partRevision.revision }).from(partRevision)
    .where(and(eq(partRevision.workspaceId, workspaceId), inArray(partRevision.partId, ids)));
  const existing = new Map(parts.map(part => [part.id, {
    latestRevision: part.latestRevision,
    revisions: new Set(revisions.filter(item => item.partId === part.id).map(item => item.revision)),
  }]));
  const plan = planStarterLibrary(STARTER_LIBRARY, { materialKeys: new Set(materials.map(item => item.key)), parts: existing });
  if (plan.materials.length) {
    await store.insert(material).values(plan.materials.map(definition => ({
      workspaceId, key: definition.key, definition, createdAt: now, updatedAt: now,
    }))).onConflictDoNothing();
  }
  const newest = new Map<string, number>();
  for (const { definition, newPart } of plan.parts) {
    if (newPart) newest.set(definition.id, definition.revision);
  }
  for (const { definition } of plan.parts) {
    if (newest.has(definition.id)) newest.set(definition.id, Math.max(newest.get(definition.id)!, definition.revision));
  }
  for (const write of plan.parts) {
    if (write.newPart) {
      await store.insert(partDefinition).values({
        id: write.definition.id, workspaceId, name: write.definition.name, category: write.definition.category,
        latestRevision: newest.get(write.definition.id)!, createdBy: null, createdAt: now, updatedAt: now,
      }).onConflictDoNothing();
    }
    await store.insert(partRevision).values({
      workspaceId, partId: write.definition.id, revision: write.definition.revision, definition: write.definition,
      createdAt: now, createdBy: null,
    }).onConflictDoNothing();
  }
  return { materials: plan.materials.length, revisions: plan.parts.length };
}
