import { venueGeometrySchema, type VenueGeometry, type Wall } from './layout.js';
import {
  AUDIENCE_FLOOR_ID, axisAlignedPlatformOutline, DIN_STAIR_RISER_MM, orientedPlatformBox, reassignVenueSupports, type Platform, type StairUnit,
} from './levels.js';
import type { OverheadBox } from './overhead.js';
import type { Placeholder } from './placeholders.js';
import type { PlanPoint } from './venue.js';
import { snapStageDeckElevation, snapStageDeckResizeDelta, snapStageDeckSize } from './stageDeck.js';

export type Vec3 = { x: number; y: number; z: number };
export type LocalFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export type OpeningEdge = 'left' | 'right' | 'top' | 'bottom';

export type PushPullHandle =
  | { kind: 'wall' | 'platform' | 'overhead' | 'placeholder' | 'stair'; id: string; face: LocalFace }
  | { kind: 'wallOpening'; id: string; openingId: string; edge: OpeningEdge; face?: LocalFace };

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
  if (handle.kind === 'wallOpening') return handle;
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

function orientedBox(platform: Platform) {
  return orientedPlatformBox(platform.outline);
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

function clampWallOpenings(wall: Wall): Wall {
  if (!wall.openings?.length) return wall;
  const openings = wall.openings.flatMap(opening => {
    const left = Math.max(0, Math.min(opening.left, wall.width - 1));
    const sill = Math.max(0, Math.min(opening.sill, wall.height - 1));
    // Flush left/right ends are allowed (left === 0, left + width === wall.width).
    let width = Math.max(1, Math.min(opening.width, wall.width - left));
    let height = Math.max(1, Math.min(opening.height, wall.height - sill));
    // Keep at least 1 mm of solid so the panel cannot vanish entirely.
    if (width >= wall.width && height >= wall.height) {
      height = Math.max(1, wall.height - 1);
    }
    if (left + width > wall.width || sill + height > wall.height) return [];
    return [{ ...opening, left, sill, width, height }];
  });
  if (!openings.length) {
    const { openings: _removed, ...rest } = wall;
    return rest;
  }
  return { ...wall, openings };
}

function resizeWall(wall: Wall, face: LocalFace, delta: number): Wall {
  const axes = planAxes(wall.rotation);
  if (face === 'py' || face === 'ny') {
    // Floor-anchored height: only the top face grows; bottom stays on the supporting surface.
    if (face === 'ny') return wall;
    return clampWallOpenings({ ...wall, height: clampDim(wall.height + delta) });
  }
  if (face === 'px' || face === 'nx') {
    const sign: 1 | -1 = face === 'px' ? 1 : -1;
    const next = growCentered(wall.width, 0, delta, sign);
    const centre = shiftPlan(wall, axes.width, sign * delta / 2);
    return clampWallOpenings({ ...wall, width: clampDim(next.size), x: centre.x, y: centre.y });
  }
  const sign: 1 | -1 = face === 'pz' ? 1 : -1;
  const next = growCentered(wall.thickness, 0, delta, sign);
  const centre = shiftPlan(wall, axes.depth, sign * delta / 2);
  return clampWallOpenings({ ...wall, thickness: clampDim(next.size), x: centre.x, y: centre.y });
}

/** Push/pull an opening edge: positive delta grows the cutout outward into the wall. */
function resizeWallOpening(wall: Wall, openingId: string, edge: OpeningEdge, delta: number): Wall {
  if (!wall.openings?.length) return wall;
  const openings = wall.openings.map(opening => {
    if (opening.id !== openingId) return opening;
    if (edge === 'left') {
      const left = Math.max(0, opening.left - delta);
      const width = opening.width + (opening.left - left);
      return { ...opening, left, width: Math.max(1, width) };
    }
    if (edge === 'right') {
      return { ...opening, width: Math.max(1, opening.width + delta) };
    }
    if (edge === 'bottom') {
      const sill = Math.max(0, opening.sill - delta);
      const height = opening.height + (opening.sill - sill);
      return { ...opening, sill, height: Math.max(1, height) };
    }
    return { ...opening, height: Math.max(1, opening.height + delta) };
  });
  return clampWallOpenings({ ...wall, openings });
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
  const box = orientedBox(platform);
  const axes = planAxes(box.rotation);
  const stageDeck = platform.style === 'stageDeck';
  if (face === 'px' || face === 'nx') {
    const sign: 1 | -1 = face === 'px' ? 1 : -1;
    // Cover the pointed/target size: grow to the next 0,5 m step, shrink to the previous.
    const width = stageDeck
      ? box.width + snapStageDeckResizeDelta(box.width, delta)
      : clampDim(box.width + delta);
    if (width === box.width) return platform;
    const centre = shiftPlan({ x: box.x, y: box.y }, axes.width, sign * (width - box.width) / 2);
    return {
      ...platform,
      outline: axisAlignedPlatformOutline(centre.x, centre.y, width, stageDeck ? snapStageDeckSize(width, box.depth).depth : clampDim(box.depth), box.rotation),
    };
  }
  const sign: 1 | -1 = face === 'pz' ? 1 : -1;
  const depth = stageDeck
    ? box.depth + snapStageDeckResizeDelta(box.depth, delta)
    : clampDim(box.depth + delta);
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
      case 'wallOpening':
        return {
          ...venue,
          walls: venue.walls?.map(item => item.id === resolved.id
            ? resizeWallOpening(item, resolved.openingId, resolved.edge, delta)
            : item),
        };
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
    case 'wall':
    case 'wallOpening':
      return venue.walls?.find(item => item.id === handle.id)?.rotation ?? 0;
    case 'overhead': return venue.overheadBoxes?.find(item => item.id === handle.id)?.rotation ?? 0;
    case 'placeholder': return venue.placeholders?.find(item => item.id === handle.id)?.rotation ?? 0;
    case 'stair': return venue.stairs?.find(item => item.id === handle.id)?.rotation ?? 0;
    case 'platform': {
      const platform = venue.platforms?.find(item => item.id === handle.id);
      return platform ? outlinePlanRotation(platform.outline) : 0;
    }
  }
}

/** Millimetre delta along the push/pull axis that places the dragged face through `hitPoint`. */
export function inferenceDeltaMm(origin: Vec3, axisNormal: Vec3, hitPoint: Vec3): number {
  return (
    (hitPoint.x - origin.x) * axisNormal.x
    + (hitPoint.y - origin.y) * axisNormal.y
    + (hitPoint.z - origin.z) * axisNormal.z
  ) * 1000;
}

/**
 * SketchUp-style inference only locks to faces roughly parallel to the dragged face.
 * Horizontal tops / angled hits under the cursor must not project onto a side-face drag
 * (that collapses Bühnenelemente into thin strips).
 */
export function inferenceFaceAligned(axisNormal: Vec3, faceNormal: Vec3, minAbsDot = 0.85): boolean {
  const dot = axisNormal.x * faceNormal.x + axisNormal.y * faceNormal.y + axisNormal.z * faceNormal.z;
  return Math.abs(dot) >= minAbsDot;
}

/** Current plan size along the dragged stage-deck face, or undefined when cover-snap does not apply. */
export function stageDeckDragAxisMm(venue: VenueGeometry, handle: PushPullHandle): number | undefined {
  if (handle.kind !== 'platform' || handle.face === 'py' || handle.face === 'ny') return undefined;
  const platform = venue.platforms?.find(item => item.id === handle.id);
  if (!platform || platform.style !== 'stageDeck') return undefined;
  const box = orientedBox(platform);
  return handle.face === 'px' || handle.face === 'nx' ? box.width : box.depth;
}

/**
 * Prefer SketchUp-style inference (flush to pointed geometry) over the grid when available.
 * Bühnenelement cover-snaps the target onto the 0,5 m module grid so the highlight matches
 * the committed outline. Alt / snap-off keeps the free pointer delta.
 */
export function resolveDragDeltaMm(
  freeDeltaMm: number,
  inferenceMm: number | undefined,
  opts: { snapEnabled: boolean; bypass: boolean; gridMm?: number; stageDeckCurrentMm?: number },
): { deltaMm: number; inferred: boolean } {
  if (opts.bypass || !opts.snapEnabled) return { deltaMm: freeDeltaMm, inferred: false };
  const inferred = inferenceMm !== undefined && Number.isFinite(inferenceMm);
  const target = inferred ? inferenceMm! : freeDeltaMm;
  if (opts.stageDeckCurrentMm !== undefined) {
    return { deltaMm: snapStageDeckResizeDelta(opts.stageDeckCurrentMm, target), inferred };
  }
  if (inferred) return { deltaMm: inferenceMm!, inferred: true };
  const grid = opts.gridMm ?? 5;
  return { deltaMm: Math.round(freeDeltaMm / grid) * grid, inferred: false };
}
