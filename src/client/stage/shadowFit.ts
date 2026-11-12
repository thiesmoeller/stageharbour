import { boundsCenter, boundsRadius, isUsableBounds, normalize, type StageBounds, type Vec3 } from './cameraFraming.js';
import type { ShadowSpec } from './lightThemes.js';

export type ShadowCameraBox = { left: number; right: number; top: number; bottom: number; near: number; far: number };
export type ShadowFit = {
  /** Light position: the bounds centre moved back along the light direction. */
  position: Vec3;
  target: Vec3;
  camera: ShadowCameraBox;
  mapSize: number;
  normalBias: number;
};

/** Pascal's building-fit constants (viewer components/viewer/lights.js), in metres. */
const MARGIN_SCALE = 1.15;
const MARGIN = 3;
const BACKOFF = 10;
const FALLBACK_RADIUS = 30;
const SMALL_SCENE_RADIUS = 1.5;
const SMALL_SCENE_MAP_SIZE = 2048;

/**
 * Grows `bounds` by where its top corners cast their shadow on the plane y = `groundY`, so a
 * shadow catcher shows the whole shadow of a part under a low light.
 */
export function withShadowFootprint(bounds: StageBounds, direction: Vec3, groundY = bounds.min[1]): StageBounds {
  const [dx, dy, dz] = normalize(direction);
  if (dy <= 0.05) return bounds;
  const drop = (bounds.max[1] - groundY) / dy;
  const shiftX = -dx * drop, shiftZ = -dz * drop;
  return {
    min: [bounds.min[0] + Math.min(0, shiftX), Math.min(bounds.min[1], groundY), bounds.min[2] + Math.min(0, shiftZ)],
    max: [bounds.max[0] + Math.max(0, shiftX), bounds.max[1], bounds.max[2] + Math.max(0, shiftZ)],
  };
}

/**
 * Fits the key light's orthographic shadow camera to the bounding sphere of `bounds`, so shadow
 * texels stay anchored to the stage however the view is zoomed. Without usable bounds the
 * frustum covers a 30 m sphere round the origin, as Pascal does for an empty scene.
 */
export function fitDirectionalShadow(bounds: StageBounds | undefined, direction: Vec3, shadow: ShadowSpec): ShadowFit {
  const usable = isUsableBounds(bounds);
  const center: Vec3 = usable ? boundsCenter(bounds) : [0, 0, 0];
  const radius = usable ? Math.max(boundsRadius(bounds), 0.01) : FALLBACK_RADIUS;
  const size = radius * MARGIN_SCALE + Math.min(MARGIN, radius * 0.25);
  const distance = size + BACKOFF;
  const [dx, dy, dz] = normalize(direction);
  const small = radius < SMALL_SCENE_RADIUS;
  const mapSize = small ? Math.max(shadow.mapSize, SMALL_SCENE_MAP_SIZE) : shadow.mapSize;
  return {
    position: [center[0] + dx * distance, center[1] + dy * distance, center[2] + dz * distance],
    target: center,
    camera: { left: -size, right: size, top: size, bottom: -size, near: BACKOFF, far: distance + radius * MARGIN_SCALE + MARGIN },
    mapSize,
    normalBias: small ? Math.min(shadow.normalBias, 4 * size / mapSize) : shadow.normalBias,
  };
}
