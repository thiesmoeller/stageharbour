import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type PointerEvent } from 'react';
import { z } from 'zod';
import { execute, history, redo, undo, type History } from '../../shared/history.js';
import { newBrace, newWall, wallCorners, wallSchema, type Brace, type Layout, type Scene, type VenueGeometry, type Wall } from '../../shared/layout.js';
import { AUDIENCE_FLOOR_ID, layoutDiagnostics, newPlatform, newStair, supportingSurfaces, type Platform, type StairUnit } from '../../shared/levels.js';
import { overheadBoxCorners, overheadClearance } from '../../shared/overhead.js';
import { braceCorners } from '../../shared/braceTransforms.js';
import { resolveWall, typesOf, type WallElementType } from '../../shared/wall-types.js';
import { measuredOutline } from '../../shared/venue.js';
import { LEASE_HEARTBEAT_MS } from '../../shared/leases.js';
import { ApiError, request } from '../api.js';
import { Autosave, SaveConflict } from './autosave.js';
import { BraceInspector } from './BraceInspector.js';
import { BraceLayer } from './BraceLayer.js';
import { PlatformInspector, StairInspector } from './PlatformInspector.js';
import { PlatformLayer, SurfaceField } from './PlatformLayer.js';
import { StageView } from './StageView.js';
import { ExportPanel } from './ExportPanel.js';
import { WallTypePanel } from './WallTypePanel.js';
import { VenuePanel, InfrastructureMarks } from './VenuePanel.js';
import { OverheadMarks } from './VenueOverhead.js';
import { InventoryPanel } from './InventoryPanel.js';

const statusText = { saved: 'Gespeichert', pending: 'Änderungen ausstehend …', saving: 'Speichert …', failed: 'Speichern fehlgeschlagen', conflict: 'Neuere Fassung vorhanden' };
export function Editor({ initial, workspaceId, readOnly, onClose, onDirty }: {
  initial: Scene; workspaceId: string; readOnly: boolean; onClose: () => void; onDirty: (value: boolean) => void;
}) {
  const [state, setState] = useState(() => history({ ...initial.layout, braces: initial.layout.braces ?? [] }));
  const current = useRef(state);
  const [selected, setSelected] = useState<string>();
  const [selectedType, setSelectedType] = useState<string>();
  const [selectedBrace, setSelectedBrace] = useState<string>();
  const [selectedPlatform, setSelectedPlatform] = useState<string>();
  const [selectedStair, setSelectedStair] = useState<string>();
  const [preview, setPreview] = useState<Wall>();
  const [previewBrace, setPreviewBrace] = useState<Brace>();
  const [exportsOpen, setExportsOpen] = useState(false);
  const [venueOpen, setVenueOpen] = useState(false);
  const [venue, setVenue] = useState<VenueGeometry>(initial.venue);
  const gesture = useRef<{ wall: Wall; x: number; y: number; latest: Wall } | undefined>(undefined);
  const braceDrag = useRef<{ brace: Brace; x: number; y: number; latest: Brace } | undefined>(undefined);
  const svg = useRef<SVGSVGElement>(null);
  const [saver] = useState(() => new Autosave({ ...initial.layout, braces: initial.layout.braces ?? [] }, initial.revision, async (layout, revision) => {
    try {
      const result = await request(`/api/workspaces/${workspaceId}/scenes/${initial.id}/layout`, { revision, layout }, 'PUT');
      return z.object({ revision: z.number().int() }).parse(result).revision;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 423)) throw new SaveConflict(error.status === 423 ? 'lease' : 'revision');
      throw error;
    }
  }));
  const saveState = useSyncExternalStore(saver.subscribe, saver.getSnapshot);
  const dirty = saveState.dirty || !!preview || !!previewBrace;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (readOnly) return;
    const tick = window.setInterval(() => {
      request(`/api/workspaces/${workspaceId}/scenes/${initial.id}/lease/heartbeat`, {}).catch(error => {
        if (error instanceof ApiError && error.status === 423) saver.markConflict('lease');
      });
    }, LEASE_HEARTBEAT_MS);
    return () => clearInterval(tick);
  }, [readOnly, saver, workspaceId, initial.id]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saver.getSnapshot().dirty || gesture.current || braceDrag.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); saver.dispose(); onDirty(false); };
  }, [saver, onDirty]);
  function apply(next: History) {
    if (readOnly || next === current.current) return;
    current.current = next;
    setState(next);
    saver.queue(next.present);
  }
  function commit(layout: Layout) { apply(execute(current.current, layout)); }
  function replace(wall: Wall) { commit({ ...current.current.present, walls: current.current.present.walls.map(item => item.id === wall.id ? wall : item) }); }
  function applyType(type: WallElementType) {
    const present = current.current.present;
    const types = typesOf(present);
    commit({
      ...present,
      wallTypes: types.some(item => item.id === type.id) ? types.map(item => item.id === type.id ? type : item) : [...types, type],
      walls: present.walls.map(wall => wall.typeId === type.id ? { ...wall, width: type.width, height: type.height, thickness: type.thickness } : wall),
    });
    setSelectedType(type.id);
  }
  function placeType(type: WallElementType) {
    const present = current.current.present;
    if (present.walls.length >= 250) return;
    const wall: Wall = { ...newWall(crypto.randomUUID(), venue.width / 2, venue.depth / 2), typeId: type.id, label: type.name, width: type.width, height: type.height, thickness: type.thickness };
    commit({ ...present, walls: [...present.walls, wall] });
    setSelected(wall.id);
    clearSelection('wall');
  }
  function removeType(id: string) {
    const present = current.current.present;
    commit({
      ...present,
      wallTypes: typesOf(present).filter(type => type.id !== id),
      walls: present.walls.map(wall => wall.typeId === id ? { ...wall, typeId: undefined } : wall),
    });
    setSelectedType(undefined);
  }
  function replaceBrace(brace: Brace) { commit({ ...current.current.present, braces: current.current.present.braces.map(item => item.id === brace.id ? brace : item) }); }
  function replacePlatform(platform: Platform) {
    commit({ ...current.current.present, platforms: (current.current.present.platforms ?? []).map(item => item.id === platform.id ? platform : item) });
  }
  function replaceStair(stair: StairUnit) {
    commit({ ...current.current.present, stairs: (current.current.present.stairs ?? []).map(item => item.id === stair.id ? stair : item) });
  }
  function clearSelection(except?: 'wall' | 'brace' | 'platform' | 'stair') {
    if (except !== 'wall') setSelected(undefined);
    if (except !== 'brace') setSelectedBrace(undefined);
    if (except !== 'platform') setSelectedPlatform(undefined);
    if (except !== 'stair') setSelectedStair(undefined);
  }
  function remove() {
    const present = current.current.present;
    if (selectedPlatform) {
      commit({ ...present, platforms: (present.platforms ?? []).filter(item => item.id !== selectedPlatform) });
      setSelectedPlatform(undefined); return;
    }
    if (selectedStair) {
      commit({ ...present, stairs: (present.stairs ?? []).filter(item => item.id !== selectedStair) });
      setSelectedStair(undefined); return;
    }
    if (selectedBrace) {
      commit({ ...present, braces: present.braces.filter(brace => brace.id !== selectedBrace) });
      setSelectedBrace(undefined); return;
    }
    if (!selected) return;
    commit({ ...present, walls: present.walls.filter(wall => wall.id !== selected) });
    setSelected(undefined);
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (readOnly || gesture.current || braceDrag.current || event.target instanceof HTMLElement && (event.target.closest('input, textarea, select, button') || event.target.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); apply(event.shiftKey ? redo(current.current) : undo(current.current));
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); apply(redo(current.current));
      } else if (event.key === 'Delete') { event.preventDefault(); remove(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });
  const selectedWall = state.present.walls.find(wall => wall.id === selected);
  const wallTypes = typesOf(state.present);
  const selectedBraceItem = state.present.braces.find(brace => brace.id === selectedBrace);
  const selectedPlatformItem = (state.present.platforms ?? []).find(item => item.id === selectedPlatform);
  const selectedStairItem = (state.present.stairs ?? []).find(item => item.id === selectedStair);
  const surfaces = supportingSurfaces(venue, state.present);
  const diagnostics = layoutDiagnostics(state.present, venue);
  const overheadWarnings = overheadClearance(state.present, venue);
  const raised = surfaces.find(surface => surface.id !== AUDIENCE_FLOOR_ID);
  function point(event: PointerEvent) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const value = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: value.x, y: -value.y };
  }
  function start(event: PointerEvent<SVGGElement>, wall: Wall) {
    if (event.button !== 0) return;
    event.stopPropagation();
    setSelected(wall.id);
    clearSelection('wall');
    if (readOnly || gesture.current || braceDrag.current) return;
    const position = point(event);
    gesture.current = { wall, ...position, latest: wall };
    setPreview(wall);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startBrace(event: PointerEvent<SVGGElement>, brace: Brace) {
    if (event.button !== 0) return;
    event.stopPropagation();
    setSelectedBrace(brace.id);
    clearSelection('brace');
    if (readOnly || gesture.current || braceDrag.current) return;
    const position = point(event);
    braceDrag.current = { brace, ...position, latest: brace };
    setPreviewBrace(brace);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const wallDrag = gesture.current;
    const position = point(event);
    const clamp = (value: number) => Math.max(-100000, Math.min(100000, Math.round(value)));
    if (wallDrag) {
      wallDrag.latest = { ...wallDrag.wall, x: clamp(wallDrag.wall.x + position.x - wallDrag.x), y: clamp(wallDrag.wall.y + position.y - wallDrag.y) };
      setPreview(wallDrag.latest);
      return;
    }
    const drag = braceDrag.current;
    if (!drag) return;
    drag.latest = { ...drag.brace, x: clamp(drag.brace.x + position.x - drag.x), y: clamp(drag.brace.y + position.y - drag.y) };
    setPreviewBrace(drag.latest);
  }
  function finish(cancelled = false) {
    const wallDrag = gesture.current;
    gesture.current = undefined;
    setPreview(undefined);
    if (wallDrag && !cancelled) replace(wallDrag.latest);
    const drag = braceDrag.current;
    braceDrag.current = undefined;
    setPreviewBrace(undefined);
    if (drag && !cancelled) replaceBrace(drag.latest);
  }
  // Bounds stay fixed during a gesture, so moving an object cannot move its coordinate system.
  const corners = [...state.present.walls.flatMap(wall => wallCorners(resolveWall(wall, wallTypes))), ...state.present.braces.flatMap(braceCorners)];
  const floor = measuredOutline(venue);
  const infra = [...(venue.connectionPoints ?? []), ...(venue.cableRoutingCorridors ?? []).flatMap(corridor => corridor.path),
    ...(venue.overheadBoxes ?? []).flatMap(overheadBoxCorners)];
  const minX = Math.min(0, ...floor.map(p => p.x), ...infra.map(p => p.x), ...corners.map(p => p.x)) - 600;
  const maxX = Math.max(venue.width, ...floor.map(p => p.x), ...infra.map(p => p.x), ...corners.map(p => p.x)) + 600;
  const minY = Math.min(0, ...floor.map(p => p.y), ...infra.map(p => p.y), ...corners.map(p => p.y)) - 800;
  const maxY = Math.max(venue.depth, ...floor.map(p => p.y), ...infra.map(p => p.y), ...corners.map(p => p.y)) + 600;
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...initial, revision: saveState.revision, layout: current.current.present }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `buehnenentwurf-${initial.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="editor" aria-label="Bühnenbild bearbeiten">
    <div className="editor-heading"><div><p className="eyebrow">{initial.productionName} · {initial.venueName}</p><h2>{initial.name}</h2></div>
      <button className="quiet" disabled={dirty} onClick={onClose}>Zur Übersicht</button></div>
    <div className="editor-toolbar">
      {!readOnly && <><button disabled={!!preview || !!previewBrace || state.present.walls.length >= 250} onClick={() => {
        const wall = newWall(crypto.randomUUID(), venue.width / 2, venue.depth / 2);
        commit({ ...state.present, walls: [...state.present.walls, wall] }); setSelected(wall.id); clearSelection('wall');
      }}>Wand hinzufügen</button>
      <button disabled={!!preview || !!previewBrace || state.present.braces.length >= 250} onClick={() => {
        const brace = newBrace(crypto.randomUUID(), venue.width / 2, venue.depth / 2);
        commit({ ...state.present, braces: [...state.present.braces, brace] }); setSelectedBrace(brace.id); clearSelection('brace');
      }}>Stütze hinzufügen</button>
      <button disabled={!!preview || !!previewBrace || (state.present.platforms ?? []).length >= 250} onClick={() => {
        const platform = newPlatform(crypto.randomUUID(), venue.width / 2, venue.depth / 2);
        commit({ ...state.present, platforms: [...state.present.platforms ?? [], platform] }); setSelectedPlatform(platform.id); clearSelection('platform');
      }}>Podest hinzufügen</button>
      <button disabled={!!preview || !!previewBrace || !raised || (state.present.stairs ?? []).length >= 250} onClick={() => {
        if (!raised) return;
        const stair = newStair(crypto.randomUUID(), AUDIENCE_FLOOR_ID, raised.id, venue.width / 2, venue.depth / 2);
        commit({ ...state.present, stairs: [...state.present.stairs ?? [], stair] }); setSelectedStair(stair.id); clearSelection('stair');
      }}>Treppe hinzufügen</button>
      <button className="quiet" disabled={!!preview || !!previewBrace || !state.past.length} onClick={() => apply(undo(current.current))}>Rückgängig</button>
      <button className="quiet" disabled={!!preview || !!previewBrace || !state.future.length} onClick={() => apply(redo(current.current))}>Wiederholen</button></>}
      <button className="quiet" onClick={() => setVenueOpen(open => !open)}>{venueOpen ? 'Spielstätte schließen' : 'Spielstätte'}</button>
      <button className="quiet" onClick={() => setExportsOpen(open => !open)}>{exportsOpen ? 'Export schließen' : 'Konstruktionsplan'}</button>
      <span className={`save-status ${saveState.status}`} role="status">{readOnly
        ? (initial.lease ? `Nur Ansicht · Bearbeitung durch ${initial.lease.holderName}` : 'Nur Ansicht')
        : saveState.status === 'conflict' && saveState.conflictKind === 'lease' ? 'Bearbeitung abgelaufen' : statusText[saveState.status]}</span>
    </div>
    {venueOpen && <VenuePanel workspaceId={workspaceId} sceneId={initial.id} venue={venue} readOnly={readOnly} onSaved={setVenue} />}
    {exportsOpen && <ExportPanel workspaceId={workspaceId} sceneId={initial.id} readOnly={readOnly} freezeDisabled={dirty || saveState.status !== 'saved'} />}
    {['failed', 'conflict'].includes(saveState.status) && <div className="error" role="alert">
      <p>{saveState.status === 'conflict'
        ? (saveState.conflictKind === 'lease'
          ? 'Die Bearbeitungsberechtigung ist abgelaufen. Ihre Änderungen bleiben hier erhalten und werden nicht überschrieben.'
          : 'Eine neuere Fassung ist gespeichert. Ihre Änderungen bleiben hier erhalten und werden nicht darübergeschrieben.')
        : 'Ihre Änderungen sind noch nicht gespeichert. Prüfen Sie die Verbindung; bei abgelaufener Anmeldung sichern Sie zunächst den lokalen Entwurf.'}</p>
      {saveState.status === 'failed' && <button onClick={() => saver.retry()}>Speichern erneut versuchen</button>}{' '}
      <button onClick={downloadDraft}>Lokalen Entwurf herunterladen</button>{' '}
      <button className="quiet" onClick={() => { if (window.confirm('Lokale Änderungen verwerfen und die gespeicherte Fassung laden?')) { saver.dispose(); onDirty(false); onClose(); } }}>Gespeicherte Fassung laden</button>
    </div>}
    <div className="editor-grid"><div className="editor-views"><div className="plan-canvas">
      <svg ref={svg} role="img" aria-label="Grundriss der Spielstätte" viewBox={`${minX} ${-maxY} ${maxX - minX} ${maxY - minY}`}
        onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}>
        <defs><pattern id="metre-grid" width="1000" height="1000" patternUnits="userSpaceOnUse"><path d="M 1000 0 L 0 0 0 1000" fill="none" stroke="#dfe5d9" strokeWidth="1" vectorEffect="non-scaling-stroke" /></pattern></defs>
        <path data-testid="venue-floor" d={`${floor.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
          fill="url(#metre-grid)" stroke="#718469" strokeWidth="2" vectorEffect="non-scaling-stroke" onPointerDown={() => clearSelection()} />
        <text x={venue.width / 2} y={-venue.depth - 200} textAnchor="middle" fontSize="180">{venue.width} mm</text>
        <text x="-170" y={-venue.depth / 2} textAnchor="middle" fontSize="180" transform={`rotate(-90 -170 ${-venue.depth / 2})`}>{venue.depth} mm</text>
        <text x={venue.width / 2} y="420" textAnchor="middle" fontSize="190">↑ Publikum · Blick zur Bühne</text>
        <PlatformLayer venuePlatforms={venue.platforms ?? []} layoutPlatforms={state.present.platforms ?? []}
          venueStairs={venue.stairs ?? []} layoutStairs={state.present.stairs ?? []}
          selectedId={selectedPlatform ?? selectedStair}
          onSelect={(kind, id) => { if (kind === 'platform') { setSelectedPlatform(id); clearSelection('platform'); } else { setSelectedStair(id); clearSelection('stair'); } }} />
        {state.present.walls.map(savedWall => {
          const wall = preview?.id === savedWall.id ? preview : savedWall;
          const resolved = resolveWall(wall, wallTypes);
          return <g key={wall.id} data-testid={`wall-${wall.id}`} aria-label={wall.label} className={readOnly ? '' : 'draggable-wall'} transform={`translate(${wall.x} ${-wall.y}) rotate(${-wall.rotation})`} onPointerDown={event => start(event, wall)}>
            <line x1={-resolved.width / 2} x2={resolved.width / 2} stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke" />
            <rect x={-resolved.width / 2} y={-resolved.thickness / 2} width={resolved.width} height={resolved.thickness} fill={selected === wall.id ? '#b67c35' : '#315d49'} stroke={selected === wall.id ? '#986122' : '#315d49'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {resolved.openings.map(opening => <rect key={opening.id} data-testid={`plan-opening-${opening.id}`} data-width={opening.width} data-height={opening.height} data-left={opening.left} data-sill={opening.sill}
              x={-resolved.width / 2 + opening.left} y={-resolved.thickness / 2} width={opening.width} height={resolved.thickness} fill="#f8faf5" stroke={selected === wall.id ? '#986122' : '#315d49'} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
            <text y="-140" textAnchor="middle" fontSize="150" pointerEvents="none">{wall.label}</text>
          </g>;
        })}
        <BraceLayer braces={state.present.braces} selectedId={selectedBrace} preview={previewBrace} readOnly={readOnly} onPointerDown={startBrace} />
        <InfrastructureMarks pins={venue.connectionPoints ?? []} corridors={venue.cableRoutingCorridors ?? []} />
        <OverheadMarks boxes={venue.overheadBoxes ?? []} />
      </svg>
      <p className="muted">Raster: 1 m · Alle Eingaben in mm · Wände, Stützen und Podeste zum Auswählen</p>
      {diagnostics.map(item => <p key={`${item.kind}-${item.objectId}`} className="warning" role="status">{item.message}</p>)}
      {overheadWarnings.map(item => <p key={`${item.kind}-${item.objectId}-${item.obstructionId ?? ''}`}
        className="warning" role="status" data-testid="overhead-warning">{item.message}</p>)}
    </div>
    <StageView layout={{
      ...state.present,
      walls: state.present.walls.map(wall => preview?.id === wall.id ? preview : wall),
      braces: state.present.braces.map(brace => previewBrace?.id === brace.id ? previewBrace : brace),
    }} venue={venue} />
    </div><aside className="wall-inspector">
      <WallTypePanel types={wallTypes} selectedId={selectedType} readOnly={readOnly}
        onSelect={setSelectedType} onCreate={applyType} onApply={applyType} onPlace={placeType} onRemove={removeType} />
      <InventoryPanel workspaceId={workspaceId} layout={state.present} selectedWall={selectedWall} readOnly={readOnly}
        onAssign={panelId => selectedWall && replace({ ...selectedWall, panelId })}
        onUnassign={() => selectedWall && replace((({ panelId: _removed, ...rest }) => rest)(selectedWall))} />
      <h3>{selectedPlatformItem ? 'Podest' : selectedStairItem ? 'Treppe' : selectedBraceItem ? 'Gewichtete Stütze' : 'Wandelement'}</h3>
      <label htmlFor="wall-selection">Auswahl</label>
      <select id="wall-selection" value={selectedWall ? `wall:${selectedWall.id}` : selectedBraceItem ? `brace:${selectedBraceItem.id}` : selectedPlatformItem ? `platform:${selectedPlatformItem.id}` : selectedStairItem ? `stair:${selectedStairItem.id}` : ''} onChange={event => {
        const value = event.target.value;
        if (value.startsWith('brace:')) { setSelectedBrace(value.slice(6)); clearSelection('brace'); }
        else if (value.startsWith('platform:')) { setSelectedPlatform(value.slice(9)); clearSelection('platform'); }
        else if (value.startsWith('stair:')) { setSelectedStair(value.slice(6)); clearSelection('stair'); }
        else { setSelected(value.replace(/^wall:/, '') || undefined); clearSelection(value ? 'wall' : undefined); }
      }}>
        <option value="">Objekt auswählen</option>
        {state.present.walls.map((wall, index) => <option key={wall.id} value={`wall:${wall.id}`}>{index + 1}. {wall.label}</option>)}
        {state.present.braces.map((brace, index) => <option key={brace.id} value={`brace:${brace.id}`}>{state.present.walls.length + index + 1}. {brace.label}</option>)}
        {(state.present.platforms ?? []).map((platform, index) => <option key={platform.id} value={`platform:${platform.id}`}>P{index + 1}. {platform.label}</option>)}
        {(state.present.stairs ?? []).map((stair, index) => <option key={stair.id} value={`stair:${stair.id}`}>T{index + 1}. {stair.label}</option>)}
      </select>
      {selectedWall ? <WallForm key={JSON.stringify(selectedWall)} wall={selectedWall} typed={!!selectedWall.typeId} surfaces={surfaces} readOnly={readOnly} onApply={replace} onRemove={remove} />
        : selectedBraceItem ? <BraceInspector key={JSON.stringify(selectedBraceItem)} brace={selectedBraceItem} surfaces={surfaces} readOnly={readOnly} onApply={replaceBrace} onRemove={remove} />
          : selectedPlatformItem ? <PlatformInspector key={JSON.stringify(selectedPlatformItem)} platform={selectedPlatformItem} readOnly={readOnly} onApply={replacePlatform} onRemove={remove} />
            : selectedStairItem ? <StairInspector key={JSON.stringify(selectedStairItem)} stair={selectedStairItem} surfaces={surfaces} readOnly={readOnly} onApply={replaceStair} onRemove={remove} />
              : <p className="muted">Wählen Sie ein Objekt im Grundriss oder fügen Sie eine Wand, ein Podest oder eine Treppe hinzu.</p>}
    </aside></div>
  </section>;
}

function WallForm({ wall, typed, surfaces, readOnly, onApply, onRemove }: {
  wall: Wall; typed: boolean; surfaces: ReturnType<typeof supportingSurfaces>; readOnly: boolean; onApply: (wall: Wall) => void; onRemove: () => void;
}) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const keys = typed ? ['x', 'y', 'rotation'] : ['x', 'y', 'rotation', 'width', 'height', 'thickness'];
    const surface = String(data.get('supportingSurfaceId') || '');
    const result = wallSchema.safeParse({
      ...wall, label: data.get('label'), supportingSurfaceId: surface || undefined,
      ...Object.fromEntries(keys.map(key => [key, Number(data.get(key))])),
    });
    if (!result.success) { setError('Bitte prüfen Sie die Maße und die Bezeichnung.'); return; }
    setError(''); onApply(result.data);
  }
  return <form onSubmit={submit}><fieldset disabled={readOnly}>
    <label htmlFor="wall-label">Bezeichnung</label><input id="wall-label" name="label" defaultValue={wall.label} maxLength={120} required />
    <SurfaceField id="wall-surface" value={wall.supportingSurfaceId} surfaces={surfaces} />
    <div className="numeric-fields">{(typed ? [
      ['x', 'X (mm)', -100000, 100000], ['y', 'Y (mm)', -100000, 100000], ['rotation', 'Drehung (°)', -360, 360],
    ] as const : [
      ['width', 'Breite (mm)', 1, 100000], ['height', 'Höhe (mm)', 1, 100000], ['thickness', 'Dicke (mm)', 1, 100000],
      ['x', 'X (mm)', -100000, 100000], ['y', 'Y (mm)', -100000, 100000], ['rotation', 'Drehung (°)', -360, 360],
    ] as const).map(([key, label, min, max]) => <div key={key}><label htmlFor={`wall-${key}`}>{label}</label><input id={`wall-${key}`} name={key} type="number" step="any" min={min} max={max} defaultValue={wall[key]} required /></div>)}</div>
    <p className="muted">{typed ? 'Außenmaße und Öffnungen kommen vom Wandtyp.' : 'X/Y beziehen sich auf die Wandmitte. Ursprung: vordere linke Ecke der Spielstätte.'}</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!readOnly && <div className="form-actions"><button type="submit">Übernehmen</button><button className="quiet" type="button" onClick={onRemove}>Wand löschen</button></div>}
  </fieldset></form>;
}
