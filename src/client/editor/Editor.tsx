import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type PointerEvent } from 'react';
import { z } from 'zod';
import { execute, history, redo, undo, type History } from '../../shared/history.js';
import { newWall, wallCorners, wallSchema, type Layout, type Scene, type Wall } from '../../shared/layout.js';
import { resolveWall, typesOf, type WallElementType } from '../../shared/wall-types.js';
import { LEASE_HEARTBEAT_MS } from '../../shared/leases.js';
import { ApiError, request } from '../api.js';
import { Autosave, SaveConflict } from './autosave.js';
import { StageView } from './StageView.js';
import { ExportPanel } from './ExportPanel.js';
import { WallTypePanel } from './WallTypePanel.js';

const statusText = { saved: 'Gespeichert', pending: 'Änderungen ausstehend …', saving: 'Speichert …', failed: 'Speichern fehlgeschlagen', conflict: 'Neuere Fassung vorhanden' };
export function Editor({ initial, workspaceId, readOnly, onClose, onDirty }: {
  initial: Scene; workspaceId: string; readOnly: boolean; onClose: () => void; onDirty: (value: boolean) => void;
}) {
  const [state, setState] = useState(() => history(initial.layout));
  const current = useRef(state);
  const [selected, setSelected] = useState<string>();
  const [selectedType, setSelectedType] = useState<string>();
  const [preview, setPreview] = useState<Wall>();
  const [exportsOpen, setExportsOpen] = useState(false);
  const gesture = useRef<{ wall: Wall; x: number; y: number; latest: Wall } | undefined>(undefined);
  const svg = useRef<SVGSVGElement>(null);
  const [saver] = useState(() => new Autosave(initial.layout, initial.revision, async (layout, revision) => {
    try {
      const result = await request(`/api/workspaces/${workspaceId}/scenes/${initial.id}/layout`, { revision, layout }, 'PUT');
      return z.object({ revision: z.number().int() }).parse(result).revision;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 423)) throw new SaveConflict(error.status === 423 ? 'lease' : 'revision');
      throw error;
    }
  }));
  const saveState = useSyncExternalStore(saver.subscribe, saver.getSnapshot);
  const dirty = saveState.dirty || !!preview;
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
      if (saver.getSnapshot().dirty || gesture.current) { event.preventDefault(); event.returnValue = ''; }
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
    const wall: Wall = { ...newWall(crypto.randomUUID(), initial.venue.width / 2, initial.venue.depth / 2), typeId: type.id, label: type.name, width: type.width, height: type.height, thickness: type.thickness };
    commit({ ...present, walls: [...present.walls, wall] });
    setSelected(wall.id);
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
  function remove() {
    if (!selected) return;
    commit({ ...current.current.present, walls: current.current.present.walls.filter(wall => wall.id !== selected) });
    setSelected(undefined);
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (readOnly || gesture.current || event.target instanceof HTMLElement && (event.target.closest('input, textarea, select, button') || event.target.isContentEditable)) return;
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
    if (readOnly || gesture.current) return;
    const position = point(event);
    gesture.current = { wall, ...position, latest: wall };
    setPreview(wall);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const drag = gesture.current;
    if (!drag) return;
    const position = point(event);
    const clamp = (value: number) => Math.max(-100000, Math.min(100000, Math.round(value)));
    drag.latest = { ...drag.wall, x: clamp(drag.wall.x + position.x - drag.x), y: clamp(drag.wall.y + position.y - drag.y) };
    setPreview(drag.latest);
  }
  function finish(cancelled = false) {
    const drag = gesture.current;
    gesture.current = undefined;
    setPreview(undefined);
    if (drag && !cancelled) replace(drag.latest);
  }
  // Bounds stay fixed during a gesture, so moving an object cannot move its coordinate system.
  const corners = state.present.walls.flatMap(wall => wallCorners(resolveWall(wall, wallTypes)));
  const minX = Math.min(0, ...corners.map(p => p.x)) - 600;
  const maxX = Math.max(initial.venue.width, ...corners.map(p => p.x)) + 600;
  const minY = Math.min(0, ...corners.map(p => p.y)) - 800;
  const maxY = Math.max(initial.venue.depth, ...corners.map(p => p.y)) + 600;
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...initial, revision: saveState.revision, layout: current.current.present }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `buehnenentwurf-${initial.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="editor" aria-label="Bühnenbild bearbeiten">
    <div className="editor-heading"><div><p className="eyebrow">{initial.productionName} · {initial.venueName}</p><h2>{initial.name}</h2></div>
      <button className="quiet" disabled={dirty} onClick={onClose}>Zur Übersicht</button></div>
    <div className="editor-toolbar">
      {!readOnly && <><button disabled={!!preview || state.present.walls.length >= 250} onClick={() => {
        const wall = newWall(crypto.randomUUID(), initial.venue.width / 2, initial.venue.depth / 2);
        commit({ ...state.present, walls: [...state.present.walls, wall] }); setSelected(wall.id);
      }}>Wand hinzufügen</button>
      <button className="quiet" disabled={!!preview || !state.past.length} onClick={() => apply(undo(current.current))}>Rückgängig</button>
      <button className="quiet" disabled={!!preview || !state.future.length} onClick={() => apply(redo(current.current))}>Wiederholen</button></>}
      <button className="quiet" onClick={() => setExportsOpen(open => !open)}>{exportsOpen ? 'Export schließen' : 'Konstruktionsplan'}</button>
      <span className={`save-status ${saveState.status}`} role="status">{readOnly
        ? (initial.lease ? `Nur Ansicht · Bearbeitung durch ${initial.lease.holderName}` : 'Nur Ansicht')
        : saveState.status === 'conflict' && saveState.conflictKind === 'lease' ? 'Bearbeitung abgelaufen' : statusText[saveState.status]}</span>
    </div>
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
        <rect x="0" y={-initial.venue.depth} width={initial.venue.width} height={initial.venue.depth} fill="url(#metre-grid)" stroke="#718469" strokeWidth="2" vectorEffect="non-scaling-stroke" onPointerDown={() => setSelected(undefined)} />
        <text x={initial.venue.width / 2} y={-initial.venue.depth - 200} textAnchor="middle" fontSize="180">{initial.venue.width} mm</text>
        <text x="-170" y={-initial.venue.depth / 2} textAnchor="middle" fontSize="180" transform={`rotate(-90 -170 ${-initial.venue.depth / 2})`}>{initial.venue.depth} mm</text>
        <text x={initial.venue.width / 2} y="420" textAnchor="middle" fontSize="190">↑ Publikum · Blick zur Bühne</text>
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
      </svg>
      <p className="muted">Raster: 1 m · Alle Eingaben in mm · Wände zum Verschieben ziehen</p>
    </div>
    <StageView layout={{ ...state.present, walls: state.present.walls.map(wall => preview?.id === wall.id ? preview : wall) }} venue={initial.venue} />
    </div><aside className="wall-inspector">
      <WallTypePanel types={wallTypes} selectedId={selectedType} readOnly={readOnly}
        onSelect={setSelectedType} onCreate={applyType} onApply={applyType} onPlace={placeType} onRemove={removeType} />
      <h3>Wandelement</h3>
      <label htmlFor="wall-selection">Auswahl</label><select id="wall-selection" value={selectedWall?.id ?? ''} onChange={event => setSelected(event.target.value || undefined)}><option value="">Wand auswählen</option>{state.present.walls.map((wall, index) => <option key={wall.id} value={wall.id}>{index + 1}. {wall.label}</option>)}</select>
      {selectedWall ? <WallForm key={JSON.stringify(selectedWall)} wall={selectedWall} typed={!!selectedWall.typeId} readOnly={readOnly} onApply={replace} onRemove={remove} /> : <p className="muted">Wählen Sie eine Wand im Grundriss oder fügen Sie eine neue hinzu.</p>}
    </aside></div>
  </section>;
}

function WallForm({ wall, typed, readOnly, onApply, onRemove }: { wall: Wall; typed: boolean; readOnly: boolean; onApply: (wall: Wall) => void; onRemove: () => void }) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const keys = typed ? ['x', 'y', 'rotation'] : ['x', 'y', 'rotation', 'width', 'height', 'thickness'];
    const result = wallSchema.safeParse({ ...wall, label: data.get('label'), ...Object.fromEntries(keys.map(key => [key, Number(data.get(key))])) });
    if (!result.success) { setError('Bitte prüfen Sie die Maße und die Bezeichnung.'); return; }
    setError(''); onApply(result.data);
  }
  return <form onSubmit={submit}><fieldset disabled={readOnly}>
    <label htmlFor="wall-label">Bezeichnung</label><input id="wall-label" name="label" defaultValue={wall.label} maxLength={120} required />
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
