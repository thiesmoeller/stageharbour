import { normalizeRotation, selectionPivot, transformSelection, type PlanTransform } from './editing.js';
import type { Layout, VenueGeometry } from './layout.js';
import type { SelectableMember } from './selection.js';
import { snapRotation, translationFor, type SnapGuide, type SnapWall, type StageCentreline } from './snapping.js';
import { transformVenue, venueObjectFootprint, venueObjects, venueSelectionPivot, type VenueObject } from './venueEditing.js';
import { resolveWall } from './wall-types.js';

export type TransformOperation = 'translate' | 'rotate';
export function objectRotation(item: { id?: string; rotation?: number; outline?: { x: number; y: number }[] }) {
  if (item.rotation !== undefined) return item.rotation;
  const [a, b] = item.outline ?? [];
  return a && b ? Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI : 0;
}

function shapes(item: VenueObject, venue: VenueGeometry): SnapWall[] {
  const base = { id: item.id, x: item.x, y: item.y, rotation: 0 };
  switch (item.kind) {
    case 'wall': return [resolveWall(item, venue.wallTypes ?? [])];
    case 'stair': return [{ ...item, thickness: item.run }];
    case 'placeholder': return [{ ...item, thickness: item.depth }];
    case 'overhead': return [{ ...item, width: item.length, thickness: item.width }];
    case 'truss': return [{ ...item, width: item.length, thickness: item.sectionWidth }];
    case 'curtain': return [{ ...item, width: item.length, thickness: 120 }];
    case 'pin': return [{ ...base, width: 0, thickness: 0 }];
    default: {
      // Use actual polygon edges, not a bounding rectangle around an irregular platform.
      const points = venueObjectFootprint(item, venue);
      return points.flatMap((a, index) => {
        if (item.kind === 'corridor' && index === points.length - 1) return [];
        const b = points[(index + 1) % points.length]!;
        return [{ id: `${item.id}:${index}`, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
          rotation: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI,
          width: Math.hypot(b.x - a.x, b.y - a.y), thickness: 0 }];
      });
    }
  }
}

function adjust(delta: PlanTransform, operation: TransformOperation, baseRotation: number, bypass: boolean,
  moving: SnapWall[], others: SnapWall[], centreline: StageCentreline | undefined, pivot?: { x: number; y: number },
) {
  if (operation === 'rotate') return { delta: { x: 0, y: 0, rotation: normalizeRotation((bypass ? baseRotation + delta.rotation : snapRotation(baseRotation + delta.rotation)) - baseRotation) }, guides: [] as SnapGuide[] };
  if (bypass) return { delta: { ...delta, rotation: 0 }, guides: [] as SnapGuide[] };
  const snapped = translationFor(moving, others, centreline, pivot);
  return { delta: { x: delta.x + snapped.dx, y: delta.y + snapped.dy, rotation: 0 }, guides: snapped.guides };
}

export function layoutSelectionRotation(layout: Layout, members: readonly SelectableMember[]) {
  if (members.length === 1) {
    const id = members[0]!.id;
    return layout.objects.find(item => item.id === id)?.rotation ?? 0;
  }
  const group = layout.groups?.find(item => item.members.length === members.length && item.members.every(m => members.some(p => p.id === m.id)));
  return group?.rotation ?? 0;
}

/** The same transform policy for plan gestures and 3D handles. Numeric edits remain exact. */
export function transformLayoutGesture(layout: Layout, venue: VenueGeometry, members: readonly SelectableMember[], delta: PlanTransform, operation: TransformOperation, bypass: boolean) {
  const ids = new Set(members.map(item => item.id));
  const candidate = transformSelection(layout, members, { ...delta, rotation: 0 });
  const moving = candidate.objects.filter(item => ids.has(item.id))
    .map(item => ({ id: item.id, x: item.x, y: item.y, rotation: item.rotation, width: 0, thickness: 0 }));
  const others = (venue.walls ?? []).map(item => resolveWall(item, venue.wallTypes ?? []));
  const snapped = adjust(delta, operation, layoutSelectionRotation(layout, members), bypass, moving, others, venue.stageCentreline, selectionPivot(candidate, members));
  return { layout: transformSelection(layout, members, snapped.delta), guides: snapped.guides };
}

export function transformVenueGesture(venue: VenueGeometry, ids: readonly string[], delta: PlanTransform, operation: TransformOperation, bypass: boolean) {
  const candidate = transformVenue(venue, ids, { ...delta, rotation: 0 });
  const selected = venueObjects(candidate).filter(item => ids.includes(item.id));
  const others = (venue.walls ?? []).filter(item => !ids.includes(item.id)).map(item => resolveWall(item, venue.wallTypes ?? []));
  const rotation = selected.length === 1 ? objectRotation(selected[0]!) : 0;
  const snapped = adjust(delta, operation, rotation, bypass, selected.flatMap(item => shapes(item, candidate)), others, venue.stageCentreline, venueSelectionPivot(candidate, ids));
  return { venue: transformVenue(venue, ids, snapped.delta), guides: snapped.guides };
}
