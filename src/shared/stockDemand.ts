import { z } from 'zod';
import { assemblyOrder } from './assembly.js';
import type { Layout, VenueGeometry } from './layout.js';
import { layoutSupportOptions, resolveLayoutObjectDetails, type LayoutPartIndex } from './layoutObjects.js';
import { buildListsSchema, combineLists, sceneLists, type BuildLists, type StockInventory } from './partLists.js';

/** A saved Bühnenbild as the stock-demand endpoints read it. */
export type DemandScene = {
  id: string; name: string; productionId: string; venueId: string; venueName: string;
  layout: Layout; venue: VenueGeometry;
};

export const productionStockDemandSchema = z.strictObject({
  visits: z.array(z.strictObject({ venueId: z.string(), venueName: z.string(), lists: buildListsSchema })),
  total: buildListsSchema,
});
export type ProductionStockDemand = z.infer<typeof productionStockDemandSchema>;

function liveSceneLists(scene: DemandScene, index: LayoutPartIndex, stock: StockInventory): BuildLists {
  const details = resolveLayoutObjectDetails(scene.layout, index, layoutSupportOptions(scene.venue));
  return sceneLists({
    objects: details.objects, context: index.context, stock, scene: { id: scene.id, name: scene.name },
    assemblyNumbers: assemblyOrder(scene.layout.joints, details.objects).numbers,
  });
}

/**
 * Current demand of saved Bühnenbilder against the workspace stock. Several Bühnenbilder of one
 * venue visit share the stock, so their demand is the maximum per row, not the sum.
 */
export function stockDemand(scenes: readonly DemandScene[], index: LayoutPartIndex, stock: StockInventory): BuildLists {
  const lists = scenes.map(scene => liveSceneLists(scene, index, stock));
  return lists.length === 1 ? lists[0]! : combineLists(lists, stock);
}

/** Every venue visit of a production and the stock the whole tour needs at its largest visit. */
export function productionStockDemand(scenes: readonly DemandScene[], index: LayoutPartIndex, stock: StockInventory): ProductionStockDemand {
  const byVenue = new Map<string, DemandScene[]>();
  for (const scene of scenes) byVenue.set(scene.venueId, [...byVenue.get(scene.venueId) ?? [], scene]);
  const visits = [...byVenue.values()].map(group => ({
    venueId: group[0]!.venueId, venueName: group[0]!.venueName, lists: stockDemand(group, index, stock),
  })).sort((a, b) => a.venueName.localeCompare(b.venueName, 'de'));
  return { visits, total: combineLists(visits.map(visit => visit.lists), stock) };
}
