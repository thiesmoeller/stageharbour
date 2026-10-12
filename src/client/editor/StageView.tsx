import { editorCommand } from './interactionKeys.js';
import { DockPortal, EditorDockContext } from './EditorDock.js';
import { defaultLighting, type StageLightingSettings } from '../../shared/lighting.js';
import { ToolIcon } from './ToolIcon.js';
import { LightingPanel } from './LightingPanel.js';
import { LightLooksPanel, type LightLooksPatch } from './LightLooksPanel.js';
import { FixtureControlOverlay } from './FixtureControlOverlay.js';
import { LightBoardHost } from './LightBoardPanel.js';
import { createLightBoardLive } from './lightBoardLive.js';
import { defaultLightBoardState } from '../../shared/lightBoard.js';
import { lazy, Suspense, useContext, useEffect, useMemo, useState } from 'react';
import type { Layout, VenueGeometry } from '../../shared/layout.js';
import { stageModel } from '../../shared/transforms.js';
import { effectiveCurtains } from '../../shared/venueFixtures.js';
import { StageBraceList } from './StageBraces.js';
import { StageLevelList } from './StageLevels.js';
import { StageOverheadList } from './StageOverhead.js';
import { StageCurtainList } from './StageCurtains.js';
import { StagePlaceholderList } from './StagePlaceholders.js';
import type { PlanDisplayOptions } from '../../shared/planDisplay.js';
import { defaultPlanDisplay } from '../../shared/planDisplay.js';
import type { HangPlan } from '../../shared/hangPlan.js';

import type { Asset } from '../../shared/assets.js';
import type { StageCameraView } from './StageCamera.js';
import type { StageEditing } from './StageEditing.js';
const PascalStageCanvas = lazy(() => import('./PascalStageCanvas.js'));

import type { StageCaptureHandle } from './StageCapture.js';
export type { StageCaptureHandle } from './StageCapture.js';

function facing(normal: { x: number; z: number }) {
  if (Math.abs(normal.x) >= Math.abs(normal.z)) return normal.x >= 0 ? 'zeigt nach rechts' : 'zeigt nach links';
  return normal.z <= 0 ? 'zeigt zum Publikum' : 'zeigt von Publikum weg';
}

export function StageView({ layout, venue, assets = [], workspaceId = '', onLightingChange, onLightLooksChange, onHangPlanChange, planDisplay = defaultPlanDisplay, onCaptureReady, onFeedbackCaptureReady, initialView, onViewChange, title = 'Raumsicht', captureLightLook = false, captureHouseMaster = 1, ...editing }: {
  layout: Layout; venue: VenueGeometry; assets?: Asset[]; workspaceId?: string;
  onLightingChange?: (value: StageLightingSettings) => void;
  onLightLooksChange?: (patch: LightLooksPatch) => void;
  onHangPlanChange?: (plan: HangPlan) => void;
  planDisplay?: PlanDisplayOptions;
  onCaptureReady?: (handle: StageCaptureHandle | null) => void;
  onFeedbackCaptureReady?: (handle: StageCaptureHandle | null) => void;
  initialView?: StageCameraView;
  onViewChange?: (view: StageCameraView) => void;
  title?: string;
  /** Preview a saved look for a document without opening or changing the session board. */
  captureLightLook?: boolean;
  captureHouseMaster?: number;
} & StageEditing) {
  const dock = useContext(EditorDockContext);
  const model = stageModel(layout, venue);
  const curtains = effectiveCurtains(venue, layout);
  const savedLighting = layout.lighting ?? venue.lighting ?? defaultLighting;
  const lighting = useMemo(() => captureLightLook ? { ...savedLighting, enabled: true } : savedLighting, [captureLightLook, savedLighting]);
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
  useEffect(() => {
    if (captureLightLook) lightBoardLive.set({ ...defaultLightBoardState(hangPlan?.fixtures.map(item => item.id) ?? [], activeLook), houseMaster: captureHouseMaster });
  }, [captureLightLook, captureHouseMaster, hangPlan, activeLook, lightBoardLive]);
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
  useEffect(() => {
    if (!focusAimMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (editorCommand(event) !== 'cancel') return;
      event.preventDefault();
      event.stopPropagation();
      setFocusAimMode(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusAimMode]);
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
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
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
          { id: 'top', label: 'Von oben' }, { id: 'front', label: 'Von vorne' }, { id: 'side', label: 'Von der Seite' },
        ] as const).map(preset => <button key={preset.id} type="button" className="quiet" aria-label={preset.label} title={preset.label}
          aria-pressed={view === preset.id} onClick={() => chooseView(preset.id)}><ToolIcon name={preset.id} /></button>)}
      </div>
      <span className="camera-projection">{view === 'top' || view === 'front' || view === 'side' ? 'Parallelprojektion' : 'Perspektive'}</span>
      <div ref={setToolbarHost} className="stage-toolbar-tools" role="group" aria-label="3D-Werkzeuge" />
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
    <Suspense fallback={<p role="status">Raumsicht wird geladen …</p>}><PascalStageCanvas model={model} layout={layout} venue={venue} audience={audience} view={view} assets={assets} workspaceId={workspaceId} lighting={lighting} planDisplay={planDisplay} onCaptureReady={onCaptureReady ?? onFeedbackCaptureReady} aimOnly={exportAim}
      enhanced={!simple}
      selectedFixtureId={boardOpen ? selectedFixtureId : null}
      onFixtureSelect={boardOpen ? id => selectFixture(id) : undefined}
      focusAimMode={boardOpen && focusAimMode}
      onHangPlanChange={onHangPlanChange}
      lightBoardLive={lightBoardLive}
      showFixturePools={boardOpen || captureLightLook}
      toolbarHost={toolbarHost}
      {...editing} /></Suspense>
    {!exportAim && boardOpen && hasHangFixtures && hangPlan && <LightBoardHost
      hangPlan={hangPlan}
      live={lightBoardLive}
      activeLook={activeLook}
      selectedFixtureId={selectedFixtureId}
      onSelectFixture={selectFixture}
      looks={lightLooks}
      canSaveLook={!!onLightLooksChange}
      onLightLooksChange={onLightLooksChange}
      onHangPlanChange={onHangPlanChange}
    />}
    {!hangLit && boardOpen && hasHangFixtures && !lighting.enabled && <p className="muted light-board-hint">
      Bühnenlicht aus · nur Ansicht. Scheinwerfer-Vorschau braucht Bearbeitungsrecht für Bühnenlicht.
    </p>}
    <DockPortal panel="properties"><p className="muted">{audience
      ? 'Publikumssicht · Blick vom Zuschauer-Blickpunkt der Spielstätte · Mittelklick dreht den Blick · links im Grundriss = links hier · Vorderseite dunkel'
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
