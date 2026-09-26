import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  defaultExportLayers, EXPORT_LAYER_OPTIONS, exportListSchema, exportPreviewResultSchema, exportRevisionSchema,
  germanDate, type ExportLayers, type ExportRevision,
} from '../../shared/export.js';
import { ELEVATION_PROJECTION_NOTICE } from '../../shared/elevations.js';
import type { Group } from '../../shared/groups.js';
import type { Wall } from '../../shared/layout.js';
import { ApiError, request } from '../api.js';
import { askConfirm } from '../ConfirmDialog.js';

const statusText = { pending: 'In Arbeit', ready: 'Fertig', failed: 'Fehlgeschlagen' };

function LayerToggles({ idPrefix, layers, onChange, disabled }: {
  idPrefix: string; layers: ExportLayers; onChange: (next: ExportLayers) => void; disabled?: boolean;
}) {
  return <div className="export-layers" role="group" aria-label="PDF-Ebenen">
    <p className="export-layers-title">Inhalt der PDF</p>
    {EXPORT_LAYER_OPTIONS.map(option => <label key={option.key} htmlFor={`${idPrefix}-${option.key}`} title={option.hint}>
      <input id={`${idPrefix}-${option.key}`} type="checkbox" checked={layers[option.key]} disabled={disabled}
        onChange={event => onChange({ ...layers, [option.key]: event.target.checked })} />
      {option.label}
    </label>)}
  </div>;
}

export function PackageExport({ workspaceId, productionId, sceneId, scenes, readOnly, freezeDisabled }: {
  workspaceId: string; productionId: string; sceneId?: string;
  scenes?: readonly { id: string; name: string }[];
  readOnly: boolean; freezeDisabled?: boolean;
}) {
  const base = `/api/workspaces/${workspaceId}/productions/${productionId}/packages`;
  const [items, setItems] = useState<ExportRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [layers, setLayers] = useState<ExportLayers>(defaultExportLayers);
  function load() {
    setLoading(true);
    request(base).then(data => setItems(exportListSchema.parse(data)))
      .catch(() => setError('Der Paketverlauf konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [base]);
  async function freeze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const sceneIds = scenes ? data.getAll('sceneIds').map(String) : sceneId ? [sceneId] : [];
    if (!name || !sceneIds.length) { setError('Bitte wählen Sie mindestens eine Szene.'); return; }
    setGenerating(true); setError('');
    try {
      const created = exportRevisionSchema.parse(await request(base, {
        name, paper: data.get('paper'), scale: Number(data.get('scale')), sceneIds, layers,
      }));
      (event.target as HTMLFormElement).reset();
      setLayers(defaultExportLayers);
      if (created.status === 'failed') setError('Das PDF konnte nicht erzeugt werden. Bitte erneut versuchen.');
      load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Das Konstruktionspaket konnte nicht erzeugt werden.');
    } finally {
      setGenerating(false);
    }
  }
  async function retry(id: string) {
    setGenerating(true); setError('');
    try { await request(`${base}/${id}/retry`, {}); load(); }
    catch { setError('Die Fassung konnte nicht erneut erzeugt werden.'); }
    finally { setGenerating(false); }
  }
  async function download(item: ExportRevision) {
    setError('');
    try {
      const response = await fetch(`${base}/${item.id}/file`, { credentials: 'same-origin' });
      if (!response.ok) throw new ApiError(response.status, 'Download fehlgeschlagen.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      const safe = item.name.replace(/[^\wÄÖÜäöüß\-]+/g, '_').slice(0, 40);
      anchor.href = url; anchor.download = `konstruktionspaket-${safe || item.id.slice(0, 8)}.pdf`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Das Konstruktionspaket konnte nicht heruntergeladen werden.'); }
  }
  async function remove(id: string) {
    if (!await askConfirm({
      title: 'Konstruktionspaket löschen?',
      message: 'Dieses Konstruktionspaket endgültig löschen?',
      confirmLabel: 'Paket löschen',
      danger: true,
    })) return;
    setGenerating(true); setError('');
    try {
      await request(`${base}/${id}`, undefined, 'DELETE');
      load();
    } catch { setError('Das Konstruktionspaket konnte nicht gelöscht werden.'); }
    finally { setGenerating(false); }
  }
  const prefix = `package-${productionId}`;
  const busy = loading || generating;
  return <section className="export-panel" aria-label="Konstruktionspaket">
    <h3>Konstruktionspaket</h3>
    <p className="muted">Stückliste und Konstruktionspläne der gewählten Szenen. Ebenen steuern den Inhalt der Pläne.</p>
    {!readOnly && <form onSubmit={event => void freeze(event)}><fieldset disabled={busy || freezeDisabled}>
      <label htmlFor={`${prefix}-name`}>Bezeichnung des Pakets</label>
      <input id={`${prefix}-name`} name="name" required maxLength={120} />
      <label htmlFor={`${prefix}-paper`}>Papierformat</label>
      <select id={`${prefix}-paper`} name="paper" defaultValue="A4">
        <option value="A4">A4</option>
        <option value="A3">A3</option>
      </select>
      <label htmlFor={`${prefix}-scale`}>Maßstab</label>
      <select id={`${prefix}-scale`} name="scale" defaultValue="50">
        <option value="25">1:25</option>
        <option value="50">1:50</option>
        <option value="100">1:100</option>
      </select>
      <LayerToggles idPrefix={`${prefix}-layer`} layers={layers} onChange={setLayers} disabled={busy || freezeDisabled} />
      {scenes && scenes.length > 0 && <div className="elevation-groups">
        <p>Szenen für das Paket</p>
        {scenes.map(scene => <label key={scene.id} htmlFor={`${prefix}-scene-${scene.id}`}>
          <input id={`${prefix}-scene-${scene.id}`} type="checkbox" name="sceneIds" value={scene.id} defaultChecked />
          {scene.name}
        </label>)}
      </div>}
      {freezeDisabled && <p className="muted">Bitte speichern Sie ausstehende Änderungen, bevor Sie exportieren.</p>}
      <button type="submit">{generating ? 'Erzeugt …' : 'Als Konstruktionspaket exportieren'}</button>
    </fieldset></form>}
    {error && <p className="error" role="alert">{error}</p>}
    {loading && <p role="status">Paketverlauf wird geladen …</p>}
    <ul className="export-list">{items.map(item => <li key={item.id}>
      <strong>{item.name}</strong>
      <span>{germanDate(item.createdAt)} · {item.paper} · 1:{item.scale} · {statusText[item.status]}</span>
      {item.status === 'ready' && <button className="quiet" type="button" onClick={() => void download(item)}>Herunterladen</button>}
      {item.status === 'failed' && !readOnly && <button className="quiet" type="button" onClick={() => void retry(item.id)}>Erneut versuchen</button>}
      {!readOnly && <button className="quiet" type="button" onClick={() => void remove(item.id)}>Löschen</button>}
    </li>)}</ul>
    {!loading && !items.length && <p className="muted">Noch keine Konstruktionspakete.</p>}
  </section>;
}

export function ExportPanel({ workspaceId, sceneId, productionId, readOnly, freezeDisabled, groups, walls }: {
  workspaceId: string; sceneId: string; productionId: string; readOnly: boolean; freezeDisabled: boolean;
  groups: Group[]; walls: Wall[];
}) {
  const base = `/api/workspaces/${workspaceId}/scenes/${sceneId}/exports`;
  const [items, setItems] = useState<ExportRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [layers, setLayers] = useState<ExportLayers>(defaultExportLayers);
  const [paper, setPaper] = useState<'A4' | 'A3'>('A4');
  const [scale, setScale] = useState(50);
  const [elevationGroupIds, setElevationGroupIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ pageCount: number; planPages: number; elevationPages: number; notesPages: number }>();
  const [previewBusy, setPreviewBusy] = useState(false);
  function load() {
    setLoading(true);
    request(base).then(data => setItems(exportListSchema.parse(data)))
      .catch(() => setError('Der Exportverlauf konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [base]);
  const previewKey = useMemo(
    () => JSON.stringify({ paper, scale, elevationGroupIds, layers }),
    [paper, scale, elevationGroupIds, layers],
  );
  useEffect(() => {
    let active = true;
    setPreviewBusy(true);
    request(`${base}/preview`, { paper, scale, elevationGroupIds, layers })
      .then(data => {
        if (!active) return;
        setPreview(exportPreviewResultSchema.parse(data));
      })
      .catch(() => { if (active) setPreview(undefined); })
      .finally(() => { if (active) setPreviewBusy(false); });
    return () => { active = false; };
  }, [base, previewKey]);
  async function freeze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return;
    setGenerating(true); setError('');
    try {
      await request(base, {
        name, paper, scale, elevationGroupIds, layers,
      });
      (event.target as HTMLFormElement).reset();
      setLayers(defaultExportLayers);
      setElevationGroupIds([]);
      load();
    } catch { setError('Der Konstruktionsplan konnte nicht erzeugt werden.'); }
    finally { setGenerating(false); }
  }
  async function retry(id: string) {
    setGenerating(true); setError('');
    try { await request(`${base}/${id}/retry`, {}); load(); }
    catch { setError('Die Fassung konnte nicht erneut erzeugt werden.'); }
    finally { setGenerating(false); }
  }
  async function download(item: ExportRevision) {
    setError('');
    try {
      const response = await fetch(`${base}/${item.id}/file`, { credentials: 'same-origin' });
      if (!response.ok) throw new ApiError(response.status, 'Download fehlgeschlagen.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      const safe = item.name.replace(/[^\wÄÖÜäöüß\-]+/g, '_').slice(0, 40);
      anchor.href = url; anchor.download = `konstruktionsplan-${safe || item.id.slice(0, 8)}.pdf`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Der Konstruktionsplan konnte nicht heruntergeladen werden.'); }
  }
  async function remove(id: string) {
    if (!await askConfirm({
      title: 'Konstruktionsplan löschen?',
      message: 'Diese Konstruktionsplan-Fassung endgültig löschen?',
      confirmLabel: 'Fassung löschen',
      danger: true,
    })) return;
    setGenerating(true); setError('');
    try {
      await request(`${base}/${id}`, undefined, 'DELETE');
      load();
    } catch { setError('Die Fassung konnte nicht gelöscht werden.'); }
    finally { setGenerating(false); }
  }
  const busy = loading || generating;
  return <>
    <section className="export-panel" aria-label="Konstruktionsplan">
      <h3>Konstruktionsplan</h3>
      <p className="muted">Wählen Sie Papier, Maßstab und Ebenen. Die Vorschau zeigt die Blattzahl, bevor eine Fassung erzeugt wird. {ELEVATION_PROJECTION_NOTICE}</p>
      {!readOnly && <form onSubmit={event => void freeze(event)}><fieldset disabled={busy || freezeDisabled}>
        <label htmlFor="export-name">Bezeichnung der Fassung</label>
        <input id="export-name" name="name" required maxLength={120} />
        <label htmlFor="export-paper">Papierformat</label>
        <select id="export-paper" name="paper" value={paper} onChange={event => setPaper(event.target.value as 'A4' | 'A3')}>
          <option value="A4">A4</option>
          <option value="A3">A3</option>
        </select>
        <label htmlFor="export-scale">Maßstab</label>
        <select id="export-scale" name="scale" value={String(scale)} onChange={event => setScale(Number(event.target.value))}>
          <option value="25">1:25</option>
          <option value="50">1:50</option>
          <option value="100">1:100</option>
        </select>
        <LayerToggles idPrefix="export-layer" layers={layers} onChange={setLayers} disabled={busy || freezeDisabled} />
        {groups.length > 0 && <div className="elevation-groups">
          <p>Frontansichten für gewählte Gruppen</p>
          {groups.map((group, index) => {
            const labels = group.members.filter(member => member.kind === 'wall')
              .map(member => walls.find(wall => wall.id === member.id)?.label ?? 'Wand');
            return <label key={group.id} htmlFor={`elevation-group-${group.id}`}>
              <input id={`elevation-group-${group.id}`} type="checkbox" checked={elevationGroupIds.includes(group.id)}
                onChange={event => setElevationGroupIds(current => event.target.checked
                  ? [...current, group.id]
                  : current.filter(id => id !== group.id))} />
              {`Gruppe ${index + 1} · ${labels.join(', ')}`}
            </label>;
          })}
        </div>}
        <p className="export-preview" role="status" data-testid="export-page-preview">
          {previewBusy ? 'Blattzahl wird berechnet …'
            : preview
              ? `${preview.pageCount} Blatt · ${preview.planPages} Grundriss · ${preview.elevationPages} Ansicht · ${preview.notesPages} Hinweise`
              : 'Blattzahl nicht verfügbar'}
        </p>
        {freezeDisabled && <p className="muted">Bitte speichern Sie ausstehende Änderungen, bevor Sie exportieren.</p>}
        <button type="submit">{generating ? 'Erzeugt …' : 'Als Konstruktionsplan exportieren'}</button>
      </fieldset></form>}
      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p role="status">Exportverlauf wird geladen …</p>}
      <ul className="export-list">{items.map(item => <li key={item.id}>
        <strong>{item.name}</strong>
        <span>{germanDate(item.createdAt)} · {item.paper} · 1:{item.scale} · {statusText[item.status]}</span>
        {item.status === 'ready' && <button className="quiet" type="button" onClick={() => void download(item)}>Herunterladen</button>}
        {item.status === 'failed' && !readOnly && <button className="quiet" type="button" onClick={() => void retry(item.id)}>Erneut versuchen</button>}
        {!readOnly && <button className="quiet" type="button" onClick={() => void remove(item.id)}>Löschen</button>}
      </li>)}</ul>
      {!loading && !items.length && <p className="muted">Noch keine exportierten Fassungen.</p>}
    </section>
    <PackageExport workspaceId={workspaceId} productionId={productionId} sceneId={sceneId}
      readOnly={readOnly} freezeDisabled={freezeDisabled} />
  </>;
}
