import { type DimensionAnchor, type PlayDimension } from './dimensionSchema.js';
import { wallCorners, type Layout, type VenueGeometry } from './layout.js';
import type { ResolvedLayoutObject } from './layoutObjects.js';
import { resolveWall } from './wall-types.js';
import { measuredOutline, type PlanPoint } from './venue.js';

export type { DimensionAnchor, PlayDimension } from './dimensionSchema.js';

export type SnapAnchor = { point: PlanPoint; anchor: DimensionAnchor };

function edgePoint(start: PlanPoint, end: PlanPoint, t: number): PlanPoint {
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
}

function pushClosedEdgeMids(points: readonly PlanPoint[], into: SnapAnchor[], anchorAt: (edge: number, t: number) => DimensionAnchor) {
  for (let edge = 0; edge < points.length; edge++) {
    const start = points[edge]!;
    const end = points[(edge + 1) % points.length]!;
    into.push({ point: edgePoint(start, end, 0.5), anchor: anchorAt(edge, 0.5) });
  }
}

export function dimensionSnapPoints(
  venue: VenueGeometry,
  _layout: Layout,
  objects: readonly ResolvedLayoutObject[] = [],
): SnapAnchor[] {
  const points: SnapAnchor[] = [];
  const outline = measuredOutline(venue);
  outline.forEach((point, index) => points.push({ point, anchor: { kind: 'outline', index } }));
  pushClosedEdgeMids(outline, points, (edge, t) => ({ kind: 'outlineEdge', edge, t }));
  for (const object of objects) {
    object.footprint.slice(0, 4).forEach((point, corner) => {
      if (corner > 3) return;
      points.push({ point, anchor: { kind: 'wall', scope: 'scene', wallId: object.object.id, corner: corner as 0 | 1 | 2 | 3 } });
    });
  }
  const venueTypes = venue.wallTypes ?? [];
  for (const wall of venue.walls ?? []) {
    const corners = wallCorners(resolveWall(wall, venueTypes)).slice(0, 4);
    corners.forEach((point, corner) => {
      points.push({ point, anchor: { kind: 'wall', scope: 'venue', wallId: wall.id, corner: corner as 0 | 1 | 2 | 3 } });
    });
    pushClosedEdgeMids(corners, points, (edge, t) => ({ kind: 'wallEdge', scope: 'venue', wallId: wall.id, edge: edge as 0 | 1 | 2 | 3, t }));
  }
  for (const platform of venue.platforms ?? []) {
    platform.outline.forEach((point, index) => points.push({ point, anchor: { kind: 'platform', scope: 'venue', platformId: platform.id, index } }));
    pushClosedEdgeMids(platform.outline, points, (edge, t) => ({ kind: 'platformEdge', scope: 'venue', platformId: platform.id, edge, t }));
  }
  return points;
}

export function nearestSnap(points: readonly SnapAnchor[], at: PlanPoint, maxDistanceMm: number): SnapAnchor | undefined {
  let best: SnapAnchor | undefined;
  let distance = maxDistanceMm;
  for (const candidate of points) {
    const gap = Math.hypot(candidate.point.x - at.x, candidate.point.y - at.y);
    if (gap <= distance) { distance = gap; best = candidate; }
  }
  return best;
}

export function resolveAnchor(
  anchor: DimensionAnchor,
  venue: VenueGeometry,
  _layout: Layout,
  objects: readonly ResolvedLayoutObject[] = [],
): PlanPoint | undefined {
  if (anchor.kind === 'outline') return measuredOutline(venue)[anchor.index];
  if (anchor.kind === 'outlineEdge') {
    const outline = measuredOutline(venue);
    const start = outline[anchor.edge];
    const end = outline[(anchor.edge + 1) % outline.length];
    if (!start || !end) return undefined;
    return edgePoint(start, end, anchor.t);
  }
  if (anchor.kind === 'wall' || anchor.kind === 'wallEdge') {
    if (anchor.scope === 'scene') {
      const object = objects.find(item => item.object.id === anchor.wallId);
      if (!object) return undefined;
      const corners = object.footprint.slice(0, 4);
      if (anchor.kind === 'wall') return corners[anchor.corner];
      const start = corners[anchor.edge], end = corners[(anchor.edge + 1) % corners.length];
      return start && end ? edgePoint(start, end, anchor.t) : undefined;
    }
    const walls = venue.walls ?? [];
    const types = venue.wallTypes ?? [];
    const wall = walls.find(item => item.id === anchor.wallId);
    if (!wall) return undefined;
    const corners = wallCorners(resolveWall(wall, types)).slice(0, 4);
    if (anchor.kind === 'wall') return corners[anchor.corner];
    const start = corners[anchor.edge];
    const end = corners[(anchor.edge + 1) % corners.length];
    if (!start || !end) return undefined;
    return edgePoint(start, end, anchor.t);
  }
  if (anchor.kind === 'platform' || anchor.kind === 'platformEdge') {
    if (anchor.scope === 'scene') {
      const object = objects.find(item => item.object.id === anchor.platformId);
      if (!object) return undefined;
      if (anchor.kind === 'platform') return object.footprint[anchor.index];
      const start = object.footprint[anchor.edge], end = object.footprint[(anchor.edge + 1) % object.footprint.length];
      return start && end ? edgePoint(start, end, anchor.t) : undefined;
    }
    const platforms = venue.platforms ?? [];
    const platform = platforms.find(item => item.id === anchor.platformId);
    if (!platform) return undefined;
    if (anchor.kind === 'platform') return platform.outline[anchor.index];
    const start = platform.outline[anchor.edge];
    const end = platform.outline[(anchor.edge + 1) % platform.outline.length];
    if (!start || !end) return undefined;
    return edgePoint(start, end, anchor.t);
  }
  return objects.find(item => item.object.id === anchor.braceId)?.footprint[anchor.corner];
}

export type ResolvedDimension = {
  id: string;
  orientation: PlayDimension['orientation'];
  a: PlanPoint;
  b: PlanPoint;
  offset: number;
  valueMm: number;
};

export type PlanSegment = { x1: number; y1: number; x2: number; y2: number };

export type DimensionFigure = ResolvedDimension & {
  extensions: [PlanSegment, PlanSegment];
  line: PlanSegment;
  ticks: [PlanSegment, PlanSegment];
  label: PlanPoint;
};

/** Drop the dimension when either referenced point has left the scene. */
export function resolveDimension(
  dimension: PlayDimension,
  venue: VenueGeometry,
  layout: Layout,
  objects: readonly ResolvedLayoutObject[] = [],
): ResolvedDimension | undefined {
  const a = resolveAnchor(dimension.a, venue, layout, objects);
  const b = resolveAnchor(dimension.b, venue, layout, objects);
  if (!a || !b) return undefined;
  return { id: dimension.id, orientation: dimension.orientation, a, b, offset: dimension.offset, valueMm: dimensionValue(dimension.orientation, a, b) };
}

export function dimensionValue(orientation: PlayDimension['orientation'], a: PlanPoint, b: PlanPoint) {
  if (orientation === 'horizontal') return Math.abs(b.x - a.x);
  if (orientation === 'vertical') return Math.abs(b.y - a.y);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * SketchUp linear dimension: the line stays horizontal, vertical, or parallel to the
 * two points, whichever the cursor is pulling toward, and sits off the geometry.
 */
export function dimensionFromPlacement(a: PlanPoint, b: PlanPoint, at: PlanPoint): { orientation: PlayDimension['orientation']; offset: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const ox = at.x - (a.x + b.x) / 2;
  const oy = at.y - (a.y + b.y) / 2;
  const pull = Math.hypot(ox, oy) || 1;
  const aligned = Math.abs(ox * px + oy * py) / pull;
  const horizontal = Math.abs(oy) / pull;
  const vertical = Math.abs(ox) / pull;
  const nearAxis = Math.min(Math.abs(dx), Math.abs(dy)) / len < Math.sin(8 * Math.PI / 180);
  if (!nearAxis && aligned >= 0.9) return { orientation: 'aligned', offset: ox * px + oy * py };
  if (horizontal >= vertical) return { orientation: 'horizontal', offset: at.y };
  return { orientation: 'vertical', offset: at.x };
}

const witnessGap = 80;
const witnessOvershoot = 140;
const tickHalf = 150;

function witness(origin: PlanPoint, end: PlanPoint): PlanSegment {
  const dx = end.x - origin.x;
  const dy = end.y - origin.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: origin.x + ux * Math.min(witnessGap, len * 0.35),
    y1: origin.y + uy * Math.min(witnessGap, len * 0.35),
    x2: end.x + ux * witnessOvershoot,
    y2: end.y + uy * witnessOvershoot,
  };
}

function slash(at: PlanPoint, angle: number): PlanSegment {
  const slashAngle = angle + Math.PI / 4;
  return {
    x1: at.x - Math.cos(slashAngle) * tickHalf,
    y1: at.y - Math.sin(slashAngle) * tickHalf,
    x2: at.x + Math.cos(slashAngle) * tickHalf,
    y2: at.y + Math.sin(slashAngle) * tickHalf,
  };
}

/** Dimension line, witness lines and slash ticks in plan coordinates. */
export function dimensionFigure(dimension: ResolvedDimension): DimensionFigure {
  const { a, b, orientation, offset } = dimension;
  let start: PlanPoint;
  let end: PlanPoint;
  if (orientation === 'horizontal') {
    start = { x: a.x, y: offset };
    end = { x: b.x, y: offset };
  } else if (orientation === 'vertical') {
    start = { x: offset, y: a.y };
    end = { x: offset, y: b.y };
  } else {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    start = { x: a.x + px * offset, y: a.y + py * offset };
    end = { x: b.x + px * offset, y: b.y + py * offset };
  }
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  return {
    ...dimension,
    extensions: [witness(a, start), witness(b, end)],
    line: { x1: start.x, y1: start.y, x2: end.x, y2: end.y },
    ticks: [slash(start, angle), slash(end, angle)],
    label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
  };
}
