import { useState, type FormEvent } from 'react';
import {
  GROUP_PIVOT_NOTICE, groupContaining, groupPivot, transformGroup, ungroup,
  type GroupMember,
} from '../../shared/groups.js';
import type { Layout } from '../../shared/layout.js';
import { usePendingApplyForm } from './usePendingApplyForm.js';

/** Pivot numerics for a selected group. Form/dissolve commands live on the editing toolbar. */
export function GroupInspector({ layout, picked, readOnly, onPendingChange, onChange }: {
  layout: Layout; picked: GroupMember[]; readOnly: boolean;
  onPendingChange?: (pending: boolean) => void;
  onChange: (layout: Layout) => void;
}) {
  const group = picked.map(member => groupContaining(layout, member)).find(item => item);
  const pivot = group ? groupPivot(layout, group.id) : undefined;
  const [error, setError] = useState('');
  const { pending, resetKey, clearPending, discard, formProps } = usePendingApplyForm(onPendingChange);
  if (!group || !pivot) return null;
  const active = group;
  const activePivot = pivot;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const x = Number(data.get('x')), y = Number(data.get('y')), rotation = Number(data.get('rotation'));
    if (![x, y, rotation].every(Number.isFinite)) { setError('Bitte prüfen Sie die Gruppenmaße.'); return; }
    setError('');
    clearPending();
    onChange(transformGroup(layout, active.id, { x, y, rotation }));
  }
  return <div className="group-panel" data-testid={`group-${active.id}`}>
    <h3>Gruppe</h3>
    <p className="muted">{GROUP_PIVOT_NOTICE}</p>
    <form key={`${active.id}:${activePivot.x}:${activePivot.y}:${active.rotation}:${resetKey}`} onSubmit={submit} {...formProps}><fieldset disabled={readOnly}>
      <div className="numeric-fields">
        <div><label htmlFor="group-x">Drehpunkt X (mm)</label>
          <input id="group-x" name="x" type="number" step="any" min={-100000} max={100000} defaultValue={activePivot.x} required /></div>
        <div><label htmlFor="group-y">Drehpunkt Y (mm)</label>
          <input id="group-y" name="y" type="number" step="any" min={-100000} max={100000} defaultValue={activePivot.y} required /></div>
        <div><label htmlFor="group-rotation">Gruppendrehung (°)</label>
          <input id="group-rotation" name="rotation" type="number" step="any" min={-360} max={360} defaultValue={active.rotation} required /></div>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {!readOnly && <div className="form-actions">
        <button type="submit">Übernehmen</button>
        {pending && <button className="quiet" type="button" onClick={discard}>Verwerfen</button>}
        <button className="quiet" type="button" onClick={() => onChange(ungroup(layout, active.id))}>Gruppe auflösen</button>
      </div>}
    </fieldset></form>
  </div>;
}
