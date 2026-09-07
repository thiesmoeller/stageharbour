import { useState, type FormEvent } from 'react';
import {
  GROUP_PIVOT_NOTICE, canFormGroup, formGroup, groupContaining, groupPivot, transformGroup, ungroup,
  type GroupMember,
} from '../../shared/groups.js';
import type { Layout } from '../../shared/layout.js';

export function GroupInspector({ layout, picked, readOnly, onChange }: {
  layout: Layout; picked: GroupMember[]; readOnly: boolean; onChange: (layout: Layout) => void;
}) {
  const group = picked.map(member => groupContaining(layout, member)).find(item => item);
  const pivot = group ? groupPivot(layout, group.id) : undefined;
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!group || !pivot) return;
    const data = new FormData(event.currentTarget);
    const x = Number(data.get('x')), y = Number(data.get('y')), rotation = Number(data.get('rotation'));
    if (![x, y, rotation].every(Number.isFinite)) { setError('Bitte prüfen Sie die Gruppenmaße.'); return; }
    setError('');
    onChange(transformGroup(layout, group.id, { x, y, rotation }));
  }
  return <div className="group-panel" data-testid={group ? `group-${group.id}` : 'group-picker'}>
    <h3>Gruppe</h3>
    <p className="muted">{GROUP_PIVOT_NOTICE}</p>
    <p className="muted">Umschalt-Klick wählt weitere Wände, Stützen, Treppen oder Platzhalter. Einzelelemente bleiben bearbeitbar.</p>
    {!readOnly && !group && <div className="form-actions">
      <button type="button" disabled={!canFormGroup(layout, picked)}
        onClick={() => onChange(formGroup(layout, picked, crypto.randomUUID()))}>Gruppieren</button>
    </div>}
    {group && pivot && <form key={`${group.id}:${pivot.x}:${pivot.y}:${group.rotation}`} onSubmit={submit}><fieldset disabled={readOnly}>
      <div className="numeric-fields">
        <div><label htmlFor="group-x">Drehpunkt X (mm)</label>
          <input id="group-x" name="x" type="number" step="any" min={-100000} max={100000} defaultValue={pivot.x} required /></div>
        <div><label htmlFor="group-y">Drehpunkt Y (mm)</label>
          <input id="group-y" name="y" type="number" step="any" min={-100000} max={100000} defaultValue={pivot.y} required /></div>
        <div><label htmlFor="group-rotation">Gruppendrehung (°)</label>
          <input id="group-rotation" name="rotation" type="number" step="any" min={-360} max={360} defaultValue={group.rotation} required /></div>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {!readOnly && <div className="form-actions">
        <button type="submit">Übernehmen</button>
        <button className="quiet" type="button" onClick={() => onChange(ungroup(layout, group.id))}>Gruppe auflösen</button>
      </div>}
    </fieldset></form>}
  </div>;
}
