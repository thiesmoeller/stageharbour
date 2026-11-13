import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { PartDetail, PartRevisionInfo, PartSummary } from '../../shared/parts/catalog.js';
import { buildPartDetail, buildPartSummary, rawChildRefs, sortPartSummaries } from '../../shared/parts/catalogPlans.js';
import {
  createPartContext, partRefKey, type PartContext, type PartDefinition, type PartMaterial, type PartRef,
} from '../../shared/parts/definition.js';
import type { Database } from '../db/connection.js';
import { material, partDefinition, partRevision, user } from '../db/schema.js';
import { AccessError } from '../identity/access.js';

export type Store = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
export type PartRow = typeof partDefinition.$inferSelect;

export async function loadMaterials(store: Store, workspaceId: string): Promise<Map<string, PartMaterial>> {
  const rows = await store.select().from(material).where(eq(material.workspaceId, workspaceId));
  return new Map(rows.map(row => [row.key, row.definition]));
}

export async function loadAllRevisions(store: Store, workspaceId: string): Promise<Map<string, Map<number, PartDefinition>>> {
  const rows = await store.select({ partId: partRevision.partId, revision: partRevision.revision, definition: partRevision.definition })
    .from(partRevision).where(eq(partRevision.workspaceId, workspaceId));
  const byPart = new Map<string, Map<number, PartDefinition>>();
  for (const row of rows) {
    const revisions = byPart.get(row.partId) ?? new Map<number, PartDefinition>();
    revisions.set(row.revision, row.definition);
    byPart.set(row.partId, revisions);
  }
  return byPart;
}

export async function loadLatestDefinitions(store: Store, workspaceId: string): Promise<PartDefinition[]> {
  const rows = await store.select({ definition: partRevision.definition }).from(partDefinition)
    .innerJoin(partRevision, and(
      eq(partRevision.workspaceId, partDefinition.workspaceId), eq(partRevision.partId, partDefinition.id),
      eq(partRevision.revision, partDefinition.latestRevision)))
    .where(eq(partDefinition.workspaceId, workspaceId));
  return rows.map(row => row.definition);
}

/** Exact revisions and, transitively, the exact revisions their child parts reference. */
export async function loadParts(store: Store, workspaceId: string, seeds: readonly PartRef[]): Promise<PartDefinition[]> {
  const found = new Map<string, PartDefinition>();
  const asked = new Set<string>();
  let frontier = [...new Map(seeds.map(ref => [partRefKey(ref), ref])).values()];
  while (frontier.length) {
    frontier.forEach(ref => asked.add(partRefKey(ref)));
    const rows = await store.select({ definition: partRevision.definition }).from(partRevision).where(and(
      eq(partRevision.workspaceId, workspaceId),
      inArray(partRevision.partId, [...new Set(frontier.map(ref => ref.id))]),
      inArray(partRevision.revision, [...new Set(frontier.map(ref => ref.revision))])));
    const wanted = new Set(frontier.map(partRefKey));
    const next = new Map<string, PartRef>();
    for (const { definition } of rows) {
      const key = partRefKey(definition);
      if (!wanted.has(key) || found.has(key)) continue;
      found.set(key, definition);
      for (const child of definition.children ?? []) {
        const childKey = partRefKey(child.part);
        if (!asked.has(childKey)) next.set(childKey, { id: child.part.id, revision: child.part.revision });
      }
    }
    frontier = [...next.values()];
  }
  return [...found.values()];
}

/** Materials and child parts a definition is validated against. */
export async function contextFor(store: Store, workspaceId: string, input: unknown): Promise<PartContext> {
  const materials = await loadMaterials(store, workspaceId);
  const parts = await loadParts(store, workspaceId, rawChildRefs(input));
  return createPartContext({ materials: [...materials.values()], parts });
}

export function summaryOf(row: PartRow, definition: PartDefinition): PartSummary {
  return buildPartSummary(recordOf(row), definition);
}

const recordOf = (row: PartRow) => ({
  id: row.id, name: row.name, category: row.category, latestRevision: row.latestRevision, favourite: row.favourite,
  archivedAt: row.archivedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(),
});

const latestJoin = and(
  eq(partRevision.workspaceId, partDefinition.workspaceId), eq(partRevision.partId, partDefinition.id),
  eq(partRevision.revision, partDefinition.latestRevision));

export async function readSummaries(store: Store, workspaceId: string, includeArchived: boolean): Promise<PartSummary[]> {
  const rows = await store.select({ part: partDefinition, definition: partRevision.definition }).from(partDefinition)
    .innerJoin(partRevision, latestJoin)
    .where(and(eq(partDefinition.workspaceId, workspaceId), includeArchived ? undefined : isNull(partDefinition.archivedAt)));
  return sortPartSummaries(rows.map(row => summaryOf(row.part, row.definition)));
}

export async function findPart(store: Store, workspaceId: string, partId: string, lock = false): Promise<PartRow> {
  const query = store.select().from(partDefinition).where(and(eq(partDefinition.workspaceId, workspaceId), eq(partDefinition.id, partId)));
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw new AccessError(404, 'Bauteil nicht verfügbar.');
  return row;
}

export async function readRevision(store: Store, workspaceId: string, partId: string, revision: number) {
  const [row] = await store.select({
    definition: partRevision.definition, createdAt: partRevision.createdAt, authorName: user.name,
  }).from(partRevision).leftJoin(user, eq(user.id, partRevision.createdBy))
    .where(and(eq(partRevision.workspaceId, workspaceId), eq(partRevision.partId, partId), eq(partRevision.revision, revision)));
  if (!row) throw new AccessError(404, 'Revision nicht verfügbar.');
  return row;
}

export async function readSummary(store: Store, workspaceId: string, partId: string): Promise<PartSummary> {
  const row = await findPart(store, workspaceId, partId);
  const { definition } = await readRevision(store, workspaceId, partId, row.latestRevision);
  return summaryOf(row, definition);
}

export async function readDetail(store: Store, workspaceId: string, partId: string): Promise<PartDetail> {
  const row = await findPart(store, workspaceId, partId);
  const { definition } = await readRevision(store, workspaceId, partId, row.latestRevision);
  const revisions = await store.select({ revision: partRevision.revision, createdAt: partRevision.createdAt, authorName: user.name })
    .from(partRevision).leftJoin(user, eq(user.id, partRevision.createdBy))
    .where(and(eq(partRevision.workspaceId, workspaceId), eq(partRevision.partId, partId))).orderBy(asc(partRevision.revision));
  const infos: PartRevisionInfo[] = revisions.map(item => ({
    revision: item.revision, createdAt: item.createdAt.toISOString(), authorName: item.authorName,
  }));
  return buildPartDetail(recordOf(row), definition, infos);
}

export async function insertNewPart(store: Store, workspaceId: string, definition: PartDefinition, authorId: string | null, now: Date) {
  await store.insert(partDefinition).values({
    id: definition.id, workspaceId, name: definition.name, category: definition.category,
    latestRevision: definition.revision, createdBy: authorId, createdAt: now, updatedAt: now,
  });
  await store.insert(partRevision).values({
    workspaceId, partId: definition.id, revision: definition.revision, definition, createdAt: now, createdBy: authorId,
  });
}

/** Stores a revision and makes it the part's latest, with its name and category. */
export async function addLatestRevision(store: Store, workspaceId: string, definition: PartDefinition, authorId: string | null, now: Date) {
  await store.insert(partRevision).values({
    workspaceId, partId: definition.id, revision: definition.revision, definition, createdAt: now, createdBy: authorId,
  });
  await store.update(partDefinition).set({
    name: definition.name, category: definition.category, latestRevision: definition.revision, updatedAt: now,
  }).where(and(eq(partDefinition.workspaceId, workspaceId), eq(partDefinition.id, definition.id)));
}
