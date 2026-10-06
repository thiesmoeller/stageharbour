import { DockPortal, EditorDockContext } from './EditorDock.js';
import { defaultLighting, type StageLightingSettings } from '../../shared/lighting.js';
import { ToolIcon } from './ToolIcon.js';
import { LightingPanel } from './LightingPanel.js';
import { LightLooksPanel, type LightLooksPatch } from './LightLooksPanel.js';
import { FixtureControlOverlay } from './FixtureControlOverlay.js';
import { LightBoardHost } from './LightBoardPanel.js';
import { createLightBoardLive } from './lightBoardLive.js';
import { lazy, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import type { PlanDisplayOptions } from '../../shared/planDisplay.js';
import { defaultPlanDisplay } from '../../shared/planDisplay.js';
import type { HangPlan } from '../../shared/hangPlan.js';

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

export function StageView({ layout, venue, assets = [], workspaceId = '', onLightingChange, onLightLooksChange, onHangPlanChange, planDisplay = defaultPlanDisplay, onCaptureReady, initialView, onViewChange, title = 'Raumsicht', ...editing }: {
  layout: Layout; venue: VenueGeometry; assets?: Asset[]; workspaceId?: string;
  onLightingChange?: (value: StageLightingSettings) => void;
  onLightLooksChange?: (patch: LightLooksPatch) => void;
  onHangPlanChange?: (plan: HangPlan) => void;
  planDisplay?: PlanDisplayOptions;
  onCaptureReady?: (handle: StageCaptureHandle | null) => void;
  initialView?: StageCameraView;
  onViewChange?: (view: StageCameraView) => void;
  title?: string;
} & StageEditing) {
  const dock = useContext(EditorDockContext);
  const model = stageModel(layout, venue);
  const curtains = effectiveCurtains(venue, layout);
  const lighting = layout.lighting ?? venue.lighting ?? defaultLighting;
  const hangPlan = venue.hangPlan;
  const lightLooks = layout.lightLooks ?? [];
  const activeLook = lightLooks.find(look => look.id === layout.activeLightLookId) ?? lightLooks[0];
  const [view, setView] = useState<StageCameraView>(initialView ?? 'orbit');
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [focusAimMode, setFocusAimMode] = useState(false);
  /** Lichtpult under the canvas — session faders; open + Bühnenlicht → Scheinwerfer lit. */
  const [boardOpen, setBoardOpen] = useState(false);
  useEffect(() => { if (dock && dock.active !== 'lighting') setFocusAimMode(false); }, [dock?.active]);
  /** Stable live store: fader UI writes here; SpotLights read in useFrame (no Pascal remount). */
  const lightBoardLive = useMemo(() => createLightBoardLive(), []);
  const hasHangFixtures = !!hangPlan?.fixtures.length;
  const hangLit = boardOpen && hasHangFixtures && lighting.enabled;
  useEffect(() => { if (initialView) setView(initialView); }, [initialView]);
  useEffect(() => {
    if (!hangPlan?.fixtures.some(fixture => fixture.id === selectedFixtureId)) {
      setSelectedFixtureId(null);
      setFocusAimMode(false);
    }
  }, [hangPlan, selectedFixtureId]);
  useEffect(() => {
    if (!boardOpen) setFocusAimMode(false);
  }, [boardOpen]);
  function selectFixture(id: string | null, additive = false) {
    if (!id) { setSelectedFixtureId(null); setFocusAimMode(false); return; }
    setSelectedFixtureId(id);
    dock?.setActive('lighting');
    if (!additive) setFocusAimMode(false);
  }
  function chooseView(next: StageCameraView) {
    setView(next);
    onViewChange?.(next);
  }
  const audience = view === 'audience';
  const exportAim = !!onCaptureReady;
  const [enhanced, setEnhanced] = useState(true);
  const simple = !exportAim && !enhanced;
  const simpleCanvas = useRef<HTMLDivElement>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  useBlockBrowserZoom(simpleCanvas, simple);
  const [glBroken, setGlBroken] = useState(false);
  useEffect(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) { setGlBroken(true); return; }
    const lost = () => setGlBroken(true);
    canvas.addEventListener('webglcontextlost', lost);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const err = gl.getError();
    if (err !== gl.NO_ERROR && err !== gl.CONTEXT_LOST_WEBGL) setGlBroken(true);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, []);
  const camera = audience ? model.audience.position : { x: model.orbitTarget.x, y: 5500, z: -venue.depth * 0.35 };
  const target = audience ? model.audience.target : model.orbitTarget;
  const grundlichtScope = !onLightingChange
    ? 'Gespeichertes Grundlicht · nur Ansicht.'
    : editing.venueEditable
      ? 'Spielstätte · Bühnenlicht aus = Konstruktion, an = Theater/Scheinwerfer.'
      : 'Bühnenbild · Bühnenlicht aus = Konstruktion, an = Theater/Scheinwerfer.';
  const selectedFixture = hangPlan?.fixtures.find(fixture => fixture.id === selectedFixtureId);
  return <div className="stage-view" data-testid="stage-view" data-view={view} data-export-aim={exportAim || undefined}>
    <div className="stage-toolbar"><h3>{title}</h3>
      <div className="camera-presets" role="group" aria-label="Kamerablick">
        {([{ id: 'orbit', label: 'Umlaufansicht' }, { id: 'audience', label: 'Publikumssicht' },
          ...(!simple ? [{ id: 'top', label: 'Von oben' }, { id: 'front', label: 'Von vorne' }, { id: 'side', label: 'Von der Seite' }] as const : []),
        ] as const).map(preset => <button key={preset.id} type="button" className="quiet" aria-label={preset.label} title={preset.label}
          aria-pressed={view === preset.id} onClick={() => chooseView(preset.id)}><ToolIcon name={preset.id} /></button>)}
      </div>
      <span className="camera-projection">{view === 'top' || view === 'front' || view === 'side' ? 'Parallelprojektion' : 'Perspektive'}</span>
      {!simple && <div ref={setToolbarHost} className="stage-toolbar-tools" role="group" aria-label="3D-Werkzeuge" />}
      {!exportAim && hasHangFixtures && <button type="button" className="quiet" aria-pressed={boardOpen}
        onClick={() => {
          const next = !boardOpen;
          setBoardOpen(next);
          if (next && !lighting.enabled && onLightingChange) {
            onLightingChange({ ...lighting, enabled: true });
          }
        }}
        title="Lichtpult unter der Raumsicht" aria-label="Lichtpult">Lichtpult</button>}
      {!exportAim && <button type="button" className="quiet renderer-toggle" onClick={() => { setEnhanced(value => !value); chooseView('orbit'); }} title={enhanced ? 'Einfache Darstellung' : 'Erweiterte Darstellung'} aria-label={enhanced ? 'Einfache Darstellung' : 'Erweiterte Darstellung'}><ToolIcon name="settings" /></button>}
    </div>
    {glBroken && <p className="error" role="alert">
      3D-Ansicht: WebGL ist in diesem Chrome kaputt (häufig mit <code>--use-angle=vulkan</code>).
      {' '}Chrome ohne Vulkan-ANGLE starten, z. B. <code>google-chrome-stable --use-angle=gl</code>,
      oder unter <code>chrome://flags</code> „Vulkan“ / „Default ANGLE Vulkan“ deaktivieren und neu laden.
    </p>}
    <DockPortal panel="lighting">
    {!exportAim && <LightingPanel value={lighting} onChange={onLightingChange} scope={grundlichtScope} />}
    {!exportAim && hasHangFixtures && <LightLooksPanel looks={lightLooks} activeLookId={layout.activeLightLookId ?? activeLook?.id}
      hangPlan={hangPlan!} selectedFixtureId={selectedFixtureId}
      onSelectFixture={id => selectFixture(id)}
      onChange={onLightLooksChange} />}
    {!exportAim && boardOpen && selectedFixture && hangPlan && <FixtureControlOverlay
      fixture={selectedFixture}
      hangPlan={hangPlan}
      trusses={venue.trusses ?? []}
      stageWidth={venue.width}
      stageDepth={venue.depth}
      canEditFocus={!!onHangPlanChange}
      focusAimMode={focusAimMode}
      onFocusAimMode={setFocusAimMode}
      onHangPlanChange={onHangPlanChange}
      onClose={() => selectFixture(null)}
    />}
    </DockPortal>
    {!simple ? <Suspense fallback={<p role="status">Raumsicht wird geladen …</p>}><PascalStageCanvas model={model} layout={layout} venue={venue} audience={audience} view={view} assets={assets} workspaceId={workspaceId} lighting={lighting} planDisplay={planDisplay} onCaptureReady={onCaptureReady} aimOnly={exportAim}
      selectedFixtureId={boardOpen ? selectedFixtureId : null}
      onFixtureSelect={boardOpen ? id => selectFixture(id) : undefined}
      focusAimMode={boardOpen && focusAimMode}
      onHangPlanChange={onHangPlanChange}
      lightBoardLive={lightBoardLive}
      showFixturePools={boardOpen}
      toolbarHost={toolbarHost}
      {...editing} /></Suspense> : <div ref={simpleCanvas} className="stage-canvas" role="img" aria-label="Raumsicht der Spielstätte">
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
            <StageOverhead boxes={venue.overheadBoxes ?? []} trusses={venue.trusses ?? []} hangPlan={hangPlan}
              showTrusses={planDisplay.showTrusses} showLightingFixtures={planDisplay.showLightingFixtures} />
            {model.walls.map(wall => <WallMesh key={wall.id} wall={wall} lit={false} />)}
            <StageBraces braces={model.braces} lit={false} />
            <StagePlaceholders placeholders={model.placeholders} lit={false} />
          </group>
        </group>
        {!audience && <OrbitControls makeDefault enableDamping={false} target={[target.x, target.y, target.z]} />}
      </Canvas>
    </div>}
    {!exportAim && boardOpen && hasHangFixtures && hangPlan && <LightBoardHost
      hangPlan={hangPlan}
      live={lightBoardLive}
      activeLook={activeLook}
      selectedFixtureId={selectedFixtureId}
      onSelectFixture={selectFixture}
      looks={lightLooks}
      canSaveLook={!!onLightLooksChange}
      onLightLooksChange={onLightLooksChange}
    />}
    {!hangLit && boardOpen && hasHangFixtures && !lighting.enabled && <p className="muted light-board-hint">
      Bühnenlicht aus · nur Ansicht. Scheinwerfer-Vorschau braucht Bearbeitungsrecht für Bühnenlicht.
    </p>}
    <DockPortal panel="properties"><p className="muted">{audience
      ? 'Publikumssicht · Blick von vorne auf die Bühne (wie der Pfeil im Grundriss) · links im Grundriss = links hier · Vorderseite dunkel'
      : focusAimMode
        ? 'Zielpunkt: auf Boden, Wand oder Bühnenobjekt klicken'
        : hasHangFixtures && boardOpen
          ? 'Lichtpult · Master / Grundlicht / Blackout / Fader · Look laden oder speichern · Ausrichtung am Hang'
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
    </details>}</DockPortal>
  </div>;
}
