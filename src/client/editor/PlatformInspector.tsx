import { lazy, Suspense, useState, type FormEvent } from 'react';
import {
  PLATFORM_STYLE_LABELS, axisAlignedPlatformOutline, orientedPlatformBox, platformSchema, stairSchema,
  type Platform, type PlatformStyle, type StairUnit, type SupportingSurface,
} from '../../shared/levels.js';
import { clipPlatformToStageDeck, snapStageDeckElevation, snapStageDeckSize } from '../../shared/stageDeck.js';
import { usePendingApplyForm } from './usePendingApplyForm.js';

const MaterialPicker = lazy(() => import('./MaterialPicker.js'));

export function PlatformInspector({ platform, readOnly, bulkCount = 1, finishMixed = false, onPendingChange, onApply, onRemove }: {
  platform: Platform; readOnly: boolean; bulkCount?: number; finishMixed?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onApply: (platform: Platform) => void; onRemove: () => void;
}) {
  const [error, setError] = useState('');
  const { pending, resetKey, clearPending, discard, formProps } = usePendingApplyForm(onPendingChange);
  const box = orientedPlatformBox(platform.outline);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const x = Number(data.get('x')), y = Number(data.get('y'));
    let width = Number(data.get('width')), depth = Number(data.get('depth'));
    let elevation = Number(data.get('elevation'));
    const rotation = Number(data.get('rotation'));
    const finishRaw = String(data.get('finish') ?? '');
    const finish = finishMixed && (!finishRaw || finishRaw === '__mixed__')
      ? platform.finish
      : (typeof finishRaw === 'string' && finishRaw && finishRaw !== '__mixed__' ? finishRaw : undefined);
    const style = String(data.get('style') || 'floating') as PlatformStyle;
    if (style === 'stageDeck') {
      const snapped = snapStageDeckSize(width, depth);
      width = snapped.width; depth = snapped.depth;
      elevation = snapStageDeckElevation(elevation);
    }
    const result = platformSchema.safeParse({
      ...platform, label: data.get('label'), elevation, style,
      outline: axisAlignedPlatformOutline(x, y, width, depth, rotation),
      finish,
    });
    if (!result.success) { setError('Bitte prüfen Sie die Maße und die Bezeichnung.'); return; }
    setError('');
    clearPending();
    onApply(style === 'stageDeck' ? clipPlatformToStageDeck(result.data) : result.data);
  }
  return <form key={resetKey} onSubmit={submit} {...formProps}><fieldset disabled={readOnly}>
    {bulkCount > 1 && <p className="muted bulk-selection-hint">{bulkCount} Podeste ausgewählt. Die Oberfläche wird auf alle übernommen; übrige Felder gelten nur für das hervorgehobene Podest.</p>}
    <label htmlFor="platform-label">Bezeichnung</label><input id="platform-label" name="label" defaultValue={platform.label} maxLength={120} required />
    <label htmlFor="platform-style">Bauweise</label>
    <select id="platform-style" name="style" defaultValue={platform.style ?? 'floating'}>
      {(Object.keys(PLATFORM_STYLE_LABELS) as PlatformStyle[]).map(key =>
        <option key={key} value={key}>{PLATFORM_STYLE_LABELS[key]}</option>)}
    </select>
    <p className="muted">Bühnenelement rastet auf 2×1 / 2×0,5 / 1×1 / 1×0,5&nbsp;m mit Beinen ein. Massiv füllt bis zum Boden. Schwebend ist die bisherige Platte.</p>
    <div className="numeric-fields">{([
      ['elevation', 'Höhe über Fußboden (mm)', 1, 100000, platform.elevation],
      ['width', 'Breite (mm)', 1, 100000, box.width], ['depth', 'Tiefe (mm)', 1, 100000, box.depth],
      ['x', 'X (mm)', -100000, 100000, box.x], ['y', 'Y (mm)', -100000, 100000, box.y],
      ['rotation', 'Drehung (°)', -360, 360, box.rotation],
    ] as const).map(([key, label, min, max, value]) => <div key={key}><label htmlFor={`platform-${key}`}>{label}</label>
      <input id={`platform-${key}`} name={key} type="number" step="any" min={min} max={max} defaultValue={value} required /></div>)}</div>
    <Suspense fallback={<p>Materialbibliothek wird geladen …</p>}>
      <MaterialPicker id="platform-finish" value={platform.finish} mixed={finishMixed} />
    </Suspense>
    {error && <p role="alert" className="error">{error}</p>}
    {!readOnly && <div className="form-actions">
      <button type="submit">Übernehmen</button>
      {pending && <button className="quiet" type="button" onClick={discard}>Verwerfen</button>}
      <button className="quiet" type="button" onClick={onRemove}>Podest löschen</button>
    </div>}
  </fieldset></form>;
}

export function StairInspector({ stair, surfaces, readOnly, onPendingChange, onApply, onRemove }: {
  stair: StairUnit; surfaces: SupportingSurface[]; readOnly: boolean;
  onPendingChange?: (pending: boolean) => void;
  onApply: (stair: StairUnit) => void; onRemove: () => void;
}) {
  const [error, setError] = useState('');
  const { pending, resetKey, clearPending, discard, formProps } = usePendingApplyForm(onPendingChange);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = stairSchema.safeParse({
      ...stair, label: data.get('label'),
      lowerSurfaceId: data.get('lowerSurfaceId'), upperSurfaceId: data.get('upperSurfaceId'),
      ...Object.fromEntries(['x', 'y', 'rotation', 'width', 'run', 'riserHeight'].map(key => [key, Number(data.get(key))])),
    });
    if (!result.success) { setError('Bitte prüfen Sie die Maße und die verbundenen Flächen.'); return; }
    setError(''); clearPending(); onApply(result.data);
  }
  return <form key={resetKey} onSubmit={submit} {...formProps}><fieldset disabled={readOnly}>
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
    {!readOnly && <div className="form-actions">
      <button type="submit">Übernehmen</button>
      {pending && <button className="quiet" type="button" onClick={discard}>Verwerfen</button>}
      <button className="quiet" type="button" onClick={onRemove}>Treppe löschen</button>
    </div>}
  </fieldset></form>;
}
