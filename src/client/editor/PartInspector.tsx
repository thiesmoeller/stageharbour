import { useEffect, useState, type FormEvent } from 'react';
import type { LayoutObject, PartFaceFinish } from '../../shared/layout.js';
import type { ResolvedLayoutObject } from '../../shared/layoutObjects.js';
import type { PartSummary, StockItem } from '../../shared/parts/catalog.js';
import type { PartParameter } from '../../shared/parts/definition.js';
import type { FaceSurfacing, SurfaceFinish } from '../../shared/surfaces.js';
import { confirmDiscardPending, usePendingApplyForm } from './usePendingApplyForm.js';
import { FinishEditor } from './WallSurfaceEditor.js';

type SupportOption = { id: string; label: string };

function surfacing(value: PartFaceFinish | undefined): FaceSurfacing {
  if (!value) return {};
  return 'kind' in value ? { full: value } : value;
}

function PartFaceEditor({ id, label, value, height, onChange }: {
  id: string;
  label: string;
  value?: PartFaceFinish;
  height: number;
  onChange: (value?: PartFaceFinish) => void;
}) {
  const face = surfacing(value);
  const banded = face.splitMm !== undefined;
  const setFull = (finish?: SurfaceFinish) => onChange(finish);
  return <fieldset className="surface-face-editor"><legend>{label}</legend>
    <label htmlFor={`${id}-mode`}>Aufteilung</label>
    <select id={`${id}-mode`} aria-label={`${label} Aufteilung`} value={banded ? 'bands' : 'full'} onChange={event => {
      if (event.target.value === 'bands') onChange({
        splitMm: Math.max(1, Math.round(height / 2)),
        lower: face.full,
        upper: face.full,
      });
      else setFull(face.full ?? face.lower ?? face.upper);
    }}>
      <option value="full">Ganze Fläche</option>
      <option value="bands">Unteres / oberes Band</option>
    </select>
    {banded ? <>
      <label htmlFor={`${id}-split`}>Teilungshöhe (mm)</label>
      <input id={`${id}-split`} type="number" min={1} max={100000} value={face.splitMm}
        onChange={event => onChange({ ...face, splitMm: Number(event.target.value) || 1, full: undefined })} />
      <FinishEditor id={`${id}-lower`} finish={face.lower} faceHeightMm={face.splitMm!}
        onChange={finish => onChange({ ...face, full: undefined, lower: finish, splitMm: face.splitMm })} />
      <FinishEditor id={`${id}-upper`} finish={face.upper} faceHeightMm={Math.max(1, height - face.splitMm!)}
        onChange={finish => onChange({ ...face, full: undefined, upper: finish, splitMm: face.splitMm })} />
    </> : <FinishEditor id={`${id}-full`} finish={face.full} faceHeightMm={height} onChange={setFull} />}
  </fieldset>;
}

function ParameterField({ parameter, value }: { parameter: PartParameter; value: number }) {
  const id = `part-parameter-${parameter.key}`;
  if (parameter.type === 'toggle') {
    return <div><label htmlFor={id}>{parameter.label}</label><select id={id} name={`parameter:${parameter.key}`} defaultValue={value}>
      <option value={0}>Aus</option><option value={1}>Ein</option>
    </select></div>;
  }
  if (parameter.values?.length) {
    return <div><label htmlFor={id}>{parameter.label}</label><select id={id} name={`parameter:${parameter.key}`} defaultValue={value}>
      {parameter.values.map(option => <option key={option} value={option}>{option}</option>)}
    </select></div>;
  }
  return <div><label htmlFor={id}>{parameter.label}</label><input id={id} name={`parameter:${parameter.key}`}
    type="number" step={parameter.range?.step ?? 'any'} min={parameter.range?.min} max={parameter.range?.max}
    defaultValue={value} required /></div>;
}

export function PartInspector({ item, summary, latestRevision, stockItems, supports, readOnly, onApply, onRemove, onUpdateRevision, onPendingChange }: {
  item: ResolvedLayoutObject;
  summary?: PartSummary;
  latestRevision?: number;
  stockItems: readonly StockItem[];
  supports: readonly SupportOption[];
  readOnly: boolean;
  onApply: (object: LayoutObject) => void;
  onRemove: () => void;
  onUpdateRevision: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { object, definition, resolved } = item;
  const { pending, resetKey, markPending, clearPending, discard, formProps } = usePendingApplyForm(onPendingChange);
  const parameters = definition.parameters.filter(parameter => parameter.scope !== 'variant');
  const faces = [...new Map(resolved.faces.map(face => [face.key, face])).values()];
  const [finishes, setFinishes] = useState<NonNullable<LayoutObject['finishes']>>(() => object.finishes ?? {});
  const compatibleStock = stockItems.filter(stock =>
    stock.partId === object.part.id
    && stock.variantKey === (object.variant ?? null)
    && !stock.archived
  );
  useEffect(() => { setFinishes(object.finishes ?? {}); }, [object.id, object.finishes]);
  function discardAll() {
    setFinishes(object.finishes ?? {});
    discard();
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values: Record<string, number> = {};
    const state: Record<string, number> = {};
    for (const parameter of parameters) {
      const value = Number(data.get(`parameter:${parameter.key}`));
      if (!Number.isFinite(value)) return;
      (parameter.scope === 'state' ? state : values)[parameter.key] = value;
    }
    const support = String(data.get('support') ?? '');
    const stockItemId = String(data.get('stockItemId') ?? '');
    const assemblyRaw = String(data.get('assemblyNumber') ?? '');
    const variant = String(data.get('variant') ?? '');
    const {
      variant: _variant, values: _values, state: _state, support: _support,
      stockItemId: _stockItemId, assemblyNumber: _assemblyNumber, finishes: _finishes,
      ...base
    } = object;
    clearPending();
    onApply({
      ...base,
      label: String(data.get('label') ?? object.label).trim(),
      ...(variant ? { variant } : {}),
      ...(Object.keys(values).length ? { values } : {}),
      ...(Object.keys(state).length ? { state } : {}),
      x: Number(data.get('x')),
      y: Number(data.get('y')),
      rotation: Number(data.get('rotation')),
      ...(support ? { support } : {}),
      ...(stockItemId ? { stockItemId } : {}),
      ...(assemblyRaw ? { assemblyNumber: Number(assemblyRaw) } : {}),
      ...(Object.keys(finishes).length ? { finishes } : {}),
    });
  }
  return <aside className="wall-inspector">
    <h3>Bauteil</h3>
    <p className="muted">{definition.name} · Revision {object.part.revision}{summary ? ` · ${summary.category}` : ''}</p>
    {latestRevision && latestRevision > object.part.revision && !readOnly && <p className="warning">
      Revision {latestRevision} ist verfügbar. <button type="button" className="quiet" onClick={onUpdateRevision}>Revision aktualisieren</button>
    </p>}
    <form key={`${JSON.stringify(object)}:${resetKey}`} onSubmit={submit} {...formProps}><fieldset disabled={readOnly}>
      <label htmlFor="part-label">Bezeichnung</label>
      <input id="part-label" name="label" defaultValue={object.label} maxLength={120} required />
      {!!definition.variants?.length && <>
        <label htmlFor="part-variant">Variante</label>
        <select id="part-variant" name="variant" defaultValue={object.variant ?? ''}>
          {!object.variant && <option value="">Standard</option>}
          {definition.variants.map(variant => <option key={variant.key} value={variant.key}>{variant.label}</option>)}
        </select>
      </>}
      <div className="numeric-fields">
        <div><label htmlFor="part-x">X (mm)</label><input id="part-x" name="x" type="number" step="any" defaultValue={object.x} required /></div>
        <div><label htmlFor="part-y">Y (mm)</label><input id="part-y" name="y" type="number" step="any" defaultValue={object.y} required /></div>
        <div><label htmlFor="part-rotation">Drehung (°)</label><input id="part-rotation" name="rotation" type="number" step="any" min={-360} max={360} defaultValue={object.rotation} required /></div>
      </div>
      {parameters.length > 0 && <details open><summary>Parameter und Zustand</summary><div className="numeric-fields">
        {parameters.map(parameter => <ParameterField key={parameter.key} parameter={parameter} value={resolved.values[parameter.key] ?? parameter.default} />)}
      </div></details>}
      <label htmlFor="part-support">Auflage</label>
      <select id="part-support" name="support" defaultValue={object.support ?? ''}>
        <option value="">Zuschauerboden / automatisch</option>
        {supports.filter(option => option.id !== object.id).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <label htmlFor="part-stock">Bestandsstück</label>
      <select id="part-stock" name="stockItemId" defaultValue={object.stockItemId ?? ''}>
        <option value="">Kein Bestandsstück</option>
        {compatibleStock.map(stock => <option key={stock.id} value={stock.id} disabled={!stock.usable}>{stock.label}{stock.usable ? '' : ' · nicht verwendbar'}</option>)}
      </select>
      <label htmlFor="part-assembly">Montagenummer</label>
      <input id="part-assembly" name="assemblyNumber" type="number" min={1} max={250} defaultValue={object.assemblyNumber ?? ''} />
      {faces.length > 0 && <details><summary>Oberflächen</summary>
        {faces.map(face => <PartFaceEditor key={face.key} id={`part-finish-${face.key}`} label={face.label}
          value={finishes[face.key]} height={resolved.height}
          onChange={finish => {
            markPending();
            setFinishes(current => {
              const next = { ...current };
              if (finish) next[face.key] = finish;
              else delete next[face.key];
              return next;
            });
          }} />)}
      </details>}
      {!readOnly && <div className="form-actions"><button type="submit">Übernehmen</button>
        {pending && <button type="button" className="quiet" onClick={discardAll}>Verwerfen</button>}
        <button type="button" className="quiet" onClick={() => void confirmDiscardPending(pending).then(ok => {
          if (ok) onRemove();
        })}>Bauteil löschen</button></div>}
    </fieldset></form>
    {resolved.issues.length > 0 && <ul className="warning">{resolved.issues.map(issue => <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>)}</ul>}
  </aside>;
}
