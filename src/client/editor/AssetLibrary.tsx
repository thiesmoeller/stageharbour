import { lazy, Suspense, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { assetSchema, type Asset, type AssetDefinition } from '../../shared/assets.js';
import { newBrace, newWall, type Brace, type Wall } from '../../shared/layout.js';
import { request } from '../api.js';

const PascalCatalog = lazy(() => import('./PascalCatalog.js'));
export function AssetLibrary({ workspaceId, assets, readOnly, selected, onCreated, onArchive, onPlace }: {
  workspaceId: string; assets: Asset[]; readOnly: boolean; selected?: Wall | Brace;
  onCreated: (asset: Asset) => void; onArchive: (id: string) => void; onPlace: (asset: Asset) => void;
}) {
  const [tab, setTab] = useState<'inventory' | 'import' | 'catalog'>('inventory');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `/api/workspaces/${workspaceId}/assets`;
  async function create(name: string, definition: AssetDefinition) {
    const asset = assetSchema.parse(await request(base, { name, definition }));
    onCreated(asset);
    return asset;
  }
  async function template(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const kind = data.get('kind');
    const item = kind === 'selection' && selected ? selected : kind === 'brace' ? newBrace(crypto.randomUUID(), 0, 0) : newWall(crypto.randomUUID(), 0, 0);
    const { id: _id, label: _label, x: _x, y: _y, rotation: _rotation, ...dimensions } = item;
    setBusy(true); setError('');
    try {
      await create(String(data.get('name')), 'thickness' in dimensions ? { kind: 'wall', template: dimensions } : { kind: 'brace', template: dimensions });
    } catch { setError('Die Inventarvorlage konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget), file = data.get('file');
    if (!(file instanceof File)) return;
    setBusy(true); setError('');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Die Datei darf höchstens 20 MB groß sein.');
      const response = await fetch(`${base}/files`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'model/gltf-binary' }, body: file });
      if (!response.ok) throw new Error('Upload fehlgeschlagen. Verwenden Sie eine GLB-Datei mit eingebetteten Texturen und Geometrie.');
      const { fileId } = z.object({ fileId: z.uuid() }).parse(await response.json());
      await create(String(data.get('name')), { kind: 'model', width: Number(data.get('width')), height: Number(data.get('height')), depth: Number(data.get('depth')), source: { kind: 'upload', fileId } });
      setTab('inventory');
    } catch (error) { setError(error instanceof Error ? error.message : 'Import fehlgeschlagen.'); }
    finally { setBusy(false); }
  }
  return <section className="asset-library" aria-label="Objektbibliothek">
    <div className="section-heading"><h3>Objektbibliothek</h3><span>Gemeinsam in der Theatergruppe</span></div>
    <div className="asset-tabs">
      {([['inventory', 'Inventar'], ['import', 'GLB importieren'], ['catalog', 'Pascal-Katalog']] as const).map(([id, title]) => <button key={id} type="button" className="quiet" aria-pressed={tab === id} onClick={() => { setTab(id); setError(''); }}>{title}</button>)}
    </div>
    {tab === 'inventory' && <>
      <label htmlFor="asset-search">Inventar durchsuchen</label><input id="asset-search" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="asset-grid">{assets.filter(asset => !asset.archived && asset.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(asset => <article className="asset-card" key={asset.id}>
        <strong>{asset.name}</strong><span>{asset.definition.kind === 'wall' ? 'Wandelement' : asset.definition.kind === 'brace' ? 'Gewichtete Stütze' : '3D-Modell'}</span>
        <button type="button" disabled={readOnly || busy} onClick={() => onPlace(asset)}>Platzieren</button>
        {!readOnly && <button className="quiet" type="button" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try { await request(`${base}/${asset.id}`, undefined, 'DELETE'); onArchive(asset.id); }
          catch { setError('Das Objekt konnte nicht archiviert werden.'); }
          finally { setBusy(false); }
        }}>Archivieren</button>}
      </article>)}</div>
      {!assets.some(asset => !asset.archived) && <p className="muted">Speichern Sie Wände und Stützen als wiederverwendbare Vorlagen oder importieren Sie Modelle.</p>}
      {!readOnly && <form onSubmit={event => void template(event)}><fieldset disabled={busy}>
        <label htmlFor="template-name">Name der Inventarvorlage</label><input id="template-name" name="name" required maxLength={120} />
        <label htmlFor="template-kind">Vorlage aus</label><select id="template-kind" name="kind">
          {selected && <option value="selection">Ausgewähltes Objekt ({selected.label})</option>}
          <option value="wall">Standardwand · 1200 × 2400 × 28 mm</option><option value="brace">Beispielstütze · Maße vor Einsatz prüfen</option>
        </select><button type="submit">Inventarvorlage speichern</button>
      </fieldset></form>}
      <p className="muted">Vorlagen erzeugen unabhängige Exemplare. Archivieren entfernt nur die Vorlage aus der Auswahl; bestehende Szenen behalten ihre Objekte.</p>
    </>}
    {tab === 'import' && <form onSubmit={event => void upload(event)}><fieldset disabled={busy || readOnly}>
      <p>GLB mit eingebetteten Texturen, bis 20 MB. Das Modell wird für alle Mitglieder gespeichert.</p>
      <label htmlFor="model-name">Modellname</label><input id="model-name" name="name" maxLength={120} required />
      <label htmlFor="model-file">GLB-Datei</label><input id="model-file" name="file" type="file" accept=".glb,model/gltf-binary" required />
      <p className="muted">Geben Sie die tatsächlichen Außenmaße ein. Die Vorschau wird darauf skaliert und auf den Boden gestellt.</p>
      <div className="numeric-fields">{[['width', 'Modellbreite (mm)'], ['height', 'Modellhöhe (mm)'], ['depth', 'Modelltiefe (mm)']].map(([key, label]) => <label key={key}>{label}<input name={key} type="number" min="1" max="100000" step="any" defaultValue="1000" required /></label>)}</div>
      <button type="submit">Modell ins Inventar importieren</button>
    </fieldset></form>}
    {tab === 'catalog' && <Suspense fallback={<p role="status">Katalog wird geladen …</p>}><PascalCatalog disabled={readOnly || busy} onAdd={async (name, definition) => {
      setBusy(true); setError('');
      try { await create(name, definition); setTab('inventory'); }
      catch { setError('Das Katalogmodell konnte nicht übernommen werden.'); }
      finally { setBusy(false); }
    }} /></Suspense>}
    {busy && <p role="status">Bibliothek wird gespeichert …</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
