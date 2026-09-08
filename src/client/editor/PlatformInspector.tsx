import { useState, type FormEvent } from 'react';
import { axisAlignedPlatformOutline, platformBounds, platformSchema, stairSchema, type Platform, type StairUnit, type SupportingSurface } from '../../shared/levels.js';

export function PlatformInspector({ platform, readOnly, onApply, onRemove }: {
  platform: Platform; readOnly: boolean; onApply: (platform: Platform) => void; onRemove: () => void;
}) {
  const [error, setError] = useState('');
  const box = platformBounds(platform.outline);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const x = Number(data.get('x')), y = Number(data.get('y'));
    const width = Number(data.get('width')), depth = Number(data.get('depth'));
    const rotation = Number(data.get('rotation'));
    const result = platformSchema.safeParse({
      ...platform, label: data.get('label'), elevation: Number(data.get('elevation')),
      outline: axisAlignedPlatformOutline(x, y, width, depth, rotation),
    });
    if (!result.success) { setError('Bitte prüfen Sie die Maße und die Bezeichnung.'); return; }
    setError(''); onApply(result.data);
  }
  return <form onSubmit={submit}><fieldset disabled={readOnly}>
    <label htmlFor="platform-label">Bezeichnung</label><input id="platform-label" name="label" defaultValue={platform.label} maxLength={120} required />
    <div className="numeric-fields">{([
      ['elevation', 'Höhe über Fußboden (mm)', 1, 100000, platform.elevation],
      ['width', 'Breite (mm)', 1, 100000, box.width], ['depth', 'Tiefe (mm)', 1, 100000, box.depth],
      ['x', 'X (mm)', -100000, 100000, box.x], ['y', 'Y (mm)', -100000, 100000, box.y],
      ['rotation', 'Drehung (°)', -360, 360, 0],
    ] as const).map(([key, label, min, max, value]) => <div key={key}><label htmlFor={`platform-${key}`}>{label}</label>
      <input id={`platform-${key}`} name={key} type="number" step="any" min={min} max={max} defaultValue={value} required /></div>)}</div>
    <p className="muted">Beispielmaße, keine gemessene Spielstättenvorgabe. Umriss aus Mittelpunkt, Rechteck und Drehung.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!readOnly && <div className="form-actions"><button type="submit">Übernehmen</button><button className="quiet" type="button" onClick={onRemove}>Podest löschen</button></div>}
  </fieldset></form>;
}

export function StairInspector({ stair, surfaces, readOnly, onApply, onRemove }: {
  stair: StairUnit; surfaces: SupportingSurface[]; readOnly: boolean;
  onApply: (stair: StairUnit) => void; onRemove: () => void;
}) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = stairSchema.safeParse({
      ...stair, label: data.get('label'),
      lowerSurfaceId: data.get('lowerSurfaceId'), upperSurfaceId: data.get('upperSurfaceId'),
      ...Object.fromEntries(['x', 'y', 'rotation', 'width', 'run', 'riserHeight'].map(key => [key, Number(data.get(key))])),
    });
    if (!result.success) { setError('Bitte prüfen Sie die Maße und die verbundenen Flächen.'); return; }
    setError(''); onApply(result.data);
  }
  return <form onSubmit={submit}><fieldset disabled={readOnly}>
    <label htmlFor="stair-label">Bezeichnung</label><input id="stair-label" name="label" defaultValue={stair.label} maxLength={120} required />
    <label htmlFor="stair-lower">Untere Fläche</label>
    <select id="stair-lower" name="lowerSurfaceId" defaultValue={stair.lowerSurfaceId}>
      {surfaces.map(surface => <option key={surface.id} value={surface.id}>{surface.label} ({surface.elevation} mm)</option>)}
    </select>
    <label htmlFor="stair-upper">Obere Fläche</label>
    <select id="stair-upper" name="upperSurfaceId" defaultValue={stair.upperSurfaceId}>
      {surfaces.map(surface => <option key={surface.id} value={surface.id}>{surface.label} ({surface.elevation} mm)</option>)}
    </select>
    <div className="numeric-fields">{([
      ['width', 'Breite (mm)', 1], ['run', 'Lauflänge (mm)', 1], ['riserHeight', 'Steigung je Stufe (mm)', 1],
      ['x', 'X (mm)', -100000], ['y', 'Y (mm)', -100000], ['rotation', 'Drehung (°)', -360],
    ] as const).map(([key, label, min]) => <div key={key}><label htmlFor={`stair-${key}`}>{label}</label>
      <input id={`stair-${key}`} name={key} type="number" step="any" min={min} max={key === 'rotation' ? 360 : 100000} defaultValue={stair[key]} required /></div>)}</div>
    <p className="muted">Die Gesamthöhe ergibt sich aus den verbundenen Auflageflächen. Beispielmaße, keine gemessene Vorgabe.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!readOnly && <div className="form-actions"><button type="submit">Übernehmen</button><button className="quiet" type="button" onClick={onRemove}>Treppe löschen</button></div>}
  </fieldset></form>;
}
