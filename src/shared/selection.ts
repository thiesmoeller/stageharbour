import type { ResolvedLayoutObject } from './layoutObjects.js';

export type PlanBounds = { minX: number; maxX: number; minY: number; maxY: number };
export type SelectableMember = {
  kind: 'object';
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

/** True when `inner` lies completely inside `outer` (edge-inclusive). */
export function boundsContain(outer: PlanBounds, inner: PlanBounds) {
  return outer.minX <= inner.minX && outer.maxX >= inner.maxX && outer.minY <= inner.minY && outer.maxY >= inner.maxY;
}

/**
 * Plan millimetre rubber-band hit test. An object is selected only when its
 * entire plan footprint lies inside the box (grazing a corner does not count).
 */
export function membersInBounds(objects: readonly ResolvedLayoutObject[], bounds: PlanBounds): SelectableMember[] {
  const members: SelectableMember[] = [];
  for (const object of objects) {
    const box = pointsBounds(object.footprint);
    if (box && boundsContain(bounds, box)) members.push({ kind: 'object', id: object.object.id });
  }
  return members;
}
