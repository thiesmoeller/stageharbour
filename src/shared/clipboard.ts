import type { PanelConnection } from './assembly.js';
import { dropMember, type Group, type GroupMember } from './groups.js';
import type { Brace, Layout, Wall } from './layout.js';
import type { Placeholder } from './placeholders.js';
import type { Platform, StairUnit } from './levels.js';

export type ClipboardMember = { kind: 'wall' | 'brace' | 'platform' | 'stair' | 'placeholder'; id: string };
export type LayoutClipboard = {
  keepIdentities: boolean;
  walls: Wall[];
  braces: Brace[];
  platforms: Platform[];
  stairs: StairUnit[];
  placeholders?: Placeholder[];
  connections: PanelConnection[];
  groups: Group[];
};

/** Plan translation applied when pasting; UI supplies cursor delta so copies follow the pointer. */
export type PasteOffset = { x: number; y: number };

function keysOf(selected: readonly ClipboardMember[]) {
  return new Set(selected.map(item => `${item.kind}:${item.id}`));
}

function extract(layout: Layout, selected: readonly ClipboardMember[]): Omit<LayoutClipboard, 'keepIdentities'> | undefined {
  if (!selected.length) return;
  const ids = keysOf(selected);
  const walls = layout.walls.filter(wall => ids.has(`wall:${wall.id}`));
  const braces = layout.braces.filter(brace => ids.has(`brace:${brace.id}`));
  const platforms = (layout.platforms ?? []).filter(platform => ids.has(`platform:${platform.id}`));
  const stairs = (layout.stairs ?? []).filter(stair => ids.has(`stair:${stair.id}`));
  const placeholders = (layout.placeholders ?? []).filter(item => ids.has(`placeholder:${item.id}`));
  if (!walls.length && !braces.length && !platforms.length && !stairs.length && !placeholders.length) return;
  const wallIds = new Set(walls.map(wall => wall.id));
  const connections = (layout.connections ?? []).filter(connection => wallIds.has(connection.a) && wallIds.has(connection.b));
  const groups = (layout.groups ?? []).flatMap(group => {
    const members = group.members.filter(member => ids.has(`${member.kind}:${member.id}`));
    if (members.length < 2 || !members.some(member => member.kind === 'wall')) return [];
    return [{ ...group, members }];
  });
  return {
    walls: structuredClone(walls), braces: structuredClone(braces),
    platforms: structuredClone(platforms), stairs: structuredClone(stairs), placeholders: structuredClone(placeholders),
    connections: structuredClone(connections), groups: structuredClone(groups),
  };
}

export function copySelection(layout: Layout, selected: readonly ClipboardMember[]): LayoutClipboard | undefined {
  const taken = extract(layout, selected);
  return taken ? { keepIdentities: false, ...taken } : undefined;
}

export function cutSelection(layout: Layout, selected: readonly ClipboardMember[]): { layout: Layout; clipboard?: LayoutClipboard } {
  const taken = extract(layout, selected);
  if (!taken) return { layout };
  return { layout: removeSelection(layout, selected), clipboard: { keepIdentities: true, ...taken } };
}

export function removeSelection(layout: Layout, selected: readonly ClipboardMember[]): Layout {
  const ids = keysOf(selected);
  const wallIds = new Set(selected.flatMap(item => item.kind === 'wall' ? [item.id] : []));
  let next: Layout = {
    ...layout,
    walls: layout.walls.filter(wall => !ids.has(`wall:${wall.id}`)),
    braces: layout.braces.filter(brace => !ids.has(`brace:${brace.id}`)),
    platforms: layout.platforms?.filter(platform => !ids.has(`platform:${platform.id}`)),
    stairs: layout.stairs?.filter(stair => !ids.has(`stair:${stair.id}`)),
    placeholders: layout.placeholders?.filter(item => !ids.has(`placeholder:${item.id}`)),
    connections: (layout.connections ?? []).filter(connection => !wallIds.has(connection.a) && !wallIds.has(connection.b)),
  };
  for (const member of selected) {
    if (member.kind !== 'platform') next = dropMember(next, member as GroupMember);
  }
  return next;
}

function clampCoord(value: number) {
  return Math.max(-100000, Math.min(100000, value));
}

function shift(value: number, delta: number) {
  return clampCoord(value + delta);
}

function placementCopy(wall: Wall, id: string, offset: PasteOffset): Wall {
  const moved = { ...wall, id, x: shift(wall.x, offset.x), y: shift(wall.y, offset.y) };
  const { panelId: _panelId, finishAssignment: _finishAssignment, assemblyNumber: _assemblyNumber, ...rest } = moved;
  return rest;
}

/** Average of clipboard member centres — used so paste can land under the cursor. */
export function clipboardPivot(clipboard: LayoutClipboard): { x: number; y: number } | undefined {
  const points: { x: number; y: number }[] = [
    ...clipboard.walls.map(wall => ({ x: wall.x, y: wall.y })),
    ...clipboard.braces.map(brace => ({ x: brace.x, y: brace.y })),
    ...clipboard.stairs.map(stair => ({ x: stair.x, y: stair.y })),
    ...(clipboard.placeholders ?? []).map(item => ({ x: item.x, y: item.y })),
    ...clipboard.platforms.map(platform => ({
      x: platform.outline.reduce((sum, point) => sum + point.x, 0) / platform.outline.length,
      y: platform.outline.reduce((sum, point) => sum + point.y, 0) / platform.outline.length,
    })),
  ];
  if (!points.length) return;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

export function pasteClipboard(
  layout: Layout,
  clipboard: LayoutClipboard,
  nextId: () => string,
  offset: PasteOffset = { x: 0, y: 0 },
): {
  layout: Layout; pasted: ClipboardMember[]; consumed: boolean;
} {
  if (layout.walls.length + clipboard.walls.length > 250
    || layout.braces.length + clipboard.braces.length > 250
    || (layout.platforms ?? []).length + clipboard.platforms.length > 250
    || (layout.stairs ?? []).length + clipboard.stairs.length > 250
    || (layout.placeholders ?? []).length + (clipboard.placeholders ?? []).length > 250) {
    return { layout, pasted: [], consumed: false };
  }
  if (clipboard.keepIdentities) {
    const existing = new Set([
      ...layout.walls.map(item => `wall:${item.id}`), ...layout.braces.map(item => `brace:${item.id}`),
      ...(layout.placeholders ?? []).map(item => `placeholder:${item.id}`), ...(layout.platforms ?? []).map(item => `platform:${item.id}`), ...(layout.stairs ?? []).map(item => `stair:${item.id}`),
    ]);
    const incoming = [
      ...clipboard.walls.map(item => `wall:${item.id}`), ...clipboard.braces.map(item => `brace:${item.id}`),
      ...(clipboard.placeholders ?? []).map(item => `placeholder:${item.id}`), ...clipboard.platforms.map(item => `platform:${item.id}`), ...clipboard.stairs.map(item => `stair:${item.id}`),
    ];
    if (incoming.some(key => existing.has(key))) return { layout, pasted: [], consumed: false };
  }
  const memberMap = new Map<string, string>();
  const wallMap = new Map<string, string>();
  function take(kind: ClipboardMember['kind'], id: string) {
    const next = clipboard.keepIdentities ? id : nextId();
    memberMap.set(`${kind}:${id}`, next);
    if (kind === 'wall') wallMap.set(id, next);
    return next;
  }
  const walls = clipboard.walls.map(wall => clipboard.keepIdentities
    ? { ...wall, x: shift(wall.x, offset.x), y: shift(wall.y, offset.y) }
    : placementCopy(wall, take('wall', wall.id), offset));
  if (clipboard.keepIdentities) for (const wall of clipboard.walls) take('wall', wall.id);
  const braces = clipboard.braces.map(brace => ({ ...brace, id: take('brace', brace.id), x: shift(brace.x, offset.x), y: shift(brace.y, offset.y) }));
  const platforms = clipboard.platforms.map(platform => ({
    ...platform, id: take('platform', platform.id),
    outline: platform.outline.map(point => ({ x: shift(point.x, offset.x), y: shift(point.y, offset.y) })),
  }));
  const stairs = clipboard.stairs.map(stair => ({ ...stair, id: take('stair', stair.id), x: shift(stair.x, offset.x), y: shift(stair.y, offset.y) }));
  const placeholders = (clipboard.placeholders ?? []).map(item => ({ ...item, id: take('placeholder', item.id), x: shift(item.x, offset.x), y: shift(item.y, offset.y) }));
  const groups = clipboard.groups.map(group => ({
    ...group, id: clipboard.keepIdentities ? group.id : nextId(),
    members: group.members.map(member => ({ ...member, id: memberMap.get(`${member.kind}:${member.id}`) ?? member.id })),
  }));
  const connections = clipboard.connections.map(connection => ({
    ...connection, id: clipboard.keepIdentities ? connection.id : nextId(),
    a: wallMap.get(connection.a) ?? connection.a, b: wallMap.get(connection.b) ?? connection.b,
  }));
  const pasted: ClipboardMember[] = [
    ...walls.map(wall => ({ kind: 'wall' as const, id: wall.id })),
    ...braces.map(brace => ({ kind: 'brace' as const, id: brace.id })),
    ...platforms.map(platform => ({ kind: 'platform' as const, id: platform.id })),
    ...stairs.map(stair => ({ kind: 'stair' as const, id: stair.id })),
    ...placeholders.map(item => ({ kind: 'placeholder' as const, id: item.id })),
  ];
  return {
    layout: {
      ...layout, walls: [...layout.walls, ...walls], braces: [...layout.braces, ...braces],
      platforms: platforms.length ? [...layout.platforms ?? [], ...platforms] : layout.platforms,
      placeholders: placeholders.length ? [...layout.placeholders ?? [], ...placeholders] : layout.placeholders,
      stairs: stairs.length ? [...layout.stairs ?? [], ...stairs] : layout.stairs,
      groups: groups.length ? [...layout.groups ?? [], ...groups] : layout.groups,
      connections: connections.length ? [...layout.connections ?? [], ...connections] : layout.connections,
    },
    pasted, consumed: clipboard.keepIdentities,
  };
}
