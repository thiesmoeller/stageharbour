import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assetListSchema, type Asset } from '../../shared/assets.js';
import {
  DOCUMENT_PURPOSES, DOCUMENT_SECTION_LABELS, defaultCamera, documentDraftSchema, documentReadiness,
  layersForPurpose, sectionsForPurpose, viewFrameId, type DocumentDraft, type DocumentPurpose,
  type DocumentSection, type ExportDocumentSpec,
} from '../../shared/exportDocument.js';
import { exportRevisionSchema } from '../../shared/export.js';
import { sceneListSchema, sceneSchema, type Scene } from '../../shared/layout.js';
import type { PaperSize } from '../../shared/tiling.js';
import { ApiError, request } from '../api.js';
import { StageView, type StageCaptureHandle } from './StageView.js';
import { SurfaceRegistryProvider } from './SurfaceRegistryContext.js';

type Scope = 'scene' | 'venue' | 'production';
type Job = {
  id: string; status: string; stage: string; pageCount: number | null; error: string | null;
  manifest: { pageCount?: number; sheets?: { index: number; title: string }[] } | null;
  issuedRevisionId: string | null;
};

function scopeIds(scenes: readonly Scene[], scope: Scope, sceneId: string, venueId: string) {
  if (scope === 'scene') return scenes.filter(scene => scene.id === sceneId).map(scene => scene.id);
  if (scope === 'venue') return scenes.filter(scene => scene.venueId === venueId).map(scene => scene.id);
  return scenes.map(scene => scene.id);
}

function initialSpec(purpose: DocumentPurpose, scenes: string[]): ExportDocumentSpec {
  return {
    schemaVersion: 1,
    purpose,
    sections: sectionsForPurpose(purpose),
    preset: purpose === 'technical' ? 'construction' : 'presentation',
    revisionName: 'Entwurf',
    paper: purpose === 'technical' ? 'A3' : 'A4',
    orientation: 'auto',
    scale: 50,
    layers: layersForPurpose(purpose),
    kind: scenes.length > 1 ? 'package' : 'scene',
    scenes: scenes.map(sceneId => ({ sceneId, elevationGroupIds: [] })),
    planScope: purpose === 'technical' ? 'scenery' : 'venue',
  };
}

export function RecipientDocumentWorkspace({ workspaceId, productionId, seedSceneId, seedVenueId, liveScene, defaultScope = 'scene', freezeDisabled = false, onClose }: {
  workspaceId: string; productionId: string; seedSceneId: string; seedVenueId: string; liveScene?: Scene;
  defaultScope?: Scope; freezeDisabled?: boolean; onClose: () => void;
}) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [scope, setScope] = useState<Scope>(defaultScope);
  const [spec, setSpec] = useState<ExportDocumentSpec>();
  const [viewImages, setViewImages] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'purpose' | 'readiness' | 'contents' | 'preview'>('purpose');
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<Job>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [activeCapture, setActiveCapture] = useState(false);
  const [captureReady, setCaptureReady] = useState(false);
  const capture = useRef<StageCaptureHandle | null>(null);
  const currentScenes = scenes.map(scene => scene.id === liveScene?.id ? liveScene : scene);
  const selectedScenes = currentScenes.filter(scene => spec?.scenes.some(item => item.sceneId === scene.id));
  const captureScene = selectedScenes[0];
  const onCaptureReady = useCallback((handle: StageCaptureHandle | null) => { capture.current = handle; setCaptureReady(!!handle); }, []);

  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const [summaries, loadedAssets] = await Promise.all([
          request(`/api/workspaces/${workspaceId}/scenes`).then(value => sceneListSchema.parse(value)),
          request(`/api/workspaces/${workspaceId}/assets`).then(value => assetListSchema.parse(value)),
        ]);
        const production = summaries.filter(item => item.productionId === productionId);
        const loaded = await Promise.all(production.map(item =>
          request(`/api/workspaces/${workspaceId}/scenes/${item.id}`).then(value => sceneSchema.parse(value))));
        if (stopped) return;
        setScenes(loaded);
        setAssets(loadedAssets);

        try {
          const raw = await request(`/api/workspaces/${workspaceId}/productions/${productionId}/document-draft`);
          const draft = raw ? documentDraftSchema.parse(raw) : null;
          if (stopped || !draft) return;
          const known = new Set(loaded.map(scene => scene.id));
          const restored = {
            ...draft.spec,
            scenes: draft.spec.scenes.filter(scene => known.has(scene.sceneId)),
          };
          const restoredIds = new Set(restored.scenes.map(scene => scene.sceneId));
          const allProduction = loaded.length > 0 && loaded.every(scene => restoredIds.has(scene.id));
          const seedVenueScenes = loaded.filter(scene => scene.venueId === seedVenueId);
          const allVenue = seedVenueScenes.length > 0 && seedVenueScenes.every(scene => restoredIds.has(scene.id))
            && restored.scenes.length === seedVenueScenes.length;
          setScope(allProduction ? 'production' : allVenue ? 'venue' : 'scene');
          setSpec(restored.scenes.length ? restored : undefined);
          setViewImages(draft.viewImages ?? {});
          setStep(restored.scenes.length ? 'readiness' : 'purpose');
        } catch {
          if (!stopped) setError('Gespeicherter Dokumententwurf konnte nicht geladen werden. Sie können trotzdem neu beginnen.');
        }
      } catch {
        if (!stopped) setError('Dokumentdaten konnten nicht geladen werden.');
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    return () => {
      stopped = true;
      setPreviewUrl(current => { if (current) URL.revokeObjectURL(current); return undefined; });
    };
  }, [workspaceId, productionId, seedVenueId]);

  const readiness = useMemo(() => spec ? documentReadiness(spec, selectedScenes) : [], [spec, selectedScenes]);

  function choosePurpose(purpose: DocumentPurpose) {
    const ids = scopeIds(currentScenes, scope, seedSceneId, seedVenueId);
    if (!ids.length) {
      setError('Für diesen Umfang ist kein Bühnenbild verfügbar.');
      return;
    }
    setError('');
    setSpec(initialSpec(purpose, ids));
    setViewImages({});
    setSaved(false);
    setStep('readiness');
  }

  function applyScope(next: Scope) {
    setScope(next);
    const ids = scopeIds(currentScenes, next, seedSceneId, seedVenueId);
    setSpec(current => current ? {
      ...current, kind: ids.length > 1 ? 'package' : 'scene',
      scenes: ids.map(sceneId => ({ sceneId, elevationGroupIds: [] })),
    } : current);
    setSaved(false);
  }

  function toggleSection(section: DocumentSection) {
    setSpec(current => {
      if (!current) return current;
      const sections = current.sections ?? [];
      return { ...current, sections: sections.includes(section) ? sections.filter(item => item !== section) : [...sections, section] };
    });
    setSaved(false);
  }

  async function saveDraft() {
    if (!spec) return;
    setSaving(true); setError('');
    try {
      const draft: DocumentDraft = { spec, viewImages: Object.keys(viewImages).length ? viewImages : undefined };
      await request(`/api/workspaces/${workspaceId}/productions/${productionId}/document-draft`, draft, 'PUT');
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Der Dokumententwurf konnte nicht gespeichert werden.');
    } finally { setSaving(false); }
  }

  async function prepare() {
    if (!spec || freezeDisabled || !spec.scenes.length) return;
    setError(''); setJob(undefined); setStep('preview');
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(undefined); }
    try {
      const body = {
        ...spec,
        introduction: spec.introduction?.trim() || undefined,
        contact: spec.contact?.trim() || undefined,
        viewImages: Object.keys(viewImages).length ? viewImages : undefined,
      };
      let current = await request(`/api/workspaces/${workspaceId}/documents`, body) as Job;
      setJob(current);
      while (current.status === 'queued' || current.status === 'rendering') {
        await new Promise(resolve => window.setTimeout(resolve, 250));
        current = await request(`/api/workspaces/${workspaceId}/documents/${current.id}`) as Job;
        setJob(current);
      }
      if (current.status !== 'ready') throw new Error(current.error || 'Die Vorschau konnte nicht erzeugt werden.');
      const response = await fetch(`/api/workspaces/${workspaceId}/documents/${current.id}/file`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Die Vorschau konnte nicht geladen werden.');
      setPreviewUrl(URL.createObjectURL(await response.blob()));
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : 'Die Vorschau konnte nicht erzeugt werden.');
    }
  }

  async function issue() {
    if (!job || job.status !== 'ready') return;
    try {
      const revision = exportRevisionSchema.parse(await request(`/api/workspaces/${workspaceId}/documents/${job.id}/issue`, {}));
      setJob(current => current ? { ...current, status: 'issued', issuedRevisionId: revision.id } : current);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Das PDF konnte nicht erstellt werden.');
    }
  }

  async function captureView() {
    if (!capture.current || !captureScene || !spec) return;
    try {
      const id = crypto.randomUUID();
      const png = await capture.current.capturePng();
      const camera = defaultCamera({ minX: 0, minY: 0, maxX: captureScene.venue.width, maxY: captureScene.venue.depth }, 'audience', captureScene.venue.audienceViewpoint);
      setSpec(current => current ? { ...current, viewCameras: [...current.viewCameras ?? [], { id, label: 'Publikumssicht', camera }] } : current);
      setViewImages(current => ({ ...current, [viewFrameId(captureScene.id, id)]: png }));
      setActiveCapture(false); setSaved(false);
    } catch { setError('Die Raumsicht konnte nicht aufgenommen werden.'); }
  }

  function returnToPurpose() {
    setStep('purpose');
    setJob(undefined);
    setActiveCapture(false);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(undefined); }
  }

  const pageCount = job?.manifest?.pageCount ?? job?.pageCount ?? 0;
  const title = step === 'purpose' || !spec?.purpose
    ? 'Für wen ist das Dokument?'
    : DOCUMENT_PURPOSES[spec.purpose].label;
  return <section className="recipient-document-workspace" aria-label="Dokument erstellen">
    <header className="section-heading">
      <div>
        <p className="eyebrow">DOKUMENTE</p>
        <h2>{title}</h2>
      </div>
      <div className="form-actions">
        {spec && step !== 'purpose' && <button type="button" onClick={returnToPurpose}>Empfänger ändern</button>}
        <button type="button" className="quiet" onClick={onClose}>Zurück zum Editor</button>
      </div>
    </header>
    {loading && <p role="status">Dokumente werden geladen …</p>}
    {error && <p className="error" role="alert">{error}</p>}

    {step === 'purpose' && !loading && <div className="document-purpose-grid">
      {(Object.entries(DOCUMENT_PURPOSES) as [DocumentPurpose, typeof DOCUMENT_PURPOSES[DocumentPurpose]][]).map(([purpose, option]) =>
        <button key={purpose} type="button" className="document-purpose-card" aria-pressed={spec?.purpose === purpose}
          onClick={() => choosePurpose(purpose)}>
          <strong>{option.label}</strong><span>{option.description}</span>
        </button>)}
    </div>}

    {spec && step !== 'purpose' && <nav className="document-steps" aria-label="Dokumentablauf">
      {(['readiness', 'contents', 'preview'] as const).map((item, index) =>
        <button key={item} type="button" className="quiet" aria-current={step === item ? 'step' : undefined} onClick={() => setStep(item)}>
          {index + 1}. {item === 'readiness' ? 'Prüfen' : item === 'contents' ? 'Inhalt' : 'Vorschau'}
        </button>)}
    </nav>}

    {spec && step === 'readiness' && <div className="document-step-panel">
      <h3>Ist alles bereit?</h3>
      <label>Umfang<select aria-label="Umfang" value={scope} onChange={event => applyScope(event.target.value as Scope)}>
        <option value="scene">Dieses Bühnenbild</option><option value="venue">Diese Spielstätte</option><option value="production">Ganze Produktion</option>
      </select></label>
      {!readiness.length && <p role="status">Die nötigen Grundlagen sind vorhanden.</p>}
      {readiness.map(issue => <div key={issue.code} className="document-readiness-warning">
        <strong>{issue.message}</strong>
        {issue.action === 'cables' && <p>Im Editor „Kabel“ wählen und die Polylinie im Grundriss setzen. Die Vorschau kann auch ohne Kabelwege erstellt werden.</p>}
      </div>)}
      <button type="button" onClick={() => setStep('contents')}>Weiter zum Inhalt</button>
    </div>}

    {spec && step === 'contents' && <div className="document-step-panel">
      <h3>Was soll enthalten sein?</h3>
      <label>Bezeichnung der Fassung<input value={spec.revisionName} maxLength={120} onChange={event => { setSpec({ ...spec, revisionName: event.target.value }); setSaved(false); }} /></label>
      <label>Einleitung<textarea rows={4} maxLength={2000} value={spec.introduction ?? ''} onChange={event => { setSpec({ ...spec, introduction: event.target.value }); setSaved(false); }} /></label>
      <label>Kontakt und Absprachen<textarea rows={2} maxLength={500} value={spec.contact ?? ''} onChange={event => { setSpec({ ...spec, contact: event.target.value }); setSaved(false); }} /></label>
      <fieldset><legend>Seiten und Abschnitte</legend>
        {(Object.entries(DOCUMENT_SECTION_LABELS) as [DocumentSection, string][]).map(([section, label]) =>
          <label key={section}><input type="checkbox" checked={(spec.sections ?? []).includes(section)} onChange={() => toggleSection(section)} />{label}</label>)}
      </fieldset>
      {(spec.sections ?? []).includes('roomViews') && <fieldset><legend>Raumsichten</legend>
        <p>{spec.viewCameras?.length ?? 0} Aufnahme(n) im Dokument.</p>
        <button type="button" className="quiet" onClick={() => setActiveCapture(value => !value)}>{activeCapture ? 'Aufnahme schließen' : 'Raumsicht aufnehmen'}</button>
        {activeCapture && captureScene && <SurfaceRegistryProvider workspaceId={workspaceId} productionId={productionId}>
          <StageView workspaceId={workspaceId} layout={captureScene.layout} venue={captureScene.venue} assets={assets}
            initialView="audience" onCaptureReady={onCaptureReady} />
          <button type="button" disabled={!captureReady} onClick={() => void captureView()}>Publikumssicht übernehmen</button>
        </SurfaceRegistryProvider>}
      </fieldset>}
      <details open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}><summary>Blattdetails</summary>
        <label>Papier<select value={spec.paper} onChange={event => setSpec({ ...spec, paper: event.target.value as PaperSize })}>
          {(['A4', 'A3', 'A2', 'A1'] as const).map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label>Maßstab<select value={String(spec.scale)} onChange={event => setSpec({ ...spec, scale: Number(event.target.value) as 25 | 50 | 100 })}>
          <option value="25">1:25</option><option value="50">1:50</option><option value="100">1:100</option>
        </select></label>
      </details>
      <div className="form-actions">
        <button type="button" className="quiet" disabled={saving} onClick={() => void saveDraft()}>{saving ? 'Speichert …' : saved ? 'Entwurf gespeichert' : 'Entwurf speichern'}</button>
        <button type="button" disabled={!spec.revisionName.trim() || freezeDisabled} onClick={() => void prepare()}>Vorschau erstellen</button>
      </div>
    </div>}

    {spec && step === 'preview' && <div className="document-preview-step">
      <div className="document-preview-summary">
        <h3>Vorschau</h3>
        <p role="status">{job?.status === 'queued' || job?.status === 'rendering' ? 'PDF wird vorbereitet …' : previewUrl ? `${pageCount} Blatt bereit.` : 'Noch keine Vorschau.'}</p>
        <button type="button" className="quiet" onClick={() => setStep('contents')}>Inhalt anpassen</button>
        <button type="button" disabled={!previewUrl} onClick={() => void issue()}>{job?.status === 'issued' ? 'PDF erstellt' : 'PDF erstellen'}</button>
        {previewUrl && <a className="button-link" href={previewUrl} download={`${spec.revisionName.replace(/[^\wÄÖÜäöüß-]+/g, '_')}.pdf`}>PDF herunterladen</a>}
      </div>
      {previewUrl ? <iframe className="document-pdf-preview" src={previewUrl} title="PDF-Vorschau" /> : <div className="document-preview-empty">Die Seiten erscheinen hier nach der Vorbereitung.</div>}
    </div>}
  </section>;
}
