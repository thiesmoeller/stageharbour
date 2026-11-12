import type { Layout, VenueGeometry } from './layout.js';
import { resolveWall } from './wall-types.js';

/** Resolve each document's own wall types before sharing immutable geometry with planning tools. */
export function planningWalls(layout: Layout, venue: VenueGeometry) {
  void layout;
  return permanentWalls(venue);
}
export function permanentWalls(venue: VenueGeometry) {
  return (venue.walls ?? []).map(wall => resolveWall(wall, venue.wallTypes ?? []));
}
