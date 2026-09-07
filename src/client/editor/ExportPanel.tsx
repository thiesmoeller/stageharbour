import { useEffect, useState, type FormEvent } from 'react';
import { exportListSchema, germanDate, type ExportRevision } from '../../shared/export.js';
import { ApiError, request } from '../api.js';

const statusText = { pending: 'In Arbeit', ready: 'Fertig', failed: 'Fehlgeschlagen' };
export function ExportPanel({ workspaceId, sceneId, readOnly, freezeDisabled }: {
  workspaceId: string; sceneId: string; readOnly: boolean; freezeDisabled: boolean;
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
      await request(base, { name, paper: data.get('paper'), scale: Number(data.get('scale')) });
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
  return <section className="export-panel" aria-label="Konstruktionsplan">
    <h3>Konstruktionsplan</h3>
    <p className="muted">A4 oder A3, Maßstab 1:25, 1:50 oder 1:100. Größere Spielstätten werden mit 20 mm Überlappung auf mehrere Blätter verteilt. Die Fassung sichert den gespeicherten Stand; spätere Änderungen ändern sie nicht.</p>
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
  </section>;
}
