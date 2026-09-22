import { braceCorners } from './braceTransforms.js';
import { wallCorners, type Layout, type VenueGeometry } from './layout.js';
import { placeholderCorners } from './placeholders.js';
import { resolveWall } from './wall-types.js';

export type PlanReportExtent = { minX: number; minY: number; maxX: number; maxY: number };
export type PlanReportScope = 'scenery' | 'venue';

function extentOf(points: { x: number; y: number }[], padding: number): PlanReportExtent | undefined {
  if (!points.length) return undefined;
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  return {
    minX: Math.min(...xs) - padding,
    minY: Math.min(...ys) - padding,
    maxX: Math.max(...xs) + padding,
    maxY: Math.max(...ys) + padding,
  };
}

/** Corners of construction scenery (set pieces), excluding audience chairs. */
export function sceneryPlanPoints(venue: VenueGeometry, layout: Layout): { x: number; y: number }[] {
  const types = layout.wallTypes ?? [];
  const points: { x: number; y: number }[] = [];
  for (const wall of layout.walls) points.push(...wallCorners(resolveWall(wall, types)));
  for (const brace of layout.braces) points.push(...braceCorners(brace));
  for (const platform of [...(layout.platforms ?? []), ...(venue.platforms ?? [])]) {
    points.push(...platform.outline);
  }
  for (const stair of [...(layout.stairs ?? []), ...(venue.stairs ?? [])]) {
    points.push({ x: stair.x, y: stair.y });
  }
  for (const item of [...(layout.placeholders ?? []), ...(venue.placeholders ?? [])]) {
    if (item.kind === 'chair') continue;
    points.push(...placeholderCorners(item));
  }
  return points;
}

/**
 * Plan crop for a construction-report frame.
 * `scenery` hugs set pieces (no audience chairs / empty hall); `venue` is the full footprint.
 */
export function planReportExtent(
  venue: VenueGeometry,
  layout: Layout,
  scope: PlanReportScope = 'scenery',
  padding = 400,
): PlanReportExtent {
  if (scope === 'venue') {
    return { minX: 0 - padding, minY: 0 - padding, maxX: venue.width + padding, maxY: venue.depth + padding };
  }
  return extentOf(sceneryPlanPoints(venue, layout), padding)
    ?? { minX: 0, minY: 0, maxX: venue.width, maxY: venue.depth };
}
