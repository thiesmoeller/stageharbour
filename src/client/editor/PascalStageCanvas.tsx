import { DockPortal } from './EditorDock.js';
import { defaultLighting, type StageLightingSettings } from '../../shared/lighting.js';
import { ToolIcon } from './ToolIcon.js';
import { StageLighting } from './StageLighting.js';
import { FixtureSpotLights } from './FixtureSpotLights.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Viewer, useViewer } from '@pascal-app/viewer';
import { Vector2, Vector3, MOUSE, type Object3D } from 'three';
import type { StageModel } from '../../shared/transforms.js';
import type { Layout, VenueGeometry } from '../../shared/layout.js';
import type { Asset } from '../../shared/assets.js';
import { StageCamera, type StageCameraView } from './StageCamera.js';
import { StageTransformControls } from './StageTransformControls.js';
import { PushPullControls } from './PushPullControls.js';
import type { StageEditing } from './StageEditing.js';
import { VenueFloor } from './VenueFloor.js';
import { PascalSceneBridge, StageInteraction } from './PascalStageNodes.js';
import { useBlockBrowserZoom } from './viewportWheel.js';
import type { StageCaptureHandle } from './StageCapture.js';
import { captureViewportPng } from './StageCapture.js';
import type { PlanDisplayOptions } from '../../shared/planDisplay.js';
import { defaultPlanDisplay } from '../../shared/planDisplay.js';
import { focusTowardPoint, patchFixtureFocus, type HangPlan } from '../../shared/hangPlan.js';
import type { LightBoardLive } from './lightBoardLive.js';
import { trussHangWorld } from '../../shared/truss.js';

/** Viewer owns the R3F Canvas, so pointer-miss must be detected via raycast. */
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

type OrbitLike = Object3D & {
  enabled: boolean;
  enableRotate: boolean;
  mouseButtons: { LEFT?: number; MIDDLE?: number; RIGHT?: number };
};

function EditOrbitBinding({ allowOrbit }: { allowOrbit: boolean }) {
  const controls = useThree(state => state.controls) as OrbitLike | null;
  useLayoutEffect(() => {
    if (!controls?.mouseButtons) return;
    controls.enableRotate = allowOrbit;
    controls.mouseButtons.LEFT = -1;
    controls.mouseButtons.MIDDLE = MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = MOUSE.PAN;
  }, [allowOrbit, controls]);
  return null;
}

function PascalCaptureBridge({ onCaptureReady, mirrorWidth }: { onCaptureReady?: (handle: StageCaptureHandle | null) => void; mirrorWidth: number }) {
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
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        return captureViewportPng(gl as never, scene, camera, options);
      },
    };
    onCaptureReady(handle);
    return () => onCaptureReady(null);
  }, [camera, controls, gl, onCaptureReady, scene, mirrorWidth]);
  return null;
}

export default function PascalStageCanvas({ model, layout, venue, audience, view = audience ? 'audience' : 'orbit', assets, workspaceId, lighting = defaultLighting, planDisplay = defaultPlanDisplay, onCaptureReady, aimOnly = false, enhanced = true, selectedFixtureId, onFixtureSelect, focusAimMode, onHangPlanChange, lightBoardLive, showFixturePools = false, toolbarHost = null, ...editing }: {
  model: StageModel; layout: Layout; venue: VenueGeometry; audience: boolean; view?: StageCameraView; assets: Asset[]; workspaceId: string; lighting?: StageLightingSettings;
  planDisplay?: PlanDisplayOptions;
  onCaptureReady?: (handle: StageCaptureHandle | null) => void;
  aimOnly?: boolean;
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
  const theme = useViewer(state => state.sceneTheme);
  const setTheme = useViewer(state => state.setSceneTheme);
  const span = Math.max(model.floor.width, model.floor.depth) / 1000;
  const target = focusSelection && editing.pivot ? { x: editing.pivot.x, y: 0, z: editing.pivot.y } : audience ? model.audience.target : model.orbitTarget;
  const camera = audience ? model.audience.position : {
    x: model.orbitTarget.x + span * 350, y: span * 750, z: -span * 550,
  };
  useLayoutEffect(() => {
    useViewer.getState().setCameraMode('perspective');
    useViewer.getState().setRenderPaused(false);
  }, []);
  useLayoutEffect(() => {
    useViewer.getState().setShading(enhanced ? 'rendered' : 'solid');
    useViewer.getState().setTextures(enhanced);
  }, [enhanced]);
  /** Bühnenlicht + Lichtpult open → Scheinwerfer preview. */
  const hangLit = !!showFixturePools && lighting.enabled;
  useLayoutEffect(() => {
    useViewer.getState().setShadows(hangLit);
  }, [hangLit]);
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
  const mirrorWidth = model.floor.width;
  const mirroredCameraX = mirrorWidth - camera.x;
  const mirroredTargetX = mirrorWidth - target.x;
  const hangPlan = venue.hangPlan;
  const tools = !aimOnly ? <>
    <button type="button" className="quiet" aria-pressed={mode === 'select'} onClick={() => setMode('select')} title="3D auswählen" aria-label="3D auswählen"><ToolIcon name="select" /></button>
    <button type="button" className="quiet" disabled={!editing.pivot} onClick={() => frame(true)} title="Auswahl einpassen" aria-label="Auswahl einpassen"><ToolIcon name="expand" /></button>
    <button type="button" className="quiet" onClick={() => frame(false)} title="Bühne einpassen" aria-label="Bühne einpassen"><ToolIcon name="expand" /></button>
    {editing.onTransform && <>
      <button type="button" className="quiet" aria-pressed={mode === 'translate'} onClick={() => setMode('translate')} title="3D verschieben" aria-label="3D verschieben"><ToolIcon name="move" /></button>
      <button type="button" className="quiet" aria-pressed={mode === 'rotate'} onClick={() => setMode('rotate')} title="3D drehen" aria-label="3D drehen"><ToolIcon name="rotate" /></button>
    </>}
    {editing.onPushPull && <button type="button" className="quiet" aria-pressed={mode === 'pushPull'} onClick={() => setMode('pushPull')} title="Größe ziehen" aria-label="Größe ziehen"><ToolIcon name="pushPull" /></button>}
    <DockPortal panel="display"><details className="render-settings" open><summary>Darstellung</summary><div className="render-settings-body"><label>Umgebung <select value={theme} onChange={event => setTheme(event.target.value)}>
      <option value="studio">Studio</option><option value="paper">Warm</option>
      <option value="sunset">Abend</option>
    </select></label>
    <label><input type="checkbox" checked={detailed} onChange={event => setDetailed(event.target.checked)} /> Hohe Renderqualität</label></div></details></DockPortal>
  </> : null;
  return <StageInteraction.Provider value={{
    assets, workspaceId, mirrorWidth, model, venueEditable: editing.venueEditable,
    selectedIds: editing.selectedIds ?? [], onSelect: editing.onSelect, onClearSelection: editing.onClearSelection,
    hangPlan, planDisplay, stageWidth: venue.width, stageDepth: venue.depth,
    selectedFixtureId, onFixtureSelect: onFixtureSelect ? (id, _additive) => onFixtureSelect(id) : undefined,
    lightBoardLive: hangLit ? lightBoardLive : undefined, showFixturePools,
  }}>
    <PascalSceneBridge layout={layout} venue={venue} />
    {tools && (toolbarHost ? createPortal(tools, toolbarHost) : <div className="render-toolbar">{tools}</div>)}
    <div ref={canvas} className="stage-canvas" role="img" aria-label="Raumsicht der Spielstätte" data-renderer="pascal" data-lighting={lighting.enabled ? 'theatre' : 'studio'}
      data-focus-aim={focusAimMode || undefined}>
      <Viewer defaultRender={{ shading: 'rendered' }} selectionManager="custom" useBvh={false} renderContext="viewer"
        disablePostFx={aimOnly || !detailed}>
        {onCaptureReady && <PascalCaptureBridge onCaptureReady={onCaptureReady} mirrorWidth={mirrorWidth} />}
        {!aimOnly && <ClearSelectionOnMiss onClear={editing.onClearSelection} onFixtureClear={() => onFixtureSelect?.(null)} focusAimMode={focusAimMode} />}
        {!aimOnly && <FocusAimOnSurface enabled={!!focusAimMode} mirrorWidth={mirrorWidth} selectedFixtureId={selectedFixtureId}
          hangPlan={hangPlan} trusses={venue.trusses} onHangPlanChange={onHangPlanChange} />}
        <StageLighting settings={lighting} width={venue.width} depth={venue.depth} environmentKey={theme}
          lightBoardLive={hangLit ? lightBoardLive : undefined} />
        <FixtureSpotLights hangPlan={hangPlan} trusses={venue.trusses ?? []} stageWidth={venue.width} stageDepth={venue.depth}
          lightBoardLive={lightBoardLive} enabled={hangLit} />
        <StageCamera key={frameRevision} view={view} span={focusSelection && editing.pivot ? 3 : span} target={[mirroredTargetX / 1000, target.y / 1000, target.z / 1000]}
          position={view === 'top' ? [mirroredTargetX / 1000, span * 2, target.z / 1000] : view === 'side' ? [-span * 2, 2, target.z / 1000] : view === 'front' ? [mirroredTargetX / 1000, 2, -span] : focusSelection && editing.pivot ? [mirroredTargetX / 1000 + 2, 4, target.z / 1000 - 5] : [mirroredCameraX / 1000, camera.y / 1000, camera.z / 1000]} />
        <group position={[mirrorWidth / 1000, 0, 0]} scale={[-1, 1, 1]}>
          <group scale={0.001}>
          <VenueFloor venue={venue} lit />
          </group>
        </group>
        {!aimOnly && (mode === 'translate' || mode === 'rotate') && <StageTransformControls {...editing} width={mirrorWidth} mode={mode} />}
        {!aimOnly && <PushPullControls venue={editing.resizeDocument ?? venue} scope={editing.resizeScope ?? 'venue'} enabled={mode === 'pushPull'} snapEnabled={editing.snapEnabled} onPushPull={editing.onPushPull} />}
        <OrbitControls makeDefault
          target={[mirroredTargetX / 1000, target.y / 1000, target.z / 1000]} maxPolarAngle={Math.PI / 2 - 0.01} minDistance={0.1} maxDistance={500} />
        <EditOrbitBinding allowOrbit={view === 'orbit' || view === 'audience' || aimOnly} />
      </Viewer>
    </div>
  </StageInteraction.Provider>;
}
