import { layoutSchema, type Layout, type VenueGeometry } from './layout.js';

/** Include permanent supporting surfaces for height calculations, but only scene objects are resize targets. */
export function sceneResizeDocument(layout: Layout, venue: VenueGeometry): VenueGeometry {
  return { ...venue, walls: layout.walls, wallTypes: layout.wallTypes,
    platforms: [...venue.platforms ?? [], ...layout.platforms ?? []],
    stairs: [...venue.stairs ?? [], ...layout.stairs ?? []], placeholders: layout.placeholders };
}

/** The scene command cannot write back permanent venue geometry. */
export function resizedScene(layout: Layout, resized: VenueGeometry): Layout {
  const scenePlatforms = new Set(layout.platforms?.map(item => item.id));
  const sceneStairs = new Set(layout.stairs?.map(item => item.id));
  const candidate = { ...layout, walls: resized.walls ?? layout.walls,
    platforms: resized.platforms?.filter(item => scenePlatforms.has(item.id)),
    stairs: resized.stairs?.filter(item => sceneStairs.has(item.id)), placeholders: resized.placeholders };
  return layoutSchema.safeParse(candidate).success ? candidate : layout;
}
