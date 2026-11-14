import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { assetListSchema, assetSchema, type Asset } from '../../shared/assets.js';
import { modelCatalogSchema, type ModelCatalogItem } from '../../shared/polyHaven.js';
import { ApiError, request, upload } from '../api.js';
import { localCapabilities } from '../local/mode.js';
import { useEditingLease } from './useEditingLease.js';

export function useWorkspaceAssets(workspaceId: string) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const reload = useCallback(async () => {
    const list = assetListSchema.parse(await request(`/api/workspaces/${workspaceId}/assets`));
    setAssets(list);
  }, [workspaceId]);
  useEffect(() => { void reload().catch(() => undefined); }, [reload]);
  return { assets, reload };
}

export function RequisitenPanel({ workspaceId, readOnly, assets, onChanged, onPlace }: {
  workspaceId: string;
  readOnly: boolean;
  assets: Asset[];
  onChanged: () => void;
  onPlace: (asset: Asset) => void;
}) {
  const lease = useEditingLease(`/api/workspaces/${workspaceId}/inventory`, !readOnly);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<ModelCatalogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const models = assets.filter(asset => !asset.archived && asset.definition.kind === 'model');

  async function search(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true); setError('');
    try {
      setCatalog(modelCatalogSchema.parse(await request(
        `/api/workspaces/${workspaceId}/assets/catalog/poly-haven?q=${encodeURIComponent(query)}`,
      )));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Poly Haven konnte nicht durchsucht werden.');
    } finally { setBusy(false); }
  }

  async function importModel(id: string) {
    setBusy(true); setError('');
    try {
      if (!await lease.acquire()) return;
      assetSchema.parse(await request(`/api/workspaces/${workspaceId}/assets/import/poly-haven`, { id }));
      await onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Das Modell konnte nicht importiert werden.');
    } finally { setBusy(false); }
  }

  async function uploadGlb(file: File) {
    setBusy(true); setError('');
    try {
      if (!await lease.acquire()) return;
      const glb = file.type === 'model/gltf-binary' ? file : new File([file], file.name, { type: 'model/gltf-binary' });
      const uploaded = await upload(`/api/workspaces/${workspaceId}/assets/files`, glb) as { fileId: string };
      assetSchema.parse(await request(`/api/workspaces/${workspaceId}/assets`, {
        name: file.name.replace(/\.glb$/i, '').slice(0, 120) || 'Requisite',
        definition: { kind: 'model', width: 1000, height: 1000, depth: 1000, source: { kind: 'upload', fileId: uploaded.fileId } },
      }));
      await onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Die GLB-Datei konnte nicht gespeichert werden.');
    } finally { setBusy(false); }
  }

  return <details className="inspector-section" open>
    <summary>Requisiten</summary>
    <div className="inspector-section-body">
      <p className="muted">CC0-Modelle von Poly Haven und eigene GLB-Dateien. Requisiten sind keine Bauteile und werden nicht eingelagert.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!readOnly && localCapabilities.polyHaven && <form onSubmit={event => void search(event)} className="surface-catalog-search">
        <label>Poly Haven suchen<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Stuhl, Tisch, Kiste …" /></label>
        <button type="submit" disabled={busy}>{busy ? 'Suche …' : 'Suchen'}</button>
      </form>}
      {catalog.map(item => <div key={item.id} className="library-row">
        <div><strong>{item.name}</strong><br /><span className="muted">{item.categories.join(', ') || 'Poly Haven · CC0'}</span></div>
        <button type="button" disabled={readOnly || busy} onClick={() => void importModel(item.id)}>Importieren</button>
      </div>)}
      {!readOnly && <label className="library-row">GLB hochladen
        <input type="file" accept=".glb,model/gltf-binary" disabled={busy} onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void uploadGlb(file);
        }} />
      </label>}
      {models.map(asset => <div key={asset.id} className="library-row">
        <div><strong>{asset.name}</strong><br /><span className="muted">{asset.definition.kind === 'model' ? `${asset.definition.width} × ${asset.definition.depth} × ${asset.definition.height} mm` : ''}</span></div>
        <button type="button" disabled={readOnly} onClick={() => onPlace(asset)}>Setzen</button>
      </div>)}
      {!models.length && <p className="muted">Noch keine Requisite im Arbeitsbereich.</p>}
    </div>
  </details>;
}
