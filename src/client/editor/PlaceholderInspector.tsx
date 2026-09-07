import { useState, type FormEvent } from 'react';
import type { SupportingSurface } from '../../shared/levels.js';
import {
  PLACEHOLDER_DEFERRED_NOTICE, PLACEHOLDER_EXAMPLE_NOTICE, PLACEHOLDER_KIND_LABELS, PLACEHOLDER_KINDS,
  newPlaceholder, placeholderKindSchema, placeholderSchema, type Placeholder, type PlaceholderKind,
} from '../../shared/placeholders.js';
import { SurfaceField } from './PlatformLayer.js';

const kinds = PLACEHOLDER_KINDS;

export function PlaceholderLibrary({ readOnly, disabled, onAdd }: {
  readOnly: boolean; disabled: boolean; onAdd: (kind: PlaceholderKind) => void;
}) {
  return <div className="placeholder-library">
    <h3>Platzhalter</h3>
    <p className="muted">{PLACEHOLDER_EXAMPLE_NOTICE} {PLACEHOLDER_DEFERRED_NOTICE}</p>
    {!readOnly && <div className="form-actions">{kinds.map(kind =>
      <button key={kind} type="button" className="quiet" disabled={disabled} onClick={() => onAdd(kind)}>
        {PLACEHOLDER_KIND_LABELS[kind]} hinzufügen</button>)}
    </div>}
  </div>;
}

export function PlaceholderInspector({ item, surfaces, readOnly, onApply, onRemove }: {
  item: Placeholder; surfaces: SupportingSurface[]; readOnly: boolean;
  onApply: (item: Placeholder) => void; onRemove: () => void;
}) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const surface = String(data.get('supportingSurfaceId') || '');
    const kind = placeholderKindSchema.safeParse(data.get('kind'));
    const result = placeholderSchema.safeParse({
      ...item, kind: kind.success ? kind.data : item.kind, label: data.get('label'),
      supportingSurfaceId: surface || undefined,
      ...Object.fromEntries(['x', 'y', 'rotation', 'width', 'depth', 'height'].map(key => [key, Number(data.get(key))])),
    });
    if (!result.success) { setError('Bitte prüfen Sie die Maße und die Bezeichnung.'); return; }
    setError(''); onApply(result.data);
  }
  return <form onSubmit={submit}><fieldset disabled={readOnly}>
    <label htmlFor="placeholder-kind">Art</label>
    <select id="placeholder-kind" name="kind" defaultValue={item.kind}>
      {kinds.map(kind => <option key={kind} value={kind}>{PLACEHOLDER_KIND_LABELS[kind]}</option>)}
    </select>
    <label htmlFor="placeholder-label">Bezeichnung</label>
    <input id="placeholder-label" name="label" defaultValue={item.label} maxLength={120} required />
    <SurfaceField id="placeholder-surface" value={item.supportingSurfaceId} surfaces={surfaces} />
    <div className="numeric-fields">{([
      ['width', 'Breite (mm)', 1, 100000], ['depth', 'Tiefe (mm)', 1, 100000], ['height', 'Höhe (mm)', 1, 100000],
      ['x', 'X (mm)', -100000, 100000], ['y', 'Y (mm)', -100000, 100000], ['rotation', 'Drehung (°)', -360, 360],
    ] as const).map(([key, label, min, max]) => <div key={key}><label htmlFor={`placeholder-${key}`}>{label}</label>
      <input id={`placeholder-${key}`} name={key} type="number" step="any" min={min} max={max} defaultValue={item[key]} required /></div>)}</div>
    <p className="muted">{PLACEHOLDER_EXAMPLE_NOTICE} X/Y beziehen sich auf die Grundflächenmitte.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!readOnly && <div className="form-actions"><button type="submit">Übernehmen</button>
      <button className="quiet" type="button" onClick={onRemove}>Platzhalter löschen</button></div>}
  </fieldset></form>;
}

export function addPlaceholder(kind: PlaceholderKind, x: number, y: number): Placeholder {
  return newPlaceholder(kind, crypto.randomUUID(), x, y);
}
