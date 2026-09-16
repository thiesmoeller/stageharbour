import { defaultLighting, type StageLightingSettings } from '../../shared/lighting.js';
import { ToolIcon } from './ToolIcon.js';
import { StageLighting } from './StageLighting.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Viewer, useViewer } from '@pascal-app/viewer';
import { Vector2, MOUSE, type Object3D } from 'three';
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

/** Viewer owns the R3F Canvas, so pointer-miss must be detected via raycast. */
function ClearSelectionOnMiss({ onClear }: { onClear?: () => void }) {
  const gl = useThree(state => state.gl);
  const camera = useThree(state => state.camera);
  const scene = useThree(state => state.scene);
  const raycaster = useThree(state => state.raycaster);
  useEffect(() => {
    if (!onClear) return;
    const ndc = new Vector2();
    let origin: { x: number; y: number } | undefined;
    const onDown = (event: PointerEvent) => { origin = { x: event.clientX, y: event.clientY }; };
    const onUp = (event: PointerEvent) => {
      if (!origin) return;
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
      origin = undefined;
      if (dx * dx + dy * dy > 36) return;
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      if (!hits.some(hit => hit.object.name !== 'venue-floor' && hit.object.visible)) onClear();
    };
    gl.domElement.addEventListener('pointerdown', onDown);
    gl.domElement.addEventListener('pointerup', onUp);
    return () => {
      gl.domElement.removeEventListener('pointerdown', onDown);
      gl.domElement.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, onClear, raycaster, scene]);
  return null;
}

type OrbitLike = Object3D & {
  enabled: boolean;
  enableRotate: boolean;
  mouseButtons: { LEFT?: number; MIDDLE?: number; RIGHT?: number };
};

/**
 * CAD binding: LMB never orbits while an edit tool owns the viewport.
 * Orbit is middle-mouse; pan is right-mouse. Avoids LMB races with gizmo / Größe ziehen.
 */
function EditOrbitBinding({ allowOrbit }: { allowOrbit: boolean }) {
  const controls = useThree(state => state.controls) as OrbitLike | null;
  useLayoutEffect(() => {
    if (!controls?.mouseButtons) return;
    controls.enableRotate = allowOrbit;
    // -1 is OrbitControls' "no action" (see three-stdlib default branch).
    controls.mouseButtons.LEFT = -1;
    controls.mouseButtons.MIDDLE = MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = MOUSE.PAN;
  }, [allowOrbit, controls]);
  return null;
}

export default function PascalStageCanvas({ model, layout, venue, audience, view = audience ? 'audience' : 'orbit', assets, workspaceId, lighting = defaultLighting, ...editing }: { model: StageModel; layout: Layout; venue: VenueGeometry; audience: boolean; view?: StageCameraView; assets: Asset[]; workspaceId: string; lighting?: StageLightingSettings } & StageEditing) {
  const [focusSelection, setFocusSelection] = useState(false);
  const [frameRevision, setFrameRevision] = useState(0);
  function frame(selection: boolean) { setFocusSelection(selection); setFrameRevision(value => value + 1); }
  const [mode, setMode] = useState<'translate' | 'rotate' | 'pushPull'>('translate');
  const [detailed, setDetailed] = useState(false);
  const theme = useViewer(state => state.sceneTheme);
  const setTheme = useViewer(state => state.setSceneTheme);
  // Pascal lighting, cameras and screen-space effects use metres. The source
  // model stays in millimetres, including the 28 mm panels and export geometry.
  const span = Math.max(model.floor.width, model.floor.depth) / 1000;
  const target = focusSelection && editing.pivot ? { x: editing.pivot.x, y: 0, z: editing.pivot.y } : audience ? model.audience.target : model.orbitTarget;
  const camera = audience ? model.audience.position : {
    x: model.orbitTarget.x + span * 350, y: span * 750, z: -span * 550,
  };
  useLayoutEffect(() => {
    useViewer.getState().setCameraMode('perspective');
    useViewer.getState().setRenderPaused(false);
    useViewer.getState().setShadows(true);
  }, []);
  const canvas = useRef<HTMLDivElement>(null);
  useBlockBrowserZoom(canvas);
  const mirrorWidth = model.floor.width;
  const mirroredCameraX = mirrorWidth - camera.x;
  const mirroredTargetX = mirrorWidth - target.x;
  return <StageInteraction.Provider value={{ assets, workspaceId, mirrorWidth, model, venueEditable: editing.venueEditable, selectedIds: editing.selectedIds ?? [], onSelect: editing.onSelect, onClearSelection: editing.onClearSelection }}>
    <PascalSceneBridge layout={layout} venue={venue} />
    <div className="render-toolbar">
      <button type="button" className="quiet" disabled={!editing.pivot} onClick={() => frame(true)}><ToolIcon name="expand" />Auswahl einpassen</button><button type="button" className="quiet" onClick={() => frame(false)}><ToolIcon name="expand" />Bühne einpassen</button>
      {editing.onTransform && <><button type="button" className="quiet" aria-pressed={mode === 'translate'} onClick={() => setMode('translate')} title="3D verschieben"><ToolIcon name="move" />3D verschieben</button><button type="button" className="quiet" aria-pressed={mode === 'rotate'} onClick={() => setMode('rotate')} title="3D drehen"><ToolIcon name="rotate" />3D drehen</button></>}
      {editing.onPushPull && <button type="button" className="quiet" aria-pressed={mode === 'pushPull'} onClick={() => setMode('pushPull')} title="Größe ziehen" aria-label="Größe ziehen"><ToolIcon name="expand" />Größe ziehen</button>}
      <details className="render-settings"><summary>Darstellung</summary><div className="render-settings-body"><label>Umgebung <select value={theme} onChange={event => setTheme(event.target.value)}>
        <option value="studio">Studio</option><option value="paper">Warm</option>
        <option value="sunset">Abend</option>
      </select></label>
      <label><input type="checkbox" checked={detailed} onChange={event => setDetailed(event.target.checked)} /> Hohe Renderqualität</label></div></details>
    </div>
    <div ref={canvas} className="stage-canvas" role="img" aria-label="Raumsicht der Spielstätte" data-renderer="pascal" data-lighting={lighting.enabled ? 'theatre' : 'studio'}>
      <Viewer defaultRender={{ shading: 'rendered' }} selectionManager="custom" useBvh={false} renderContext="viewer" disablePostFx={!detailed || lighting.enabled}>
        <ClearSelectionOnMiss onClear={editing.onClearSelection} />
        <StageLighting settings={lighting} width={venue.width} depth={venue.depth} environmentKey={theme} />
        <StageCamera key={frameRevision} view={view} span={focusSelection && editing.pivot ? 3 : span} target={[mirroredTargetX / 1000, target.y / 1000, target.z / 1000]}
          position={view === 'top' ? [mirroredTargetX / 1000, span * 2, target.z / 1000] : view === 'side' ? [-span * 2, 2, target.z / 1000] : view === 'front' ? [mirroredTargetX / 1000, 2, -span] : focusSelection && editing.pivot ? [mirroredTargetX / 1000 + 2, 4, target.z / 1000 - 5] : [mirroredCameraX / 1000, camera.y / 1000, camera.z / 1000]} />
        <group position={[mirrorWidth / 1000, 0, 0]} scale={[-1, 1, 1]}>
          <group scale={0.001}>
          {/* ClearSelectionOnMiss distinguishes floor clicks from completed handle drags. */}
          <VenueFloor venue={venue} lit />
          </group>
        </group>
        {mode !== 'pushPull' && <StageTransformControls {...editing} width={mirrorWidth} mode={mode === 'rotate' ? 'rotate' : 'translate'} />}
        <PushPullControls venue={editing.resizeDocument ?? venue} scope={editing.resizeScope ?? 'venue'} enabled={mode === 'pushPull'} snapEnabled={editing.snapEnabled} onPushPull={editing.onPushPull} />
        <OrbitControls key={`${view}-${frameRevision}`} makeDefault
          target={[mirroredTargetX / 1000, target.y / 1000, target.z / 1000]} maxPolarAngle={Math.PI / 2 - 0.01} minDistance={0.1} maxDistance={500} />
        <EditOrbitBinding allowOrbit={view === 'orbit'} />
      </Viewer>
    </div>
  </StageInteraction.Provider>;
}
