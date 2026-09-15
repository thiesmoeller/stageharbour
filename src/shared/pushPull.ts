import { venueGeometrySchema, type VenueGeometry, type Wall } from './layout.js';
import { reassignVenueSupports, type Platform, type StairUnit } from './levels.js';
import type { OverheadBox } from './overhead.js';
import type { Placeholder } from './placeholders.js';

export type Vec3 = { x: number; y: number; z: number };
export type LocalFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

export type PushPullHandle = {
  kind: 'wall' | 'platform' | 'overhead' | 'placeholder' | 'stair';
  id: string;
  face: LocalFace;
};

/** Grow size while keeping the opposite face fixed; faceSign is +1 for the +axis face. */
export function growCentered(size: number, center: number, deltaOutward: number, faceSign: 1 | -1) {
  return { size: size + deltaOutward, center: center + faceSign * deltaOutward / 2 };
}

export function classifyLocalFace(local: Vec3): LocalFace {
  const ax = Math.abs(local.x), ay = Math.abs(local.y), az = Math.abs(local.z);
  if (ay >= ax && ay >= az) return local.y >= 0 ? 'py' : 'ny';
  if (ax >= az) return local.x >= 0 ? 'px' : 'nx';
  return local.z >= 0 ? 'pz' : 'nz';
}

/**
 * Convert a world-space face normal into the object's local box axes.
 * planRotationDeg is the theatre plan yaw; mirroredX undoes the audience-left mirror.
 */
export function localNormalFromWorld(world: Vec3, planRotationDeg: number, mirroredX: boolean): Vec3 {
  const wx = mirroredX ? -world.x : world.x;
  const angle = -planRotationDeg * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return {
    x: wx * cos + world.z * sin,
    y: world.y,
    z: -wx * sin + world.z * cos,
  };
}

export function resolvePushPullFace(handle: PushPullHandle): PushPullHandle | undefined {
  if (handle.kind === 'platform' && handle.face !== 'py') return undefined;
  return handle;
}

function clampDim(value: number) {
  return Math.min(100000, Math.max(1, value));
}

function planAxes(rotationDeg: number) {
  const angle = rotationDeg * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return {
    width: { x: cos, y: sin },
    depth: { x: -sin, y: cos },
  };
}

function shiftPlan(point: { x: number; y: number }, axis: { x: number; y: number }, amount: number) {
  return { x: point.x + axis.x * amount, y: point.y + axis.y * amount };
}

function resizeWall(wall: Wall, face: LocalFace, delta: number): Wall {
  const axes = planAxes(wall.rotation);
  if (face === 'py' || face === 'ny') {
    // Floor-anchored height: only the top face grows; bottom stays on the supporting surface.
    if (face === 'ny') return wall;
    return { ...wall, height: clampDim(wall.height + delta) };
  }
  if (face === 'px' || face === 'nx') {
    const sign: 1 | -1 = face === 'px' ? 1 : -1;
    const next = growCentered(wall.width, 0, delta, sign);
    const centre = shiftPlan(wall, axes.width, sign * delta / 2);
    return { ...wall, width: clampDim(next.size), x: centre.x, y: centre.y };
  }
  const sign: 1 | -1 = face === 'pz' ? 1 : -1;
  const next = growCentered(wall.thickness, 0, delta, sign);
  const centre = shiftPlan(wall, axes.depth, sign * delta / 2);
  return { ...wall, thickness: clampDim(next.size), x: centre.x, y: centre.y };
}

function resizeOverhead(box: OverheadBox, face: LocalFace, delta: number): OverheadBox {
  const axes = planAxes(box.rotation);
  if (face === 'py') return { ...box, thickness: clampDim(box.thickness + delta) };
  if (face === 'ny') {
    const thickness = clampDim(box.thickness + delta);
    const bottomHeight = clampDim(box.bottomHeight - delta);
    return { ...box, thickness, bottomHeight };
  }
  if (face === 'px' || face === 'nx') {
    const sign: 1 | -1 = face === 'px' ? 1 : -1;
    const next = growCentered(box.length, 0, delta, sign);
    const centre = shiftPlan(box, axes.width, sign * delta / 2);
    return { ...box, length: clampDim(next.size), x: centre.x, y: centre.y };
  }
  const sign: 1 | -1 = face === 'pz' ? 1 : -1;
  const next = growCentered(box.width, 0, delta, sign);
  const centre = shiftPlan(box, axes.depth, sign * delta / 2);
  return { ...box, width: clampDim(next.size), x: centre.x, y: centre.y };
}

function resizePlaceholder(item: Placeholder, face: LocalFace, delta: number): Placeholder {
  const axes = planAxes(item.rotation);
  if (face === 'py') return { ...item, height: clampDim(item.height + delta) };
  if (face === 'ny') return item;
  if (face === 'px' || face === 'nx') {
    const sign: 1 | -1 = face === 'px' ? 1 : -1;
    const centre = shiftPlan(item, axes.width, sign * delta / 2);
    return { ...item, width: clampDim(item.width + delta), x: centre.x, y: centre.y };
  }
  const sign: 1 | -1 = face === 'pz' ? 1 : -1;
  const centre = shiftPlan(item, axes.depth, sign * delta / 2);
  return { ...item, depth: clampDim(item.depth + delta), x: centre.x, y: centre.y };
}

function resizeStair(stair: StairUnit, face: LocalFace, delta: number): StairUnit {
  const axes = planAxes(stair.rotation);
  if (face === 'px' || face === 'nx') {
    const sign: 1 | -1 = face === 'px' ? 1 : -1;
    const centre = shiftPlan(stair, axes.width, sign * delta / 2);
    return { ...stair, width: clampDim(stair.width + delta), x: centre.x, y: centre.y };
  }
  if (face === 'pz' || face === 'nz') {
    const sign: 1 | -1 = face === 'pz' ? 1 : -1;
    const centre = shiftPlan(stair, axes.depth, sign * delta / 2);
    return { ...stair, run: clampDim(stair.run + delta), x: centre.x, y: centre.y };
  }
  return stair;
}

function resizePlatform(platform: Platform, face: LocalFace, delta: number): Platform {
  if (face !== 'py') return platform;
  return { ...platform, elevation: clampDim(platform.elevation + delta) };
}

/** Apply a signed outward millimetre delta along the resolved face. */
export function applyPushPull(venue: VenueGeometry, handle: PushPullHandle, deltaOutwardMm: number): VenueGeometry {
  const resolved = resolvePushPullFace(handle);
  if (!resolved || !Number.isFinite(deltaOutwardMm) || deltaOutwardMm === 0) return venue;
  const delta = Math.round(deltaOutwardMm);
  if (delta === 0) return venue;
  const candidate = (() => {
    switch (resolved.kind) {
      case 'wall':
        return { ...venue, walls: venue.walls?.map(item => item.id === resolved.id ? resizeWall(item, resolved.face, delta) : item) };
      case 'platform':
        return { ...venue, platforms: venue.platforms?.map(item => item.id === resolved.id ? resizePlatform(item, resolved.face, delta) : item) };
      case 'overhead':
        return { ...venue, overheadBoxes: venue.overheadBoxes?.map(item => item.id === resolved.id ? resizeOverhead(item, resolved.face, delta) : item) };
      case 'placeholder':
        return { ...venue, placeholders: venue.placeholders?.map(item => item.id === resolved.id ? resizePlaceholder(item, resolved.face, delta) : item) };
      case 'stair':
        return { ...venue, stairs: venue.stairs?.map(item => item.id === resolved.id ? resizeStair(item, resolved.face, delta) : item) };
    }
  })();
  return venueGeometrySchema.safeParse(candidate).success ? reassignVenueSupports(candidate) : venue;
}

export function planRotationFor(venue: VenueGeometry, handle: PushPullHandle): number {
  switch (handle.kind) {
    case 'wall': return venue.walls?.find(item => item.id === handle.id)?.rotation ?? 0;
    case 'overhead': return venue.overheadBoxes?.find(item => item.id === handle.id)?.rotation ?? 0;
    case 'placeholder': return venue.placeholders?.find(item => item.id === handle.id)?.rotation ?? 0;
    case 'stair': return venue.stairs?.find(item => item.id === handle.id)?.rotation ?? 0;
    case 'platform': return 0;
  }
}
