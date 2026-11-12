import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useThree } from '@react-three/fiber';
import { Vector2, Vector3, type Object3D } from 'three';
import type { Asset } from '../../shared/assets.js';
import { focusTowardPoint, patchFixtureFocus, type HangPlan } from '../../shared/hangPlan.js';
import type { Layout, VenueGeometry } from '../../shared/layout.js';
import { defaultLighting, type StageLightingSettings } from '../../shared/lighting.js';
import type { PlanDisplayOptions } from '../../shared/planDisplay.js';
import { defaultPlanDisplay } from '../../shared/planDisplay.js';
import type { StageModel } from '../../shared/transforms.js';
import { trussHangWorld } from '../../shared/truss.js';
import { stageViewCamera, stageViewEye, type StageBounds, type StageViewPreset, type Vec3, type Viewport } from '../stage/cameraFraming.js';
import { LIGHT_THEME_IDS, lightTheme, type LightThemeId } from '../stage/lightThemes.js';
import type { StageQuality } from '../stage/renderer.js';
import { StageCanvas, type StageCameraInput } from '../stage/StageCanvas.js';
import { StageInstanceBatches, StageInstances } from '../stage/StageInstances.js';
import type { SurfaceDisplay } from '../stage/surfaceMaterials.js';
import { readStoredTheme, storeTheme } from '../stage/themePreference.js';
import { DockPortal } from './EditorDock.js';
import { FixtureSpotLights } from './FixtureSpotLights.js';
import type { LightBoardLive } from './lightBoardLive.js';
import { PushPullControls } from './PushPullControls.js';
import { captureViewportPng, type StageCaptureHandle } from './StageCapture.js';
import type { StageEditing } from './StageEditing.js';
import { StageElementView, StageInteraction } from './StageElements.js';
import { stageElements } from './stageElements.js';
import { StageLighting } from './StageLighting.js';
import { StageDisplay } from './stageMaterialHooks.js';
import { StageTransformControls } from './StageTransformControls.js';
import { ToolIcon } from './ToolIcon.js';
import { VenueFloor } from './VenueFloor.js';
import { useBlockBrowserZoom } from './viewportWheel.js';

/**
 * Clears the selection on a click that hits nothing but the floor. A press that moves more than
 * 6 px is a camera drag, and a click on a Scheinwerfer belongs to the fixture selection.
 */
function ClearSelectionOnMiss({ onClear, onFixtureClear, focusAimMode }: {
  onClear?: () => void;
  onFixtureClear?: () => void;
  focusAimMode?: boolean;
}) {
  const gl = useThree(state => state.gl);
  const camera = useThree(state => state.camera);
  const scene = useThree(state => state.scene);
  const raycaster = useThree(state => state.raycaster);
  useEffect(() => {
    if (!onClear && !onFixtureClear) return;
    const target = gl.domElement;
    if (!target) return;
    const ndc = new Vector2();
    let origin: { x: number; y: number } | undefined;
    const onDown = (event: PointerEvent) => { origin = { x: event.clientX, y: event.clientY }; };
    const onUp = (event: PointerEvent) => {
      if (!origin) return;
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
      origin = undefined;
      if (dx * dx + dy * dy > 36) return;
      if (focusAimMode) return;
      const rect = target.getBoundingClientRect();
      ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      const hitFixture = hits.some(hit => {
        let node: Object3D | null = hit.object;
        while (node) {
          if (node.userData?.lightingFixtureId) return true;
          node = node.parent;
        }
        return false;
      });
      if (hitFixture) return;
      if (!hits.some(hit => hit.object.name !== 'venue-floor' && hit.object.visible)) {
        onClear?.();
        onFixtureClear?.();
      }
    };
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointerup', onUp);
    return () => {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointerup', onUp);
    };
  }, [camera, focusAimMode, gl, onClear, onFixtureClear, raycaster, scene]);
  return null;
}

/** Capture-style focus: click any visible surface to aim the selected fixture. */
function FocusAimOnSurface({ enabled, mirrorWidth, selectedFixtureId, hangPlan, trusses, onHangPlanChange }: {
  enabled: boolean;
  mirrorWidth: number;
  selectedFixtureId?: string | null;
  hangPlan?: HangPlan;
  trusses: VenueGeometry['trusses'];
  onHangPlanChange?: (plan: HangPlan) => void;
}) {
  const gl = useThree(state => state.gl);
  const camera = useThree(state => state.camera);
  const scene = useThree(state => state.scene);
  const raycaster = useThree(state => state.raycaster);
  useEffect(() => {
    if (!enabled || !selectedFixtureId || !hangPlan || !onHangPlanChange) return;
    const target = gl.domElement;
    if (!target) return;
    const ndc = new Vector2();
    let origin: { x: number; y: number } | undefined;
    const onDown = (event: PointerEvent) => { origin = { x: event.clientX, y: event.clientY }; };
    const onUp = (event: PointerEvent) => {
      if (!origin) return;
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
      origin = undefined;
      if (dx * dx + dy * dy > 36) return;
      const rect = target.getBoundingClientRect();
      ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      const hit = hits.find(entry => {
        let node: Object3D | null = entry.object;
        while (node) {
          if (node.userData?.lightingFixtureId) return false;
          if (node.name.startsWith('fixture-spot')) return false;
          node = node.parent;
        }
        return entry.object.visible;
      });
      if (!hit) return;
      // Meshes live under mirror + mm→m scale: recover plan millimetres (incl. height).
      const world = hit.point;
      const xMm = mirrorWidth - world.x * 1000;
      const yMm = world.y * 1000;
      const zMm = world.z * 1000;
      const fixture = hangPlan.fixtures.find(item => item.id === selectedFixtureId);
      if (!fixture) return;
      const truss = (trusses ?? []).find(item => item.id === fixture.trussId);
      const hang = truss?.hangPoints.find(point => point.id === fixture.hangPointId);
      if (!truss || !hang) return;
      const worldHang = trussHangWorld(truss, hang);
      const aimed = focusTowardPoint(
        { x: worldHang.x, y: truss.bottomHeight, z: worldHang.y },
        { x: xMm, y: yMm, z: zMm },
      );
      onHangPlanChange(patchFixtureFocus(hangPlan, fixture.id, aimed));
    };
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointerup', onUp);
    return () => {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointerup', onUp);
    };
  }, [camera, enabled, gl, hangPlan, mirrorWidth, onHangPlanChange, raycaster, scene, selectedFixtureId, trusses]);
  return null;
}

function CaptureBridge({ onCaptureReady, mirrorWidth }: { onCaptureReady?: (handle: StageCaptureHandle | null) => void; mirrorWidth: number }) {
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  const controls = useThree(state => state.controls);
  useEffect(() => {
    if (!onCaptureReady) return;
    const handle: StageCaptureHandle = {
      getCamera() {
        const target = controls && 'target' in controls && controls.target instanceof Vector3
          ? controls.target : camera.position.clone().add(camera.getWorldDirection(new Vector3()));
        const toModel = (point: Vector3) => ({ x: mirrorWidth - point.x * 1000, y: point.y * 1000, z: point.z * 1000 });
        return { projection: camera.type === 'OrthographicCamera' ? 'orthographic' : 'perspective', position: toModel(camera.position), target: toModel(target) };
      },
      async capturePng(options) {
        // One frame later, so state changes made just before the capture are in the scene.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        return captureViewportPng(gl, scene, camera, options);
      },
    };
    onCaptureReady(handle);
    return () => onCaptureReady(null);
  }, [camera, controls, gl, onCaptureReady, scene, mirrorWidth]);
  return null;
}

/** A browser without a usable WebGL context throws while the canvas mounts; the editor stays up. */
class WebGlBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('Raumsicht could not start', error);
  }

  render() {
    return this.state.failed
      ? <p className="error" role="alert">Die 3D-Ansicht konnte nicht gestartet werden: Dieser Browser stellt kein WebGL bereit.</p>
      : this.props.children;
  }
}

const SOLID_DISPLAY: SurfaceDisplay = { shading: 'solid', textures: false };
const RENDERED_DISPLAY: SurfaceDisplay = { shading: 'rendered', textures: true };

export default function RaumsichtCanvas({ model, layout, venue, audience, view = audience ? 'audience' : 'orbit', assets, workspaceId, lighting = defaultLighting, planDisplay = defaultPlanDisplay, onCaptureReady, aimOnly = false, enhanced = true, selectedFixtureId, onFixtureSelect, focusAimMode, onHangPlanChange, lightBoardLive, showFixturePools = false, toolbarHost = null, ...editing }: {
  model: StageModel; layout: Layout; venue: VenueGeometry; audience: boolean; view?: StageViewPreset; assets: Asset[]; workspaceId: string; lighting?: StageLightingSettings;
  planDisplay?: PlanDisplayOptions;
  onCaptureReady?: (handle: StageCaptureHandle | null) => void;
  aimOnly?: boolean;
  /** Erweiterte Darstellung: textures and physically based shading. Off is the plain, fast view. */
  enhanced?: boolean;
  selectedFixtureId?: string | null;
  onFixtureSelect?: (id: string | null) => void;
  focusAimMode?: boolean;
  onHangPlanChange?: (plan: HangPlan) => void;
  lightBoardLive?: LightBoardLive;
  showFixturePools?: boolean;
  /** Host in the top floating stage toolbar (FreeCAD-style); avoids overlapping Lichtpult. */
  toolbarHost?: HTMLElement | null;
} & StageEditing) {
  const [focusSelection, setFocusSelection] = useState(false);
  const [frameRevision, setFrameRevision] = useState(0);
  function frame(selection: boolean) { setFocusSelection(selection); setFrameRevision(value => value + 1); }
  const [mode, setMode] = useState<'select' | 'translate' | 'rotate' | 'pushPull'>('select');
  const [detailed, setDetailed] = useState(false);
  const [theme, setThemeState] = useState<LightThemeId>(readStoredTheme);
  function setTheme(next: LightThemeId) { setThemeState(next); storeTheme(next); }
  const span = Math.max(model.floor.width, model.floor.depth) / 1000;
  const focus = focusSelection && !!editing.pivot;
  const target = focus && editing.pivot ? { x: editing.pivot.x, y: 0, z: editing.pivot.y } : audience ? model.audience.target : model.orbitTarget;
  const eye = audience ? model.audience.position : {
    x: model.orbitTarget.x + span * 350, y: span * 750, z: -span * 550,
  };
  /** Bühnenlicht + Lichtpult open → Scheinwerfer preview. */
  const hangLit = !!showFixturePools && lighting.enabled;
  const quality: StageQuality = !enhanced ? 'simple' : detailed && !aimOnly ? 'high' : 'enhanced';
  const canvas = useRef<HTMLDivElement>(null);
  useBlockBrowserZoom(canvas);
  useEffect(() => {
    if (aimOnly) return;
    const exitTool = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || mode === 'select') return;
      (event as KeyboardEvent & { stageToolExitHandled?: boolean }).stageToolExitHandled = true;
      setMode('select');
    };
    window.addEventListener('keydown', exitTool, true);
    return () => window.removeEventListener('keydown', exitTool, true);
  }, [aimOnly, mode]);
  // The stage is drawn mirrored in X, so audience-left is on the left of the picture.
  const mirrorWidth = model.floor.width;
  const viewTarget: Vec3 = [(mirrorWidth - target.x) / 1000, target.y / 1000, target.z / 1000];
  const viewEye: Vec3 = [(mirrorWidth - eye.x) / 1000, eye.y / 1000, eye.z / 1000];
  const camera: StageCameraInput = (viewport: Viewport) => ({
    mode: 'look',
    ...stageViewCamera(view, {
      target: viewTarget, position: stageViewEye(view, { target: viewTarget, eye: viewEye, span, focus }), span: focus ? 3 : span, viewport,
    }),
  });
  const hangPlan = venue.hangPlan;
  const elements = useMemo(() => stageElements(layout, venue), [layout, venue]);
  const stageTop = Math.max(3000, venue.ceilingHeight ?? 0, ...model.walls.map(wall => wall.center.y + wall.size.y / 2));
  const bounds: StageBounds = { min: [0, 0, 0], max: [model.floor.width / 1000, stageTop / 1000, model.floor.depth / 1000] };
  const interaction = useMemo(() => ({
    assets, workspaceId, mirrorWidth, model, venueEditable: editing.venueEditable,
    selectedIds: editing.selectedIds ?? [], onSelect: editing.onSelect,
    hangPlan, planDisplay, stageWidth: venue.width, stageDepth: venue.depth,
    selectedFixtureId, onFixtureSelect: onFixtureSelect ? (id: string) => onFixtureSelect(id) : undefined,
    lightBoardLive: hangLit ? lightBoardLive : undefined,
  }), [assets, workspaceId, mirrorWidth, model, editing.venueEditable, editing.selectedIds, editing.onSelect, hangPlan, planDisplay,
    venue.width, venue.depth, selectedFixtureId, onFixtureSelect, hangLit, lightBoardLive]);
  const tools = !aimOnly ? <>
    <button type="button" className="quiet" aria-pressed={mode === 'select'} onClick={() => setMode('select')} title="3D auswählen" aria-label="3D auswählen"><ToolIcon name="select" /></button>
    <button type="button" className="quiet" disabled={!editing.pivot} onClick={() => frame(true)} title="Auswahl einpassen" aria-label="Auswahl einpassen"><ToolIcon name="expand" /></button>
    <button type="button" className="quiet" onClick={() => frame(false)} title="Bühne einpassen" aria-label="Bühne einpassen"><ToolIcon name="expand" /></button>
    {editing.onTransform && <>
      <button type="button" className="quiet" aria-pressed={mode === 'translate'} onClick={() => setMode('translate')} title="3D verschieben" aria-label="3D verschieben"><ToolIcon name="move" /></button>
      <button type="button" className="quiet" aria-pressed={mode === 'rotate'} onClick={() => setMode('rotate')} title="3D drehen" aria-label="3D drehen"><ToolIcon name="rotate" /></button>
    </>}
    {editing.onPushPull && <button type="button" className="quiet" aria-pressed={mode === 'pushPull'} onClick={() => setMode('pushPull')} title="Größe ziehen" aria-label="Größe ziehen"><ToolIcon name="pushPull" /></button>}
    <DockPortal panel="display"><details className="render-settings" open><summary>Darstellung</summary><div className="render-settings-body"><label>Umgebung <select value={theme} onChange={event => setTheme(lightTheme(event.target.value).id)}>
      {LIGHT_THEME_IDS.map(id => <option key={id} value={id}>{lightTheme(id).label}</option>)}
    </select></label>
    <label title="Weiche Schatten des Hauptlichts und höhere Auflösung auf hochauflösenden Bildschirmen. Nur in der erweiterten Darstellung.">
      <input type="checkbox" checked={detailed && enhanced} disabled={!enhanced} onChange={event => setDetailed(event.target.checked)} /> Hohe Renderqualität</label></div></details></DockPortal>
  </> : null;
  return <StageInteraction.Provider value={interaction}>
    {tools && (toolbarHost ? createPortal(tools, toolbarHost) : <div className="render-toolbar">{tools}</div>)}
    <div ref={canvas} className="stage-canvas" role="img" aria-label="Raumsicht der Spielstätte" data-renderer="stage" data-lighting={lighting.enabled ? 'theatre' : 'studio'}
      data-quality={quality} data-focus-aim={focusAimMode || undefined}>
      <WebGlBoundary>
        <StageCanvas theme={theme} quality={quality} lights={false} camera={camera} cameraRevision={frameRevision}
          controls={{ buttons: 'editor', enableRotate: view === 'orbit' || view === 'audience' || aimOnly }}>
          <StageDisplay.Provider value={enhanced ? RENDERED_DISPLAY : SOLID_DISPLAY}>
            <StageInstances>
              {onCaptureReady && <CaptureBridge onCaptureReady={onCaptureReady} mirrorWidth={mirrorWidth} />}
              {!aimOnly && <ClearSelectionOnMiss onClear={editing.onClearSelection} onFixtureClear={() => onFixtureSelect?.(null)} focusAimMode={focusAimMode} />}
              {!aimOnly && <FocusAimOnSurface enabled={!!focusAimMode} mirrorWidth={mirrorWidth} selectedFixtureId={selectedFixtureId}
                hangPlan={hangPlan} trusses={venue.trusses} onHangPlanChange={onHangPlanChange} />}
              <StageLighting settings={lighting} width={venue.width} depth={venue.depth}
                lightBoardLive={hangLit ? lightBoardLive : undefined} keyShadows={quality === 'high'} bounds={bounds}
                backdrop={lightTheme(theme).background} />
              <FixtureSpotLights hangPlan={hangPlan} trusses={venue.trusses ?? []} stageWidth={venue.width} stageDepth={venue.depth}
                lightBoardLive={lightBoardLive} enabled={hangLit} />
              <group position={[mirrorWidth / 1000, 0, 0]} scale={[-1, 1, 1]}>
                <group scale={0.001}>
                  <VenueFloor venue={venue} />
                  <StageInstanceBatches />
                </group>
              </group>
              {elements.map(item => <StageElementView key={item.id} item={item} />)}
              {!aimOnly && (mode === 'translate' || mode === 'rotate') && <StageTransformControls {...editing} width={mirrorWidth} mode={mode} />}
              {!aimOnly && <PushPullControls venue={editing.resizeDocument ?? venue} scope={editing.resizeScope ?? 'venue'} enabled={mode === 'pushPull'} snapEnabled={editing.snapEnabled} onPushPull={editing.onPushPull} />}
            </StageInstances>
          </StageDisplay.Provider>
        </StageCanvas>
      </WebGlBoundary>
    </div>
  </StageInteraction.Provider>;
}
