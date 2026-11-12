/**
 * The one seam for renderer creation and renderer-wide settings of every StageCanvas.
 *
 * Contract:
 * - Nothing else under src/client constructs a three.js renderer for the stage; StageCanvas hands
 *   `createStageRenderer` to R3F and reads the settings below.
 * - Output colour space, tone mapping, shadow-map type and the pixel-ratio caps per quality are
 *   decided here and nowhere else. Per-theme exposure and clear colour go through
 *   `applyStageAppearance`.
 * - Callers may rely only on `StageRenderer` members that WebGLRenderer and WebGPURenderer share:
 *   render, setRenderTarget, getRenderTarget, setClearColor, readRenderTargetPixelsAsync,
 *   domElement, shadowMap.enabled, toneMappingExposure, dispose.
 * - Materials come from the surface material factory (surfaceMaterials.ts) and must compile on this
 *   renderer, so a later renderer switch changes this file and that factory only.
 * - Loaders that depend on what the GPU supports (compressed textures) learn about the renderer
 *   through `onStageRenderer`, not by reaching into a canvas.
 */
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer, type Color, type ShadowMapType } from 'three';

export type StageRenderer = WebGLRenderer;
export type StageQuality = 'simple' | 'enhanced';

export type StageQualitySettings = {
  shadows: boolean;
  shadowMapType: ShadowMapType;
  /** Upper device-pixel-ratio bound for fine pointers (desktop). */
  maxPixelRatio: number;
  /** Upper bound on touch devices, where fragment cost matters more. */
  coarsePointerMaxPixelRatio: number;
};

/**
 * Simple renders at CSS pixels without shadows. Enhanced is the opt-in "Hohe Renderqualität":
 * PCF shadows and sharper rendering on dense displays, capped at 1.5 desktop / 1.25 touch.
 */
export const STAGE_QUALITY: Readonly<Record<StageQuality, Readonly<StageQualitySettings>>> = {
  simple: { shadows: false, shadowMapType: PCFShadowMap, maxPixelRatio: 1, coarsePointerMaxPixelRatio: 1 },
  enhanced: { shadows: true, shadowMapType: PCFShadowMap, maxPixelRatio: 1.5, coarsePointerMaxPixelRatio: 1.25 },
};

export const STAGE_OUTPUT_COLOR_SPACE = SRGBColorSpace;
export const STAGE_TONE_MAPPING = ACESFilmicToneMapping;

const SHADOWS_ON = { enabled: true, type: PCFShadowMap } as const;

/** Value for R3F's `shadows` prop. PCFShadowMap with a radius is three r186's soft shadow. */
export function shadowMapConfig(quality: StageQuality): false | { enabled: true; type: ShadowMapType } {
  return STAGE_QUALITY[quality].shadows ? SHADOWS_ON : false;
}

/** Value for R3F's `dpr` prop. */
export function pixelRatioRange(quality: StageQuality, coarsePointer = prefersCoarsePointer()): [number, number] {
  const settings = STAGE_QUALITY[quality];
  return [1, coarsePointer ? settings.coarsePointerMaxPixelRatio : settings.maxPixelRatio];
}

export function prefersCoarsePointer() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

export type StageRendererOptions = {
  canvas: HTMLCanvasElement;
  /** Creation-time only: keeps the last frame readable after compositing, for captures. */
  preserveDrawingBuffer?: boolean;
  powerPreference?: WebGLPowerPreference;
};

const rendererListeners = new Set<(renderer: StageRenderer) => void>();
let latestRenderer: StageRenderer | undefined;

/**
 * Calls `listener` with every renderer `createStageRenderer` creates from now on, and at once with
 * the most recent one if there is one. Returns the unsubscribe function.
 */
export function onStageRenderer(listener: (renderer: StageRenderer) => void): () => void {
  rendererListeners.add(listener);
  if (latestRenderer) listener(latestRenderer);
  return () => { rendererListeners.delete(listener); };
}

export function createStageRenderer({ canvas, preserveDrawingBuffer = false, powerPreference = 'high-performance' }: StageRendererOptions): StageRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer, powerPreference });
  applyStageRendererSettings(renderer);
  announceStageRenderer(renderer);
  return renderer;
}

/** Exported for tests; `createStageRenderer` is the only production caller. */
export function announceStageRenderer(renderer: StageRenderer) {
  latestRenderer = renderer;
  for (const listener of [...rendererListeners]) listener(renderer);
}

export function applyStageRendererSettings(renderer: StageRenderer) {
  renderer.outputColorSpace = STAGE_OUTPUT_COLOR_SPACE;
  renderer.toneMapping = STAGE_TONE_MAPPING;
  renderer.shadowMap.type = PCFShadowMap;
}

/** Theme-dependent renderer state. The clear colour is the flat theme background, not tone mapped. */
export function applyStageAppearance(renderer: StageRenderer, appearance: { background: string; exposure: number }) {
  renderer.setClearColor(appearance.background, 1);
  renderer.toneMappingExposure = appearance.exposure;
}

const fit = (value: number) => (value * (value + 0.0245786) - 0.000090537) / (value * (0.983729 * value + 0.432951) + 0.238081);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Applies `STAGE_TONE_MAPPING` (ACES filmic, three's fit) to a colour in place, as the renderer
 * does to every lit surface. WebGL draws clear colours and `scene.background` without tone mapping,
 * so a backdrop that should sit in the picture like a lit surface is mapped here first.
 */
export function toneMapStageColor(color: Color, exposure: number): Color {
  const scale = exposure / 0.6;
  const r = color.r * scale, g = color.g * scale, b = color.b * scale;
  const x = fit(0.59719 * r + 0.35458 * g + 0.04823 * b);
  const y = fit(0.076 * r + 0.90834 * g + 0.01566 * b);
  const z = fit(0.0284 * r + 0.13383 * g + 0.83777 * b);
  return color.setRGB(
    clamp01(1.60475 * x - 0.53108 * y - 0.07367 * z),
    clamp01(-0.10208 * x + 1.10813 * y - 0.00605 * z),
    clamp01(-0.00327 * x - 0.07276 * y + 1.07602 * z),
  );
}
