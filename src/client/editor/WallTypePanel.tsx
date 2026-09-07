import { useState, type FormEvent } from 'react';
import { newOpening, newWallType, wallTypeSchema, type WallElementType } from '../../shared/wall-types.js';

export function WallTypePanel({ types, selectedId, readOnly, onSelect, onCreate, onApply, onPlace, onRemove }: {
  types: WallElementType[]; selectedId?: string; readOnly: boolean;
  onSelect: (id?: string) => void;
  onCreate: (type: WallElementType) => void;
  onApply: (type: WallElementType) => void;
  onPlace: (type: WallElementType) => void;
  onRemove: (id: string) => void;
}) {
  const selected = types.find(type => type.id === selectedId);
  return <div className="wall-types">
    <h3>Wandtypen</h3>
    <label htmlFor="wall-type-selection">Wandtyp</label>
    <select id="wall-type-selection" value={selected?.id ?? ''} onChange={event => onSelect(event.target.value || undefined)}>
      <option value="">Wandtyp auswählen</option>
      {types.map((type, index) => <option key={type.id} value={type.id}>{index + 1}. {type.name}</option>)}
    </select>
    {!readOnly && <div className="form-actions">
      <button type="button" onClick={() => { const type = newWallType(crypto.randomUUID()); onCreate(type); }} disabled={types.length >= 250}>Wandtyp anlegen</button>
    </div>}
    {selected ? <TypeForm key={JSON.stringify(selected)} type={selected} readOnly={readOnly} onApply={onApply} onPlace={onPlace} onRemove={() => onRemove(selected.id)} />
      : <p className="muted">Legen Sie einen wiederverwendbaren Wandtyp mit rechteckigen Öffnungen an.</p>}
  </div>;
}

function TypeForm({ type, readOnly, onApply, onPlace, onRemove }: {
  type: WallElementType; readOnly: boolean;
  onApply: (type: WallElementType) => void; onPlace: (type: WallElementType) => void; onRemove: () => void;
}) {
  const [openings, setOpenings] = useState(type.openings);
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = wallTypeSchema.safeParse({
      ...type, name: data.get('name'),
      ...Object.fromEntries(['width', 'height', 'thickness'].map(key => [key, Number(data.get(key))])),
      openings: openings.map(opening => ({
        ...opening,
        ...Object.fromEntries(['left', 'sill', 'width', 'height'].map(key => [key, Number(data.get(`${key}-${opening.id}`))])),
      })),
    });
    if (!result.success) { setError('Bitte prüfen Sie die Außenmaße und ob alle Öffnungen innerhalb der Platte liegen.'); return; }
    setError(''); onApply(result.data);
  }
  return <form onSubmit={submit}><fieldset disabled={readOnly}>
    <label htmlFor="wall-type-name">Wandtyp-Bezeichnung</label>
    <input id="wall-type-name" name="name" defaultValue={type.name} maxLength={120} required />
    <div className="numeric-fields">{([
      ['width', 'Außenbreite (mm)'], ['height', 'Außenhöhe (mm)'], ['thickness', 'Außendicke (mm)'],
    ] as const).map(([key, label]) => <div key={key}><label htmlFor={`wall-type-${key}`}>{label}</label>
      <input id={`wall-type-${key}`} name={key} type="number" step="any" min={1} max={100000} defaultValue={type[key]} required /></div>)}
    </div>
    <h4>Rechteckige Öffnungen</h4>
    {openings.map((opening, index) => <div key={opening.id} className="opening-fields">
      <p>{index + 1}. Öffnung</p>
      {([
        ['left', 'Abstand von links (mm)'], ['sill', 'Abstand von unten (mm)'],
        ['width', 'Öffnungsbreite (mm)'], ['height', 'Öffnungshöhe (mm)'],
      ] as const).map(([key, label]) => <div key={key}><label htmlFor={`${key}-${opening.id}`}>{label}</label>
        <input id={`${key}-${opening.id}`} name={`${key}-${opening.id}`} type="number" step="any" min={key === 'width' || key === 'height' ? 1 : 0} max={100000} defaultValue={opening[key]} required /></div>)}
      {!readOnly && <button className="quiet" type="button" onClick={() => setOpenings(openings.filter(item => item.id !== opening.id))}>Öffnung entfernen</button>}
    </div>)}
    {!readOnly && <button className="quiet" type="button" onClick={() => setOpenings([...openings, newOpening(crypto.randomUUID())])}>Öffnung hinzufügen</button>}
    <p className="muted">Maße von der linken und unteren Kante der Plattenvorderseite. Türanschlag und Schwenkbereich gehören nicht dazu.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!readOnly && <div className="form-actions">
      <button type="submit">Wandtyp speichern</button>
      <button className="quiet" type="button" onClick={() => onPlace(type)}>Wandtyp platzieren</button>
      <button className="quiet" type="button" onClick={onRemove}>Wandtyp löschen</button>
    </div>}
  </fieldset></form>;
}
