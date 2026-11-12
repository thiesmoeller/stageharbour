import { createContext, useContext, useImperativeHandle, useLayoutEffect, useMemo, type CSSProperties, type ReactNode, type Ref } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { MOUSE, OrthographicCamera as ThreeOrthographicCamera, PerspectiveCamera as ThreePerspectiveCamera, type Camera, type Mesh, type Scene } from 'three';
import {
  DEFAULT_STAGE_BOUNDS, boundsCenter, boundsSize, isUsableBounds, resolveStageCamera, vector,
  type StageBounds, type StageCameraConfig, type Viewport,
} from './cameraFraming.js';
import { DEFAULT_LIGHT_THEME_ID, lightTheme, type LightTheme, type LightThemeId } from './lightThemes.js';
import { applyStageAppearance, applyStageRendererSettings, createStageRenderer, pixelRatioRange, shadowMapConfig, type StageQuality, type StageRenderer } from './renderer.js';
import { StageLights } from './StageLights.js';

/** A camera, or a function of the canvas size in CSS pixels (re-applied when the size changes). */
export type StageCameraInput = StageCameraConfig | ((viewport: Viewport) => StageCameraConfig);

export type StageControlsConfig = {
  /** `editor`: left button free for selection, middle orbits, right pans. `preview`: left orbits. */
  buttons?: 'editor' | 'preview';
  enableRotate?: boolean;
  enablePan?: boolean;
  enableZoom?: boolean;
  enableDamping?: boolean;
  maxPolarAngle?: number;
  minDistance?: number;
  maxDistance?: number;
};

/** `solid` is a theme-coloured floor plane; `shadow` only darkens where shadows fall. */
export type StageGroundMode = 'none' | 'solid' | 'shadow';

export type StageCanvasHandle = {
  readonly gl: StageRenderer;
  readonly scene: Scene;
  readonly camera: Camera;
  invalidate(): void;
  /** Renders one frame synchronously, for captures and `frameloop="never"`. */
  render(): void;
};

export type StageCanvasProps = {
  children?: ReactNode;
  theme?: LightThemeId;
  quality?: StageQuality;
  /** Stage extent in view-space metres: fits the shadow camera, the ground and `frame` cameras. */
  bounds?: StageBounds;
  camera?: StageCameraInput;
  controls?: StageControlsConfig | false;
  /** Theme lights. Callers that bring their own lighting rig pass false. */
  lights?: boolean;
  ground?: StageGroundMode;
  /** Click on empty space or on objects without pointer handlers; drags over 2 px do not count. */
  onPointerMissed?: (event: MouseEvent) => void;
  /** Defaults to `demand`: frames render on change only. */
  frameloop?: 'always' | 'demand' | 'never';
  /** Creation-time only. */
  preserveDrawingBuffer?: boolean;
  ref?: Ref<StageCanvasHandle>;
  className?: string;
  style?: CSSProperties;
  id?: string;
  role?: string;
  'aria-label'?: string;
};

export type StageCanvasContextValue = { theme: LightTheme; quality: StageQuality; bounds?: StageBounds };

const StageCanvasContext = createContext<StageCanvasContextValue | null>(null);

export function useStageCanvas() {
  const value = useContext(StageCanvasContext);
  if (!value) throw new Error('useStageCanvas must be used inside a StageCanvas');
  return value;
}

const DEFAULT_CAMERA: StageCameraConfig = { mode: 'frame' };

export function StageCanvas({
  children, theme = DEFAULT_LIGHT_THEME_ID, quality = 'enhanced', bounds, camera = DEFAULT_CAMERA, controls = {},
  lights = true, ground = 'none', onPointerMissed, frameloop = 'demand', preserveDrawingBuffer = false, ref, ...rest
}: StageCanvasProps) {
  const spec = lightTheme(theme);
  const boundsKey = bounds ? JSON.stringify(bounds) : '';
  const stableBounds = useMemo(() => isUsableBounds(bounds) ? bounds : undefined, [boundsKey]);
  const groundBounds = stableBounds ?? DEFAULT_STAGE_BOUNDS;
  const context = useMemo(() => ({ theme: spec, quality, bounds: stableBounds }), [spec, quality, stableBounds]);
  return <Canvas {...rest} frameloop={frameloop} dpr={pixelRatioRange(quality)} shadows={shadowMapConfig(quality)}
    gl={({ canvas, powerPreference }) => createStageRenderer({ canvas: canvas as HTMLCanvasElement, preserveDrawingBuffer, powerPreference })}
    onPointerMissed={onPointerMissed}>
    <StageCanvasContext.Provider value={context}>
      <StageHandle handleRef={ref} />
      <RendererAppearance theme={spec} quality={quality} />
      <StageCameraRig input={camera} bounds={stableBounds} controls={controls} />
      {lights && <StageLights theme={spec} quality={quality} bounds={stableBounds} shadowGroundY={ground !== 'none' ? groundBounds.min[1] : undefined} />}
      {ground !== 'none' && <StageGround mode={ground} theme={spec} bounds={groundBounds} />}
      {children}
    </StageCanvasContext.Provider>
  </Canvas>;
}

function StageHandle({ handleRef }: { handleRef?: Ref<StageCanvasHandle> }) {
  const get = useThree(state => state.get);
  useImperativeHandle(handleRef, () => ({
    get gl() { return get().gl; },
    get scene() { return get().scene; },
    get camera() { return get().camera; },
    invalidate: () => get().invalidate(),
    render: () => {
      const state = get();
      state.gl.render(state.scene, state.camera);
    },
  }), [get]);
  return null;
}

function RendererAppearance({ theme, quality }: { theme: LightTheme; quality: StageQuality }) {
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => {
    applyStageRendererSettings(gl);
    applyStageAppearance(gl, { background: theme.background, exposure: theme.toneMappingExposure });
    invalidate();
  }, [gl, theme, invalidate]);
  useLayoutEffect(() => {
    // Shadow-map enablement is part of every lit material's program key.
    scene.traverse(object => {
      const material = (object as Mesh).material;
      if (!material) return;
      for (const entry of Array.isArray(material) ? material : [material]) entry.needsUpdate = true;
    });
    invalidate();
  }, [quality, scene, invalidate]);
  return null;
}

type OrbitControlsLike = { target: { set(x: number, y: number, z: number): void }; update(): void; mouseButtons: Record<'LEFT' | 'MIDDLE' | 'RIGHT', MOUSE | -1 | null> };

const MOUSE_BUTTONS = {
  editor: { LEFT: -1, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN },
  preview: { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN },
} as const;

function StageCameraRig({ input, bounds, controls }: { input: StageCameraInput; bounds?: StageBounds; controls: StageControlsConfig | false }) {
  const width = useThree(state => state.size.width);
  const height = useThree(state => state.size.height);
  const camera = useThree(state => state.camera);
  const active = useThree(state => state.controls) as OrbitControlsLike | null;
  const invalidate = useThree(state => state.invalidate);
  const look = resolveStageCamera(typeof input === 'function' ? input({ width, height }) : input, { width, height }, bounds);
  const lookKey = JSON.stringify(look);
  const buttons = controls ? controls.buttons ?? 'editor' : undefined;
  useLayoutEffect(() => {
    camera.up.set(...look.up);
    camera.position.set(...look.position);
    camera.lookAt(...look.target);
    if (camera instanceof ThreeOrthographicCamera || camera instanceof ThreePerspectiveCamera) {
      camera.near = look.near;
      camera.far = look.far;
      if (camera instanceof ThreeOrthographicCamera) camera.zoom = look.zoom;
      else camera.fov = look.fov;
      camera.updateProjectionMatrix();
    }
    if (active) {
      active.target.set(...look.target);
      active.update();
    }
    invalidate();
  }, [lookKey, camera, active, invalidate]);
  useLayoutEffect(() => {
    if (!active || !buttons) return;
    Object.assign(active.mouseButtons, MOUSE_BUTTONS[buttons]);
  }, [active, buttons]);
  return <>
    {look.projection === 'orthographic'
      ? <OrthographicCamera makeDefault position={vector(look.position)} up={vector(look.up)} zoom={look.zoom} near={look.near} far={look.far} />
      : <PerspectiveCamera makeDefault position={vector(look.position)} up={vector(look.up)} fov={look.fov} near={look.near} far={look.far} />}
    {controls && <OrbitControls makeDefault
      enableRotate={controls.enableRotate ?? true} enablePan={controls.enablePan ?? true} enableZoom={controls.enableZoom ?? true}
      enableDamping={controls.enableDamping ?? true} maxPolarAngle={controls.maxPolarAngle ?? Math.PI / 2 - 0.01}
      minDistance={controls.minDistance ?? 0.1} maxDistance={controls.maxDistance ?? 500} />}
  </>;
}

function StageGround({ mode, theme, bounds }: { mode: Exclude<StageGroundMode, 'none'>; theme: LightTheme; bounds: StageBounds }) {
  const [cx, , cz] = boundsCenter(bounds);
  const [sx, , sz] = boundsSize(bounds);
  const extent = Math.max(20, 4 * Math.max(sx, sz));
  return <mesh name="stage-ground" rotation={[-Math.PI / 2, 0, 0]} position={[cx, bounds.min[1], cz]} receiveShadow>
    <planeGeometry args={[extent, extent]} />
    {mode === 'shadow'
      ? <shadowMaterial opacity={0.3} depthWrite={false} />
      : <meshStandardMaterial color={theme.ground} roughness={1} metalness={0} />}
  </mesh>;
}
