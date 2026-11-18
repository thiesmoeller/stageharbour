import { validateGlbBytes } from '../../shared/glbBytes.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Object3D } from 'three';
import { configureStageGltfLoader } from '../stage/decoders.js';
import { loadWorkspaceModel } from '../stage/WorkspaceMesh.js';
import { ModelCalibration, type ModelCalibrationValue } from './ModelCalibration.js';
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

export function RequisitenPanel({ workspaceId, readOnly, assets, onChanged, onPlace, nested = false }: {
  nested?: boolean;
  workspaceId: string;
  readOnly: boolean;
  assets: Asset[];
  onChanged: () => void;
  onPlace: (asset: Asset) => void;
}) {
  const lease = useEditingLease(`/api/workspaces/${workspaceId}/inventory`, !readOnly);
  const [pending, setPending] = useState<{ object: Object3D; file?: File; asset?: Asset }>();
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<ModelCatalogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const models = assets.filter(asset => !asset.archived && asset.definition.kind === 'model');

  async function search(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setStatus('Suche läuft …');
    setBusy(true); setError('');
    try {
      const found = modelCatalogSchema.parse(await request(
        `/api/workspaces/${workspaceId}/assets/catalog/poly-haven?q=${encodeURIComponent(query)}`,
      ));
      setCatalog(found);
      setStatus(found.length ? `${found.length} Modelle gefunden.` : 'Keine passenden Modelle gefunden.');
    } catch (caught) {
      setStatus('');
      setError('Suche fehlgeschlagen. Erneut suchen: ' + (caught instanceof ApiError ? caught.message : 'Poly Haven ist nicht erreichbar.'));
    } finally { setBusy(false); }
  }

  async function importModel(id: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!await lease.acquire()) return;
      assetSchema.parse(await request(`/api/workspaces/${workspaceId}/assets/import/poly-haven`, { id }));
      await onChanged();
      setStatus('Modell im Arbeitsbereich gespeichert.');
      setPending(undefined);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Das Modell konnte nicht importiert werden.');
    } finally { setBusy(false); }
  }

  async function uploadGlb(file: File, dimensions: ModelCalibrationValue) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!await lease.acquire()) return;
      const glb = file.type === 'model/gltf-binary' ? file : new File([file], file.name, { type: 'model/gltf-binary' });
      const uploaded = await upload(`/api/workspaces/${workspaceId}/assets/files`, glb) as { fileId: string };
      assetSchema.parse(await request(`/api/workspaces/${workspaceId}/assets`, {
        name: file.name.replace(/\.glb$/i, '').slice(0, 120) || 'Requisite',
        definition: { kind: 'model', ...dimensions, source: { kind: 'upload', fileId: uploaded.fileId } },
      }));
      await onChanged();
      setStatus('Modell im Arbeitsbereich gespeichert.');
      setPending(undefined);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Die GLB-Datei konnte nicht gespeichert werden.');
    } finally { setBusy(false); }
  }

  async function prepare(input: File | Asset) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (input instanceof File) {
        const loader = new GLTFLoader(); configureStageGltfLoader(loader);
        const bytes = await input.arrayBuffer();
        validateGlbBytes(new Uint8Array(bytes));
        const object = (await loader.parseAsync(bytes, '')).scene;
        setPending({ object, file: input });
      } else if (input.definition.kind === 'model' && input.definition.source.kind === 'upload') {
        setPending({ object: await loadWorkspaceModel(workspaceId, input.definition.source.fileId), asset: input });
      } else onPlace(input);
    } catch { setError('Die GLB-Datei konnte nicht als Vorschau geladen werden.'); }
    finally { setBusy(false); }
  }

  return <details className="inspector-section" open>
    <summary>{nested ? "Mesh einfügen" : "Requisiten"}</summary>
    <div className="inspector-section-body">
      <p className="muted">CC0-Modelle von Poly Haven und eigene GLB-Dateien. Importierte Geometrie bleibt statisch. Gewicht und gekauftes Zubehör werden ausdrücklich am Bauteil erfasst.</p>
      <p role="status">{status}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!readOnly && localCapabilities.polyHaven && <form onSubmit={event => void search(event)} className="surface-catalog-search">
        <label>Poly Haven suchen<input type="search" name="q" value={query} onChange={event => setQuery(event.target.value)} placeholder="Stuhl, Tisch, Kiste …" /></label>
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
          if (file) void prepare(file);
        }} />
      </label>}
      {pending && <ModelCalibration key={pending.file?.name ?? pending.asset?.id} object={pending.object} busy={busy}
        initial={pending.asset?.definition.kind === 'model' ? { ...pending.asset.definition, rotation: pending.asset.definition.rotation ?? [0, 0, 0] } : undefined}
        onCancel={() => setPending(undefined)} onAccept={dimensions => {
          if (pending.file) void uploadGlb(pending.file, dimensions);
          else if (pending.asset?.definition.kind === 'model') {
            onPlace({ ...pending.asset, definition: { ...pending.asset.definition, ...dimensions } }); setPending(undefined);
          }
        }} />}
      {models.map(asset => <div key={asset.id} className="library-row">
        <div><strong>{asset.name}</strong><br /><span className="muted">{asset.definition.kind === 'model' ? `${asset.definition.width} × ${asset.definition.depth} × ${asset.definition.height} mm` : ''}</span></div>
        <button type="button" disabled={readOnly} onClick={() => void prepare(asset)}>{nested ? "In Bauteil einfügen" : "Setzen"}</button>
      </div>)}
      {!models.length && <p className="muted">Noch keine Requisite im Arbeitsbereich.</p>}
    </div>
  </details>;
}
