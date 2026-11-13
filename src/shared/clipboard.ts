import { dropMember, type Group } from './groups.js';
import type { Joint, Layout, LayoutObject } from './layout.js';

export type ClipboardMember = { kind: 'object'; id: string };
export type LayoutClipboard = {
  keepIdentities: boolean;
  objects: LayoutObject[];
  joints: Joint[];
  groups: Group[];
};
export type PasteOffset = { x: number; y: number };

const keysOf = (selected: readonly ClipboardMember[]) => new Set(selected.map(item => item.id));

function extract(layout: Layout, selected: readonly ClipboardMember[]): Omit<LayoutClipboard, 'keepIdentities'> | undefined {
  const ids = keysOf(selected);
  const objects = layout.objects.filter(object => ids.has(object.id));
  if (!objects.length) return;
  const joints = layout.joints.filter(joint => ids.has(joint.a.object) && ids.has(joint.b.object));
  const groups = (layout.groups ?? []).flatMap(group => {
    const members = group.members.filter(member => ids.has(member.id));
    return members.length >= 2 ? [{ ...group, members }] : [];
  });
  return { objects: structuredClone(objects), joints: structuredClone(joints), groups: structuredClone(groups) };
}

export function copySelection(layout: Layout, selected: readonly ClipboardMember[]): LayoutClipboard | undefined {
  const taken = extract(layout, selected);
  return taken ? { keepIdentities: false, ...taken } : undefined;
}

export function cutSelection(layout: Layout, selected: readonly ClipboardMember[]): { layout: Layout; clipboard?: LayoutClipboard } {
  const taken = extract(layout, selected);
  return taken ? { layout: removeSelection(layout, selected), clipboard: { keepIdentities: true, ...taken } } : { layout };
}

export function removeSelection(layout: Layout, selected: readonly ClipboardMember[]): Layout {
  const ids = keysOf(selected);
  let next: Layout = {
    ...layout,
    objects: layout.objects.filter(object => !ids.has(object.id)),
    joints: layout.joints.filter(joint => !ids.has(joint.a.object) && !ids.has(joint.b.object)),
    wallPictures: layout.wallPictures?.filter(picture => !ids.has(picture.wallId)),
  };
  for (const member of selected) next = dropMember(next, member);
  return next;
}

const clampCoord = (value: number) => Math.max(-100000, Math.min(100000, value));
const shift = (value: number, delta: number) => clampCoord(value + delta);

function placementCopy(object: LayoutObject, id: string, offset: PasteOffset): LayoutObject {
  const moved = { ...object, id, x: shift(object.x, offset.x), y: shift(object.y, offset.y) };
  const { stockItemId: _stockItemId, assemblyNumber: _assemblyNumber, ...rest } = moved;
  return rest;
}

export function clipboardPivot(clipboard: LayoutClipboard): { x: number; y: number } | undefined {
  if (!clipboard.objects.length) return;
  return {
    x: clipboard.objects.reduce((sum, object) => sum + object.x, 0) / clipboard.objects.length,
    y: clipboard.objects.reduce((sum, object) => sum + object.y, 0) / clipboard.objects.length,
  };
}

export function pasteClipboard(
  layout: Layout,
  clipboard: LayoutClipboard,
  nextId: () => string,
  offset: PasteOffset = { x: 0, y: 0 },
): { layout: Layout; pasted: ClipboardMember[]; consumed: boolean } {
  if (layout.objects.length + clipboard.objects.length > 1000) {
    return { layout, pasted: [], consumed: false };
  }
  if (clipboard.keepIdentities) {
    const existing = new Set(layout.objects.map(object => object.id));
    if (clipboard.objects.some(object => existing.has(object.id))) {
      return { layout, pasted: [], consumed: false };
    }
  }
  const ids = new Map(clipboard.objects.map(object => [object.id, clipboard.keepIdentities ? object.id : nextId()]));
  const copiedIds = new Set(clipboard.objects.map(object => object.id));
  const objects = clipboard.objects.map(object => {
    const moved = clipboard.keepIdentities
      ? { ...object, x: shift(object.x, offset.x), y: shift(object.y, offset.y) }
      : placementCopy(object, ids.get(object.id)!, offset);
    return moved.support && copiedIds.has(moved.support)
      ? { ...moved, support: ids.get(moved.support)! }
      : moved;
  });
  const groups: Group[] = clipboard.groups.map(group => ({
    ...group,
    id: clipboard.keepIdentities ? group.id : nextId(),
    members: group.members.map(member => ({ ...member, id: ids.get(member.id) ?? member.id })),
  }));
  const joints: Joint[] = clipboard.joints.map(joint => ({
    ...joint,
    ...(joint.id ? { id: clipboard.keepIdentities ? joint.id : nextId() } : {}),
    a: { ...joint.a, object: ids.get(joint.a.object) ?? joint.a.object },
    b: { ...joint.b, object: ids.get(joint.b.object) ?? joint.b.object },
  }));
  return {
    layout: {
      ...layout,
      objects: [...layout.objects, ...objects],
      joints: [...layout.joints, ...joints],
      groups: groups.length ? [...layout.groups ?? [], ...groups] : layout.groups,
    },
    pasted: objects.map(object => ({ kind: 'object', id: object.id })),
    consumed: clipboard.keepIdentities,
  };
}
