import { axisAlignedPlatformOutline, orientedPlatformBox, type Platform } from './levels.js';

/** Catalog sizes from common BE-1 / GT Stage Deck Bühnenelemente (mm). */
export const STAGE_DECK_MODULES_MM = [
  { width: 2000, depth: 1000, label: '2 × 1 m' },
  { width: 2000, depth: 500, label: '2 × 0,5 m' },
  { width: 1000, depth: 1000, label: '1 × 1 m' },
  { width: 1000, depth: 500, label: '1 × 0,5 m' },
] as const;

/** Typical adjustable leg / spindle heights for stage decks (mm). */
export const STAGE_DECK_LEG_HEIGHTS_MM = [200, 400, 600, 800, 1000, 1200] as const;

export const STAGE_DECK_STEP_MM = 500;
export const STAGE_DECK_TOP_THICKNESS_MM = 80;
/** Square Steckfuß tube section (GUIL PTA-440: 5 × 5 cm). */
export const STAGE_DECK_LEG_SECTION_MM = 50;
/** Clearance from panel edge to outer face of each Steckfuß (mm). */
export const STAGE_DECK_LEG_EDGE_INSET_MM = 8;
/** Soft rubber cap under each Steckfuß (mm). */
export const STAGE_DECK_RUBBER_HEIGHT_MM = 12;
export const STAGE_DECK_RUBBER_SECTION_MM = 50;
/** Visible aluminum rim width on the walking surface (mm). */
export const STAGE_DECK_FRAME_PROFILE_MM = 4;

export type StageDeckModule = { x: number; y: number; width: number; depth: number };

function snapAxis(mm: number) {
  return Math.max(STAGE_DECK_STEP_MM, Math.round(mm / STAGE_DECK_STEP_MM) * STAGE_DECK_STEP_MM);
}

/** Nearest plan size that can be tiled with catalog Bühnenelemente (0,5 m grid). */
export function snapStageDeckSize(width: number, depth: number) {
  return { width: snapAxis(width), depth: snapAxis(depth) };
}

/**
 * Cover/fit a dragged axis onto the 0,5 m module grid with the opposite face fixed.
 * Growing takes the smallest step that reaches or passes the target; shrinking floors.
 */
export function snapStageDeckResizeDelta(currentMm: number, deltaMm: number) {
  const step = STAGE_DECK_STEP_MM;
  const raw = currentMm + deltaMm;
  const snapped = deltaMm >= 0
    ? Math.max(step, Math.ceil((raw - 1e-6) / step) * step)
    : Math.max(step, Math.floor((raw + 1e-6) / step) * step);
  return snapped - currentMm;
}

/** Module grain relative to the podium outline: 0 = long 2 m edge along width, 90 = along depth. */
export type StageDeckGrain = 0 | 90;

export function normalizeStageDeckGrain(value: number | undefined): StageDeckGrain {
  return value === 90 ? 90 : 0;
}

/** Nearest common leg height for a Bühnenelement podium. */
export function snapStageDeckElevation(elevation: number) {
  let best: number = STAGE_DECK_LEG_HEIGHTS_MM[0]!;
  let bestDistance = Math.abs(elevation - best);
  for (const height of STAGE_DECK_LEG_HEIGHTS_MM) {
    const distance = Math.abs(elevation - height);
    if (distance < bestDistance) { best = height; bestDistance = distance; }
  }
  return best;
}

function partitionAxis(length: number): number[] {
  const parts: number[] = [];
  let remaining = length;
  while (remaining >= 2000) { parts.push(2000); remaining -= 2000; }
  while (remaining >= 1000) { parts.push(1000); remaining -= 1000; }
  while (remaining >= 500) { parts.push(500); remaining -= 500; }
  return parts;
}

/**
 * Tile a snapped WxD rectangle with catalog modules (local coords, origin at podium centre).
 * Prefers larger modules along each axis; 2×2 m cells become two 2×1 m modules.
 * `grain` 90° swaps the preferred long-edge direction (2 m along depth instead of width).
 */
export function layoutStageDeckModules(
  width: number,
  depth: number,
  grain: StageDeckGrain | number | undefined = 0,
): StageDeckModule[] {
  if (normalizeStageDeckGrain(grain) === 90) {
    return layoutStageDeckModules(depth, width, 0).map(module => ({
      x: module.y,
      y: module.x,
      width: module.depth,
      depth: module.width,
    }));
  }
  const size = snapStageDeckSize(width, depth);
  const cols = partitionAxis(size.width);
  const rows = partitionAxis(size.depth);
  const modules: StageDeckModule[] = [];
  let y = -size.depth / 2;
  for (const row of rows) {
    let x = -size.width / 2;
    for (const col of cols) {
      const match = STAGE_DECK_MODULES_MM.find(module =>
        (module.width === col && module.depth === row) || (module.width === row && module.depth === col));
      if (match) {
        const oriented = match.width === col && match.depth === row
          ? { width: match.width, depth: match.depth }
          : { width: match.depth, depth: match.width };
        modules.push({ x: x + oriented.width / 2, y: y + oriented.depth / 2, ...oriented });
        x += oriented.width;
        continue;
      }
      if (col === 2000 && row === 2000) {
        modules.push({ x: x + 1000, y: y + 500, width: 2000, depth: 1000 });
        modules.push({ x: x + 1000, y: y + 1500, width: 2000, depth: 1000 });
        x += 2000;
        continue;
      }
      modules.push({ x: x + col / 2, y: y + row / 2, width: col, depth: row });
      x += col;
    }
    y += row;
  }
  return modules;
}

/**
 * Four feet per catalog module, inset under the panel (outer face 8 mm inside the edge).
 * Neighbouring modules keep their own feet — abutting decks show eight legs, not six.
 */
export function stageDeckLegPositions(
  width: number,
  depth: number,
  grain: StageDeckGrain | number | undefined = 0,
) {
  const inset = STAGE_DECK_LEG_EDGE_INSET_MM + STAGE_DECK_LEG_SECTION_MM / 2;
  const legs: { x: number; y: number }[] = [];
  for (const module of layoutStageDeckModules(width, depth, grain)) {
    const hx = Math.max(0, module.width / 2 - inset);
    const hy = Math.max(0, module.depth / 2 - inset);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      legs.push({ x: Math.round(module.x + sx * hx), y: Math.round(module.y + sy * hy) });
    }
  }
  return legs;
}

/** Apply Bühnenelement snapping to an existing platform outline and elevation. */
export function clipPlatformToStageDeck(platform: Platform): Platform {
  const box = orientedPlatformBox(platform.outline);
  const size = snapStageDeckSize(box.width, box.depth);
  const elevation = snapStageDeckElevation(platform.elevation);
  const deckGrain = normalizeStageDeckGrain(platform.deckGrain);
  return {
    ...platform,
    style: 'stageDeck',
    deckGrain,
    elevation,
    outline: axisAlignedPlatformOutline(box.x, box.y, size.width, size.depth, box.rotation),
  };
}
