import { useState, type FormEvent } from 'react';
import {
  createSurfaceSchema, surfaceCatalogSchema, surfaceFileResultSchema, surfaceRecordSchema,
  type SurfaceCatalogItem, type SurfaceMapKind,
} from '../../shared/surfaceRegistry.js';
import { ApiError, request, upload } from '../api.js';
import { surfaceTextureUrl, useSurfaceRegistry } from './SurfaceRegistryContext.js';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

function TextureInput({ name, label, required = false }: { name: SurfaceMapKind; label: string; required?: boolean }) {
  return <label>{label}<input name={name} type="file" accept={IMAGE_ACCEPT} required={required} /></label>;
}

export function SurfaceRegistryPanel({ readOnly = false }: { readOnly?: boolean }) {
  const registry = useSurfaceRegistry();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [packing, setPacking] = useState<'orm' | 'separate'>('orm');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalog, setCatalog] = useState<SurfaceCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogScope, setCatalogScope] = useState<'workspace' | 'production'>(
    registry.productionId ? 'production' : 'workspace',
  );
  const [catalogResolution, setCatalogResolution] = useState<'1k' | '2k'>('1k');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true); setError('');
    try {
      const form = new FormData(formElement);
      const maps: Record<string, string> = {};
      const kinds: SurfaceMapKind[] = [
        'baseColor', 'normal', ...(packing === 'orm' ? ['orm'] as const : ['roughness', 'metalness', 'occlusion'] as const),
        'displacement', 'alpha', 'emissive',
      ];
      for (const kind of kinds) {
        const file = form.get(kind);
        if (!(file instanceof File) || !file.size) continue;
        const result = surfaceFileResultSchema.parse(
          await upload(`/api/workspaces/${registry.workspaceId}/surfaces/files`, file),
        );
        maps[kind] = result.fileId;
      }
      const payload = createSurfaceSchema.parse({
        scope: form.get('scope'),
        productionId: form.get('scope') === 'production' ? registry.productionId : undefined,
        name: form.get('name'),
        description: form.get('description'),
        definition: {
          workflow: 'metallic-roughness',
          tileWidthMm: Number(form.get('tileWidthMm')),
          tileHeightMm: Number(form.get('tileHeightMm')),
          maps,
          baseColorFactor: form.get('baseColorFactor'),
          roughnessFactor: Number(form.get('roughnessFactor')),
          metallicFactor: Number(form.get('metallicFactor')),
          normalScale: Number(form.get('normalScale')),
          displacementScaleMm: Number(form.get('displacementScaleMm')),
          normalConvention: 'opengl',
        },
      });
      surfaceRecordSchema.parse(await request(`/api/workspaces/${registry.workspaceId}/surfaces`, payload));
      formElement.reset();
      setCreating(false);
      registry.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Oberfläche konnte nicht angelegt werden. Bitte Dateien und Maße prüfen.');
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    setBusy(true); setError('');
    try {
      await request(`/api/workspaces/${registry.workspaceId}/surfaces/${id}`, undefined, 'DELETE');
      registry.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Oberfläche konnte nicht archiviert werden.');
    } finally {
      setBusy(false);
    }
  }

  async function searchCatalog(event?: FormEvent) {
    event?.preventDefault();
    setCatalogLoading(true); setError('');
    try {
      setCatalog(surfaceCatalogSchema.parse(await request(
        `/api/workspaces/${registry.workspaceId}/surfaces/catalog/poly-haven?q=${encodeURIComponent(catalogQuery)}`,
      )));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Poly Haven konnte nicht durchsucht werden.');
    } finally {
      setCatalogLoading(false);
    }
  }

  async function importCatalogSurface(assetId: string) {
    setBusy(true); setError('');
    try {
      surfaceRecordSchema.parse(await request(
        `/api/workspaces/${registry.workspaceId}/surfaces/import/poly-haven`,
        {
          provider: 'poly-haven',
          assetId,
          resolution: catalogResolution,
          scope: catalogScope,
          productionId: catalogScope === 'production' ? registry.productionId : undefined,
        },
      ));
      await registry.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Das Poly-Haven-Material konnte nicht importiert werden.');
    } finally {
      setBusy(false);
    }
  }

  return <details className="inspector-section" open>
    <summary>Eigene Oberflächen</summary>
    <div className="inspector-section-body surface-registry">
      <p className="muted">glTF&nbsp;2.0 Metallic-Roughness · PNG/JPEG/WebP · Normalmaps im OpenGL-Format (+Y).</p>
      <div className="surface-registry-list">
        {registry.surfaces.filter(surface => !surface.archived).map(surface => <article key={surface.id} className="surface-registry-item">
          <img src={surfaceTextureUrl(registry.workspaceId, surface.definition.maps.baseColor)} alt="" />
          <div><strong>{surface.name}</strong><br />
            <span className="muted">{surface.scope === 'workspace' ? 'Arbeitsbereich' : 'Nur diese Produktion'} · {surface.definition.tileWidthMm} × {surface.definition.tileHeightMm} mm</span>
          </div>
          {!readOnly && <button type="button" className="quiet" disabled={busy}
            onClick={() => void archive(surface.id)}>Archivieren</button>}
        </article>)}
        {!registry.loading && registry.surfaces.every(surface => surface.archived) && <p className="muted">Noch keine eigenen Oberflächen.</p>}
      </div>
      {!readOnly && !creating && <div className="form-actions">
        <button type="button" onClick={() => setCreating(true)}>Oberfläche hochladen</button>
        <button type="button" className="quiet" onClick={() => {
          const open = !catalogOpen;
          setCatalogOpen(open);
          if (open && !catalog.length) void searchCatalog();
        }}>Poly Haven durchsuchen</button>
      </div>}
      {!readOnly && catalogOpen && <section className="surface-catalog">
        <form onSubmit={event => void searchCatalog(event)} className="surface-catalog-search">
          <label>CC0-Material suchen<input value={catalogQuery}
            onChange={event => setCatalogQuery(event.target.value)} placeholder="Holz, Stoff, Beton …" /></label>
          <button type="submit" disabled={catalogLoading}>{catalogLoading ? 'Suche …' : 'Suchen'}</button>
        </form>
        <div className="numeric-fields">
          <label>Auflösung<select value={catalogResolution}
            onChange={event => setCatalogResolution(event.target.value as '1k' | '2k')}>
            <option value="1k">1K (schneller)</option><option value="2k">2K (mehr Details)</option>
          </select></label>
          <label>Gültigkeit<select value={catalogScope}
            onChange={event => setCatalogScope(event.target.value as 'workspace' | 'production')}>
            <option value="workspace">Gesamter Arbeitsbereich</option>
            {registry.productionId && <option value="production">Nur diese Produktion</option>}
          </select></label>
        </div>
        <div className="surface-catalog-grid">
          {catalog.map(item => <article key={item.id} className="surface-catalog-item">
            <img src={item.thumbnailUrl} alt="" loading="lazy" />
            <div><strong>{item.name}</strong><br />
              <span className="muted">{item.tileWidthMm} × {item.tileHeightMm} mm</span></div>
            <button type="button" disabled={busy}
              onClick={() => void importCatalogSurface(item.id)}>Importieren</button>
          </article>)}
        </div>
        {!catalogLoading && !catalog.length && <p className="muted">Keine passenden Materialien gefunden.</p>}
        <p className="muted">CC0-Materialien · <a href="https://polyhaven.com/textures"
          target="_blank" rel="noreferrer">Powered by Poly Haven</a></p>
      </section>}
      {creating && <form onSubmit={event => void submit(event)}><fieldset disabled={busy}>
        <label>Name<input name="name" required maxLength={120} /></label>
        <label>Beschreibung<textarea name="description" maxLength={500} /></label>
        <label>Gültigkeit<select name="scope" defaultValue={registry.productionId ? 'production' : 'workspace'}>
          <option value="workspace">Gesamter Arbeitsbereich (alle Bereiche)</option>
          {registry.productionId && <option value="production">Nur diese Produktion</option>}
        </select></label>
        <div className="numeric-fields">
          <label>Kachelbreite (mm)<input name="tileWidthMm" type="number" min={10} max={100000} defaultValue={1000} required /></label>
          <label>Kachelhöhe (mm)<input name="tileHeightMm" type="number" min={10} max={100000} defaultValue={1000} required /></label>
        </div>
        <TextureInput name="baseColor" label="Base Color / Albedo (sRGB) *" required />
        <TextureInput name="normal" label="Normal (OpenGL +Y, linear)" />
        <label>PBR-Kanäle<select value={packing} onChange={event => setPacking(event.target.value as 'orm' | 'separate')}>
          <option value="orm">Gepackt: ORM (R=AO, G=Roughness, B=Metallic)</option>
          <option value="separate">Einzelne Graustufenbilder</option>
        </select></label>
        {packing === 'orm' ? <TextureInput name="orm" label="ORM (linear)" /> : <>
          <TextureInput name="occlusion" label="Ambient Occlusion (linear)" />
          <TextureInput name="roughness" label="Roughness (linear)" />
          <TextureInput name="metalness" label="Metallic (linear)" />
        </>}
        <TextureInput name="displacement" label="Height / Displacement (linear)" />
        <TextureInput name="alpha" label="Opacity / Alpha (linear)" />
        <TextureInput name="emissive" label="Emissive (sRGB)" />
        <label>Grundfarbe<input name="baseColorFactor" type="color" defaultValue="#ffffff" /></label>
        <div className="numeric-fields">
          <label>Roughness-Faktor<input name="roughnessFactor" type="number" min={0} max={1} step={0.01} defaultValue={1} /></label>
          <label>Metallic-Faktor<input name="metallicFactor" type="number" min={0} max={1} step={0.01} defaultValue={0} /></label>
          <label>Normal-Stärke<input name="normalScale" type="number" min={0} max={4} step={0.05} defaultValue={1} /></label>
          <label>Displacement (mm)<input name="displacementScaleMm" type="number" min={0} max={1000} step={0.1} defaultValue={0} /></label>
        </div>
        <div className="form-actions"><button type="submit">Hochladen und anlegen</button>
          <button type="button" className="quiet" onClick={() => setCreating(false)}>Abbrechen</button></div>
      </fieldset></form>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </details>;
}
