import type { PanelConnection } from './assembly.js';
import { dropMember, type Group, type GroupMember } from './groups.js';
import type { Brace, Layout, Wall } from './layout.js';
import type { Platform, StairUnit } from './levels.js';

/** Paste offset from clipboard geometry, millimetres, +x audience-right and +y away from the audience. */
export const PASTE_OFFSET_MM = 300;

export type ClipboardMember = { kind: 'wall' | 'brace' | 'platform' | 'stair'; id: string };
export type LayoutClipboard = {
  keepIdentities: boolean;
  walls: Wall[];
  braces: Brace[];
  platforms: Platform[];
  stairs: StairUnit[];
  connections: PanelConnection[];
  groups: Group[];
};

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
  if (!walls.length && !braces.length && !platforms.length && !stairs.length) return;
  const wallIds = new Set(walls.map(wall => wall.id));
  const connections = (layout.connections ?? []).filter(connection => wallIds.has(connection.a) && wallIds.has(connection.b));
  const groups = (layout.groups ?? []).flatMap(group => {
    const members = group.members.filter(member => ids.has(`${member.kind}:${member.id}`));
    if (members.length < 2 || !members.some(member => member.kind === 'wall')) return [];
    return [{ ...group, members }];
  });
  return {
    walls: structuredClone(walls), braces: structuredClone(braces),
    platforms: structuredClone(platforms), stairs: structuredClone(stairs),
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
    connections: (layout.connections ?? []).filter(connection => !wallIds.has(connection.a) && !wallIds.has(connection.b)),
  };
  for (const member of selected) {
    if (member.kind !== 'platform') next = dropMember(next, member as GroupMember);
  }
  return next;
}

function shift(value: number) {
  return Math.max(-100000, Math.min(100000, value + PASTE_OFFSET_MM));
}

function placementCopy(wall: Wall, id: string): Wall {
  const moved = { ...wall, id, x: shift(wall.x), y: shift(wall.y) };
  const { panelId: _panelId, assemblyNumber: _assemblyNumber, ...rest } = moved;
  return rest;
}

export function pasteClipboard(layout: Layout, clipboard: LayoutClipboard, nextId: () => string): {
  layout: Layout; pasted: ClipboardMember[]; consumed: boolean;
} {
  if (layout.walls.length + clipboard.walls.length > 250
    || layout.braces.length + clipboard.braces.length > 250
    || (layout.platforms ?? []).length + clipboard.platforms.length > 250
    || (layout.stairs ?? []).length + clipboard.stairs.length > 250) {
    return { layout, pasted: [], consumed: false };
  }
  if (clipboard.keepIdentities) {
    const existing = new Set([
      ...layout.walls.map(item => `wall:${item.id}`), ...layout.braces.map(item => `brace:${item.id}`),
      ...(layout.platforms ?? []).map(item => `platform:${item.id}`), ...(layout.stairs ?? []).map(item => `stair:${item.id}`),
    ]);
    const incoming = [
      ...clipboard.walls.map(item => `wall:${item.id}`), ...clipboard.braces.map(item => `brace:${item.id}`),
      ...clipboard.platforms.map(item => `platform:${item.id}`), ...clipboard.stairs.map(item => `stair:${item.id}`),
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
    ? { ...wall, x: shift(wall.x), y: shift(wall.y) }
    : placementCopy(wall, take('wall', wall.id)));
  if (clipboard.keepIdentities) for (const wall of clipboard.walls) take('wall', wall.id);
  const braces = clipboard.braces.map(brace => ({ ...brace, id: take('brace', brace.id), x: shift(brace.x), y: shift(brace.y) }));
  const platforms = clipboard.platforms.map(platform => ({
    ...platform, id: take('platform', platform.id),
    outline: platform.outline.map(point => ({ x: shift(point.x), y: shift(point.y) })),
  }));
  const stairs = clipboard.stairs.map(stair => ({ ...stair, id: take('stair', stair.id), x: shift(stair.x), y: shift(stair.y) }));
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
  ];
  return {
    layout: {
      ...layout, walls: [...layout.walls, ...walls], braces: [...layout.braces, ...braces],
      platforms: platforms.length ? [...layout.platforms ?? [], ...platforms] : layout.platforms,
      stairs: stairs.length ? [...layout.stairs ?? [], ...stairs] : layout.stairs,
      groups: groups.length ? [...layout.groups ?? [], ...groups] : layout.groups,
      connections: connections.length ? [...layout.connections ?? [], ...connections] : layout.connections,
    },
    pasted, consumed: clipboard.keepIdentities,
  };
}
