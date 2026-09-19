import { venueGeometrySchema, type VenueGeometry, type Wall } from './layout.js';
import {
  AUDIENCE_FLOOR_ID, axisAlignedPlatformOutline, DIN_STAIR_RISER_MM, platformCentroid, reassignVenueSupports, type Platform, type StairUnit,
} from './levels.js';
import type { OverheadBox } from './overhead.js';
import type { Placeholder } from './placeholders.js';
import type { PlanPoint } from './venue.js';
import { snapStageDeckElevation, snapStageDeckSize, STAGE_DECK_STEP_MM } from './stageDeck.js';

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
 * Meshes use rotationY = -planRotation (see wallSolid); undo that yaw after un-mirroring.
 */
export function localNormalFromWorld(world: Vec3, planRotationDeg: number, mirroredX: boolean): Vec3 {
  const wx = mirroredX ? -world.x : world.x;
  const angle = planRotationDeg * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return {
    x: wx * cos + world.z * sin,
    y: world.y,
    z: -wx * sin + world.z * cos,
  };
}

export function resolvePushPullFace(handle: PushPullHandle): PushPullHandle | undefined {
  // Floor-anchored solids keep the bottom face fixed.
  if ((handle.kind === 'platform' || handle.kind === 'wall' || handle.kind === 'placeholder') && handle.face === 'ny') {
    return undefined;
  }
  return handle;
}

function outlinePlanRotation(outline: readonly PlanPoint[]) {
  const a = outline[0], b = outline[1];
  if (!a || !b) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}

/** Oriented width/depth from the first two edges of a rectangular podium outline. */
function orientedPlatformBox(platform: Platform) {
  const a = platform.outline[0], b = platform.outline[1], c = platform.outline[2];
  const centre = platformCentroid(platform.outline);
  if (!a || !b || !c) {
    return { x: centre.x, y: centre.y, width: 1, depth: 1, rotation: 0 };
  }
  return {
    x: centre.x, y: centre.y,
    width: Math.hypot(b.x - a.x, b.y - a.y),
    depth: Math.hypot(c.x - b.x, c.y - b.y),
    rotation: outlinePlanRotation(platform.outline),
  };
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

/** Vertical stair pull raises/lowers the upper podium; step count follows DIN ~16 cm risers. */
function applyStairPushPull(venue: VenueGeometry, stair: StairUnit, face: LocalFace, delta: number): VenueGeometry {
  if (face === 'px' || face === 'nx' || face === 'pz' || face === 'nz') {
    return {
      ...venue,
      stairs: venue.stairs?.map(item => item.id === stair.id ? resizeStair(item, face, delta) : item),
    };
  }
  if (face !== 'py' && face !== 'ny') return venue;
  const sign: 1 | -1 = face === 'py' ? 1 : -1;
  return {
    ...venue,
    platforms: venue.platforms?.map(platform => platform.id === stair.upperSurfaceId
      ? { ...platform, elevation: clampDim(platform.elevation + sign * delta) }
      : platform),
    stairs: venue.stairs?.map(item => item.id === stair.id
      ? { ...item, riserHeight: DIN_STAIR_RISER_MM }
      : item),
  };
}

function resizePlatform(platform: Platform, face: LocalFace, delta: number, supportElevation = 0): Platform {
  if (face === 'ny') return platform;
  if (face === 'py') {
    if (platform.style === 'stageDeck') {
      const rise = snapStageDeckElevation(platform.elevation - supportElevation + delta);
      const elevation = Math.min(100000, Math.max(1, supportElevation + rise));
      return elevation === platform.elevation ? platform : { ...platform, elevation };
    }
    const elevation = clampDim(platform.elevation + delta);
    return elevation === platform.elevation ? platform : { ...platform, elevation };
  }
  const box = orientedPlatformBox(platform);
  const axes = planAxes(box.rotation);
  const stageDeck = platform.style === 'stageDeck';
  if (face === 'px' || face === 'nx') {
    const sign: 1 | -1 = face === 'px' ? 1 : -1;
    const raw = box.width + delta;
    const width = stageDeck
      ? Math.max(STAGE_DECK_STEP_MM, Math.round(raw / STAGE_DECK_STEP_MM) * STAGE_DECK_STEP_MM)
      : clampDim(raw);
    if (width === box.width) return platform;
    const centre = shiftPlan({ x: box.x, y: box.y }, axes.width, sign * (width - box.width) / 2);
    return {
      ...platform,
      outline: axisAlignedPlatformOutline(centre.x, centre.y, width, stageDeck ? snapStageDeckSize(width, box.depth).depth : clampDim(box.depth), box.rotation),
    };
  }
  const sign: 1 | -1 = face === 'pz' ? 1 : -1;
  const raw = box.depth + delta;
  const depth = stageDeck
    ? Math.max(STAGE_DECK_STEP_MM, Math.round(raw / STAGE_DECK_STEP_MM) * STAGE_DECK_STEP_MM)
    : clampDim(raw);
  if (depth === box.depth) return platform;
  const centre = shiftPlan({ x: box.x, y: box.y }, axes.depth, sign * (depth - box.depth) / 2);
  return {
    ...platform,
    outline: axisAlignedPlatformOutline(centre.x, centre.y, stageDeck ? snapStageDeckSize(box.width, depth).width : clampDim(box.width), depth, box.rotation),
  };
}

function applyPlatformPushPull(venue: VenueGeometry, platform: Platform, face: LocalFace, delta: number): VenueGeometry {
  const supportElevation = platform.supportingSurfaceId && platform.supportingSurfaceId !== AUDIENCE_FLOOR_ID
    ? (venue.platforms?.find(item => item.id === platform.supportingSurfaceId)?.elevation ?? 0)
    : 0;
  const next = resizePlatform(platform, face, delta, supportElevation);
  if (next === platform) return venue;
  const platforms = venue.platforms?.map(item => item.id === platform.id ? next : item);
  if (face !== 'py') return { ...venue, platforms };
  // Height change: keep attached stairs on DIN ~16 cm risers so steps are added/removed.
  return {
    ...venue,
    platforms,
    stairs: venue.stairs?.map(stair => stair.upperSurfaceId === platform.id || stair.lowerSurfaceId === platform.id
      ? { ...stair, riserHeight: DIN_STAIR_RISER_MM }
      : stair),
  };
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
      case 'platform': {
        const platform = venue.platforms?.find(item => item.id === resolved.id);
        return platform ? applyPlatformPushPull(venue, platform, resolved.face, delta) : venue;
      }
      case 'overhead':
        return { ...venue, overheadBoxes: venue.overheadBoxes?.map(item => item.id === resolved.id ? resizeOverhead(item, resolved.face, delta) : item) };
      case 'placeholder':
        return { ...venue, placeholders: venue.placeholders?.map(item => item.id === resolved.id ? resizePlaceholder(item, resolved.face, delta) : item) };
      case 'stair': {
        const stair = venue.stairs?.find(item => item.id === resolved.id);
        return stair ? applyStairPushPull(venue, stair, resolved.face, delta) : venue;
      }
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
    case 'platform': {
      const platform = venue.platforms?.find(item => item.id === handle.id);
      return platform ? outlinePlanRotation(platform.outline) : 0;
    }
  }
}
