import { z } from 'zod';
import { RAL_CODE_PATTERN } from './ral.js';

const libraryRef = z.string().regex(/^library:[a-zA-Z0-9_-]+$/).max(180);
const ralCode = z.string().regex(RAL_CODE_PATTERN);
/** Grain / pattern direction steps (degrees) on a wall face. */
export const SURFACE_ROTATIONS_DEG = [0, 90, 180, 270] as const;
export type SurfaceRotationDeg = (typeof SURFACE_ROTATIONS_DEG)[number];

/** Default horizontal split for two-band surfacing (mm from panel floor). */
export const DEFAULT_SURFACE_SPLIT_MM = 1200;

/**
 * How much of the face one texture tile covers along the face width (mm).
 * Catalog presets keep their own repeat when scale is omitted.
 */
export const DEFAULT_LIBRARY_SCALE_MM = 1000;

export const paintSurfaceFinishSchema = z.strictObject({
  kind: z.literal('paint'),
  ral: ralCode,
});

export const librarySurfaceFinishSchema = z.strictObject({
  kind: z.literal('library'),
  ref: libraryRef,
  /** Millimetres of pattern along the face width; omit to use catalog repeat. */
  scaleMm: z.number().finite().min(50).max(20000).optional(),
  /** Grain / pattern direction on the face. */
  rotationDeg: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
});

export const surfaceFinishSchema = z.discriminatedUnion('kind', [
  paintSurfaceFinishSchema,
  librarySurfaceFinishSchema,
]);
export type SurfaceFinish = z.infer<typeof surfaceFinishSchema>;

export const faceSurfacingSchema = z.strictObject({
  /** Whole-face finish when not using bands. */
  full: surfaceFinishSchema.optional(),
  /** Horizontal split from the panel floor (mm). Lower = [0, splitMm), upper = [splitMm, height]. */
  splitMm: z.number().finite().min(1).max(100000).optional(),
  lower: surfaceFinishSchema.optional(),
  upper: surfaceFinishSchema.optional(),
}).refine(face => {
  if (face.splitMm !== undefined) return !!(face.lower || face.upper);
  return true;
}, 'Banded faces need a lower or upper finish').refine(face => {
  if (face.splitMm === undefined) return !(face.lower || face.upper);
  return true;
}, 'Lower/upper bands require splitMm');

export type FaceSurfacing = z.infer<typeof faceSurfacingSchema>;

export const wallSurfacesSchema = z.strictObject({
  front: faceSurfacingSchema.optional(),
  back: faceSurfacingSchema.optional(),
  /** Thin edge / thickness faces — no bands in Phase 1. */
  edge: surfaceFinishSchema.optional(),
});
export type WallSurfaces = z.infer<typeof wallSurfacesSchema>;

export type WallFaceId = 'front' | 'back' | 'edge';
export type FaceBandId = 'full' | 'lower' | 'upper';

/** Lift legacy finish / RAL fields into `surfaces` and drop the old keys. */
export function migrateWallSurfaces<T extends {
  finish?: string;
  frontRal?: string;
  backRal?: string;
  surfaces?: WallSurfaces;
}>(wall: T): Omit<T, 'finish' | 'frontRal' | 'backRal'> & { surfaces?: WallSurfaces } {
  const { finish, frontRal, backRal, surfaces: existing, ...rest } = wall;
  const base = rest as Omit<T, 'finish' | 'frontRal' | 'backRal'>;
  if (existing) {
    return { ...base, surfaces: existing };
  }
  const surfaces: WallSurfaces = {};
  if (finish) {
    surfaces.front = { full: { kind: 'library', ref: finish } };
  } else if (frontRal) {
    surfaces.front = { full: { kind: 'paint', ral: frontRal } };
  }
  if (backRal) {
    surfaces.back = { full: { kind: 'paint', ral: backRal } };
  }
  if (!surfaces.front && !surfaces.back && !surfaces.edge) {
    return base;
  }
  return { ...base, surfaces };
}

/** Effective finish for a face band (banded or full). */
export function resolveFaceBand(face: FaceSurfacing | undefined, band: FaceBandId): SurfaceFinish | undefined {
  if (!face) return undefined;
  if (band === 'lower') return face.lower ?? (face.splitMm === undefined ? face.full : undefined);
  if (band === 'upper') return face.upper ?? (face.splitMm === undefined ? face.full : undefined);
  return face.full ?? face.lower ?? face.upper;
}

export function faceIsBanded(face: FaceSurfacing | undefined): boolean {
  return face?.splitMm !== undefined;
}

/** Split height clamped into the panel, or undefined when the face is not banded. */
export function faceSplitMm(face: FaceSurfacing | undefined, panelHeight: number): number | undefined {
  if (face?.splitMm === undefined) return undefined;
  return Math.max(1, Math.min(panelHeight - 1, Math.round(face.splitMm)));
}

export function patchFaceSurfacing(
  current: FaceSurfacing | undefined,
  patch: {
    mode?: 'full' | 'bands';
    splitMm?: number;
    full?: SurfaceFinish | null;
    lower?: SurfaceFinish | null;
    upper?: SurfaceFinish | null;
  },
): FaceSurfacing | undefined {
  let next: FaceSurfacing = { ...(current ?? {}) };
  if (patch.mode === 'full') {
    const { splitMm: _s, lower: _l, upper: _u, ...rest } = next;
    next = rest;
    if (patch.full !== undefined) {
      if (patch.full === null) {
        const { full: _f, ...cleared } = next;
        next = cleared;
      } else next = { ...next, full: patch.full };
    } else if (!next.full && current?.lower) {
      next = { ...next, full: current.lower };
    } else if (!next.full && current?.upper) {
      next = { ...next, full: current.upper };
    }
  } else if (patch.mode === 'bands') {
    const { full: _f, ...rest } = next;
    const defaultPaint: SurfaceFinish = { kind: 'paint', ral: '9010' };
    next = {
      ...rest,
      splitMm: patch.splitMm ?? next.splitMm ?? DEFAULT_SURFACE_SPLIT_MM,
      lower: patch.lower === null ? undefined : (patch.lower ?? next.lower ?? next.full ?? defaultPaint),
      upper: patch.upper === null ? undefined : (patch.upper ?? next.upper ?? next.full ?? defaultPaint),
    };
    if (patch.lower === null) {
      const { lower: _l, ...cleared } = next;
      next = cleared;
    }
    if (patch.upper === null) {
      const { upper: _u, ...cleared } = next;
      next = cleared;
    }
  } else {
    if (patch.splitMm !== undefined) next = { ...next, splitMm: patch.splitMm };
    if (patch.full !== undefined) {
      if (patch.full === null) {
        const { full: _f, ...cleared } = next;
        next = cleared;
      } else next = { ...next, full: patch.full };
    }
    if (patch.lower !== undefined) {
      if (patch.lower === null) {
        const { lower: _l, ...cleared } = next;
        next = cleared;
      } else next = { ...next, lower: patch.lower };
    }
    if (patch.upper !== undefined) {
      if (patch.upper === null) {
        const { upper: _u, ...cleared } = next;
        next = cleared;
      } else next = { ...next, upper: patch.upper };
    }
  }
  const parsed = faceSurfacingSchema.safeParse(next);
  if (!parsed.success) return current;
  if (!parsed.data.full && !parsed.data.lower && !parsed.data.upper && parsed.data.splitMm === undefined) {
    return undefined;
  }
  return parsed.data;
}

export function patchWallSurfaces(
  surfaces: WallSurfaces | undefined,
  face: WallFaceId,
  patch: Parameters<typeof patchFaceSurfacing>[1] | { edge?: SurfaceFinish | null },
): WallSurfaces | undefined {
  if (face === 'edge') {
    const edgePatch = patch as { edge?: SurfaceFinish | null };
    const next: WallSurfaces = { ...(surfaces ?? {}) };
    if (edgePatch.edge === null) {
      const { edge: _e, ...rest } = next;
      return Object.keys(rest).length ? rest : undefined;
    }
    if (edgePatch.edge) next.edge = edgePatch.edge;
    return next;
  }
  const facePatch = patchFaceSurfacing(surfaces?.[face], patch as Parameters<typeof patchFaceSurfacing>[1]);
  const next: WallSurfaces = { ...(surfaces ?? {}) };
  if (!facePatch) {
    const { [face]: _removed, ...rest } = next;
    return Object.keys(rest).length ? rest : undefined;
  }
  next[face] = facePatch;
  return next;
}
