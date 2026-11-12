export const STAGE_CANVAS_HARNESS_HASH = '#/__stage-canvas';
export const STAGE_CANVAS_HARNESS_FLAG = 'stage-harness';

/** The StageCanvas test harness: always in dev, in production builds only with `?stage-harness`. */
export function isStageCanvasHarnessRoute(location: { hash: string; search: string }, dev: boolean) {
  if (location.hash !== STAGE_CANVAS_HARNESS_HASH) return false;
  return dev || new URLSearchParams(location.search).has(STAGE_CANVAS_HARNESS_FLAG);
}
