import { useState, type FormEvent } from 'react';
import { braceSchema, type Brace } from '../../shared/layout.js';
import type { SupportingSurface } from '../../shared/levels.js';
import { SurfaceField } from './PlatformLayer.js';
import { usePendingApplyForm } from './usePendingApplyForm.js';

export function BraceInspector({ brace, surfaces, readOnly, onPendingChange, onApply, onRemove, onAlign }: {
  brace: Brace; surfaces: SupportingSurface[]; readOnly: boolean;
  onPendingChange?: (pending: boolean) => void;
  onApply: (brace: Brace) => void; onRemove: () => void; onAlign?: () => void;
}) {
  const [error, setError] = useState('');
  const { pending, resetKey, clearPending, discard, formProps } = usePendingApplyForm(onPendingChange);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = braceSchema.safeParse({
      ...brace, label: data.get('label'),
      ballast: data.get('ballast') === 'single' ? { mode: 'single', side: data.get('ballastSide') } : { mode: data.get('ballast') },
      ...Object.fromEntries(['x', 'y', 'rotation', 'footprintWidth', 'footprintDepth', 'height'].map(key => [key, Number(data.get(key))])),
    });
    if (!result.success) { setError('Bitte prüfen Sie die Maße und die Bezeichnung.'); return; }
    setError(''); clearPending(); onApply(result.data);
  }
  return <form key={resetKey} onSubmit={submit} {...formProps}><fieldset disabled={readOnly}>
    <label htmlFor="brace-label">Bezeichnung</label><input id="brace-label" name="label" defaultValue={brace.label} maxLength={120} required />
    <label htmlFor="brace-ballast">Beschwerung</label>
    <select id="brace-ballast" name="ballast" defaultValue={brace.ballast?.mode ?? 'none'}>
      <option value="none">Keine</option><option value="single">Einfach · 1 Gehwegplatte</option>
      <option value="heavy">Schwer · 2 Gehwegplatten + 1 Spanngurt</option>
    </select>
    <label htmlFor="brace-ballast-side">Seite bei einfacher Beschwerung</label>
    <select id="brace-ballast-side" name="ballastSide" defaultValue={brace.ballast?.mode === 'single' ? brace.ballast.side : 'left'}>
      <option value="left">Links</option><option value="right">Rechts</option>
    </select>
    <p className="muted">Gehwegplatten: 400 × 400 × 50 mm. Links/rechts aus Sicht der Wand zum Bodenausleger.</p>
    <SurfaceField id="brace-surface" value={brace.supportingSurfaceId} surfaces={surfaces} />
    <div className="numeric-fields">{([
      ['footprintWidth', 'Grundfläche Breite (mm)', 1, 100000], ['footprintDepth', 'Grundfläche Tiefe (mm)', 1, 100000],
      ['height', 'Stützenhöhe (mm)', 1, 100000],
      ['x', 'X (mm)', -100000, 100000], ['y', 'Y (mm)', -100000, 100000], ['rotation', 'Drehung (°)', -360, 360],
    ] as const).map(([key, label, min, max]) => <div key={key}><label htmlFor={`brace-${key}`}>{label}</label>
      <input id={`brace-${key}`} name={key} type="number" step="any" min={min} max={max} defaultValue={brace[key]} required /></div>)}</div>
    <p className="muted">Stützdreieck aus 40×40 mm Holz: Wandseite 1200 mm, Bodenausleger 500 mm. Die hohe Seite zeigt zur Wand. X/Y beziehen sich auf die Grundflächenmitte.</p>
    <p className="muted">Stützen werden manuell platziert; es wird keine Stabilitätsempfehlung erzeugt.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!readOnly && <div className="form-actions">
      <button type="submit">Übernehmen</button>
      {pending && <button className="quiet" type="button" onClick={discard}>Verwerfen</button>}
      {onAlign && <button className="quiet" type="button" onClick={onAlign}>An Wand ausrichten</button>}
      <button className="quiet" type="button" onClick={onRemove}>Stütze löschen</button>
    </div>}
  </fieldset></form>;
}
