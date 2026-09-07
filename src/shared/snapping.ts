import { z } from 'zod';
import { groupOf, groupPivot, transformGroup, type Group, type GroupPose } from './groups.js';

const coordinate = z.number().finite().min(-100000).max(100000);

/** Millimetres. An edge or centre closer than this to a wall edge or the centreline snaps onto it. Independent of screen zoom. */
export const SNAP_DISTANCE_MM = 100;
/** Degrees. Rotation closer than this to a common layout angle snaps onto that angle. */
export const SNAP_ANGLE_DEG = 2.5;
/** Common layout-design angles in degrees. Mirroring is out of scope. */
export const COMMON_LAYOUT_ANGLES_DEG = Array.from({ length: 49 }, (_, i) => -360 + i * 15);
export const SNAP_NOTICE = `Einrasttoleranz ${SNAP_DISTANCE_MM} mm und ${String(SNAP_ANGLE_DEG).replace('.', ',')}°. Kanten und Mittellinie. Alt umgeht das Einrasten. Spiegeln ist nicht vorgesehen.`;

export const stageCentrelineSchema = z.strictObject({
  x: coordinate, y: coordinate,
  rotation: z.number().finite().min(-360).max(360),
});
export type StageCentreline = z.infer<typeof stageCentrelineSchema>;
export const centrelineSchema = stageCentrelineSchema;

export function defaultCentreline(venue: { width: number; depth: number }): StageCentreline {
  return { x: venue.width / 2, y: venue.depth / 2, rotation: 90 };
}

export type SnapGuide = { kind: 'wall-edge' | 'centreline'; a: { x: number; y: number }; b: { x: number; y: number } };
export type SnapOptions = { bypass?: boolean; snapAngles?: boolean };
export type SnapWall = { id: string; x: number; y: number; rotation: number; width: number; thickness: number };
type SnapLayout = {
  walls: SnapWall[];
  braces?: { id: string; x: number; y: number; rotation: number }[];
  stairs?: { id: string; x: number; y: number; rotation: number }[];
  groups?: Group[];
};

export function centrelineSpan(centreline: StageCentreline, length = 100000) {
  const angle = centreline.rotation * Math.PI / 180;
  const dx = Math.cos(angle) * length, dy = Math.sin(angle) * length;
  return { a: { x: centreline.x - dx, y: centreline.y - dy }, b: { x: centreline.x + dx, y: centreline.y + dy } };
}

export function snapRotation(rotation: number) {
  let best = rotation, bestDelta = SNAP_ANGLE_DEG;
  for (const angle of COMMON_LAYOUT_ANGLES_DEG) {
    const delta = Math.abs(wrapDelta(rotation - angle));
    if (delta < bestDelta || delta === bestDelta && Math.abs(angle) < Math.abs(best)) {
      best = angle; bestDelta = delta;
    }
  }
  return bestDelta <= SNAP_ANGLE_DEG ? (best === -360 || best === 360 ? 0 : best) : rotation;
}

export function snapWallPose(wall: SnapWall, others: SnapWall[], centreline: StageCentreline | undefined, options?: SnapOptions) {
  if (options?.bypass) return { x: wall.x, y: wall.y, rotation: wall.rotation, guides: [] as SnapGuide[] };
  const rotation = options?.snapAngles ? snapRotation(wall.rotation) : wall.rotation;
  const posed = { ...wall, rotation };
  const { dx, dy, guides } = translationFor([posed], others.filter(item => item.id !== wall.id), centreline);
  return { x: clean(posed.x + dx), y: clean(posed.y + dy), rotation, guides };
}

export function snapGroupPose(layout: SnapLayout, groupId: string, pose: GroupPose, centreline: StageCentreline | undefined, options?: SnapOptions) {
  const group = groupOf(layout, groupId);
  if (options?.bypass || !group) return { pose, guides: [] as SnapGuide[] };
  const rotation = options?.snapAngles ? snapRotation(pose.rotation) : pose.rotation;
  const proposed = { ...pose, rotation };
  const moved = transformGroup(layout, groupId, proposed);
  const memberIds = new Set(group.members.filter(member => member.kind === 'wall').map(member => member.id));
  const moving = moved.walls.filter(wall => memberIds.has(wall.id));
  const others = layout.walls.filter(wall => !memberIds.has(wall.id));
  const { dx, dy, guides } = translationFor(moving, others, centreline, groupPivot(moved, groupId));
  return { pose: { x: clean(proposed.x + dx), y: clean(proposed.y + dy), rotation }, guides };
}

function clean(value: number) {
  if (Math.abs(value) < 1e-9) return 0;
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 1e-9 ? rounded : value;
}

function wrapDelta(value: number) {
  let result = value % 360;
  if (result > 180) result -= 360;
  if (result < -180) result += 360;
  return result;
}

function corners(wall: SnapWall) {
  const angle = wall.rotation * Math.PI / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx = 0, sy = 0]) => {
    const dx = sx * wall.width / 2, dy = sy * wall.thickness / 2;
    return { x: wall.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: wall.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  });
}

function edges(wall: SnapWall) {
  const points = corners(wall);
  return points.map((start, index) => ({ a: start, b: points[(index + 1) % points.length]! }));
}

function unit(a: { x: number; y: number }, b: { x: number; y: number }) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 0)) return;
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

function parallel(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x * b.x + a.y * b.y) >= Math.cos(SNAP_ANGLE_DEG * Math.PI / 180);
}

function offsetToLine(point: { x: number; y: number }, origin: { x: number; y: number }, dir: { x: number; y: number }) {
  const normal = { x: -dir.y, y: dir.x };
  const signed = (point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y;
  return { dx: -signed * normal.x, dy: -signed * normal.y, distance: Math.abs(signed), normal };
}

type Candidate = { dx: number; dy: number; distance: number; guide: SnapGuide };

function translationFor(moving: SnapWall[], others: SnapWall[], centreline: StageCentreline | undefined, extraPoint?: { x: number; y: number }) {
  const first = bestCandidate(moving, others, centreline, extraPoint);
  if (!first) return { dx: 0, dy: 0, guides: [] as SnapGuide[] };
  const shifted = moving.map(wall => ({ ...wall, x: wall.x + first.dx, y: wall.y + first.dy }));
  const shiftedPoint = extraPoint ? { x: extraPoint.x + first.dx, y: extraPoint.y + first.dy } : extraPoint;
  const second = bestCandidate(shifted, others, centreline, shiftedPoint, first);
  const dx = first.dx + (second?.dx ?? 0), dy = first.dy + (second?.dy ?? 0);
  return { dx, dy, guides: second ? [first.guide, second.guide] : [first.guide] };
}

function bestCandidate(moving: SnapWall[], others: SnapWall[], centreline: StageCentreline | undefined, extraPoint?: { x: number; y: number }, ignore?: Candidate): Candidate | undefined {
  const candidates: Candidate[] = [];
  for (const wall of moving) {
    for (const edge of edges(wall)) {
      const dir = unit(edge.a, edge.b);
      if (!dir) continue;
      for (const other of others) {
        for (const target of edges(other)) {
          const targetDir = unit(target.a, target.b);
          if (!targetDir || !parallel(dir, targetDir)) continue;
          const snap = offsetToLine(edge.a, target.a, targetDir);
          if (snap.distance <= SNAP_DISTANCE_MM) {
            candidates.push({ dx: snap.dx, dy: snap.dy, distance: snap.distance, guide: { kind: 'wall-edge', a: target.a, b: target.b } });
          }
        }
      }
      if (centreline) {
        const span = centrelineSpan(centreline);
        const lineDir = unit(span.a, span.b);
        if (lineDir && parallel(dir, lineDir)) {
          const snap = offsetToLine(edge.a, centreline, lineDir);
          if (snap.distance <= SNAP_DISTANCE_MM) {
            candidates.push({ dx: snap.dx, dy: snap.dy, distance: snap.distance, guide: { kind: 'centreline', ...span } });
          }
        }
      }
    }
    if (centreline) {
      const span = centrelineSpan(centreline);
      const lineDir = unit(span.a, span.b);
      if (lineDir) {
        const snap = offsetToLine({ x: wall.x, y: wall.y }, centreline, lineDir);
        if (snap.distance <= SNAP_DISTANCE_MM) {
          candidates.push({ dx: snap.dx, dy: snap.dy, distance: snap.distance, guide: { kind: 'centreline', ...span } });
        }
      }
    }
  }
  if (extraPoint && centreline) {
    const span = centrelineSpan(centreline);
    const lineDir = unit(span.a, span.b);
    if (lineDir) {
      const snap = offsetToLine(extraPoint, centreline, lineDir);
      if (snap.distance <= SNAP_DISTANCE_MM) {
        candidates.push({ dx: snap.dx, dy: snap.dy, distance: snap.distance, guide: { kind: 'centreline', ...span } });
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.find(candidate => {
    if (candidate.distance < 1e-9) return false;
    if (!ignore) return true;
    const cross = ignore.dx * candidate.dy - ignore.dy * candidate.dx;
    const ignoreLen = Math.hypot(ignore.dx, ignore.dy);
    const nextLen = Math.hypot(candidate.dx, candidate.dy);
    return Math.abs(cross) > 1e-6 * Math.max(1, ignoreLen) * Math.max(1, nextLen);
  });
}
