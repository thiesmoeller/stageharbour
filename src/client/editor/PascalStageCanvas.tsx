import { useLayoutEffect, useRef, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import { Viewer, useViewer } from '@pascal-app/viewer';
import type { StageModel } from '../../shared/transforms.js';
import type { Layout, VenueGeometry } from '../../shared/layout.js';
import type { Asset } from '../../shared/assets.js';
import { StageCamera, type StageCameraView } from './StageCamera.js';
import { StageTransformControls } from './StageTransformControls.js';
import type { StageEditing } from './StageEditing.js';
import { VenueFloor } from './VenueFloor.js';
import { PascalSceneBridge, StageInteraction } from './PascalStageNodes.js';
import { useBlockBrowserZoom } from './viewportWheel.js';

export default function PascalStageCanvas({ model, layout, venue, audience, view = audience ? 'audience' : 'orbit', assets, workspaceId, ...editing }: { model: StageModel; layout: Layout; venue: VenueGeometry; audience: boolean; view?: StageCameraView; assets: Asset[]; workspaceId: string } & StageEditing) {
  const [focusSelection, setFocusSelection] = useState(false);
  const [mode, setMode] = useState<'translate' | 'rotate'>('translate');
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
  return <StageInteraction.Provider value={{ assets, workspaceId, mirrorWidth, model, venueEditable: editing.venueEditable, selectedIds: editing.selectedIds ?? [], onSelect: editing.onSelect }}>
    <PascalSceneBridge layout={layout} venue={venue} />
    <div className="render-toolbar">
      <button type="button" className="quiet" disabled={!editing.pivot} onClick={() => setFocusSelection(true)}>Auswahl einpassen</button><button type="button" className="quiet" onClick={() => setFocusSelection(false)}>Bühne einpassen</button>
      {editing.onTransform && <><button type="button" className="quiet" aria-pressed={mode === 'translate'} onClick={() => setMode('translate')}>3D verschieben</button><button type="button" className="quiet" aria-pressed={mode === 'rotate'} onClick={() => setMode('rotate')}>3D drehen</button></>}
      <label>Umgebung <select value={theme} onChange={event => setTheme(event.target.value)}>
        <option value="studio">Studio</option><option value="paper">Warm</option>
        <option value="sunset">Abend</option>
      </select></label>
      <label><input type="checkbox" checked={detailed} onChange={event => setDetailed(event.target.checked)} /> Hohe Renderqualität</label>
    </div>
    <div ref={canvas} className="stage-canvas" role="img" aria-label="Raumsicht der Spielstätte" data-renderer="pascal">
      <Viewer selectionManager="custom" useBvh={false} renderContext="viewer" disablePostFx={!detailed}>
        <StageCamera view={view} span={focusSelection && editing.pivot ? 3 : span} target={[mirroredTargetX / 1000, target.y / 1000, target.z / 1000]}
          position={view === 'top' ? [mirroredTargetX / 1000, span * 2, target.z / 1000] : view === 'side' ? [-span * 2, 2, target.z / 1000] : view === 'front' ? [mirroredTargetX / 1000, 2, -span] : focusSelection && editing.pivot ? [mirroredTargetX / 1000 + 2, 4, target.z / 1000 - 5] : [mirroredCameraX / 1000, camera.y / 1000, camera.z / 1000]} />
        <group position={[mirrorWidth / 1000, 0, 0]} scale={[-1, 1, 1]}>
          <group scale={0.001}>
          <VenueFloor venue={venue} lit />
          </group>
        </group>
        <StageTransformControls {...editing} width={mirrorWidth} mode={mode} />
        <OrbitControls key={view} enableRotate={view === 'orbit'} makeDefault target={[mirroredTargetX / 1000, target.y / 1000, target.z / 1000]} maxPolarAngle={Math.PI / 2 - 0.01} minDistance={0.1} maxDistance={500} />
      </Viewer>
    </div>
  </StageInteraction.Provider>;
}
