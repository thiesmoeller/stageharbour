import { z } from 'zod';

const name = z.string().trim().min(1).max(120);
const dimension = z.number().finite().min(1).max(100000);
const alongPanel = z.number().finite().min(0).max(100000);
export const doorHingeSchema = z.enum(['left', 'right']);
export type DoorHinge = z.infer<typeof doorHingeSchema>;
/** Scenic door leaf: 80 × 200 cm, white. */
export const DOOR_LEAF = { width: 800, height: 2000, thickness: 40 } as const;
/** Outer door frame from 25 × 50 mm softwood (face × depth outward). */
export const DOOR_FRAME = { face: 25, depth: 50 } as const;
export const DOOR_LEAF_COLOR = '#f7f7f4';
export const DOOR_FRAME_COLOR = '#e8e2d6';

export const openingSchema = z.strictObject({
  id: z.uuid(),
  left: alongPanel, sill: alongPanel,
  width: dimension, height: dimension,
  hinge: doorHingeSchema.optional(),
  /** Roman arch: straight jambs to the spring line, semicircular crown (radius = width/2). */
  profile: z.enum(['rectangle', 'arch']).optional(),
});
export type Opening = z.infer<typeof openingSchema>;

/** Fields accepted from storage before legacy Bogen openings are upgraded. */
const wallTypeFieldsSchema = z.strictObject({
  id: z.uuid(), name,
  width: dimension, height: dimension, thickness: dimension,
  openings: z.array(openingSchema).max(20).refine(
    openings => new Set(openings.map(opening => opening.id)).size === openings.length, 'Opening IDs must be unique',
  ),
});

/**
 * Pre–Roman-arch stand-in: same clear opening as today's Bogen, but a flat lintel.
 * Doors share the clear size and are excluded by hinge.
 */
const LEGACY_ARCH_OPENING = { left: 200, sill: 0, width: 800, height: 2000 } as const;
const LEGACY_ARCH_PANEL = { width: 1200, height: 2400, thickness: 250 } as const;

function isLegacyArchOpening(opening: Opening): boolean {
  return !opening.hinge && opening.profile !== 'arch'
    && opening.left === LEGACY_ARCH_OPENING.left && opening.sill === LEGACY_ARCH_OPENING.sill
    && opening.width === LEGACY_ARCH_OPENING.width && opening.height === LEGACY_ARCH_OPENING.height;
}

function isLegacyArchPanel(type: Pick<WallElementType, 'name' | 'width' | 'height' | 'thickness'>): boolean {
  return type.name === 'Bogen'
    || (type.width === LEGACY_ARCH_PANEL.width && type.height === LEGACY_ARCH_PANEL.height
      && type.thickness === LEGACY_ARCH_PANEL.thickness);
}

/** Upgrade stored rectangular Bogen stand-ins to `profile: 'arch'` for mesh, elevations and export. */
export function migrateLegacyArchWallType(type: WallElementType): WallElementType {
  if (!isLegacyArchPanel(type)) return type;
  let changed = false;
  const openings = type.openings.map(opening => {
    if (!isLegacyArchOpening(opening)) return opening;
    changed = true;
    return { ...opening, profile: 'arch' as const };
  });
  return changed ? { ...type, openings } : type;
}

/**
 * Bidirectional wall-type schema: migrate legacy flat Bogen openings on decode and encode.
 * Fastify response serialization encodes raw DB rows, so both sides must upgrade.
 */
export const wallTypeSchema = z.codec(wallTypeFieldsSchema, wallTypeFieldsSchema, {
  decode: type => migrateLegacyArchWallType(type),
  encode: type => migrateLegacyArchWallType(type),
}).refine(type => type.openings.every(opening =>
  opening.left + opening.width <= type.width && opening.sill + opening.height <= type.height
  && (opening.profile !== 'arch' || opening.height + 1e-9 >= opening.width / 2)
), 'Openings must lie inside the panel');
export type WallElementType = z.infer<typeof wallTypeFieldsSchema>;

/** True when the opening uses a semicircular crown (radius = half width). */
export function isArchOpening(opening: Pick<Opening, 'profile' | 'width' | 'height'>): boolean {
  return opening.profile === 'arch' && opening.height + 1e-9 >= opening.width / 2;
}

/** Height of the straight jambs below the arch spring line. */
export function openingSpringHeight(opening: Pick<Opening, 'width' | 'height'>): number {
  return opening.height - opening.width / 2;
}

/**
 * Void outline in panel millimetres from the bottom-left (left/sill origin).
 * Rectangle, or Roman arch (straight sides + semicircular crown).
 */
export function openingOutlinePoints(
  opening: Pick<Opening, 'left' | 'sill' | 'width' | 'height' | 'profile'>,
  steps = 16,
): { x: number; y: number }[] {
  const x0 = opening.left, y0 = opening.sill;
  const x1 = x0 + opening.width, y1 = y0 + opening.height;
  if (!isArchOpening(opening)) {
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }
  const radius = opening.width / 2;
  const springY = y0 + openingSpringHeight(opening);
  const cx = x0 + radius;
  const points = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: springY }];
  const count = Math.max(8, steps);
  for (let i = 1; i < count; i++) {
    const angle = Math.PI * (i / count);
    points.push({ x: cx + radius * Math.cos(angle), y: springY + radius * Math.sin(angle) });
  }
  points.push({ x: x0, y: springY });
  return points;
}

/** Whether a panel-local point (origin bottom-left) lies inside the opening void. */
export function pointInOpening(
  opening: Pick<Opening, 'left' | 'sill' | 'width' | 'height' | 'profile'>,
  x: number, y: number,
): boolean {
  if (x <= opening.left || x >= opening.left + opening.width) return false;
  if (y <= opening.sill || y >= opening.sill + opening.height) return false;
  if (!isArchOpening(opening)) return true;
  const radius = opening.width / 2;
  const springY = opening.sill + openingSpringHeight(opening);
  if (y <= springY) return true;
  const dx = x - (opening.left + radius);
  const dy = y - springY;
  return dx * dx + dy * dy <= radius * radius + 1e-6;
}

export function newWallType(id: string): WallElementType {
  return { id, name: 'Wandtyp', width: 1200, height: 2400, thickness: 28, openings: [] };
}
export function newOpening(id: string): Opening {
  return { id, left: 200, sill: 0, width: 800, height: 2000 };
}
export function newDoorOpening(id: string, hinge: DoorHinge): Opening {
  return { id, left: 200, sill: 0, width: DOOR_LEAF.width, height: DOOR_LEAF.height, hinge };
}

/** 0 % closed → 100 % open at 90° toward the audience. */
export function doorOpenAngleDegrees(openPercent: number): number {
  return Math.max(0, Math.min(100, openPercent)) / 100 * 90;
}
export function isDoorOpening(opening: Opening): opening is Opening & { hinge: DoorHinge } {
  return opening.hinge === 'left' || opening.hinge === 'right';
}

export type ResolvedWall = {
  id: string; label: string;
  x: number; y: number; rotation: number;
  width: number; height: number; thickness: number;
  typeId?: string; openings: Opening[];
};
export function resolveWall(wall: {
  id: string; label: string; x: number; y: number; rotation: number;
  width: number; height: number; thickness: number; typeId?: string; openings?: Opening[];
}, types: WallElementType[]): ResolvedWall {
  const type = wall.typeId ? types.find(item => item.id === wall.typeId) : undefined;
  return {
    ...wall,
    width: type?.width ?? wall.width,
    height: type?.height ?? wall.height,
    thickness: type?.thickness ?? wall.thickness,
    openings: type?.openings ?? wall.openings ?? [],
  };
}

/** Default lintel when drawing a full-height venue cutout (mm). */
export const VENUE_CUTOUT_LINTEL_MM = 400;

/** Plan-space point → distance from the wall's left end along its width (0…width). */
export function wallAlongFromPlanPoint(
  wall: { x: number; y: number; rotation: number; width: number },
  point: { x: number; y: number },
): number {
  const rad = wall.rotation * Math.PI / 180;
  const dx = point.x - wall.x, dy = point.y - wall.y;
  const along = dx * Math.cos(rad) + dy * Math.sin(rad);
  return Math.max(0, Math.min(wall.width, along + wall.width / 2));
}

/**
 * Build a rectangular cutout spanning `a`…`b` along the wall width.
 * Sill is 0; height leaves a small lintel when the wall is tall enough.
 */
export function openingFromWallSpan(
  id: string,
  wall: { width: number; height: number },
  alongA: number,
  alongB: number,
): Opening | undefined {
  const left = Math.round(Math.min(alongA, alongB));
  const right = Math.round(Math.max(alongA, alongB));
  const width = right - left;
  if (!(width >= 1)) return undefined;
  const lintel = wall.height > VENUE_CUTOUT_LINTEL_MM + 1 ? VENUE_CUTOUT_LINTEL_MM : 0;
  const height = Math.max(1, wall.height - lintel);
  if (left + width > wall.width || height > wall.height) return undefined;
  return { id, left, sill: 0, width, height };
}

export function openingsFitWall(
  wall: { width: number; height: number },
  openings: readonly Opening[],
): boolean {
  return openings.every(opening =>
    opening.left + opening.width <= wall.width && opening.sill + opening.height <= wall.height
  );
}
export function typesOf(layout: { wallTypes?: WallElementType[] }): WallElementType[] {
  return (layout.wallTypes ?? []).map(migrateLegacyArchWallType);
}
