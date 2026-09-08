import { z } from 'zod';
import { groupOf, groupPivot, membersPivot, transformGroup, transformMembers, type Group, type GroupPose } from './groups.js';
import type { Brace } from './layout.js';
import { polygonsInteriorOverlap } from './overlap.js';

const coordinate = z.number().finite().min(-100000).max(100000);

/** Millimetres. An edge or centre closer than this to a wall edge or the centreline snaps onto it. Independent of screen zoom. */
export const SNAP_DISTANCE_MM = 100;
/** Degrees. Rotation closer than this to a common layout angle snaps onto that angle. */
export const SNAP_ANGLE_DEG = 2.5;
/** Padding beyond participating edges when drawing a wall-edge alignment guide. */
export const GUIDE_PADDING_MM = 2000;
/** Fractions along the front edge for point snaps (1:3, 1:2, 2:3 plus ends). Short sides use ends only. */
export const SNAP_EDGE_FRACTIONS = [0, 1 / 3, 1 / 2, 2 / 3, 1] as const;
/** Common layout-design angles in degrees. Mirroring is out of scope. */
export const COMMON_LAYOUT_ANGLES_DEG = Array.from({ length: 49 }, (_, i) => -360 + i * 15);
export const SNAP_NOTICE = `Einrasttoleranz ${SNAP_DISTANCE_MM} mm · Vorderseite bei ⅓·½·⅔, Stirnseiten an Enden, Mittellinie und 15°-Winkel. Alt umgeht. Keine Objektüberschneidungen.`;

export const stageCentrelineSchema = z.strictObject({
  x: coordinate, y: coordinate,
  rotation: z.number().finite().min(-360).max(360),
});
export type StageCentreline = z.infer<typeof stageCentrelineSchema>;
export const centrelineSchema = stageCentrelineSchema;

export function defaultCentreline(venue: { width: number; depth: number }): StageCentreline {
  return { x: venue.width / 2, y: venue.depth / 2, rotation: 90 };
}

export type SnapGuide = {
  kind: 'wall-edge' | 'centreline' | 'wall-anchor';
  a: { x: number; y: number }; b: { x: number; y: number };
};
export type SnapOptions = { bypass?: boolean; snapAngles?: boolean };
export type SnapWall = { id: string; x: number; y: number; rotation: number; width: number; thickness: number };
type SnapLayout = {
  walls: SnapWall[];
  braces?: { id: string; x: number; y: number; rotation: number }[];
  stairs?: { id: string; x: number; y: number; rotation: number }[];
  groups?: Group[];
};
type PlanPoint = { x: number; y: number };
type Edge = { a: PlanPoint; b: PlanPoint };

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
  return bestDelta <= SNAP_ANGLE_DEG ? normalizeDegrees(best === -360 || best === 360 ? 0 : best) : rotation;
}

function normalizeDegrees(value: number) {
  let result = value % 360;
  if (result > 180) result -= 360;
  if (result <= -180) result += 360;
  return Object.is(result, -0) ? 0 : result;
}

/** Plan degrees from centre to point: 0° = +x (audience-right), 90° = +y (away from audience). */
export function planRotationAt(centre: { x: number; y: number }, point: { x: number; y: number }) {
  return Math.atan2(point.y - centre.y, point.x - centre.x) * 180 / Math.PI;
}

export function rotateToward(
  centre: { x: number; y: number },
  point: { x: number; y: number },
  options?: { bypass?: boolean },
) {
  const raw = planRotationAt(centre, point);
  if (options?.bypass) return { rotation: raw, angleSnapped: false };
  const rotation = snapRotation(raw);
  return { rotation, angleSnapped: Math.abs(wrapDelta(rotation - raw)) > 1e-9 };
}

/** Handle beyond the object’s local +x end so drag rotates around the centre. */
export function rotationHandlePoint(item: { x: number; y: number; rotation: number; width: number }, reachBeyond = 350) {
  const angle = item.rotation * Math.PI / 180;
  const reach = item.width / 2 + reachBeyond;
  return { x: item.x + Math.cos(angle) * reach, y: item.y + Math.sin(angle) * reach };
}

export function snapStatusText(input: {
  guides?: SnapGuide[];
  rotation?: number;
  angleSnapped?: boolean;
}) {
  const parts: string[] = [];
  if (input.angleSnapped && input.rotation !== undefined) {
    const rounded = Math.round(input.rotation * 10) / 10;
    parts.push(`${Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',')}°`);
  }
  const kinds = new Set((input.guides ?? []).map(guide => guide.kind));
  if (kinds.has('wall-edge')) parts.push('Wandkante');
  if (kinds.has('wall-anchor')) parts.push('Teilung ⅓·½·⅔');
  if (kinds.has('centreline')) parts.push('Mittellinie');
  if (!parts.length) return undefined;
  return `Eingerastet · ${parts.join(' · ')}`;
}

export function snapWallPose(wall: SnapWall, others: SnapWall[], centreline: StageCentreline | undefined, options?: SnapOptions) {
  if (options?.bypass) return { x: wall.x, y: wall.y, rotation: wall.rotation, guides: [] as SnapGuide[] };
  const rotation = options?.snapAngles ? snapRotation(wall.rotation) : wall.rotation;
  const posed = { ...wall, rotation };
  const { dx, dy, guides } = translationFor([posed], others.filter(item => item.id !== wall.id), centreline);
  return { x: clean(posed.x + dx), y: clean(posed.y + dy), rotation, guides };
}

export function braceAsSnapWall(brace: Pick<Brace, 'id' | 'x' | 'y' | 'rotation' | 'footprintWidth' | 'footprintDepth'>): SnapWall {
  return { id: brace.id, x: brace.x, y: brace.y, rotation: brace.rotation, width: brace.footprintWidth, thickness: brace.footprintDepth };
}

export function snapBracePose(
  brace: Pick<Brace, 'id' | 'x' | 'y' | 'rotation' | 'footprintWidth' | 'footprintDepth'>,
  walls: SnapWall[],
  centreline: StageCentreline | undefined,
  options?: SnapOptions,
) {
  return snapWallPose(braceAsSnapWall(brace), walls, centreline, options);
}

/**
 * Rotate so the tall (−Y) face is parallel to the nearest wall long edge, then
 * translate that face onto the edge when within SNAP_DISTANCE_MM (or always when force).
 */
export function alignBraceToNearestWall(
  brace: Brace,
  walls: SnapWall[],
  options?: { force?: boolean; maxDistance?: number },
): Brace | undefined {
  if (!walls.length) return;
  const maxDistance = options?.maxDistance ?? (options?.force ? 1e9 : SNAP_DISTANCE_MM);
  let best: { wall: SnapWall; edge: Edge; distance: number; wallAngle: number } | undefined;
  for (const wall of walls) {
    for (const edge of edges(wall)) {
      const length = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
      if (length < wall.width * 0.5) continue; // prefer long sides
      const dir = unit(edge.a, edge.b);
      if (!dir) continue;
      const snap = offsetToLine({ x: brace.x, y: brace.y }, edge.a, dir);
      if (snap.distance > maxDistance) continue;
      if (!best || snap.distance < best.distance) {
        best = { wall, edge, distance: snap.distance, wallAngle: Math.atan2(dir.y, dir.x) * 180 / Math.PI };
      }
    }
  }
  if (!best) return;
  const candidates = [normalizeDegrees(best.wallAngle), normalizeDegrees(best.wallAngle + 180)];
  let rotation = candidates[0]!;
  let bestFace = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const posed = { ...brace, rotation: candidate };
    const face = tallFaceMidpoint(posed);
    const dir = unit(best.edge.a, best.edge.b);
    if (!dir) continue;
    const dist = offsetToLine(face, best.edge.a, dir).distance;
    if (dist < bestFace) { bestFace = dist; rotation = candidate; }
  }
  const aligned = { ...brace, rotation };
  const face = tallFaceMidpoint(aligned);
  const dir = unit(best.edge.a, best.edge.b);
  if (!dir) return aligned;
  const snap = offsetToLine(face, best.edge.a, dir);
  if (!options?.force && snap.distance > SNAP_DISTANCE_MM) return aligned;
  return {
    ...aligned,
    x: clean(aligned.x + snap.dx),
    y: clean(aligned.y + snap.dy),
  };
}

export function tallFaceMidpoint(brace: Pick<Brace, 'x' | 'y' | 'rotation' | 'footprintWidth' | 'footprintDepth'>) {
  const angle = brace.rotation * Math.PI / 180;
  const localY = -brace.footprintDepth / 2;
  return {
    x: brace.x - localY * Math.sin(angle),
    y: brace.y + localY * Math.cos(angle),
  };
}

/** Keep the tall-face midpoint on `hinge` while changing rotation (wall/Stütze contact axis). */
export function rotateBraceOnContact(
  brace: Brace,
  hinge: { x: number; y: number },
  rotation: number,
): Brace {
  const next = { ...brace, rotation };
  const face = tallFaceMidpoint(next);
  return { ...next, x: clean(next.x + hinge.x - face.x), y: clean(next.y + hinge.y - face.y) };
}

/** When the tall face is within snap distance of a wall edge, return that contact point for hinge rotation. */
export function braceContactHinge(brace: Brace, walls: SnapWall[]): { hinge: { x: number; y: number }; edge: { a: { x: number; y: number }; b: { x: number; y: number } } } | undefined {
  const face = tallFaceMidpoint(brace);
  let best: { hinge: { x: number; y: number }; edge: Edge; distance: number } | undefined;
  for (const wall of walls) {
    for (const edge of edges(wall)) {
      const length = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
      if (length < wall.width * 0.5) continue;
      const dir = unit(edge.a, edge.b);
      if (!dir) continue;
      const snap = offsetToLine(face, edge.a, dir);
      if (snap.distance > SNAP_DISTANCE_MM) continue;
      const hinge = { x: face.x + snap.dx, y: face.y + snap.dy };
      if (!best || snap.distance < best.distance) best = { hinge, edge, distance: snap.distance };
    }
  }
  return best ? { hinge: best.hinge, edge: best.edge } : undefined;
}

export function snapGroupPose(layout: SnapLayout, groupId: string, pose: GroupPose, centreline: StageCentreline | undefined, options?: SnapOptions) {
  const group = groupOf(layout, groupId);
  if (options?.bypass || !group) return { pose, guides: [] as SnapGuide[] };
  return snapMembersPose(layout, group.members, pose, group.rotation, centreline, options);
}

export function snapMembersPose(
  layout: SnapLayout, members: { kind: 'wall' | 'brace' | 'stair' | 'placeholder'; id: string }[],
  pose: GroupPose, baseRotation: number, centreline: StageCentreline | undefined, options?: SnapOptions,
) {
  if (options?.bypass || members.length === 0) return { pose, guides: [] as SnapGuide[] };
  const rotation = options?.snapAngles ? snapRotation(pose.rotation) : pose.rotation;
  const proposed = { ...pose, rotation };
  const moved = transformMembers(layout, members, proposed, baseRotation);
  const memberIds = new Set(members.filter(member => member.kind === 'wall').map(member => member.id));
  const moving = moved.walls.filter(wall => memberIds.has(wall.id));
  const others = layout.walls.filter(wall => !memberIds.has(wall.id));
  const { dx, dy, guides } = translationFor(moving, others, centreline, membersPivot(moved, members));
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

function unit(a: PlanPoint, b: PlanPoint) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 0)) return;
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

function parallel(a: PlanPoint, b: PlanPoint) {
  return Math.abs(a.x * b.x + a.y * b.y) >= Math.cos(SNAP_ANGLE_DEG * Math.PI / 180);
}

function offsetToLine(point: PlanPoint, origin: PlanPoint, dir: PlanPoint) {
  const normal = { x: -dir.y, y: dir.x };
  const signed = (point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y;
  return { dx: -signed * normal.x, dy: -signed * normal.y, distance: Math.abs(signed), normal };
}

/** Long dashed guide spanning both edges (PowerPoint-style), not only the short target segment. */
function wallEdgeGuide(moving: Edge, target: Edge): SnapGuide {
  const dir = unit(target.a, target.b) ?? unit(moving.a, moving.b);
  if (!dir) return { kind: 'wall-edge', a: target.a, b: target.b };
  const origin = target.a;
  const projections = [moving.a, moving.b, target.a, target.b].map(point =>
    (point.x - origin.x) * dir.x + (point.y - origin.y) * dir.y);
  const minT = Math.min(...projections) - GUIDE_PADDING_MM;
  const maxT = Math.max(...projections) + GUIDE_PADDING_MM;
  return {
    kind: 'wall-edge',
    a: { x: origin.x + dir.x * minT, y: origin.y + dir.y * minT },
    b: { x: origin.x + dir.x * maxT, y: origin.y + dir.y * maxT },
  };
}

type Candidate = {
  dx: number; dy: number; distance: number; guide: SnapGuide;
  movingEdge: Edge; targetEdge?: Edge; normal: PlanPoint; full?: boolean;
};

function lerp(a: PlanPoint, b: PlanPoint, t: number): PlanPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Front (V): ends + ⅓·½·⅔. Short sides: ends only (thickness is too short for fractions).
 * Back (R) is omitted so walls do not snap onto the reverse face.
 */
export function wallFaceAnchors(wall: SnapWall): PlanPoint[] {
  const [c0, c1, c2, c3] = corners(wall);
  if (!c0 || !c1 || !c2 || !c3) return [];
  const points: PlanPoint[] = [];
  for (const t of SNAP_EDGE_FRACTIONS) points.push(lerp(c0, c1, t)); // front
  for (const t of [0, 1] as const) {
    points.push(lerp(c1, c2, t)); // right short edge
    points.push(lerp(c3, c0, t)); // left short edge
  }
  return points;
}

function anchorGuide(point: PlanPoint): SnapGuide {
  return { kind: 'wall-anchor', a: { x: point.x - 120, y: point.y }, b: { x: point.x + 120, y: point.y } };
}

function translationFor(moving: SnapWall[], others: SnapWall[], centreline: StageCentreline | undefined, extraPoint?: PlanPoint) {
  const first = bestCandidate(moving, others, centreline, extraPoint);
  if (first?.full) {
    const finalPose = moving.map(wall => ({ ...wall, x: wall.x + first.dx, y: wall.y + first.dy }));
    return { dx: first.dx, dy: first.dy, guides: alignmentGuides(finalPose, others, centreline, first.guide) };
  }
  const shifted = first
    ? moving.map(wall => ({ ...wall, x: wall.x + first.dx, y: wall.y + first.dy }))
    : moving;
  const shiftedPoint = first && extraPoint ? { x: extraPoint.x + first.dx, y: extraPoint.y + first.dy } : extraPoint;
  const second = first ? bestCandidate(shifted, others, centreline, shiftedPoint, first) : undefined;
  const dx = (first?.dx ?? 0) + (second?.dx ?? 0);
  const dy = (first?.dy ?? 0) + (second?.dy ?? 0);
  const finalPose = moving.map(wall => ({ ...wall, x: wall.x + dx, y: wall.y + dy }));
  const seed = [first?.guide, second?.guide].filter((guide): guide is SnapGuide => !!guide);
  return { dx, dy, guides: alignmentGuides(finalPose, others, centreline, ...seed) };
}

/** Guides for edges/anchors already within snap distance (including perfect alignment). */
function alignmentGuides(moving: SnapWall[], others: SnapWall[], centreline: StageCentreline | undefined, ...seed: SnapGuide[]): SnapGuide[] {
  const guides: SnapGuide[] = [...seed];
  const seen = new Set<string>();
  function add(guide: SnapGuide) {
    const key = `${guide.kind}:${guide.a.x}:${guide.a.y}:${guide.b.x}:${guide.b.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    guides.push(guide);
  }
  for (const guide of seed) add(guide);
  for (const wall of moving) {
    for (const edge of edges(wall)) {
      const dir = unit(edge.a, edge.b);
      if (!dir) continue;
      for (const other of others) {
        for (const target of edges(other)) {
          const targetDir = unit(target.a, target.b);
          if (!targetDir || !parallel(dir, targetDir)) continue;
          if (offsetToLine(edge.a, target.a, targetDir).distance <= SNAP_DISTANCE_MM) {
            add(wallEdgeGuide(edge, target));
          }
        }
      }
      if (centreline) {
        const span = centrelineSpan(centreline);
        const lineDir = unit(span.a, span.b);
        if (lineDir && parallel(dir, lineDir) && offsetToLine(edge.a, centreline, lineDir).distance <= SNAP_DISTANCE_MM) {
          add({ kind: 'centreline', ...span });
        }
      }
    }
    for (const movingPoint of wallFaceAnchors(wall)) {
      for (const other of others) {
        for (const target of wallFaceAnchors(other)) {
          if (Math.hypot(target.x - movingPoint.x, target.y - movingPoint.y) <= SNAP_DISTANCE_MM) {
            add(anchorGuide(target));
            add({ kind: 'wall-anchor', a: { x: target.x, y: target.y - 120 }, b: { x: target.x, y: target.y + 120 } });
          }
        }
      }
    }
    if (centreline) {
      const span = centrelineSpan(centreline);
      const lineDir = unit(span.a, span.b);
      if (lineDir && offsetToLine({ x: wall.x, y: wall.y }, centreline, lineDir).distance <= SNAP_DISTANCE_MM) {
        add({ kind: 'centreline', ...span });
      }
    }
  }
  return guides;
}

function bestCandidate(moving: SnapWall[], others: SnapWall[], centreline: StageCentreline | undefined, extraPoint?: PlanPoint, ignore?: Candidate): Candidate | undefined {
  const candidates: Candidate[] = [];
  for (const wall of moving) {
    for (const movingPoint of wallFaceAnchors(wall)) {
      for (const other of others) {
        for (const target of wallFaceAnchors(other)) {
          const dx = target.x - movingPoint.x, dy = target.y - movingPoint.y;
          const distance = Math.hypot(dx, dy);
          if (distance > SNAP_DISTANCE_MM || distance < 1e-9) continue;
          const normal = distance > 0 ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 };
          candidates.push({
            dx, dy, distance, normal, full: true,
            guide: anchorGuide(target),
            movingEdge: { a: movingPoint, b: movingPoint },
          });
        }
      }
    }
    for (const edge of edges(wall)) {
      const dir = unit(edge.a, edge.b);
      if (!dir) continue;
      for (const other of others) {
        for (const target of edges(other)) {
          const targetDir = unit(target.a, target.b);
          if (!targetDir || !parallel(dir, targetDir)) continue;
          const snap = offsetToLine(edge.a, target.a, targetDir);
          if (snap.distance <= SNAP_DISTANCE_MM) {
            candidates.push({
              dx: snap.dx, dy: snap.dy, distance: snap.distance, normal: snap.normal,
              guide: wallEdgeGuide(edge, target), movingEdge: edge, targetEdge: target,
            });
          }
        }
      }
      if (centreline) {
        const span = centrelineSpan(centreline);
        const lineDir = unit(span.a, span.b);
        if (lineDir && parallel(dir, lineDir)) {
          const snap = offsetToLine(edge.a, centreline, lineDir);
          if (snap.distance <= SNAP_DISTANCE_MM) {
            candidates.push({
              dx: snap.dx, dy: snap.dy, distance: snap.distance, normal: snap.normal,
              guide: { kind: 'centreline', ...span }, movingEdge: edge,
            });
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
          candidates.push({
            dx: snap.dx, dy: snap.dy, distance: snap.distance, normal: snap.normal,
            guide: { kind: 'centreline', ...span },
            movingEdge: { a: { x: wall.x, y: wall.y }, b: { x: wall.x, y: wall.y } },
          });
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
        candidates.push({
          dx: snap.dx, dy: snap.dy, distance: snap.distance, normal: snap.normal,
          guide: { kind: 'centreline', ...span },
          movingEdge: { a: extraPoint, b: extraPoint },
        });
      }
    }
  }
  const lockedNormals = candidates.filter(item => item.distance < 1e-9).map(item => item.normal);
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.find(candidate => {
    if (candidate.distance < 1e-9) return false;
    if (lockedNormals.some(normal => Math.abs(normal.x * candidate.normal.x + normal.y * candidate.normal.y) > 0.99)) return false;
    if (poseOverlapsOthers(moving, others, candidate.dx, candidate.dy)) return false;
    if (!ignore) return true;
    if (ignore.full || candidate.full) return false;
    const cross = ignore.dx * candidate.dy - ignore.dy * candidate.dx;
    const ignoreLen = Math.hypot(ignore.dx, ignore.dy);
    const nextLen = Math.hypot(candidate.dx, candidate.dy);
    return Math.abs(cross) > 1e-6 * Math.max(1, ignoreLen) * Math.max(1, nextLen);
  });
}

/** Snap must not propose a pose that the placement overlap check would reject. */
function poseOverlapsOthers(moving: SnapWall[], others: SnapWall[], dx: number, dy: number) {
  for (const wall of moving) {
    const shifted = corners({ ...wall, x: wall.x + dx, y: wall.y + dy });
    for (const other of others) {
      if (polygonsInteriorOverlap(shifted, corners(other))) return true;
    }
  }
  return false;
}
