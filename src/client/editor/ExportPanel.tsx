import { useEffect, useState, type FormEvent } from 'react';
import { exportListSchema, exportRevisionSchema, germanDate, type ExportRevision } from '../../shared/export.js';
import { ELEVATION_PROJECTION_NOTICE } from '../../shared/elevations.js';
import type { Group } from '../../shared/groups.js';
import type { Wall } from '../../shared/layout.js';
import { ApiError, request } from '../api.js';

const statusText = { pending: 'In Arbeit', ready: 'Fertig', failed: 'Fehlgeschlagen' };

export function PackageExport({ workspaceId, productionId, sceneId, scenes, readOnly, freezeDisabled }: {
  workspaceId: string; productionId: string; sceneId?: string;
  scenes?: readonly { id: string; name: string }[];
  readOnly: boolean; freezeDisabled?: boolean;
}) {
  const base = `/api/workspaces/${workspaceId}/productions/${productionId}/packages`;
  const [items, setItems] = useState<ExportRevision[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  function load() {
    setBusy(true); setError('');
    request(base).then(data => setItems(exportListSchema.parse(data)))
      .catch(() => setError('Der Paketverlauf konnte nicht geladen werden.'))
      .finally(() => setBusy(false));
  }
  useEffect(load, [base]);
  async function freeze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const sceneIds = scenes ? data.getAll('sceneIds').map(String) : sceneId ? [sceneId] : [];
    if (!name || !sceneIds.length) { setError('Bitte wählen Sie mindestens eine Szene.'); return; }
    setBusy(true); setError('');
    try {
      const created = exportRevisionSchema.parse(await request(base, {
        name, paper: data.get('paper'), scale: Number(data.get('scale')), sceneIds,
      }));
      (event.target as HTMLFormElement).reset();
      if (created.status === 'failed') {
        setError('Das PDF konnte nicht erzeugt werden. Bitte erneut versuchen.');
      }
      load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Das Konstruktionspaket konnte nicht erzeugt werden.');
      setBusy(false);
    }
  }
  async function retry(id: string) {
    setBusy(true); setError('');
    try { await request(`${base}/${id}/retry`, {}); load(); }
    catch { setError('Die Fassung konnte nicht erneut erzeugt werden.'); setBusy(false); }
  }
  async function download(item: ExportRevision) {
    setError('');
    try {
      const response = await fetch(`${base}/${item.id}/file`, { credentials: 'same-origin' });
      if (!response.ok) throw new ApiError(response.status, 'Download fehlgeschlagen.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `konstruktionspaket-${item.id}.pdf`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Das Konstruktionspaket konnte nicht heruntergeladen werden.'); }
  }
  const prefix = `package-${productionId}`;
  return <section className="export-panel" aria-label="Konstruktionspaket">
    <h3>Konstruktionspaket</h3>
    <p className="muted">Stückliste und Konstruktionspläne der gewählten Szenen. Wiederholte Einsätze derselben Platte zählen als eine physische Platte. Die Fassung sichert Maße, Zuweisungen und Hinweise; spätere Bestands-, Typ- oder Spielstättenänderungen ändern sie nicht.</p>
    {!readOnly && <form onSubmit={event => void freeze(event)}><fieldset disabled={busy || freezeDisabled}>
      <label htmlFor={`${prefix}-name`}>Bezeichnung des Pakets</label>
      <input id={`${prefix}-name`} name="name" required maxLength={120} />
      <label htmlFor={`${prefix}-paper`}>Papierformat des Pakets</label>
      <select id={`${prefix}-paper`} name="paper" defaultValue="A4">
        <option value="A4">A4</option>
        <option value="A3">A3</option>
      </select>
      <label htmlFor={`${prefix}-scale`}>Maßstab des Pakets</label>
      <select id={`${prefix}-scale`} name="scale" defaultValue="50">
        <option value="25">1:25</option>
        <option value="50">1:50</option>
        <option value="100">1:100</option>
      </select>
      {scenes && scenes.length > 0 && <div className="elevation-groups">
        <p>Szenen für das Paket</p>
        {scenes.map(scene => <label key={scene.id} htmlFor={`${prefix}-scene-${scene.id}`}>
          <input id={`${prefix}-scene-${scene.id}`} type="checkbox" name="sceneIds" value={scene.id} defaultChecked />
          {scene.name}
        </label>)}
      </div>}
      <button type="submit">Als Konstruktionspaket exportieren</button>
    </fieldset></form>}
    {error && <p className="error" role="alert">{error}</p>}
    {busy && <p role="status">Paketverlauf wird geladen …</p>}
    <ul className="export-list">{items.map(item => <li key={item.id}>
      <strong>{item.name}</strong>
      <span>{germanDate(item.createdAt)} · {item.paper} · 1:{item.scale} · {statusText[item.status]}</span>
      {item.status === 'ready' && <button className="quiet" type="button" onClick={() => void download(item)}>Herunterladen</button>}
      {item.status === 'failed' && !readOnly && <button className="quiet" type="button" onClick={() => void retry(item.id)}>Erneut versuchen</button>}
    </li>)}</ul>
    {!busy && !items.length && <p className="muted">Noch keine Konstruktionspakete.</p>}
  </section>;
}

export function ExportPanel({ workspaceId, sceneId, productionId, readOnly, freezeDisabled, groups, walls }: {
  workspaceId: string; sceneId: string; productionId: string; readOnly: boolean; freezeDisabled: boolean;
  groups: Group[]; walls: Wall[];
}) {
  const base = `/api/workspaces/${workspaceId}/scenes/${sceneId}/exports`;
  const [items, setItems] = useState<ExportRevision[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  function load() {
    setBusy(true); setError('');
    request(base).then(data => setItems(exportListSchema.parse(data)))
      .catch(() => setError('Der Exportverlauf konnte nicht geladen werden.'))
      .finally(() => setBusy(false));
  }
  useEffect(load, [base]);
  async function freeze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return;
    setBusy(true); setError('');
    try {
      await request(base, {
        name, paper: data.get('paper'), scale: Number(data.get('scale')),
        elevationGroupIds: data.getAll('elevationGroupIds'),
      });
      (event.target as HTMLFormElement).reset();
      load();
    } catch { setError('Der Konstruktionsplan konnte nicht erzeugt werden.'); setBusy(false); }
  }
  async function retry(id: string) {
    setBusy(true); setError('');
    try { await request(`${base}/${id}/retry`, {}); load(); }
    catch { setError('Die Fassung konnte nicht erneut erzeugt werden.'); setBusy(false); }
  }
  async function download(item: ExportRevision) {
    setError('');
    try {
      const response = await fetch(`${base}/${item.id}/file`, { credentials: 'same-origin' });
      if (!response.ok) throw new ApiError(response.status, 'Download fehlgeschlagen.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `konstruktionsplan-${item.id}.pdf`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Der Konstruktionsplan konnte nicht heruntergeladen werden.'); }
  }
  return <>
    <section className="export-panel" aria-label="Konstruktionsplan">
      <h3>Konstruktionsplan</h3>
      <p className="muted">A4 oder A3, Maßstab 1:25, 1:50 oder 1:100. Größere Spielstätten werden mit 20 mm Überlappung auf mehrere Blätter verteilt. Gewählte Wandgruppen erhalten bemaßte Frontansichten. {ELEVATION_PROJECTION_NOTICE} Die Fassung sichert den gespeicherten Stand; spätere Änderungen ändern sie nicht.</p>
      {!readOnly && <form onSubmit={event => void freeze(event)}><fieldset disabled={busy || freezeDisabled}>
        <label htmlFor="export-name">Bezeichnung der Fassung</label>
        <input id="export-name" name="name" required maxLength={120} />
        <label htmlFor="export-paper">Papierformat</label>
        <select id="export-paper" name="paper" defaultValue="A4">
          <option value="A4">A4</option>
          <option value="A3">A3</option>
        </select>
        <label htmlFor="export-scale">Maßstab</label>
        <select id="export-scale" name="scale" defaultValue="50">
          <option value="25">1:25</option>
          <option value="50">1:50</option>
          <option value="100">1:100</option>
        </select>
        {groups.length > 0 && <div className="elevation-groups">
          <p>Frontansichten für gewählte Gruppen</p>
          {groups.map((group, index) => {
            const labels = group.members.filter(member => member.kind === 'wall')
              .map(member => walls.find(wall => wall.id === member.id)?.label ?? 'Wand');
            return <label key={group.id} htmlFor={`elevation-group-${group.id}`}>
              <input id={`elevation-group-${group.id}`} type="checkbox" name="elevationGroupIds" value={group.id} />
              {`Gruppe ${index + 1} · ${labels.join(', ')}`}
            </label>;
          })}
        </div>}
        <button type="submit">Als Konstruktionsplan exportieren</button>
      </fieldset></form>}
      {error && <p className="error" role="alert">{error}</p>}
      {busy && <p role="status">Exportverlauf wird geladen …</p>}
      <ul className="export-list">{items.map(item => <li key={item.id}>
        <strong>{item.name}</strong>
        <span>{germanDate(item.createdAt)} · {item.paper} · 1:{item.scale} · {statusText[item.status]}</span>
        {item.status === 'ready' && <button className="quiet" type="button" onClick={() => void download(item)}>Herunterladen</button>}
        {item.status === 'failed' && !readOnly && <button className="quiet" type="button" onClick={() => void retry(item.id)}>Erneut versuchen</button>}
      </li>)}</ul>
      {!busy && !items.length && <p className="muted">Noch keine exportierten Fassungen.</p>}
    </section>
    <PackageExport workspaceId={workspaceId} productionId={productionId} sceneId={sceneId}
      readOnly={readOnly} freezeDisabled={freezeDisabled} />
  </>;
}
