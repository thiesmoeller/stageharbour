import { layoutSchema, type Layout } from './layout.js';
import { platformCentroid } from './levels.js';
import type { SelectableMember } from './selection.js';

export type PlanTransform = { x: number; y: number; rotation: number };
export function normalizeRotation(value: number) { return ((value + 180) % 360 + 360) % 360 - 180; }
export function selectionPivot(layout: Layout, selection: readonly SelectableMember[]) {
  const ids = new Set(selection.map(item => item.id));
  const points = [...layout.walls, ...layout.braces, ...layout.stairs ?? [], ...layout.placeholders ?? []].filter(item => ids.has(item.id));
  const centres = [...points, ...(layout.platforms ?? []).filter(item => ids.has(item.id)).map(item => platformCentroid(item.outline))];
  if (!centres.length) return;
  return { x: centres.reduce((sum, p) => sum + p.x, 0) / centres.length, y: centres.reduce((sum, p) => sum + p.y, 0) / centres.length };
}

/** Paint the same Pascal library finish onto every listed wall id (or clear it). */
export function applyWallFinish(layout: Layout, wallIds: readonly string[], finish: string | undefined): Layout {
  const ids = new Set(wallIds);
  if (!ids.size) return layout;
  const walls = layout.walls.map(wall => {
    if (!ids.has(wall.id)) return wall;
    if (finish) return { ...wall, finish };
    const { finish: _removed, ...rest } = wall;
    return rest;
  });
  return { ...layout, walls };
}

/** A complete candidate transform from a gesture's original document, never from its previous preview. */
export function transformSelection(layout: Layout, selection: readonly SelectableMember[], delta: PlanTransform): Layout {
  const pivot = selectionPivot(layout, selection);
  if (!pivot || ![delta.x, delta.y, delta.rotation].every(Number.isFinite)) return layout;
  const keys = new Set(selection.map(item => `${item.kind}:${item.id}`));
  const radians = delta.rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const point = (p: { x: number; y: number }) => ({ x: pivot.x + (p.x - pivot.x) * cos - (p.y - pivot.y) * sin + delta.x, y: pivot.y + (p.x - pivot.x) * sin + (p.y - pivot.y) * cos + delta.y });
  const posed = <T extends { id: string; x: number; y: number; rotation: number }>(items: T[], kind: string) => items.map(item => keys.has(`${kind}:${item.id}`) ? { ...item, ...point(item), rotation: normalizeRotation(item.rotation + delta.rotation) } : item);
  const candidate = {
    ...layout, walls: posed(layout.walls, 'wall'), braces: posed(layout.braces, 'brace'),
    stairs: layout.stairs && posed(layout.stairs, 'stair'), placeholders: layout.placeholders && posed(layout.placeholders, 'placeholder'),
    platforms: layout.platforms?.map(item => keys.has(`platform:${item.id}`) ? { ...item, outline: item.outline.map(point) } : item),
    groups: layout.groups?.map(group => group.members.every(member => keys.has(`${member.kind}:${member.id}`)) ? { ...group, rotation: normalizeRotation(group.rotation + delta.rotation) } : group),
  };
  return layoutSchema.safeParse(candidate).success ? candidate : layout;
}
