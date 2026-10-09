import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { surfaceDefinition } from '../db/schema.js';
import { AccessError } from '../identity/access.js';

/** Collect registry finish references without coupling validation to each document shape. */
export function registrySurfaceIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    if (record.kind === 'registry' && typeof record.surfaceId === 'string') ids.add(record.surfaceId);
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return [...ids];
}

export async function requireRegistrySurfaces(
  db: Pick<Database, 'select'>,
  workspaceId: string,
  productionId: string | null,
  value: unknown,
) {
  const ids = registrySurfaceIds(value);
  if (!ids.length) return;
  const rows = await db.select({
    id: surfaceDefinition.id,
    productionId: surfaceDefinition.productionId,
  }).from(surfaceDefinition).where(and(
    eq(surfaceDefinition.workspaceId, workspaceId),
    inArray(surfaceDefinition.id, ids),
  ));
  if (rows.length !== ids.length || rows.some(row => row.productionId !== null && row.productionId !== productionId)) {
    throw new AccessError(400, 'Mindestens eine eigene Oberfläche ist in diesem Dokument nicht verfügbar.');
  }
}
