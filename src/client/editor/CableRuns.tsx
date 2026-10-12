import type { CablePurpose, CableRun } from '../../shared/infrastructure.js';
import { CABLE_PURPOSE_LABELS, polylineLengthMm, requiredCableLengthMm } from '../../shared/infrastructure.js';

export function CableRunMarks({ runs }: { runs: readonly CableRun[] }) {
  return <g data-testid="cable-runs">
    {runs.map(run => {
      const first = run.path[0]!;
      const last = run.path.at(-1)!;
      return <g key={run.id} data-print-layer="cables" data-print-name={run.label} data-testid={`cable-run-${run.id}`}>
        <path d={run.path.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')}
          fill="none" stroke="#9b3f64" strokeWidth="5" vectorEffect="non-scaling-stroke" />
        <circle cx={first.x} cy={-first.y} r="65" fill="#fff" stroke="#9b3f64" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <circle cx={last.x} cy={-last.y} r="65" fill="#9b3f64" />
        <text x={first.x} y={-first.y - 100} fontSize="130" textAnchor="middle">{run.start.label}</text>
        <text x={last.x} y={-last.y - 100} fontSize="130" textAnchor="middle">{run.end.label}</text>
        <text x={(first.x + last.x) / 2} y={-(first.y + last.y) / 2 - 80} fontSize="130" textAnchor="middle">
          {run.label} · {run.quantity}× {run.cableType} · {(requiredCableLengthMm(run) / 1000).toFixed(1)} m
        </text>
      </g>;
    })}
  </g>;
}

export function CableRunsPanel({ runs, onChange, onClose }: {
  runs: CableRun[];
  onChange: (runs: CableRun[]) => void;
  onClose: () => void;
}) {
  function patch(id: string, value: Partial<CableRun>) {
    onChange(runs.map(run => run.id === id ? { ...run, ...value } : run));
  }
  return <aside className="cable-runs-panel" aria-label="Tatsächliche Kabelwege">
    <header className="section-heading"><h3>Kabelwege</h3><button type="button" className="quiet" onClick={onClose}>Schließen</button></header>
    <p className="muted">Diese Wege gehören zum Bühnenbild. Gestrichelte Korridore der Spielstätte dienen nur als Orientierung.</p>
    {!runs.length && <p>Noch keine Kabelwege. Mit „Kabel zeichnen“ Start und Ziel im Grundriss anklicken.</p>}
    {runs.map((run, index) => <fieldset key={run.id}>
      <legend>{index + 1}. {run.label}</legend>
      <label>Bezeichnung<input value={run.label} maxLength={120} onChange={event => patch(run.id, { label: event.target.value })} /></label>
      <label>Zweck<select value={run.purpose} onChange={event => patch(run.id, { purpose: event.target.value as CablePurpose })}>
        {Object.entries(CABLE_PURPOSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Kabeltyp<input value={run.cableType} maxLength={120} onChange={event => patch(run.id, { cableType: event.target.value })} /></label>
      <label>Anzahl<input type="number" min="1" max="100" value={run.quantity} onChange={event => patch(run.id, { quantity: Number(event.target.value) })} /></label>
      <label>Von<input value={run.start.label} maxLength={120} onChange={event => patch(run.id, { start: { ...run.start, label: event.target.value } })} /></label>
      <label>Nach<input value={run.end.label} maxLength={120} onChange={event => patch(run.id, { end: { ...run.end, label: event.target.value } })} /></label>
      <label>Zugabe (mm)<input type="number" min="0" max="100000" step="100" value={run.slackMm}
        onChange={event => patch(run.id, { slackMm: Number(event.target.value) })} /></label>
      <p>Weg {(polylineLengthMm(run.path) / 1000).toFixed(1)} m · benötigt {(requiredCableLengthMm(run) / 1000).toFixed(1)} m je Kabel</p>
      <button type="button" className="quiet" onClick={() => onChange(runs.filter(item => item.id !== run.id))}>Kabelweg entfernen</button>
    </fieldset>)}
  </aside>;
}
