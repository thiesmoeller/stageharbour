import { useState, type FormEvent } from 'react';
import { braceSchema, type Brace } from '../../shared/layout.js';

export function BraceInspector({ brace, readOnly, onApply, onRemove }: {
  brace: Brace; readOnly: boolean; onApply: (brace: Brace) => void; onRemove: () => void;
}) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = braceSchema.safeParse({
      ...brace, label: data.get('label'),
      ...Object.fromEntries(['x', 'y', 'rotation', 'footprintWidth', 'footprintDepth', 'height'].map(key => [key, Number(data.get(key))])),
    });
    if (!result.success) { setError('Bitte prüfen Sie die Maße und die Bezeichnung.'); return; }
    setError(''); onApply(result.data);
  }
  return <form onSubmit={submit}><fieldset disabled={readOnly}>
    <label htmlFor="brace-label">Bezeichnung</label><input id="brace-label" name="label" defaultValue={brace.label} maxLength={120} required />
    <div className="numeric-fields">{([
      ['footprintWidth', 'Grundfläche Breite (mm)', 1, 100000], ['footprintDepth', 'Grundfläche Tiefe (mm)', 1, 100000],
      ['height', 'Stützenhöhe (mm)', 1, 100000],
      ['x', 'X (mm)', -100000, 100000], ['y', 'Y (mm)', -100000, 100000], ['rotation', 'Drehung (°)', -360, 360],
    ] as const).map(([key, label, min, max]) => <div key={key}><label htmlFor={`brace-${key}`}>{label}</label>
      <input id={`brace-${key}`} name={key} type="number" step="any" min={min} max={max} defaultValue={brace[key]} required /></div>)}</div>
    <p className="muted">Beispielmaße, keine gemessene Inventarvorgabe. X/Y beziehen sich auf die Grundflächenmitte.</p>
    <p className="muted">Stützen werden manuell platziert; es wird keine Stabilitätsempfehlung erzeugt.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!readOnly && <div className="form-actions"><button type="submit">Übernehmen</button><button className="quiet" type="button" onClick={onRemove}>Stütze löschen</button></div>}
  </fieldset></form>;
}
