import { useState, type FormEvent } from 'react';
import type { InventoryPanel } from '../../shared/inventory.js';
import { wallTypeSchema } from '../../shared/wall-types.js';
import { WallSurfaceEditor } from './WallSurfaceEditor.js';
import { WallTypePreview } from './WallTypePreview.js';

export function PhysicalPanelForm({ panel, disabled, onSave, onCancel }: {
  panel: InventoryPanel; disabled: boolean;
  onSave: (body: { label: string; note: string | null; cutouts: NonNullable<InventoryPanel['cutouts']>; finish?: { surfaces: NonNullable<InventoryPanel['currentFinish']>['surfaces']; description: string } }) => void;
  onCancel: () => void;
}) {
  const [cutouts, setCutouts] = useState(panel.cutouts ?? []);
  const [surfaces, setSurfaces] = useState(panel.currentFinish?.surfaces ?? {});
  const [finishChanged, setFinishChanged] = useState(false);
  const [error, setError] = useState('');
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallTypeSchema.safeParse({ ...panel.type, openings: [...panel.type.openings, ...cutouts] }).success) {
      setError('Alle Ausschnitte müssen innerhalb der Platte liegen. Höchstens 20 Öffnungen insgesamt.'); return;
    }
    const data = new FormData(event.currentTarget);
    onSave({ label: String(data.get('label')).trim(), note: String(data.get('note') ?? '').trim() || null, cutouts,
      ...(finishChanged ? { finish: { surfaces, description: String(data.get('finishDescription') ?? '').trim() } } : {}),
    });
  }
  return <form data-testid={`edit-panel-${panel.id}`} onSubmit={save}><fieldset disabled={disabled}>
    <label>Plattenetikett<input name="label" required maxLength={120} defaultValue={panel.label} /></label>
    <label>Reparaturhinweis<input name="note" maxLength={500} defaultValue={panel.note ?? ''} /></label>
    <WallTypePreview type={panel.type} cutouts={cutouts} surfaces={surfaces} />
    <h4>Technikausschnitte dieser Platte</h4>
    <p className="muted">Für Steckdosen und Kabel. Maße von links und unten an der Vorderseite. Diese Bestandsmerkmale verändern keinen Bühnenbildentwurf.</p>
    {cutouts.map((opening, index) => <div className="opening-fields" key={opening.id}>
      <strong>Ausschnitt {index + 1}</strong>
      <div className="numeric-fields">{([['left', 'Von links'], ['sill', 'Von unten'], ['width', 'Breite'], ['height', 'Höhe']] as const).map(([key, label]) => <label key={key}>{label} (mm)<input type="number" required min={key === 'width' || key === 'height' ? 1 : 0} max={100000} value={opening[key]} onChange={event => setCutouts(current => current.map(item => item.id === opening.id ? { ...item, [key]: Number(event.target.value) } : item))} /></label>)}</div>
      <button type="button" className="quiet" onClick={() => setCutouts(current => current.filter(item => item.id !== opening.id))}>Ausschnitt entfernen</button>
    </div>)}
    <button type="button" className="quiet" disabled={cutouts.length + panel.type.openings.length >= 20} onClick={() => setCutouts(current => [...current, { id: crypto.randomUUID(), left: 0, sill: 0, width: Math.min(80, panel.type.width), height: Math.min(80, panel.type.height) }])}>Steckdosen-/Kabelausschnitt hinzufügen</button>
    <h4>Tatsächliche Oberfläche</h4>
    <p className="muted">Nur bereits ausgeführte Farbe oder Tapete erfassen. Geplante Arbeiten werden separat bestätigt.</p>
    <WallSurfaceEditor surfaces={surfaces} panelHeight={panel.type.height} onChange={next => { setSurfaces(next ?? {}); setFinishChanged(true); }} />
    <label>Tapete / Oberflächenhinweis<input name="finishDescription" maxLength={300} defaultValue={panel.currentFinish?.description ?? ''} placeholder="z. B. Blumentapete, Rückseite weiß" onChange={() => setFinishChanged(true)} /></label>
    {error && <p role="alert">{error}</p>}
    <div className="form-actions"><button type="submit">Speichern</button><button type="button" className="quiet" onClick={onCancel}>Abbrechen</button></div>
  </fieldset></form>;
}
