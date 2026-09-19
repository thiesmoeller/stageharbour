import { braceCorners } from './braceTransforms.js';
import type { Layout } from './layout.js';
import { wallCorners } from './layout.js';
import { stairCorners } from './levels.js';
import { placeholderCorners } from './placeholders.js';
import { resolveWall } from './wall-types.js';

export type PlanBounds = { minX: number; maxX: number; minY: number; maxY: number };
export type SelectableMember = {
  kind: 'wall' | 'brace' | 'stair' | 'placeholder' | 'platform';
  id: string;
};

export function normalizeBounds(a: { x: number; y: number }, b: { x: number; y: number }): PlanBounds {
  return {
    minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y),
  };
}

function pointsBounds(points: readonly { x: number; y: number }[]): PlanBounds | undefined {
  if (!points.length) return;
  return {
    minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)),
    minY: Math.min(...points.map(point => point.y)), maxY: Math.max(...points.map(point => point.y)),
  };
}

function overlaps(a: PlanBounds, b: PlanBounds) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Plan millimetre rubber-band hit test. An object is selected when its plan
 * footprint intersects the box (not only when the centre lies inside).
 */
export function membersInBounds(layout: Layout, bounds: PlanBounds): SelectableMember[] {
  const types = layout.wallTypes ?? [];
  const members: SelectableMember[] = [];
  for (const wall of layout.walls) {
    const box = pointsBounds(wallCorners(resolveWall(wall, types)));
    if (box && overlaps(bounds, box)) members.push({ kind: 'wall', id: wall.id });
  }
  for (const brace of layout.braces ?? []) {
    const box = pointsBounds(braceCorners(brace));
    if (box && overlaps(bounds, box)) members.push({ kind: 'brace', id: brace.id });
  }
  for (const stair of layout.stairs ?? []) {
    const box = pointsBounds(stairCorners(stair));
    if (box && overlaps(bounds, box)) members.push({ kind: 'stair', id: stair.id });
  }
  for (const item of layout.placeholders ?? []) {
    const box = pointsBounds(placeholderCorners(item));
    if (box && overlaps(bounds, box)) members.push({ kind: 'placeholder', id: item.id });
  }
  for (const platform of layout.platforms ?? []) {
    const box = pointsBounds(platform.outline);
    if (box && overlaps(bounds, box)) members.push({ kind: 'platform', id: platform.id });
  }
  return members;
}
