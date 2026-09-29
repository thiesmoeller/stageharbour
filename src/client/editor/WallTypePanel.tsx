import { useState, type FormEvent } from 'react';
import { GROUP_WALL_TYPE_KINDS, GROUP_WALL_TYPE_NAMES, groupWallType, groupWallTypeSizeLabel, type GroupWallTypeKind } from '../../shared/inventory.js';
import { newDoorOpening, newOpening, newWallType, wallTypeSchema, type DoorHinge, type WallElementType } from '../../shared/wall-types.js';
import { WallTypePreview } from './WallTypePreview.js';
import { confirmDiscardPending, usePendingApplyForm } from './usePendingApplyForm.js';

export function WallTypePanel({ types, selectedId, readOnly, onSelect, onCreate, onApply, onPlace, onRemove, onPendingChange }: {
  types: WallElementType[]; selectedId?: string; readOnly: boolean;
  onSelect: (id?: string) => void;
  onCreate: (type: WallElementType) => void;
  onApply: (type: WallElementType) => void;
  onPlace?: (type: WallElementType) => void;
  onRemove: (id: string) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [template, setTemplate] = useState<GroupWallTypeKind | ''>('plain');
  const [typePending, setTypePending] = useState(false);
  const selected = types.find(type => type.id === selectedId);
  function createType() {
    void (async () => {
      if (!(await confirmDiscardPending(typePending))) return;
      const type = template
        ? groupWallType(template, crypto.randomUUID(), crypto.randomUUID())
        : newWallType(crypto.randomUUID());
      onCreate(type);
    })();
  }
  return <div className="wall-types">
    <h3>Wandtypen</h3>
    <label htmlFor="wall-type-selection">Wandtyp</label>
    <select id="wall-type-selection" value={selected?.id ?? ''} onChange={event => {
      const next = event.target.value || undefined;
      void (async () => {
        if (!(await confirmDiscardPending(typePending))) return;
        onSelect(next);
      })();
    }}>
      <option value="">Wandtyp auswählen</option>
      {types.map((type, index) => <option key={type.id} value={type.id}>{index + 1}. {type.name}</option>)}
    </select>
    <div className="wall-type-gallery">{types.map(type => <button type="button" className="quiet" key={type.id} aria-pressed={type.id === selectedId} onClick={() => { void (async () => { if (await confirmDiscardPending(typePending)) onSelect(type.id); })(); }}><WallTypePreview type={type} /><strong>{type.name}</strong><span>{type.width} × {type.height} mm</span></button>)}</div>
    {!readOnly && <>
      <label htmlFor="wall-type-template">Vorlage aus Bestandsarten</label>
      <select id="wall-type-template" value={template} onChange={event => setTemplate(event.target.value as GroupWallTypeKind | '')}>
        <option value="">Leerer Wandtyp</option>
        {GROUP_WALL_TYPE_KINDS.map(kind => <option key={kind} value={kind}>{GROUP_WALL_TYPE_NAMES[kind]} ({groupWallTypeSizeLabel(kind)})</option>)}
      </select>
      <div className="form-actions">
        <button type="button" onClick={createType} disabled={types.length >= 250}>Wandtyp anlegen</button>
      </div>
      <p className="muted">Vorlagen aus dem Sensenmann-Aufbau und dem gemeldeten Bestand. Türwände mit Scharnier links/rechts, weißem Blatt 800×2000 und Zarge 25×50 mm. Halbe Wände (600×2400×250 mm) stehen links und rechts der Tür. Der Bogen hat gerade Laibungen und einen Halbkreis oben (Öffnung 800×2000).</p>
    </>}
    {selected ? <TypeForm key={JSON.stringify(selected)} type={selected} readOnly={readOnly}
      onPendingChange={pending => { setTypePending(pending); onPendingChange?.(pending); }}
      onApply={onApply} onPlace={onPlace} onRemove={() => onRemove(selected.id)} />
      : <p className="muted">Legen Sie einen wiederverwendbaren Wandtyp mit rechteckigen Öffnungen an.</p>}
  </div>;
}

function TypeForm({ type, readOnly, onPendingChange, onApply, onPlace, onRemove }: {
  type: WallElementType; readOnly: boolean;
  onPendingChange?: (pending: boolean) => void;
  onApply: (type: WallElementType) => void; onPlace?: (type: WallElementType) => void; onRemove: () => void;
}) {
  const [openings, setOpenings] = useState(type.openings);
  const [preview, setPreview] = useState(type);
  const [error, setError] = useState('');
  const { pending, resetKey, markPending, clearPending, discard, formProps } = usePendingApplyForm(onPendingChange);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = wallTypeSchema.safeParse({
      ...type, name: data.get('name'),
      ...Object.fromEntries(['width', 'height', 'thickness'].map(key => [key, Number(data.get(key))])),
      openings: openings.map(opening => {
        const hingeRaw = String(data.get(`hinge-${opening.id}`) ?? '');
        const hinge = hingeRaw === 'left' || hingeRaw === 'right' ? hingeRaw : undefined;
        return {
          ...opening, hinge,
          ...Object.fromEntries(['left', 'sill', 'width', 'height'].map(key => [key, Number(data.get(`${key}-${opening.id}`))])),
        };
      }),
    });
    if (!result.success) { setError('Bitte prüfen Sie die Außenmaße und ob alle Öffnungen innerhalb der Platte liegen.'); return; }
    setError(''); clearPending(); onApply(result.data);
  }
  return <form key={resetKey} onSubmit={submit} {...formProps} onChangeCapture={event => {
    const data = new FormData(event.currentTarget);
    const candidate = wallTypeSchema.safeParse({ ...type,
      ...Object.fromEntries(['width', 'height', 'thickness'].map(key => [key, Number(data.get(key))])),
      openings: openings.map(opening => ({ ...opening, ...Object.fromEntries(['left', 'sill', 'width', 'height'].map(key => [key, Number(data.get(`${key}-${opening.id}`))])) })),
    });
    if (candidate.success) setPreview(candidate.data);
  }}><fieldset disabled={readOnly}>
    <label htmlFor="wall-type-name">Wandtyp-Bezeichnung</label>
    <input id="wall-type-name" name="name" defaultValue={type.name} maxLength={120} required />
    <div className="numeric-fields">{([
      ['width', 'Außenbreite (mm)'], ['height', 'Außenhöhe (mm)'], ['thickness', 'Außendicke (mm)'],
    ] as const).map(([key, label]) => <div key={key}><label htmlFor={`wall-type-${key}`}>{label}</label>
      <input id={`wall-type-${key}`} name={key} type="number" step="any" min={1} max={100000} defaultValue={type[key]} required /></div>)}
    </div>
    <WallTypePreview type={{ ...preview, openings: openings.map(opening => preview.openings.find(item => item.id === opening.id) ?? opening) }} />
    <h4>Öffnungen</h4>
    {openings.map((opening, index) => <div key={opening.id} className="opening-fields">
      <p>{index + 1}. Öffnung</p>
      {([
        ['left', 'Abstand von links (mm)'], ['sill', 'Abstand von unten (mm)'],
        ['width', 'Öffnungsbreite (mm)'], ['height', 'Öffnungshöhe (mm)'],
      ] as const).map(([key, label]) => <div key={key}><label htmlFor={`${key}-${opening.id}`}>{label}</label>
        <input id={`${key}-${opening.id}`} name={`${key}-${opening.id}`} type="number" step="any" min={key === 'width' || key === 'height' ? 1 : 0} max={100000} defaultValue={opening[key]} required /></div>)}
      <label htmlFor={`hinge-${opening.id}`}>Türscharnier</label>
      <select id={`hinge-${opening.id}`} name={`hinge-${opening.id}`} defaultValue={opening.hinge ?? ''}>
        <option value="">Keine Tür (nur Öffnung)</option>
        <option value="left">Scharnier links</option>
        <option value="right">Scharnier rechts</option>
      </select>
      {!readOnly && <button className="quiet" type="button" onClick={() => { markPending(); setOpenings(openings.filter(item => item.id !== opening.id)); }}>Öffnung entfernen</button>}
    </div>)}
    {!readOnly && <div className="form-actions">
      <button className="quiet" type="button" onClick={() => { markPending(); setOpenings([...openings, newOpening(crypto.randomUUID())]); }}>Öffnung hinzufügen</button>
      <button className="quiet" type="button" onClick={() => { markPending(); setOpenings([...openings, newDoorOpening(crypto.randomUUID(), 'left' satisfies DoorHinge)]); }}>Türöffnung hinzufügen</button>
    </div>}
    <p className="muted">Maße von der linken und unteren Kante der Plattenvorderseite. Mit Scharnier: weißes Türblatt 800×2000 mm und Zarge 25×50 mm außen. Öffnungsgrad am platzierten Türelement.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!readOnly && <div className="form-actions">
      <button type="submit">Wandtyp speichern</button>
      {pending && <button className="quiet" type="button" onClick={() => { setOpenings(type.openings); setPreview(type); discard(); }}>Verwerfen</button>}
      {onPlace && <button className="quiet" type="button" onClick={() => onPlace(type)}>Wandtyp platzieren</button>}
      <button className="quiet" type="button" onClick={onRemove}>Wandtyp löschen</button>
    </div>}
  </fieldset></form>;
}
