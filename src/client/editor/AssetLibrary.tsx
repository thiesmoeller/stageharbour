import { lazy, Suspense, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  assetSchema, MAX_MODEL_BYTES, MAX_MODEL_MB, modelAxisSchema, modelDimensionsFromReference,
  type Asset, type AssetDefinition, type ModelAxis,
} from '../../shared/assets.js';
import { newBrace, newWall, type Brace, type Layout, type Wall } from '../../shared/layout.js';
import type { WallElementType } from '../../shared/wall-types.js';
import { request } from '../api.js';
import { measureGlbFile } from './measureGlb.js';
import { useEditingLease } from './useEditingLease.js';
import { InventoryStock } from './InventoryPanel.js';
import { WallTypePanel } from './WallTypePanel.js';

const PascalCatalog = lazy(() => import('./PascalCatalog.js'));
const axisLabels: Record<ModelAxis, string> = { width: 'Breite', height: 'Höhe', depth: 'Tiefe' };
type LibraryTab = 'inventory' | 'panels' | 'wallTypes' | 'import' | 'catalog';

export function AssetLibrary({ workspaceId, assets, layout, readOnly, selected, wallTypes, selectedTypeId, onCreated, onArchive, onPlace,
  onWallTypeSelect, onWallTypeCreate, onWallTypeApply, onWallTypePlace, onWallTypeRemove, onPendingChange, onPanels }: {
  workspaceId: string; assets: Asset[]; layout: Layout; readOnly: boolean; selected?: Wall | Brace;
  wallTypes: WallElementType[]; selectedTypeId?: string;
  onCreated: (asset: Asset) => void; onArchive: (id: string) => void; onPlace: (asset: Asset) => void;
  onWallTypeSelect: (id?: string) => void;
  onWallTypeCreate: (type: WallElementType) => void;
  onWallTypeApply: (type: WallElementType) => void;
  onWallTypePlace: (type: WallElementType) => void;
  onWallTypeRemove: (id: string) => void;
  onPendingChange?: (pending: boolean) => void;
  onPanels: (panels: import('../../shared/inventory.js').InventoryPanel[]) => void;
}) {
  const [tab, setTab] = useState<LibraryTab>('inventory');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bounds, setBounds] = useState<{ x: number; y: number; z: number } | null>(null);
  const [axis, setAxis] = useState<ModelAxis>('height');
  const [lengthMm, setLengthMm] = useState('1000');
  const [measuring, setMeasuring] = useState(false);
  const base = `/api/workspaces/${workspaceId}/assets`;
  const lease = useEditingLease(`/api/workspaces/${workspaceId}/inventory`, !readOnly);
  async function requireLease() {
    if (!await lease.acquire()) throw new Error('Der Plattenbestand wird bereits bearbeitet oder ist nicht erreichbar. Bitte erneut versuchen.');
  }
  const reference = Number(lengthMm);
  const dimensions = bounds && Number.isFinite(reference) && reference >= 1
    ? modelDimensionsFromReference(bounds, axis, reference) : null;
  async function create(name: string, definition: AssetDefinition) {
    await requireLease();
    const asset = assetSchema.parse(await request(base, { name, definition }));
    onCreated(asset);
    return asset;
  }
  async function template(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const kind = data.get('kind');
    const item = kind === 'selection' && selected ? selected : kind === 'brace' ? newBrace(crypto.randomUUID(), 0, 0) : newWall(crypto.randomUUID(), 0, 0);
    const { id: _id, label: _label, x: _x, y: _y, rotation: _rotation, ...rest } = item;
    setBusy(true); setError('');
    try {
      await create(String(data.get('name')), 'thickness' in rest ? { kind: 'wall', template: rest } : { kind: 'brace', template: rest });
    } catch { setError('Die Objektvorlage konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }
  async function onFileChange(file: File | undefined) {
    setBounds(null); setError('');
    if (!file) return;
    setMeasuring(true);
    try {
      if (file.size > MAX_MODEL_BYTES) throw new Error(`Die Datei darf höchstens ${MAX_MODEL_MB} MB groß sein.`);
      setBounds(await measureGlbFile(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Die GLB-Datei konnte nicht gelesen werden.');
    } finally { setMeasuring(false); }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget), file = data.get('file');
    if (!(file instanceof File) || !dimensions) return;
    setBusy(true); setError('');
    try {
      if (file.size > MAX_MODEL_BYTES) throw new Error(`Die Datei darf höchstens ${MAX_MODEL_MB} MB groß sein.`);
      await requireLease();
      const response = await fetch(`${base}/files`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'model/gltf-binary' }, body: file });
      if (!response.ok) {
        const payload = await response.json().catch(() => undefined) as { message?: unknown } | undefined;
        throw new Error(typeof payload?.message === 'string' && payload.message.trim()
          ? payload.message
          : 'Upload fehlgeschlagen. Verwenden Sie eine GLB-Datei mit eingebetteten Texturen und Geometrie.');
      }
      const { fileId } = z.object({ fileId: z.uuid() }).parse(await response.json());
      await create(String(data.get('name')), { kind: 'model', ...dimensions, source: { kind: 'upload', fileId } });
      setTab('inventory'); setBounds(null); setLengthMm('1000'); setAxis('height');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Import fehlgeschlagen.'); }
    finally { setBusy(false); }
  }
  return <section className="asset-library" aria-label="Objektbibliothek">
    <div className="section-heading"><h3>Objektbibliothek</h3><span>Gemeinsam in der Theatergruppe</span></div>
    <div className="asset-tabs">
      {([['inventory', 'Objektvorlagen'], ['panels', 'Plattenbestand'], ['wallTypes', 'Wandtypen'], ['import', 'GLB importieren'], ['catalog', 'Pascal-Katalog']] as const)
        .map(([id, title]) => <button key={id} type="button" className="quiet" aria-pressed={tab === id} onClick={() => { setTab(id); setError(''); }}>{title}</button>)}
    </div>
    {tab === 'inventory' && <>
      <label htmlFor="asset-search">Objektvorlagen durchsuchen</label><input id="asset-search" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="asset-grid">{assets.filter(asset => !asset.archived && asset.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(asset => <article className="asset-card" key={asset.id}>
        <strong>{asset.name}</strong><span>{asset.definition.kind === 'wall' ? 'Wandelement' : asset.definition.kind === 'brace' ? 'Gewichtete Stütze' : '3D-Modell'}</span>
        <button type="button" disabled={readOnly || busy} onClick={() => onPlace(asset)}>Platzieren</button>
        {!readOnly && <button className="quiet" type="button" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try { await requireLease(); await request(`${base}/${asset.id}`, undefined, 'DELETE'); onArchive(asset.id); }
          catch { setError('Das Objekt konnte nicht archiviert werden.'); }
          finally { setBusy(false); }
        }}>Archivieren</button>}
      </article>)}</div>
      {!assets.some(asset => !asset.archived) && <p className="muted">Speichern Sie Wände und Stützen als wiederverwendbare Vorlagen oder importieren Sie Modelle.</p>}
      {!readOnly && <form onSubmit={event => void template(event)}><fieldset disabled={busy}>
        <label htmlFor="template-name">Name der Objektvorlage</label><input id="template-name" name="name" required maxLength={120} />
        <label htmlFor="template-kind">Vorlage aus</label><select id="template-kind" name="kind">
          {selected && <option value="selection">Ausgewähltes Objekt ({selected.label})</option>}
          <option value="wall">Standardwand · 1200 × 2400 × 28 mm</option><option value="brace">Beispielstütze · Maße vor Einsatz prüfen</option>
        </select><button type="submit">Objektvorlage speichern</button>
      </fieldset></form>}
      <p className="muted">Vorlagen erzeugen unabhängige Exemplare. Archivieren entfernt nur die Vorlage aus der Auswahl; bestehende Szenen behalten ihre Objekte.</p>
    </>}
    {tab === 'panels' && <InventoryStock workspaceId={workspaceId} layout={layout} readOnly={readOnly} onPanels={onPanels} />}
    {tab === 'wallTypes' && <WallTypePanel types={wallTypes} selectedId={selectedTypeId} readOnly={readOnly}
      onSelect={onWallTypeSelect} onCreate={onWallTypeCreate} onApply={onWallTypeApply} onPlace={onWallTypePlace} onRemove={onWallTypeRemove}
      onPendingChange={onPendingChange} />}
    {tab === 'import' && <form onSubmit={event => void upload(event)}><fieldset disabled={busy || readOnly || measuring}>
      <p>GLB mit eingebetteten Texturen, bis {MAX_MODEL_MB} MB. Das Modell wird für alle Mitglieder gespeichert.</p>
      <label htmlFor="model-name">Modellname</label><input id="model-name" name="name" maxLength={120} required />
      <label htmlFor="model-file">GLB-Datei</label>
      <input id="model-file" name="file" type="file" accept=".glb,model/gltf-binary" required
        onChange={event => void onFileChange(event.currentTarget.files?.[0])} />
      {measuring && <p role="status">Modellmaße werden gelesen …</p>}
      {bounds && <p className="muted">Dateimaße (Modell-Einheiten): {bounds.x.toFixed(3)} × {bounds.y.toFixed(3)} × {bounds.z.toFixed(3)} m. Ein bekanntes Außenmaß setzt die übrigen proportional — ohne Verzerrung.</p>}
      <label htmlFor="model-axis">Bekanntes Außenmaß</label>
      <select id="model-axis" value={axis} onChange={event => setAxis(modelAxisSchema.parse(event.target.value))} disabled={!bounds}>
        {modelAxisSchema.options.map(key => <option key={key} value={key}>{axisLabels[key]}</option>)}
      </select>
      <label htmlFor="model-length">{axisLabels[axis]} (mm)</label>
      <input id="model-length" type="number" min="1" max="100000" step="any" value={lengthMm}
        onChange={event => setLengthMm(event.target.value)} required disabled={!bounds} />
      {dimensions && <p className="muted">Ergebnis: {Math.round(dimensions.width)} × {Math.round(dimensions.height)} × {Math.round(dimensions.depth)} mm (Breite × Höhe × Tiefe).</p>}
      <button type="submit" disabled={!dimensions}>Modell in Objektvorlagen importieren</button>
    </fieldset></form>}
    {tab === 'catalog' && <Suspense fallback={<p role="status">Katalog wird geladen …</p>}><PascalCatalog disabled={readOnly || busy} onAdd={async (name, definition) => {
      setBusy(true); setError('');
      try { await create(name, definition); setTab('inventory'); }
      catch { setError('Das Katalogmodell konnte nicht übernommen werden.'); }
      finally { setBusy(false); }
    }} /></Suspense>}
    {busy && <p role="status">Bibliothek wird gespeichert …</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {lease.message && <p role="status">{lease.message}</p>}
  </section>;
}
