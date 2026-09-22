import { z } from 'zod';
import { type PlanPoint } from './venue.js';
import { stairCorners } from './levels.js';

const name = z.string().trim().min(1).max(120);
const dimension = z.number().finite().min(1).max(100000);
const coordinate = z.number().finite().min(-100000).max(100000);

/** Example millimetres for a venue Molton traveler. Not a measured venue. */
export const EXAMPLE_CURTAIN_LENGTH = 8000;
export const EXAMPLE_CURTAIN_HEIGHT = 4500;
/** USITT soft-goods fullness: ~3–6″ peak-to-peak at drawing scale → ~100 mm. */
export const EXAMPLE_CURTAIN_WAVE_AMPLITUDE = 100;
/** Plan hit-box / closed fold depth (mm). */
export const EXAMPLE_CURTAIN_FABRIC_DEPTH = 120;
/** Minimum stacked leaf width when fully open (fraction of track). */
const MIN_STACK_FRACTION = 0.06;

export const curtainOpeningSchema = z.enum(['traveler', 'stackLeft', 'stackRight']);
export type CurtainOpening = z.infer<typeof curtainOpeningSchema>;

export const curtainSchema = z.strictObject({
  id: z.uuid(), label: name,
  x: coordinate, y: coordinate,
  rotation: z.number().finite().min(-360).max(360).default(0),
  length: dimension, height: dimension,
  /** Gap between fabric hem and floor (0 = touching / nearly touching). */
  bottomClearance: z.number().finite().min(0).max(100000).default(0),
  /** 0 = closed across the track, 100 = fully open / stacked. */
  openPercent: z.number().finite().min(0).max(100).default(0),
  opening: curtainOpeningSchema.default('traveler'),
});
export type Curtain = z.infer<typeof curtainSchema>;
export const curtainsSchema = z.array(curtainSchema).max(250)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Curtain IDs must be unique');

export function newCurtain(id: string, x: number, y: number, extras?: Partial<Pick<Curtain, 'length' | 'rotation' | 'height' | 'openPercent' | 'opening'>>): Curtain {
  return {
    id, label: 'Molton', x, y, rotation: extras?.rotation ?? 0,
    length: extras?.length ?? EXAMPLE_CURTAIN_LENGTH,
    height: extras?.height ?? EXAMPLE_CURTAIN_HEIGHT,
    bottomClearance: 0,
    openPercent: extras?.openPercent ?? 0,
    opening: extras?.opening ?? 'traveler',
  };
}

/** Thin plan footprint of the curtain track (length × fabric depth). */
export function curtainCorners(curtain: Pick<Curtain, 'x' | 'y' | 'rotation' | 'length'>): PlanPoint[] {
  return stairCorners({
    x: curtain.x, y: curtain.y, rotation: curtain.rotation ?? 0,
    width: curtain.length, run: EXAMPLE_CURTAIN_FABRIC_DEPTH,
  });
}

/** Visible fabric spans along the track, in millimetres from centre (−length/2 … +length/2). */
export function curtainLeafSpans(curtain: Pick<Curtain, 'length' | 'openPercent' | 'opening'>): { start: number; end: number }[] {
  const half = curtain.length / 2;
  const open = Math.min(100, Math.max(0, curtain.openPercent ?? 0)) / 100;
  const closedSpan = curtain.length * (1 - open * (1 - MIN_STACK_FRACTION));
  if (curtain.opening === 'stackLeft') {
    return [{ start: -half, end: -half + Math.max(curtain.length * MIN_STACK_FRACTION, closedSpan) }];
  }
  if (curtain.opening === 'stackRight') {
    return [{ start: half - Math.max(curtain.length * MIN_STACK_FRACTION, closedSpan), end: half }];
  }
  // Traveler: two leaves parting from centre; fully closed draws as one continuous run.
  if (open < 0.01) return [{ start: -half, end: half }];
  const leaf = Math.max(curtain.length * MIN_STACK_FRACTION / 2, closedSpan / 2);
  return [
    { start: -half, end: -half + leaf },
    { start: half - leaf, end: half },
  ].filter(span => span.end - span.start >= 1);
}

/** USITT-style wavy plan polyline for soft goods hung with fullness. */
export function curtainWavyPoints(
  curtain: Pick<Curtain, 'x' | 'y' | 'rotation' | 'length' | 'openPercent' | 'opening'>,
  samplesPerMetre = 4,
): PlanPoint[][] {
  const angle = (curtain.rotation ?? 0) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const amplitude = EXAMPLE_CURTAIN_WAVE_AMPLITUDE / 2;
  const wavelength = 500;
  return curtainLeafSpans(curtain).map(span => {
    const length = span.end - span.start;
    const count = Math.max(8, Math.ceil((length / 1000) * samplesPerMetre * 8));
    const points: PlanPoint[] = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const along = span.start + t * length;
      const wave = Math.sin((along / wavelength) * Math.PI * 2) * amplitude;
      points.push({
        x: curtain.x + along * cos - wave * sin,
        y: curtain.y + along * sin + wave * cos,
      });
    }
    return points;
  });
}

/** End ticks perpendicular to the track (USITT soft-goods termination). */
export function curtainEndTicks(curtain: Pick<Curtain, 'x' | 'y' | 'rotation' | 'length'>): { a: PlanPoint; b: PlanPoint }[] {
  const angle = (curtain.rotation ?? 0) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const half = curtain.length / 2;
  const tick = EXAMPLE_CURTAIN_WAVE_AMPLITUDE * 0.75;
  return ([-half, half] as const).map(along => {
    const cx = curtain.x + along * cos, cy = curtain.y + along * sin;
    return {
      a: { x: cx - tick * sin, y: cy + tick * cos },
      b: { x: cx + tick * sin, y: cy - tick * cos },
    };
  });
}

/** Build a curtain from two plan points (track start / end). */
export function curtainFromSegment(id: string, start: PlanPoint, end: PlanPoint, height = EXAMPLE_CURTAIN_HEIGHT): Curtain | undefined {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(length >= 1)) return undefined;
  return newCurtain(id, (start.x + end.x) / 2, (start.y + end.y) / 2, {
    length: Math.round(length),
    rotation: Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI,
    height,
  });
}

type CurtainHangVenue = {
  ceilingHeight?: number;
  platforms?: readonly { id: string; outline: PlanPoint[]; elevation: number }[];
  trusses?: readonly { x: number; y: number; rotation?: number; length: number; sectionWidth: number; bottomHeight: number }[];
};

function pointInPolygon(outline: PlanPoint[], point: PlanPoint) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!, b = outline[j]!;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + Number.EPSILON) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function rectanglesOverlap(a: PlanPoint[], b: PlanPoint[]) {
  const ax = a.map(p => p.x), ay = a.map(p => p.y), bx = b.map(p => p.x), by = b.map(p => p.y);
  return Math.min(...ax) <= Math.max(...bx) && Math.max(...ax) >= Math.min(...bx)
    && Math.min(...ay) <= Math.max(...by) && Math.max(...ay) >= Math.min(...by)
    && (a.some(point => pointInPolygon(b, point)) || b.some(point => pointInPolygon(a, point))
      || a.some((point, i) => {
        const next = a[(i + 1) % a.length]!;
        return b.some((other, j) => {
          const otherNext = b[(j + 1) % b.length]!;
          return segmentsTouch(point, next, other, otherNext);
        });
      }));
}

function segmentsTouch(a1: PlanPoint, a2: PlanPoint, b1: PlanPoint, b2: PlanPoint) {
  const cross = (o: PlanPoint, p: PlanPoint, q: PlanPoint) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(a1, a2, b1), d2 = cross(a1, a2, b2), d3 = cross(b1, b2, a1), d4 = cross(b1, b2, a2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Samples along the curtain track centreline (for podium contact). */
export function curtainTrackSamples(curtain: Pick<Curtain, 'x' | 'y' | 'rotation' | 'length'>, stepMm = 250): PlanPoint[] {
  const angle = (curtain.rotation ?? 0) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const half = curtain.length / 2;
  const count = Math.max(2, Math.ceil(curtain.length / stepMm));
  const points: PlanPoint[] = [];
  for (let i = 0; i <= count; i++) {
    const along = -half + (i / count) * curtain.length;
    points.push({ x: curtain.x + along * cos, y: curtain.y + along * sin });
  }
  return points;
}

/**
 * Highest podium (or floor = 0) the Molton footprint touches.
 * Fabric must stop at that surface rather than punch through a Podest.
 */
export function curtainContactElevation(
  curtain: Pick<Curtain, 'x' | 'y' | 'rotation' | 'length'>,
  platforms: readonly { id: string; outline: PlanPoint[]; elevation: number }[] = [],
): number {
  let max = 0;
  for (const point of curtainTrackSamples(curtain)) {
    for (const platform of platforms) {
      if (platform.elevation > max && pointInPolygon(platform.outline, point)) max = platform.elevation;
    }
  }
  return max;
}

/**
 * Hang line: lowest overlapping truss underside, else venue ceiling, else current top.
 * Matches how soft goods are typically flown from Traverse or Decke.
 */
export function curtainHangTop(
  curtain: Pick<Curtain, 'x' | 'y' | 'rotation' | 'length' | 'height' | 'bottomClearance'>,
  venue: CurtainHangVenue,
): number {
  const footprint = curtainCorners(curtain);
  const trussTops = (venue.trusses ?? [])
    .filter(truss => rectanglesOverlap(footprint, stairCorners({
      x: truss.x, y: truss.y, rotation: truss.rotation ?? 0, width: truss.length, run: truss.sectionWidth,
    })))
    .map(truss => truss.bottomHeight);
  if (trussTops.length) return Math.min(...trussTops);
  if (venue.ceilingHeight && venue.ceilingHeight > 0) return venue.ceilingHeight;
  return (curtain.bottomClearance ?? 0) + curtain.height;
}

/**
 * Clamp Molton drop: hem sits on/above the highest contacting surface;
 * fabric height cannot exceed hang line − hem.
 */
export function clampCurtainDrop(curtain: Curtain, venue: CurtainHangVenue): Curtain {
  const contact = curtainContactElevation(curtain, venue.platforms ?? []);
  const hang = curtainHangTop(curtain, venue);
  const bottomClearance = Math.max(curtain.bottomClearance ?? 0, contact);
  const height = Math.max(1, Math.min(curtain.height, hang - bottomClearance));
  if (bottomClearance === (curtain.bottomClearance ?? 0) && height === curtain.height) return curtain;
  return { ...curtain, bottomClearance, height };
}

/** Local-space fold samples for a 3D molton leaf (x along track, z depth). */
export function curtainLeafFoldSamples(leafLength: number, openPercent: number, samples = 48): { x: number; z: number }[] {
  const open = Math.min(100, Math.max(0, openPercent)) / 100;
  const foldDepth = EXAMPLE_CURTAIN_FABRIC_DEPTH * (0.55 + open * 0.9);
  const folds = Math.max(4, Math.round(leafLength / 280) + Math.round(open * 6));
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = (t - 0.5) * leafLength;
    const z = Math.sin(t * folds * Math.PI) * foldDepth * (0.35 + 0.65 * Math.sin(t * Math.PI));
    points.push({ x, z });
  }
  return points;
}
