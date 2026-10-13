import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CablePurpose, CableRun } from '../../shared/infrastructure.js';
import {
  CABLE_PURPOSE_LABELS, insertCableRunVertex, polylineLengthMm, removeCableRunVertex,
  requiredCableLengthMm,
} from '../../shared/infrastructure.js';

const CABLE_STROKE = '#9b3f64';
const SELECTION = '#b67c35';

export function CableRunMarks({ runs, selectedId, selectedVertexIndex, draftPath, readOnly = false, onPathPointerDown, onVertexPointerDown }: {
  runs: readonly CableRun[];
  selectedId?: string;
  selectedVertexIndex?: number;
  draftPath?: readonly { x: number; y: number }[];
  readOnly?: boolean;
  onPathPointerDown?: (event: ReactPointerEvent<SVGPathElement>, runId: string) => void;
  onVertexPointerDown?: (event: ReactPointerEvent<SVGCircleElement>, runId: string, index: number) => void;
}) {
  return <g data-testid="cable-runs">
    {runs.map(run => {
      const first = run.path[0]!;
      const last = run.path.at(-1)!;
      const selected = selectedId === run.id;
      const d = run.path.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ');
      return <g key={run.id} data-print-layer="cables" data-print-name={run.label} data-testid={`cable-run-${run.id}`}
        aria-selected={selected || undefined}>
        {/* Wide invisible stroke: select, or insert midpoint when already selected. */}
        {onPathPointerDown && !readOnly && <path d={d} fill="none" stroke="transparent" strokeWidth="48"
          vectorEffect="non-scaling-stroke" pointerEvents="stroke"
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.stopPropagation();
            onPathPointerDown(event, run.id);
          }} />}
        <path d={d} fill="none" stroke={selected ? SELECTION : CABLE_STROKE} strokeWidth="5"
          vectorEffect="non-scaling-stroke" pointerEvents="none" />
        {selected && !readOnly
          ? run.path.map((point, index) => {
            const vertexSelected = selectedVertexIndex === index;
            const endpoint = index === 0 || index === run.path.length - 1;
            return <circle key={index} data-testid={`cable-run-vertex-${run.id}-${index}`}
              aria-selected={vertexSelected || undefined}
              cx={point.x} cy={-point.y} r={vertexSelected ? 85 : 70}
              fill={vertexSelected ? '#fff' : SELECTION} stroke={SELECTION} strokeWidth={vertexSelected ? 5 : 3}
              vectorEffect="non-scaling-stroke" className="draggable-wall"
              onPointerDown={onVertexPointerDown ? event => onVertexPointerDown(event, run.id, index) : undefined}>
              <title>{endpoint ? 'Endpunkt (nur verschieben)' : 'Zwischenpunkt · Entf entfernt'}</title>
            </circle>;
          })
          : <>
            <circle cx={first.x} cy={-first.y} r="65" fill="#fff" stroke={CABLE_STROKE} strokeWidth="3"
              vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle cx={last.x} cy={-last.y} r="65" fill={CABLE_STROKE} pointerEvents="none" />
          </>}
        <text x={first.x} y={-first.y - 100} fontSize="130" textAnchor="middle" pointerEvents="none">{run.start.label}</text>
        <text x={last.x} y={-last.y - 100} fontSize="130" textAnchor="middle" pointerEvents="none">{run.end.label}</text>
        <text x={(first.x + last.x) / 2} y={-(first.y + last.y) / 2 - 80} fontSize="130" textAnchor="middle" pointerEvents="none">
          {run.label} · {run.quantity}× {run.cableType} · {(requiredCableLengthMm(run) / 1000).toFixed(1)} m
        </text>
      </g>;
    })}
    {draftPath && draftPath.length > 0 && <g data-testid="cable-run-draft" pointerEvents="none">
      <path d={draftPath.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')}
        fill="none" stroke={CABLE_STROKE} strokeWidth="5" strokeDasharray="40 30" vectorEffect="non-scaling-stroke" />
      {draftPath.map((point, index) =>
        <circle key={index} cx={point.x} cy={-point.y} r="55" fill={index ? CABLE_STROKE : '#fff'}
          stroke={CABLE_STROKE} strokeWidth="3" vectorEffect="non-scaling-stroke" />)}
    </g>}
  </g>;
}

export function CableRunsPanel({ runs, selectedId, onChange, onSelect, onClose }: {
  runs: CableRun[];
  selectedId?: string;
  onChange: (runs: CableRun[]) => void;
  onSelect?: (id: string | undefined) => void;
  onClose: () => void;
}) {
  function patch(id: string, value: CableRun) {
    onChange(runs.map(run => run.id === id ? value : run));
  }
  return <aside className="cable-runs-panel" aria-label="Tatsächliche Kabelwege">
    <header className="section-heading"><h3>Kabelwege</h3><button type="button" className="quiet" onClick={onClose}>Schließen</button></header>
    <p className="muted">Polylinie zeichnen (Klicks setzen Punkte, Enter oder Doppelklick beendet). Weg anklicken wählt · nochmal auf die Linie klicken fügt einen Zwischenpunkt ein · Eckpunkt + Entf entfernt · Entf ohne Punktwahl löscht den Weg.</p>
    {!runs.length && <p>Noch keine Kabelwege. Mit „Kabel zeichnen“ Punkte im Grundriss setzen.</p>}
    {runs.map((run, index) => <fieldset key={run.id} data-selected={selectedId === run.id || undefined}>
      <legend>
        <button type="button" className={selectedId === run.id ? '' : 'quiet'} onClick={() => onSelect?.(run.id)}>
          {index + 1}. {run.label}
        </button>
      </legend>
      <label>Bezeichnung<input value={run.label} maxLength={120} onChange={event => patch(run.id, { ...run, label: event.target.value })} /></label>
      <label>Zweck<select value={run.purpose} onChange={event => patch(run.id, { ...run, purpose: event.target.value as CablePurpose })}>
        {Object.entries(CABLE_PURPOSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Kabeltyp<input value={run.cableType} maxLength={120} onChange={event => patch(run.id, { ...run, cableType: event.target.value })} /></label>
      <label>Anzahl<input type="number" min="1" max="100" value={run.quantity} onChange={event => patch(run.id, { ...run, quantity: Number(event.target.value) })} /></label>
      <label>Von<input value={run.start.label} maxLength={120} onChange={event => patch(run.id, { ...run, start: { ...run.start, label: event.target.value } })} /></label>
      <label>Nach<input value={run.end.label} maxLength={120} onChange={event => patch(run.id, { ...run, end: { ...run.end, label: event.target.value } })} /></label>
      <label>Zugabe (mm)<input type="number" min="0" max="100000" step="100" value={run.slackMm}
        onChange={event => patch(run.id, { ...run, slackMm: Number(event.target.value) })} /></label>
      <p>{run.path.length} Punkte · Weg {(polylineLengthMm(run.path) / 1000).toFixed(1)} m · benötigt {(requiredCableLengthMm(run) / 1000).toFixed(1)} m je Kabel</p>
      <div className="form-actions">
        <button type="button" className="quiet" disabled={run.path.length >= 500} onClick={() => {
          const last = run.path.at(-1)!;
          const prev = run.path.at(-2) ?? last;
          patch(run.id, insertCableRunVertex(run, run.path.length - 2, {
            x: Math.round((last.x + prev.x) / 2), y: Math.round((last.y + prev.y) / 2),
          }));
        }}>Zwischenpunkt einfügen</button>
        <button type="button" className="quiet" disabled={run.path.length <= 2} onClick={() => {
          const middle = Math.max(1, Math.min(run.path.length - 2, Math.floor(run.path.length / 2)));
          patch(run.id, removeCableRunVertex(run, middle));
        }}>Einen Zwischenpunkt entfernen</button>
        <button type="button" className="quiet" onClick={() => {
          onChange(runs.filter(item => item.id !== run.id));
          if (selectedId === run.id) onSelect?.(undefined);
        }}>Kabelweg entfernen</button>
      </div>
    </fieldset>)}
  </aside>;
}
