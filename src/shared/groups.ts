import { z } from 'zod';

/** Pivot: centroid of member centres (average plan x/y, mm). +rotation is counterclockwise, matching walls. Connections never form a group. */
export const GROUP_PIVOT_NOTICE = 'Drehpunkt ist der Schwerpunkt der Mitgliedsmitten in Millimetern. Verbindungen allein bilden keine Gruppe.';

export const groupMemberKindSchema = z.enum(['wall', 'brace', 'stair']);
export type GroupMemberKind = z.infer<typeof groupMemberKindSchema>;
export const groupMemberSchema = z.strictObject({ kind: groupMemberKindSchema, id: z.uuid() });
export type GroupMember = z.infer<typeof groupMemberSchema>;
export const groupSchema = z.strictObject({
  id: z.uuid(),
  members: z.array(groupMemberSchema).min(2).max(250),
  rotation: z.number().finite().min(-360).max(360),
}).refine(group => group.members.some(member => member.kind === 'wall'), 'Groups must include a wall')
  .refine(group => new Set(group.members.map(member => `${member.kind}:${member.id}`)).size === group.members.length, 'Group members must be unique');
export type Group = z.infer<typeof groupSchema>;
export type GroupPose = { x: number; y: number; rotation: number };

type Posed = { id: string; x: number; y: number; rotation: number };
export type GroupableLayout = {
  walls: Posed[];
  braces?: Posed[];
  stairs?: Posed[];
  groups?: Group[];
};

export function formGroup<T extends GroupableLayout>(layout: T, members: GroupMember[], id: string): T {
  if (!canFormGroup(layout, members)) return layout;
  return { ...layout, groups: [...layout.groups ?? [], { id, members, rotation: 0 }] } as T;
}

export function ungroup<T extends GroupableLayout>(layout: T, groupId: string): T {
  return { ...layout, groups: (layout.groups ?? []).filter(group => group.id !== groupId) };
}

export function groupOf<T extends { groups?: Group[] }>(layout: T, groupId: string) {
  return (layout.groups ?? []).find(group => group.id === groupId);
}

export function groupContaining<T extends { groups?: Group[] }>(layout: T, member: GroupMember) {
  return (layout.groups ?? []).find(group => group.members.some(item => item.kind === member.kind && item.id === member.id));
}

function posedOf<T extends GroupableLayout>(layout: T, member: GroupMember) {
  const list = member.kind === 'wall' ? layout.walls : member.kind === 'brace' ? layout.braces ?? [] : layout.stairs ?? [];
  return list.find(item => item.id === member.id);
}

export function groupPivot<T extends GroupableLayout>(layout: T, groupId: string) {
  const group = groupOf(layout, groupId);
  if (!group) return;
  const poses = group.members.map(member => posedOf(layout, member));
  if (poses.some(pose => !pose) || poses.length === 0) return;
  return {
    x: poses.reduce((sum, pose) => sum + pose!.x, 0) / poses.length,
    y: poses.reduce((sum, pose) => sum + pose!.y, 0) / poses.length,
  };
}

function wrapRotation(value: number) {
  let result = value;
  while (result > 360) result -= 360;
  while (result < -360) result += 360;
  return result;
}

function rotatePoint(x: number, y: number, origin: { x: number; y: number }, degrees: number) {
  const angle = degrees * Math.PI / 180;
  const dx = x - origin.x, dy = y - origin.y;
  return { x: origin.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: origin.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

export function transformGroup<T extends GroupableLayout>(layout: T, groupId: string, pose: GroupPose): T {
  const group = groupOf(layout, groupId);
  const current = groupPivot(layout, groupId);
  if (!group || !current) return layout;
  const dx = pose.x - current.x, dy = pose.y - current.y, delta = pose.rotation - group.rotation;
  const origin = { x: pose.x, y: pose.y };
  const next = new Map(group.members.flatMap(member => {
    const item = posedOf(layout, member);
    if (!item) return [];
    const moved = rotatePoint(item.x + dx, item.y + dy, origin, delta);
    return [[`${member.kind}:${member.id}`, { x: moved.x, y: moved.y, rotation: wrapRotation(item.rotation + delta) }] as const];
  }));
  function patch<U extends Posed>(kind: GroupMemberKind, items: U[]) {
    return items.map(item => {
      const updated = next.get(`${kind}:${item.id}`);
      return updated ? { ...item, ...updated } : item;
    });
  }
  return {
    ...layout,
    walls: patch('wall', layout.walls),
    braces: layout.braces ? patch('brace', layout.braces) : layout.braces,
    stairs: layout.stairs ? patch('stair', layout.stairs) : layout.stairs,
    groups: (layout.groups ?? []).map(item => item.id === groupId ? { ...item, rotation: wrapRotation(pose.rotation) } : item),
  };
}

export function dropMember<T extends GroupableLayout>(layout: T, member: GroupMember): T {
  const groups = (layout.groups ?? []).flatMap(group => {
    const members = group.members.filter(item => !(item.kind === member.kind && item.id === member.id));
    if (members.length < 2 || !members.some(item => item.kind === 'wall')) return [];
    return [{ ...group, members }];
  });
  return { ...layout, groups };
}

export function canFormGroup<T extends GroupableLayout>(layout: T, members: GroupMember[]) {
  if (members.length < 2 || !members.some(member => member.kind === 'wall')) return false;
  if (new Set(members.map(member => `${member.kind}:${member.id}`)).size !== members.length) return false;
  return members.every(member => posedOf(layout, member) && !groupContaining(layout, member));
}

export function groupsReferenceLayout<T extends GroupableLayout>(layout: T) {
  const groups = layout.groups ?? [];
  if (new Set(groups.map(group => group.id)).size !== groups.length) return false;
  const seen = new Set<string>();
  const ids = {
    wall: new Set(layout.walls.map(item => item.id)),
    brace: new Set((layout.braces ?? []).map(item => item.id)),
    stair: new Set((layout.stairs ?? []).map(item => item.id)),
  };
  return groups.every(group => group.members.every(member => {
    const key = `${member.kind}:${member.id}`;
    if (seen.has(key) || !ids[member.kind].has(member.id)) return false;
    seen.add(key);
    return true;
  }));
}
