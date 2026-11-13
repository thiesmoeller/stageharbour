import type { Layout, VenueGeometry } from './layout.js';
import { createLayoutPartIndex, resolveLayoutObjectDetails, type LayoutObjectResolution, type LayoutPartIndex } from './layoutObjects.js';
import { supportingSurfaces } from './levels.js';
import { assemblyOrder, type AssemblyOrder } from './assembly.js';
import { closureOf, referencedMaterialKeys } from './parts/catalogPlans.js';
import { PART_SCHEMA_VERSION, type PartLibrary, type PartRef } from './parts/definition.js';
import { combineLists, sceneLists, type BuildLists, type InventoryCount, type InventoryItem, type SceneRef, type StockInventory } from './partLists.js';

/**
 * A frozen document carries the exact part revisions and materials its objects used, so it
 * renders the same after the library changes. These helpers build that library at issue time
 * and resolve frozen layouts from it at render time.
 */

/** Exact revisions the objects use, their child parts recursively, and every material they name. */
export function inlineLibrary(refs: readonly PartRef[], index: Pick<LayoutPartIndex, 'part' | 'context'>): PartLibrary {
  const parts = structuredClone(closureOf(refs, ref => index.part(ref)))
    .sort((a, b) => a.id.localeCompare(b.id) || a.revision - b.revision);
  const keys = new Set(parts.flatMap(part => [...referencedMaterialKeys(part)]));
  const materials = [...keys].sort().flatMap(key => {
    const material = index.context.material(key);
    return material ? [structuredClone(material)] : [];
  });
  return { schemaVersion: PART_SCHEMA_VERSION, materials, parts };
}

export function layoutLibrary(layouts: readonly Pick<Layout, 'objects'>[], index: Pick<LayoutPartIndex, 'part' | 'context'>): PartLibrary {
  return inlineLibrary(layouts.flatMap(layout => layout.objects.map(object => object.part)), index);
}

/**
 * The stock a frozen Bühnenbild needs to report demand and labels: assigned pieces, pieces of the
 * parts it uses, and counts of those parts and materials.
 */
export function frozenInventory(library: PartLibrary, layouts: readonly Pick<Layout, 'objects'>[], stock: {
  items: readonly InventoryItem[]; counts: readonly InventoryCount[];
}): StockInventory {
  const partIds = new Set(library.parts.map(part => part.id));
  const materialKeys = new Set(library.materials.map(material => material.key));
  const assigned = new Set(layouts.flatMap(layout => layout.objects.flatMap(object => object.stockItemId ? [object.stockItemId] : [])));
  return {
    items: stock.items.filter(item => assigned.has(item.id) || (partIds.has(item.partId) && !item.archived))
      .map(item => ({
        id: item.id, label: item.label, partId: item.partId, variantKey: item.variantKey,
        ...(item.values && Object.keys(item.values).length ? { values: { ...item.values } } : {}),
        usable: item.usable, archived: item.archived,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }) || a.id.localeCompare(b.id)),
    counts: stock.counts.filter(count => (count.partId && partIds.has(count.partId)) || (count.materialKey && materialKeys.has(count.materialKey)))
      .map(count => ({ materialKey: count.materialKey, partId: count.partId, variantKey: count.variantKey, quantity: count.quantity }))
      .sort((a, b) => (a.materialKey ?? a.partId ?? '').localeCompare(b.materialKey ?? b.partId ?? '') || (a.variantKey ?? '').localeCompare(b.variantKey ?? '')),
  };
}

export function venueSupportElevations(venue: Pick<VenueGeometry, 'width' | 'depth' | 'outline' | 'platforms'>): Map<string, number> {
  return new Map(supportingSurfaces(venue).map(surface => [surface.id, surface.elevation]));
}

/** What a frozen Bühnenbild needs to be drawn and listed again. */
export type FrozenParts = { layout: Layout; venue: VenueGeometry; library: PartLibrary; stock?: StockInventory };

export type FrozenResolution = LayoutObjectResolution & {
  index: LayoutPartIndex;
  assembly: AssemblyOrder;
};

const resolutions = new WeakMap<Layout, { library: PartLibrary; venue: VenueGeometry; value: FrozenResolution }>();

/** Objects of a frozen Bühnenbild resolved from its own library; cached per frozen layout. */
export function resolveFrozen(frozen: FrozenParts): FrozenResolution {
  const cached = resolutions.get(frozen.layout);
  if (cached && cached.library === frozen.library && cached.venue === frozen.venue) return cached.value;
  const index = createLayoutPartIndex({ parts: frozen.library.parts, materials: frozen.library.materials });
  const details = resolveLayoutObjectDetails(frozen.layout, index, { supportElevations: venueSupportElevations(frozen.venue) });
  const value = { ...details, index, assembly: assemblyOrder(frozen.layout.joints, details.objects) };
  resolutions.set(frozen.layout, { library: frozen.library, venue: frozen.venue, value });
  return value;
}

export function frozenLists(frozen: FrozenParts, scene?: SceneRef): BuildLists {
  const resolved = resolveFrozen(frozen);
  return sceneLists({
    objects: resolved.objects, context: resolved.index.context, stock: frozen.stock, assemblyNumbers: resolved.assembly.numbers,
    ...(scene ? { scene } : {}),
  });
}

/** Lists of several frozen Bühnenbilder that share one stock, such as a venue visit or a package. */
export function combinedFrozenLists(scenes: readonly { frozen: FrozenParts; scene: SceneRef }[], stock?: StockInventory): BuildLists {
  return combineLists(scenes.map(item => frozenLists(item.frozen, item.scene)), stock ?? mergeInventories(scenes.map(item => item.frozen.stock)));
}

export function mergeInventories(inventories: readonly (StockInventory | undefined)[]): StockInventory {
  const items = new Map<string, InventoryItem>();
  const counts = new Map<string, InventoryCount>();
  for (const inventory of inventories) {
    for (const item of inventory?.items ?? []) items.set(item.id, item);
    for (const count of inventory?.counts ?? []) counts.set(JSON.stringify([count.materialKey, count.partId, count.variantKey]), count);
  }
  return { items: [...items.values()], counts: [...counts.values()] };
}
