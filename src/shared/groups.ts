import { z } from 'zod';

/** Pivot: centroid of object centres (average plan x/y, mm). +rotation is counterclockwise. Joints never form a group. */
export const GROUP_PIVOT_NOTICE = 'Drehpunkt ist der Schwerpunkt der Mitgliedsmitten in Millimetern. Verbindungen allein bilden keine Gruppe.';

export const groupMemberKindSchema = z.literal('object');
export type GroupMemberKind = z.infer<typeof groupMemberKindSchema>;
export const groupMemberSchema = z.strictObject({ kind: groupMemberKindSchema, id: z.uuid() });
export type GroupMember = z.infer<typeof groupMemberSchema>;
export const groupSchema = z.strictObject({
  id: z.uuid(),
  members: z.array(groupMemberSchema).min(2).max(250),
  rotation: z.number().finite().min(-360).max(360),
}).refine(group => new Set(group.members.map(member => member.id)).size === group.members.length, 'Group members must be unique');
export type Group = z.infer<typeof groupSchema>;
export type GroupPose = { x: number; y: number; rotation: number };

type Posed = { id: string; x: number; y: number; rotation: number };
export type GroupableLayout = {
  objects: Posed[];
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
  return (layout.groups ?? []).find(group => group.members.some(item => item.id === member.id));
}

function posedOf<T extends GroupableLayout>(layout: T, member: GroupMember) {
  return layout.objects.find(item => item.id === member.id);
}

export function groupPivot<T extends GroupableLayout>(layout: T, groupId: string) {
  const group = groupOf(layout, groupId);
  if (!group) return;
  return membersPivot(layout, group.members);
}

/** Centroid of an ad-hoc multi-selection (same millimetre rule as persisted groups). */
export function membersPivot<T extends GroupableLayout>(layout: T, members: GroupMember[]) {
  const poses = members.map(member => posedOf(layout, member));
  if (!members.length || poses.some(pose => !pose)) return;
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
  const next = transformMembers(layout, group.members, pose, group.rotation);
  return {
    ...next,
    groups: (layout.groups ?? []).map(item => item.id === groupId ? { ...item, rotation: wrapRotation(pose.rotation) } : item),
  };
}

/** Translate/rotate an ad-hoc selection around its centroid without writing a persisted group. */
export function transformMembers<T extends GroupableLayout>(layout: T, members: GroupMember[], pose: GroupPose, baseRotation = 0): T {
  const current = membersPivot(layout, members);
  if (!current || !members.length) return layout;
  const dx = pose.x - current.x, dy = pose.y - current.y, delta = pose.rotation - baseRotation;
  const origin = { x: pose.x, y: pose.y };
  const next = new Map(members.flatMap(member => {
    const item = posedOf(layout, member);
    if (!item) return [];
    const moved = rotatePoint(item.x + dx, item.y + dy, origin, delta);
    return [[member.id, { x: moved.x, y: moved.y, rotation: wrapRotation(item.rotation + delta) }] as const];
  }));
  function patch<U extends Posed>(items: U[]) {
    return items.map(item => {
      const updated = next.get(item.id);
      return updated ? { ...item, ...updated } : item;
    });
  }
  return {
    ...layout,
    objects: patch(layout.objects),
  };
}

export function dropMember<T extends GroupableLayout>(layout: T, member: GroupMember): T {
  const groups = (layout.groups ?? []).flatMap(group => {
    const members = group.members.filter(item => item.id !== member.id);
    if (members.length < 2) return [];
    return [{ ...group, members }];
  });
  return { ...layout, groups };
}

export function canFormGroup<T extends GroupableLayout>(layout: T, members: GroupMember[]) {
  if (members.length < 2) return false;
  if (new Set(members.map(member => member.id)).size !== members.length) return false;
  return members.every(member => posedOf(layout, member) && !groupContaining(layout, member));
}

export function groupsReferenceLayout<T extends GroupableLayout>(layout: T) {
  const groups = layout.groups ?? [];
  if (new Set(groups.map(group => group.id)).size !== groups.length) return false;
  const seen = new Set<string>();
  const ids = new Set(layout.objects.map(item => item.id));
  return groups.every(group => group.members.every(member => {
    if (seen.has(member.id) || !ids.has(member.id)) return false;
    seen.add(member.id);
    return true;
  }));
}
