import { normalizeRotation, selectionPivot, transformSelection, type PlanTransform } from './editing.js';
import type { Layout, LayoutObject, VenueGeometry } from './layout.js';
import type { ResolvedLayoutObject } from './layoutObjects.js';
import type { SelectableMember } from './selection.js';
import { snapObjectConnectors, snapRotation, translationFor, type SnapGuide, type SnapWall, type StageCentreline } from './snapping.js';
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

/** The plan footprint of an object as a box in its own frame: centre offset from the origin, extent along and across. */
export type ObjectSnapShape = { cx: number; cy: number; width: number; thickness: number };

/** Snap boxes do not depend on where an object stands, so one resolution serves a whole gesture. */
export function objectSnapShapes(objects: readonly ResolvedLayoutObject[]): Map<string, ObjectSnapShape> {
  const shapes = new Map<string, ObjectSnapShape>();
  for (const item of objects) {
    if (!item.footprint.length) continue;
    const angle = -item.object.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const local = item.footprint.map(point => {
      const dx = point.x - item.object.x, dy = point.y - item.object.y;
      return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
    });
    const minX = Math.min(...local.map(point => point.x)), maxX = Math.max(...local.map(point => point.x));
    const minY = Math.min(...local.map(point => point.y)), maxY = Math.max(...local.map(point => point.y));
    shapes.set(item.object.id, { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width: maxX - minX, thickness: maxY - minY });
  }
  return shapes;
}

function objectSnapWall(object: LayoutObject, shape: ObjectSnapShape | undefined): SnapWall {
  if (!shape) return { id: object.id, x: object.x, y: object.y, rotation: object.rotation, width: 0, thickness: 0 };
  const angle = object.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return {
    id: object.id, rotation: object.rotation, width: shape.width, thickness: shape.thickness,
    x: object.x + shape.cx * cos - shape.cy * sin,
    y: object.y + shape.cx * sin + shape.cy * cos,
  };
}

export type GestureConnection = { moving: string; targetObject: string; target: string };

/**
 * The same transform policy for plan gestures and 3D handles. Numeric edits remain exact.
 * `resolved` are the objects of `layout` as resolved when the gesture began. With them, objects snap
 * to each other's edges and a single dragged object mates its nearest compatible connector; without
 * them only the venue walls and the centreline attract.
 */
export function transformLayoutGesture(
  layout: Layout, venue: VenueGeometry, members: readonly SelectableMember[], delta: PlanTransform,
  operation: TransformOperation, bypass: boolean, resolved: readonly ResolvedLayoutObject[] = [],
): { layout: Layout; guides: SnapGuide[]; connection?: GestureConnection } {
  const ids = new Set(members.map(item => item.id));
  const candidate = transformSelection(layout, members, { ...delta, rotation: 0 });
  const releaseSupport = (next: Layout): Layout => {
    if (!next.objects.some(object => ids.has(object.id) && object.support !== undefined)) return next;
    return {
      ...next,
      objects: next.objects.map(object => {
        if (!ids.has(object.id) || object.support === undefined) return object;
        const { support: _support, ...rest } = object;
        return rest;
      }),
    };
  };
  if (operation === 'translate' && !bypass && members.length === 1) {
    const start = resolved.find(item => item.object.id === members[0]!.id);
    const moved = candidate.objects.find(item => item.id === members[0]!.id);
    if (start && moved) {
      const dx = moved.x - start.object.x, dy = moved.y - start.object.y;
      const shifted: ResolvedLayoutObject = {
        ...start,
        object: moved,
        connectors: start.connectors.map(connector => ({
          ...connector, position: { ...connector.position, x: connector.position.x + dx, z: connector.position.z + dy },
        })),
      };
      const snap = snapObjectConnectors(shifted, resolved.filter(item => item.object.id !== moved.id));
      if (snap.connection?.targetObject) {
        return {
          layout: releaseSupport(transformSelection(layout, members, { x: delta.x + snap.x - moved.x, y: delta.y + snap.y - moved.y, rotation: 0 })),
          guides: snap.guides,
          connection: { moving: snap.connection.moving, targetObject: snap.connection.targetObject, target: snap.connection.target },
        };
      }
    }
  }
  const shapes = objectSnapShapes(resolved);
  const moving = candidate.objects.filter(item => ids.has(item.id)).map(item => objectSnapWall(item, shapes.get(item.id)));
  const others = [
    ...layout.objects.filter(item => !ids.has(item.id) && shapes.has(item.id)).map(item => objectSnapWall(item, shapes.get(item.id))),
    ...(venue.walls ?? []).map(item => resolveWall(item, venue.wallTypes ?? [])),
  ];
  const snapped = adjust(delta, operation, layoutSelectionRotation(layout, members), bypass, moving, others, venue.stageCentreline, selectionPivot(candidate, members));
  const result = transformSelection(layout, members, snapped.delta);
  if (operation !== 'translate' || !snapped.guides.length) return { layout: releaseSupport(result), guides: snapped.guides };
  // A snapped position is a deliberate one: drop the sub-micron noise of pointer and footprint maths.
  return {
    layout: releaseSupport({ ...result, objects: result.objects.map(item => ids.has(item.id) ? { ...item, x: tidy(item.x), y: tidy(item.y) } : item) }),
    guides: snapped.guides,
  };
}

function tidy(value: number) {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 1e-3 ? rounded : value;
}

export function transformVenueGesture(venue: VenueGeometry, ids: readonly string[], delta: PlanTransform, operation: TransformOperation, bypass: boolean) {
  const candidate = transformVenue(venue, ids, { ...delta, rotation: 0 });
  const selected = venueObjects(candidate).filter(item => ids.includes(item.id));
  const others = (venue.walls ?? []).filter(item => !ids.includes(item.id)).map(item => resolveWall(item, venue.wallTypes ?? []));
  const rotation = selected.length === 1 ? objectRotation(selected[0]!) : 0;
  const snapped = adjust(delta, operation, rotation, bypass, selected.flatMap(item => shapes(item, candidate)), others, venue.stageCentreline, venueSelectionPivot(candidate, ids));
  return { venue: transformVenue(venue, ids, snapped.delta), guides: snapped.guides };
}
