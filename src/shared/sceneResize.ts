import { type Layout, type VenueGeometry } from './layout.js';

/** Include permanent supporting surfaces for height calculations, but only scene objects are resize targets. */
export function sceneResizeDocument(_layout: Layout, venue: VenueGeometry): VenueGeometry {
  return venue;
}

/** The scene command cannot write back permanent venue geometry. */
export function resizedScene(layout: Layout, _resized: VenueGeometry): Layout {
  return layout;
}
