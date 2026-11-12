import { eq } from 'drizzle-orm';
import { createLayoutPartIndex, type LayoutPartIndex } from '../../shared/layoutObjects.js';
import type { StockInventory } from '../../shared/partLists.js';
import { variantFromColumn } from '../../shared/parts/stock.js';
import { stockCount, stockItem } from '../db/schema.js';
import { loadAllRevisions, loadMaterials, type Store } from '../parts/data.js';

/** Every revision and material of the workspace. */
export async function workspacePartIndex(store: Store, workspaceId: string): Promise<LayoutPartIndex> {
  const [revisions, materials] = await Promise.all([loadAllRevisions(store, workspaceId), loadMaterials(store, workspaceId)]);
  return createLayoutPartIndex({
    parts: [...revisions.values()].flatMap(items => [...items.values()]),
    materials: [...materials.values()],
  });
}

/** Physical pieces (archived ones included, so old assignments still have a label) and counted stock. */
export async function workspaceInventory(store: Store, workspaceId: string): Promise<StockInventory> {
  const [items, counts] = await Promise.all([
    store.select({
      id: stockItem.id, label: stockItem.label, partId: stockItem.partId, variantKey: stockItem.variantKey,
      values: stockItem.values, usable: stockItem.usable, archivedAt: stockItem.archivedAt,
    }).from(stockItem).where(eq(stockItem.workspaceId, workspaceId)),
    store.select({
      materialKey: stockCount.materialKey, partId: stockCount.partId, variantKey: stockCount.variantKey, quantity: stockCount.quantity,
    }).from(stockCount).where(eq(stockCount.workspaceId, workspaceId)),
  ]);
  return {
    items: items.map(row => ({
      id: row.id, label: row.label, partId: row.partId, variantKey: variantFromColumn(row.variantKey),
      values: row.values, usable: row.usable, archived: row.archivedAt !== null,
    })),
    counts: counts.map(row => ({
      materialKey: row.materialKey, partId: row.partId,
      variantKey: row.partId ? variantFromColumn(row.variantKey) : null, quantity: row.quantity,
    })),
  };
}

export async function freezeSource(store: Store, workspaceId: string) {
  const [index, stock] = await Promise.all([workspacePartIndex(store, workspaceId), workspaceInventory(store, workspaceId)]);
  return { index, stock };
}
