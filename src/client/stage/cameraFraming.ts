/** View-space metres, three.js axes: +Y up; the audience sits towards −Z. */
export type Vec3 = readonly [number, number, number];
export type StageBounds = { min: Vec3; max: Vec3 };
export type Viewport = { width: number; height: number };
export type StageProjection = 'perspective' | 'orthographic';

/** A fully resolved camera: what StageCanvas applies to its default camera and orbit controls. */
export type StageLookCamera = {
  projection: StageProjection;
  position: Vec3;
  target: Vec3;
  up: Vec3;
  /** Vertical field of view in degrees (perspective). */
  fov: number;
  /** Pixels per metre (orthographic). */
  zoom: number;
  near: number;
  far: number;
};

/** R3F vector props take mutable tuples. */
export const vector = (value: Vec3): [number, number, number] => [value[0], value[1], value[2]];

export const DEFAULT_STAGE_BOUNDS: StageBounds = { min: [-1, 0, -1], max: [1, 1, 1] };
/** Front-left-above, the direction of the editor's default orbit view (audience side, raised). */
export const DEFAULT_FRAME_DIRECTION: Vec3 = [0.35, 0.75, -0.55];
const Y_UP: Vec3 = [0, 1, 0];

export function boundsCenter(bounds: StageBounds): Vec3 {
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
}

export function boundsSize(bounds: StageBounds): Vec3 {
  return [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];
}

/** Radius of the sphere through the box corners. */
export function boundsRadius(bounds: StageBounds) {
  const [x, y, z] = boundsSize(bounds);
  return Math.hypot(x, y, z) / 2;
}

export function isUsableBounds(bounds: StageBounds | undefined): bounds is StageBounds {
  if (!bounds) return false;
  const values = [...bounds.min, ...bounds.max];
  return values.every(Number.isFinite) && bounds.min.every((value, index) => value <= bounds.max[index]!);
}

export function boundsCorners(bounds: StageBounds): Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) corners.push([x, y, z]);
  return corners;
}

/** Millimetre plan box (x audience-right, y away from the audience, z up) to view-space metres. */
export function boundsFromMillimetres(min: Vec3, max: Vec3): StageBounds {
  return { min: [min[0] / 1000, min[2] / 1000, min[1] / 1000], max: [max[0] / 1000, max[2] / 1000, max[1] / 1000] };
}

export function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(...value);
  return length > 0 ? [value[0] / length, value[1] / length, value[2] / length] : Y_UP;
}

const add = (a: Vec3, b: Vec3, scale = 1): Vec3 => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
const toRadians = (degrees: number) => degrees * Math.PI / 180;

/** Perspective camera that shows the whole bounding sphere from `direction` (part preview). */
export function framePerspective(bounds: StageBounds, options: { aspect: number; fov?: number; direction?: Vec3; margin?: number }): StageLookCamera {
  const fov = options.fov ?? 40, margin = options.margin ?? 1.15;
  const aspect = options.aspect > 0 && Number.isFinite(options.aspect) ? options.aspect : 1;
  const radius = Math.max(boundsRadius(bounds), 0.01) * margin;
  const halfVertical = toRadians(fov) / 2;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  const distance = radius / Math.sin(Math.min(halfVertical, halfHorizontal));
  const target = boundsCenter(bounds);
  return {
    projection: 'perspective', target, up: Y_UP, fov, zoom: 1,
    position: add(target, normalize(options.direction ?? DEFAULT_FRAME_DIRECTION), distance),
    near: Math.max(0.01, distance - radius * 2), far: distance + radius * 4,
  };
}

/** Orthographic camera along `direction` whose zoom fits the bounding sphere into the viewport. */
export function frameOrthographic(bounds: StageBounds, options: { viewport: Viewport; direction?: Vec3; margin?: number; up?: Vec3 }): StageLookCamera {
  const margin = options.margin ?? 1.15;
  const radius = Math.max(boundsRadius(bounds), 0.01) * margin;
  const target = boundsCenter(bounds);
  const pixels = Math.max(1, Math.min(options.viewport.width, options.viewport.height));
  return {
    projection: 'orthographic', target, up: options.up ?? Y_UP, fov: 40,
    zoom: pixels / (2 * radius),
    position: add(target, normalize(options.direction ?? DEFAULT_FRAME_DIRECTION), radius * 4),
    near: 0.01, far: radius * 10,
  };
}

/**
 * What a StageCanvas is asked to show: an explicit camera (`look`, for example a Raumsicht preset
 * from `stageViewCamera`) or a bounding box to fit (`frame`, for a part preview).
 */
export type StageCameraConfig =
  | ({ mode: 'look' } & Pick<StageLookCamera, 'position' | 'target'> & Partial<Omit<StageLookCamera, 'position' | 'target'>>)
  | { mode: 'frame'; projection?: StageProjection; bounds?: StageBounds; direction?: Vec3; margin?: number; fov?: number };

export function resolveStageCamera(config: StageCameraConfig, viewport: Viewport, fallbackBounds?: StageBounds): StageLookCamera {
  if (config.mode === 'look') {
    return {
      projection: config.projection ?? 'perspective', position: config.position, target: config.target,
      up: config.up ?? Y_UP, fov: config.fov ?? 40, zoom: config.zoom ?? 50, near: config.near ?? 0.01, far: config.far ?? 1000,
    };
  }
  const bounds = [config.bounds, fallbackBounds].find(isUsableBounds) ?? DEFAULT_STAGE_BOUNDS;
  return config.projection === 'orthographic'
    ? frameOrthographic(bounds, { viewport, direction: config.direction, margin: config.margin })
    : framePerspective(bounds, { aspect: viewport.width / Math.max(1, viewport.height), fov: config.fov, direction: config.direction, margin: config.margin });
}

/** The Raumsicht camera presets, as the editor computes them today (StageCamera + PascalStageCanvas). */
export type StageViewPreset = 'orbit' | 'audience' | 'top' | 'front' | 'side';

export function isOrthographicPreset(view: StageViewPreset) {
  return view === 'top' || view === 'front' || view === 'side';
}

/**
 * Where each preset puts the eye before StageCamera's own adjustments. `eye` is the orbit or
 * audience position (already mirrored to view space); `focus` frames the current selection.
 */
export function stageViewEye(view: StageViewPreset, input: { target: Vec3; eye: Vec3; span: number; focus?: boolean }): Vec3 {
  const [tx, , tz] = input.target, span = input.span;
  if (view === 'top') return [tx, span * 2, tz];
  if (view === 'side') return [-span * 2, 2, tz];
  if (view === 'front') return [tx, 2, -span];
  if (input.focus) return [tx + 2, 4, tz - 5];
  return input.eye;
}

export function stageViewCamera(view: StageViewPreset, input: { target: Vec3; position: Vec3; span: number; viewport: Viewport }): StageLookCamera {
  const { target, span, viewport } = input;
  const aspect = viewport.width / Math.max(1, viewport.height);
  let position = input.position;
  if (view === 'orbit') {
    const distance = span * 0.7 / (Math.tan(toRadians(20)) * Math.min(1, aspect));
    position = add(target, normalize([position[0] - target[0], position[1] - target[1], position[2] - target[2]]), distance);
  }
  return {
    projection: isOrthographicPreset(view) ? 'orthographic' : 'perspective',
    position, target,
    up: view === 'top' ? [0, 0, 1] : Y_UP,
    fov: 40,
    zoom: Math.min(viewport.width, viewport.height) / Math.max(1, span * 1.3),
    near: 0.01, far: 1000,
  };
}
