import { defaultLighting, type StageLightingSettings } from '../../shared/lighting.js';
import { ToolIcon } from './ToolIcon.js';
import { LightingPanel } from './LightingPanel.js';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { WallMesh } from './WallMesh.js';
import type { Layout, VenueGeometry } from '../../shared/layout.js';
import { stageModel, type Vec3 } from '../../shared/transforms.js';
import { effectiveCurtains } from '../../shared/venueFixtures.js';
import { StageBraceList, StageBraces } from './StageBraces.js';
import { StageLevelList, StageLevels } from './StageLevels.js';
import { StageOverhead, StageOverheadList } from './StageOverhead.js';
import { StageCurtainList } from './StageCurtains.js';
import { StagePlaceholderList, StagePlaceholders } from './StagePlaceholders.js';

import type { Asset } from '../../shared/assets.js';
import type { StageCameraView } from './StageCamera.js';
import type { StageEditing } from './StageEditing.js';
import { useBlockBrowserZoom } from './viewportWheel.js';
const PascalStageCanvas = lazy(() => import('./PascalStageCanvas.js'));

import type { StageCaptureHandle } from './StageCapture.js';
export type { StageCaptureHandle } from './StageCapture.js';

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

export function StageView({ layout, venue, assets = [], workspaceId = '', onLightingChange, onCaptureReady, initialView, onViewChange, title = 'Raumsicht', ...editing }: {
  layout: Layout; venue: VenueGeometry; assets?: Asset[]; workspaceId?: string;
  onLightingChange?: (value: StageLightingSettings) => void;
  /**
   * Export PDF snapshot handle. Forces the Pascal viewer (same renderer as the scene
   * Raumsicht) — a second classic R3F canvas fights Pascal’s `three/webgpu` shaders.
   */
  onCaptureReady?: (handle: StageCaptureHandle | null) => void;
  initialView?: StageCameraView;
  onViewChange?: (view: StageCameraView) => void;
  title?: string;
} & StageEditing) {
  const model = stageModel(layout, venue);
  const curtains = effectiveCurtains(venue, layout);
  const lighting = layout.lighting ?? venue.lighting ?? defaultLighting;
  const [view, setView] = useState<StageCameraView>(initialView ?? 'orbit');
  useEffect(() => { if (initialView) setView(initialView); }, [initialView]);
  function chooseView(next: StageCameraView) {
    setView(next);
    onViewChange?.(next);
  }
  const audience = view === 'audience';
  const exportAim = !!onCaptureReady;
  const [enhanced, setEnhanced] = useState(true);
  // Export aiming must stay on Pascal. Classic R3F + Pascal three/webgpu = shader spam.
  const simple = !exportAim && !enhanced;
  const simpleCanvas = useRef<HTMLDivElement>(null);
  useBlockBrowserZoom(simpleCanvas, simple);
  const camera = audience ? model.audience.position : { x: model.orbitTarget.x, y: 5500, z: -venue.depth * 0.35 };
  const target = audience ? model.audience.target : model.orbitTarget;
  return <div className="stage-view" data-testid="stage-view" data-view={view} data-export-aim={exportAim || undefined}>
    <div className="stage-toolbar"><h3>{title}</h3>
      <div className="camera-presets" role="group" aria-label="Kamerablick">
        {([{ id: 'orbit', label: 'Umlaufansicht' }, { id: 'audience', label: 'Publikumssicht' },
          ...(!simple ? [{ id: 'top', label: 'Von oben' }, { id: 'front', label: 'Von vorne' }, { id: 'side', label: 'Von der Seite' }] as const : []),
        ] as const).map(preset => <button key={preset.id} type="button" className="quiet" aria-label={preset.label} title={preset.label}
          aria-pressed={view === preset.id} onClick={() => chooseView(preset.id)}><ToolIcon name={preset.id} /></button>)}
      </div>
      <span className="camera-projection">{view === 'top' || view === 'front' || view === 'side' ? 'Parallelprojektion' : 'Perspektive'}</span>
      {!exportAim && <button type="button" className="quiet renderer-toggle" onClick={() => { setEnhanced(value => !value); chooseView('orbit'); }} title={enhanced ? 'Einfache Darstellung' : 'Erweiterte Darstellung'} aria-label={enhanced ? 'Einfache Darstellung' : 'Erweiterte Darstellung'}><ToolIcon name="settings" /></button>}
    </div>
    {!exportAim && <LightingPanel value={lighting} onChange={onLightingChange} scope={!onLightingChange ? 'Gespeicherte Lichtstimmung · nur Ansicht.' : editing.venueEditable ? 'Teil des Spielstättenentwurfs · mit der Spielstätte speichern.' : 'Änderungen werden mit dieser Szene gespeichert.'} />}
    {!simple ? <Suspense fallback={<p role="status">Raumsicht wird geladen …</p>}><PascalStageCanvas model={model} layout={layout} venue={venue} audience={audience} view={view} assets={assets} workspaceId={workspaceId} lighting={lighting} onCaptureReady={onCaptureReady} aimOnly={exportAim} {...editing} /></Suspense> : <div ref={simpleCanvas} className="stage-canvas" role="img" aria-label="Raumsicht der Spielstätte">
      <Canvas shadows key={audience ? 'audience' : 'orbit'} gl={{ antialias: true, alpha: false }} dpr={[1, 2]}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[camera.x, Math.max(camera.y, 4000), camera.z]} intensity={0.55} />
        <color attach="background" args={['#eef2e8']} />
        <PerspectiveCamera makeDefault fov={40} near={10} far={250000} position={[camera.x, camera.y, camera.z]} />
        {audience && <LookFromAudience position={camera} target={target} />}
        <group position={[venue.width / 2, 0, 0]} scale={[-1, 1, 1]}>
          <group position={[-venue.width / 2, 0, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[venue.width / 2, 0, venue.depth / 2]}>
              <planeGeometry args={[venue.width, venue.depth]} />
              <meshBasicMaterial color="#dce4d4" />
            </mesh>
            <StageLevels model={model} lit={false} />
            <StageOverhead boxes={venue.overheadBoxes ?? []} trusses={venue.trusses ?? []} />
            {model.walls.map(wall => <WallMesh key={wall.id} wall={wall} lit={false} />)}
            <StageBraces braces={model.braces} lit={false} />
            <StagePlaceholders placeholders={model.placeholders} lit={false} />
          </group>
        </group>
        {!audience && <OrbitControls makeDefault enableDamping={false} target={[target.x, target.y, target.z]} />}
      </Canvas>
    </div>}
    <p className="muted">{audience
      ? 'Publikumssicht · Blick von vorne auf die Bühne (wie der Pfeil im Grundriss) · links im Grundriss = links hier · Vorderseite dunkel'
      : 'Vorderseite (Sperrholz, dunkel) · Rückseite (Holzrahmen, hell) · Stützen als Dreieckskörper · Ziehen zum Drehen · links/rechts wie im Grundriss'}</p>
    {!exportAim && <details className="stage-measurements"><summary>Objektmaße und Ausrichtung</summary>
    <ul aria-label="Wände in der Raumsicht">{model.walls.map(wall => <li key={wall.id} data-testid={`stage-wall-${wall.id}`}
      data-x={wall.center.x} data-y={wall.center.y} data-z={wall.center.z}
      data-height={wall.size.y} data-width={wall.size.x} data-thickness={wall.size.z}
      data-opening-count={wall.openings.length} data-opening-width={wall.openings[0]?.width ?? ''} data-opening-height={wall.openings[0]?.height ?? ''}>
      {wall.label}: Vorderseite {facing(wall.frontNormal)}</li>)}</ul>
    <StageBraceList braces={model.braces} />
    <StagePlaceholderList placeholders={model.placeholders} />
    <StageLevelList model={model} />
    <StageOverheadList boxes={venue.overheadBoxes ?? []} trusses={venue.trusses ?? []} />
    <StageCurtainList curtains={curtains} />
    </details>}
  </div>;
}
