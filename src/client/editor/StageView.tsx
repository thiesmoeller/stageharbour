import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { WallMesh } from './WallMesh.js';
import type { Layout, VenueGeometry } from '../../shared/layout.js';
import { stageModel, type Vec3, type WallSolid } from '../../shared/transforms.js';
import { StageBraceList, StageBraces } from './StageBraces.js';
import { StageLevelList, StageLevels } from './StageLevels.js';
import { StageOverhead, StageOverheadList } from './StageOverhead.js';
import { StagePlaceholderList, StagePlaceholders } from './StagePlaceholders.js';

import type { Asset } from '../../shared/assets.js';
import type { StageCameraView } from './StageCamera.js';
import type { StageEditing } from './StageEditing.js';
import { useBlockBrowserZoom } from './viewportWheel.js';
const PascalStageCanvas = lazy(() => import('./PascalStageCanvas.js'));
const plywood = '#315d49';
const timber = '#d9c6a1';
const edge = '#5a6e52';

function facing(normal: { x: number; z: number }) {
  if (Math.abs(normal.x) >= Math.abs(normal.z)) return normal.x >= 0 ? 'zeigt nach rechts' : 'zeigt nach links';
  return normal.z <= 0 ? 'zeigt zum Publikum' : 'zeigt von Publikum weg';
}

/** Keep the camera looking from the audience toward upstage (+Z). Scene is X-mirrored so plan-left stays screen-left. */
function LookFromAudience({ position, target }: { position: Vec3; target: Vec3 }) {
  const { camera } = useThree();
  useLayoutEffect(() => {
    camera.position.set(position.x, position.y, position.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(target.x, target.y, target.z);
    camera.updateProjectionMatrix();
  }, [camera, position.x, position.y, position.z, target.x, target.y, target.z]);
  return null;
}

export function StageView({ layout, venue, assets = [], workspaceId = '', ...editing }: { layout: Layout; venue: VenueGeometry; assets?: Asset[]; workspaceId?: string } & StageEditing) {
  const model = stageModel(layout, venue);
  const [view, setView] = useState<StageCameraView>('orbit');
  const audience = view === 'audience';
  const [enhanced, setEnhanced] = useState(true);
  const simpleCanvas = useRef<HTMLDivElement>(null);
  useBlockBrowserZoom(simpleCanvas, !enhanced);
  const camera = audience ? model.audience.position : { x: model.orbitTarget.x, y: 5500, z: -venue.depth * 0.35 };
  const target = audience ? model.audience.target : model.orbitTarget;
  return <div className="stage-view" data-testid="stage-view" data-view={view}>
    <div className="stage-toolbar"><h3>Raumsicht</h3>
      <button type="button" className="quiet" onClick={() => setView('audience')}>Publikumssicht</button>
      <button type="button" className="quiet" onClick={() => setView('orbit')}>Umlaufansicht</button>
      {enhanced && <><button type="button" className="quiet" onClick={() => setView('top')}>Von oben</button><button type="button" className="quiet" onClick={() => setView('front')}>Von vorne</button><button type="button" className="quiet" onClick={() => setView('side')}>Von der Seite</button></>}<button type="button" className="quiet" onClick={() => setEnhanced(value => !value)}>{enhanced ? 'Einfache Darstellung' : 'Erweiterte Darstellung'}</button></div>
    {enhanced ? <Suspense fallback={<p role="status">Raumsicht wird geladen …</p>}><PascalStageCanvas model={model} layout={layout} venue={venue} audience={audience} view={view} assets={assets} workspaceId={workspaceId} {...editing} /></Suspense> : <div ref={simpleCanvas} className="stage-canvas" role="img" aria-label="Raumsicht der Spielstätte">
      <Canvas key={audience ? 'audience' : 'orbit'} gl={{ antialias: true, alpha: false }} dpr={[1, 2]}>
        <color attach="background" args={['#eef2e8']} />
        <PerspectiveCamera makeDefault fov={40} near={10} far={250000} position={[camera.x, camera.y, camera.z]} />
        {audience && <LookFromAudience position={camera} target={target} />}
        <group position={[venue.width / 2, 0, 0]} scale={[-1, 1, 1]}>
          <group position={[-venue.width / 2, 0, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[venue.width / 2, 0, venue.depth / 2]}>
              <planeGeometry args={[venue.width, venue.depth]} />
              <meshBasicMaterial color="#dce4d4" />
            </mesh>
            <StageLevels model={model} />
            <StageOverhead boxes={venue.overheadBoxes ?? []} />
            {model.walls.map(wall => <WallMesh key={wall.id} wall={wall} />)}
            <StageBraces braces={model.braces} />
            <StagePlaceholders placeholders={model.placeholders} />
          </group>
        </group>
        {!audience && <OrbitControls makeDefault enableDamping={false} target={[target.x, target.y, target.z]} />}
      </Canvas>
    </div>}
    <p className="muted">{audience
      ? 'Publikumssicht · Blick von vorne auf die Bühne (wie der Pfeil im Grundriss) · links im Grundriss = links hier · Vorderseite dunkel'
      : 'Vorderseite (Sperrholz, dunkel) · Rückseite (Holzrahmen, hell) · Stützen als Dreieckskörper · Ziehen zum Drehen · links/rechts wie im Grundriss'}</p>
    <details className="stage-measurements"><summary>Objektmaße und Ausrichtung</summary>
    <ul aria-label="Wände in der Raumsicht">{model.walls.map(wall => <li key={wall.id} data-testid={`stage-wall-${wall.id}`}
      data-x={wall.center.x} data-y={wall.center.y} data-z={wall.center.z}
      data-height={wall.size.y} data-width={wall.size.x} data-thickness={wall.size.z}
      data-opening-count={wall.openings.length} data-opening-width={wall.openings[0]?.width ?? ''} data-opening-height={wall.openings[0]?.height ?? ''}>
      {wall.label}: Vorderseite {facing(wall.frontNormal)}</li>)}</ul>
    <StageBraceList braces={model.braces} />
    <StagePlaceholderList placeholders={model.placeholders} />
    <StageLevelList model={model} />
    <StageOverheadList boxes={venue.overheadBoxes ?? []} />
    </details>
  </div>;
}
