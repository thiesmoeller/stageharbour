import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { assetListSchema, type Asset } from '../../shared/assets.js';
import {
  DOCUMENT_PURPOSES, DOCUMENT_SECTION_LABELS, automaticSheetFamily, bodyRect, documentDraftSchema, documentReadiness,
  type DocumentDraft, type DocumentFrame, type DocumentPage, type DocumentPurpose,
  type DocumentSection, type ExportDocumentSpec, type FrameKind,
} from '../../shared/exportDocument.js';
import {
  FRAME_LABELS, PAGE_LAYOUTS, arrangedPages, constrainFrame, duplicateStudioPage, editableDrawingPage,
  newStudioFrame, newStudioPage, studioLayout, studioSpec, type PageLayoutId,
} from '../../shared/documentStudio.js';
import { EXPORT_LAYER_OPTIONS, resolveExportLayers } from '../../shared/exportLayers.js';
import { sceneListSchema, sceneSchema, type Scene } from '../../shared/layout.js';
import { inventorySchema, type Inventory } from '../../shared/inventory.js';
import type { PaperSize } from '../../shared/tiling.js';
import { request } from '../api.js';
import { askConfirm } from '../ConfirmDialog.js';
import { DocumentSheet, DocumentSheetArtwork } from './DocumentSheet.js';
import { useDocumentDraft } from './useDocumentDraft.js';
import { useDocumentProof } from './useDocumentProof.js';
import { useModalFocus } from './useModalFocus.js';
import { editingText } from './interactionKeys.js';
import { StageView, type StageCaptureHandle } from './StageView.js';
import { EditorDockContext } from './EditorDock.js';
import { SurfaceRegistryProvider } from './SurfaceRegistryContext.js';
import { ToolIcon } from './ToolIcon.js';
import './document-studio.css';

type Scope = 'scene' | 'venue' | 'production';
type Props = {
  workspaceId: string; productionId: string; seedSceneId: string; seedVenueId: string; liveScene?: Scene;
  defaultScope?: Scope; freezeDisabled?: boolean; onClose: () => void;
};
type Loaded = { scenes: Scene[]; assets: Asset[]; draft: DocumentDraft; inventory: Inventory };

function scopeIds(scenes: readonly Scene[], scope: Scope, sceneId: string, venueId: string) {
  return scenes.filter(scene => scope === 'production' || (scope === 'venue' ? scene.venueId === venueId : scene.id === sceneId)).map(scene => scene.id);
}

/** Loading is separate so a restored document starts with its own clean undo/save history. */
export function RecipientDocumentWorkspace(props: Props) {
  const [loaded, setLoaded] = useState<Loaded>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const { workspaceId, productionId, seedSceneId, seedVenueId, defaultScope = 'scene' } = props;
  useEffect(() => {
    let stopped = false;
    setError('');
    void (async () => {
      try {
        const [summaries, assets, rawDraft, inventory] = await Promise.all([
          request(`/api/workspaces/${workspaceId}/scenes`).then(value => sceneListSchema.parse(value)),
          request(`/api/workspaces/${workspaceId}/assets`).then(value => assetListSchema.parse(value)),
          request(`/api/workspaces/${workspaceId}/productions/${productionId}/document-draft`),
          request(`/api/workspaces/${workspaceId}/inventory`).then(value => inventorySchema.parse(value)),
        ]);
        const scenes = await Promise.all(summaries.filter(scene => scene.productionId === productionId).map(scene =>
          request(`/api/workspaces/${workspaceId}/scenes/${scene.id}`).then(value => sceneSchema.parse(value))));
        const stored = rawDraft ? documentDraftSchema.parse(rawDraft) : null;
        const knownIds = new Set(scenes.map(scene => scene.id));
        const restored = stored ? { ...stored, spec: { ...stored.spec, scenes: stored.spec.scenes.filter(scene => knownIds.has(scene.sceneId)) } } : null;
        const draft = restored?.spec.scenes.length ? restored : {
          spec: { ...studioSpec('technical', scopeIds(scenes, defaultScope, seedSceneId, seedVenueId)), ...(defaultScope !== 'scene' ? { kind: 'package' as const } : {}) },
        };
        if (!draft.spec.scenes.length) throw new Error('Für dieses Dokument ist kein Bühnenbild verfügbar.');
        if (!stopped) setLoaded({ scenes, assets, draft, inventory });
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : 'Dokumentdaten konnten nicht geladen werden.');
      }
    })();
    return () => { stopped = true; };
  }, [workspaceId, productionId, seedSceneId, seedVenueId, defaultScope, attempt]);
  if (!loaded) return <section className="recipient-document-workspace document-studio studio-loading" aria-label="Dokument erstellen">
    <button type="button" className="quiet" onClick={props.onClose}>Zurück zum Editor</button>
    <div><ToolIcon name="library" /><h2>Dokumentstudio</h2>{error
      ? <><p role="alert">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Erneut versuchen</button></>
      : <p role="status">Bühnenbilder und Dokument werden geladen …</p>}</div>
  </section>;
  return <DocumentStudio {...props} loaded={loaded} />;
}

function DocumentStudio({ loaded, workspaceId, productionId, seedSceneId, seedVenueId, liveScene, freezeDisabled = false, onClose }: Props & { loaded: Loaded }) {
  const draft = useDocumentDraft(loaded.draft);
  const value = draft.value;
  const spec = value.spec;
  const images = value.viewImages ?? {};
  const scenes = useMemo(() => loaded.scenes.map(scene => scene.id === liveScene?.id ? liveScene : scene), [loaded.scenes, liveScene]);
  const selectedScenes = scenes.filter(scene => spec.scenes.some(entry => entry.sceneId === scene.id));
  const [issuedAt] = useState(() => new Date());
  const [activePage, setActivePage] = useState(0);
  const [selectedFrameId, setSelectedFrameId] = useState<string>();
  const [cancelGesture, setCancelGesture] = useState(0);
  const [rail, setRail] = useState<'pages' | 'contents' | 'layouts'>('pages');
  const [inspector, setInspector] = useState<'document' | 'selection'>('document');
  const [mode, setMode] = useState<'edit' | 'proof'>('edit');
  const [mobilePane, setMobilePane] = useState<'pages' | 'sheet' | 'settings'>('sheet');
  const [zoom, setZoom] = useState(1);
  const canvas = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [showNotices, setShowNotices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const failedSave = useRef('');
  const savingRef = useRef(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureReady, setCaptureReady] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const capture = useRef<StageCaptureHandle | null>(null);
  const [fontReady, setFontReady] = useState(false);
  const preview = useDocumentProof(workspaceId);
  const json = JSON.stringify(value);
  const gestureActive = draft.isActive();
  const valid = documentDraftSchema.safeParse(value).success;
  const proofKey = JSON.stringify({ draft: value, sources: selectedScenes.map(scene => ({ id: scene.id, revision: scene.revision, venue: scene.venue, layout: scene.layout })) });
  const proofCurrent = preview.proof?.key === proofKey;
  const studioRoot = useModalFocus<HTMLElement>(true, () => {
    if (captureOpen) { if (!capturing) setCaptureOpen(false); }
    else if (draft.isActive()) { draft.finish(true); setCancelGesture(value => value + 1); }
    else if (selectedFrameId) setSelectedFrameId(undefined);
    else void close();
  });

  useEffect(() => { let stopped = false; void document.fonts.load('12px StudioSource').then(() => { if (!stopped) setFontReady(true); }); return () => { stopped = true; }; }, []);
  const measure = useMemo(() => {
    if (!fontReady) return undefined;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return undefined;
    return (text: string, size: number, bold?: boolean) => {
      context.font = `${bold ? 700 : 400} ${size * 96 / 72}px StudioSource`;
      return context.measureText(text).width * 25.4 / 96;
    };
  }, [fontReady]);
  const layoutResult = useMemo(() => {
    try { return { layout: studioLayout({ ...spec, revisionName: spec.revisionName.trim() || 'Entwurf' }, scenes, issuedAt, measure, loaded.inventory), error: '' }; }
    catch (caught) { return { layout: undefined, error: caught instanceof Error ? caught.message : 'Das Layout konnte nicht erstellt werden.' }; }
  }, [spec, scenes, issuedAt, measure, loaded.inventory]);
  const layout = layoutResult.layout;
  const pages = useMemo(() => spec.customPages?.length ? spec.customPages : layout ? arrangedPages(layout) : [], [spec.customPages, layout]);
  const pageIndex = Math.min(activePage, Math.max(0, pages.length - 1));
  const page = pages[pageIndex];
  const sheet = page?.automaticKey ? layout?.sheets.find(item => item.sourceKey === page.automaticKey)
    : spec.customPages?.length ? layout?.sheets.find(item => item.pageId === page?.id) : layout?.sheets[pageIndex];
  const selectedFrame = page?.frames.find(frame => frame.id === selectedFrameId);
  const proofPage = preview.proof?.job.manifest?.sheets?.find(sheet => page?.automaticKey ? sheet.sourceKey === page.automaticKey : sheet.pageId === page?.id)?.index ?? pageIndex + 1;
  const fitWidth = sheet ? Math.max(160, Math.min(canvasSize.width - 70, (canvasSize.height - 90) * sheet.widthMm / sheet.heightMm)) : 500;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setCanvasSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode, mobilePane]);
  const missingElevations = selectedScenes.every(scene => !(scene.layout.groups?.length)) && pages.some(page => page.frames.some(frame => frame.kind === 'elevation'));
  const missingViews = layout?.sheets.flatMap(sheet => sheet.frames).filter(frame => frame.kind === 'view3d' && frame.paint.some(item => item.op === 'image' && !images[item.frameId])).length ?? 0;
  const readiness = documentReadiness(spec, selectedScenes);
  const notices = [...readiness.map(issue => issue.message), ...new Set(layout?.diagnostics ?? []), ...(missingElevations ? ['Wandansichten benötigen eine Wandgruppe. Gruppiere die gewünschten Wände im Bühnenbild.'] : []), ...(missingViews ? [`Für ${missingViews} Raumsicht(en) fehlt noch eine Aufnahme. Wähle die Ansicht auf dem Blatt und übernimm ein Kamerabild.`] : []), ...(freezeDisabled ? ['Das Bühnenbild wird noch gespeichert. Der PDF-Export wartet auf den gespeicherten Stand.'] : [])];

  function commitSpec(next: ExportDocumentSpec) { draft.commit({ ...value, spec: next }); }
  function patchSpec(patch: Partial<ExportDocumentSpec>) { commitSpec({ ...spec, ...patch }); }
  function updatePages(next: DocumentPage[]) { patchSpec({ customPages: next }); }
  function updatePage(next: DocumentPage) { updatePages(pages.map((item, index) => index === pageIndex ? next : item)); }
  function patchFrame(patch: Partial<DocumentFrame>) {
    if (!page || !selectedFrame) return;
    const nextImages = { ...images };
    const sourceChanged = patch.source?.sceneId && patch.source.sceneId !== selectedFrame.source.sceneId;
    if (sourceChanged && selectedFrame.kind === 'view3d') delete nextImages[selectedFrame.id];
    const nextPage = { ...page, frames: page.frames.map(frame => frame.id === selectedFrame.id
      ? constrainFrame({ ...frame, ...patch, ...(sourceChanged && frame.kind === 'view3d' ? { camera: undefined } : {}) }, page) : frame) };
    draft.commit({ ...value, spec: { ...spec, customPages: pages.map((item, index) => index === pageIndex ? nextPage : item) }, viewImages: nextImages });
  }
  function selectPage(index: number) { setActivePage(index); setSelectedFrameId(undefined); setInspector('selection'); setMobilePane('sheet'); }

  async function saveDraft() {
    if (!valid || savingRef.current || draft.isActive()) return false;
    const submitted = value;
    savingRef.current = true; setSaving(true); setSaveError('');
    try {
      await request(`/api/workspaces/${workspaceId}/productions/${productionId}/document-draft`, submitted, 'PUT');
      draft.markSaved(submitted); failedSave.current = ''; return true;
    } catch (caught) {
      failedSave.current = JSON.stringify(submitted);
      setSaveError(caught instanceof Error ? caught.message : 'Der Entwurf konnte nicht gespeichert werden.'); return false;
    } finally { savingRef.current = false; setSaving(false); }
  }
  useEffect(() => {
    if (!draft.dirty || !valid || saving || gestureActive || failedSave.current === json) return;
    const timer = window.setTimeout(() => { void saveDraft(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [json, draft.dirty, valid, saving, gestureActive]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (draft.dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [draft.dirty]);

  async function close() {
    while (savingRef.current) await new Promise(resolve => window.setTimeout(resolve, 80));
    if (draft.dirty && !await saveDraft()) {
      if (!await askConfirm({ title: 'Ungespeicherten Entwurf schließen?', message: 'Der Dokumententwurf konnte noch nicht gespeichert werden. Beim Schließen gehen die letzten Änderungen verloren.', confirmLabel: 'Trotzdem schließen' })) return;
    }
    onClose();
  }
  async function resetAutomatic(patch: Partial<ExportDocumentSpec>) {
    if (spec.customPages?.length && !await askConfirm({ title: 'Seiten neu aufbauen?', message: 'Die Seiten werden mit diesen Einstellungen neu zusammengestellt. Individuelle Seiten und Platzierungen werden ersetzt. Rückgängig ist danach möglich.', confirmLabel: 'Seiten neu aufbauen' })) return;
    patchSpec({ ...patch, customPages: undefined }); setActivePage(0); setSelectedFrameId(undefined);
  }
  async function choosePurpose(purpose: DocumentPurpose) {
    const defaults = studioSpec(purpose, spec.scenes.map(item => item.sceneId), spec.revisionName);
    await resetAutomatic({ ...defaults, kind: spec.kind, introduction: spec.introduction, contact: spec.contact, viewCameras: spec.viewCameras });
  }
  function addPage(layoutId: PageLayoutId = 'plan') {
    if (pages.length >= 80) return;
    const next = newStudioPage(spec, selectedScenes[0]?.id ?? seedSceneId, layoutId);
    updatePages([...pages, next]); setActivePage(pages.length); setSelectedFrameId(undefined); setRail('pages'); setInspector('selection'); setMobilePane('sheet');
  }
  function duplicatePage() {
    if (!page || pages.length >= 80) return;
    const copy = duplicateStudioPage(page);
    const copiedImages = { ...images };
    page.frames.forEach((frame, index) => { if (images[frame.id]) copiedImages[copy.frames[index]!.id] = images[frame.id]!; });
    const next = [...pages]; next.splice(pageIndex + 1, 0, copy);
    draft.commit({ ...value, spec: { ...spec, customPages: next }, viewImages: copiedImages }); selectPage(pageIndex + 1);
  }
  function movePage(direction: number) {
    const target = pageIndex + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages]; [next[pageIndex], next[target]] = [next[target]!, next[pageIndex]!]; updatePages(next); selectPage(target);
  }
  async function removePage() {
    if (!page || pages.length <= 1) return;
    const family = sheet && page.automaticKey ? automaticSheetFamily(sheet) : undefined;
    const related = family ? pages.filter(item => item.automaticKey && layout?.sheets.some(s => s.sourceKey === item.automaticKey && automaticSheetFamily(s) === family)) : [];
    const continuationKeys = new Set(related.map(item => item.automaticKey));
    const removing = continuationKeys.size > 1 ? related : [page];
    if (removing.length >= pages.length) return;
    if (removing.length > 1 && !await askConfirm({ title: 'Abschnitt mit Folgeblättern entfernen?', message: `${removing.length} zusammengehörige Blätter werden entfernt. So bleibt kein unvollständiger Plan oder Listenausschnitt zurück.`, confirmLabel: 'Abschnitt entfernen' })) return;
    updatePages(pages.filter(item => !removing.includes(item))); selectPage(Math.max(0, pageIndex - 1));
  }
  function editDrawing() {
    if (!page || !sheet) return;
    const next = editableDrawingPage(page, sheet, spec);
    const nextImages = { ...images };
    sheet.frames.forEach((frame, index) => { if (images[frame.id] && next.frames[index]) nextImages[next.frames[index]!.id] = images[frame.id]!; });
    draft.commit({ ...value, spec: { ...spec, customPages: pages.map((item, index) => index === pageIndex ? next : item) }, viewImages: nextImages });
    setSelectedFrameId(next.frames[0]?.id); setInspector('selection'); setMobilePane('settings');
  }
  function addFrame(kind: FrameKind) {
    if (!page) return;
    if (page.automaticKey) {
      const next = newStudioPage(spec, selectedScenes[0]?.id ?? seedSceneId);
      next.name = FRAME_LABELS[kind];
      next.frames = [newStudioFrame(kind, bodyRect(next.paper, next.orientation), selectedScenes[0]?.id ?? seedSceneId, spec.scale)];
      updatePages([...pages, next]); setActivePage(pages.length); setSelectedFrameId(next.frames[0]?.id);
    } else {
      if (page.frames.length >= 40) return;
      const body = bodyRect(page.paper, page.orientation);
      const frame = newStudioFrame(kind, { x: body.x + 4, y: body.y + 4, width: Math.min(110, body.width - 8), height: Math.min(80, body.height - 8) }, selectedScenes[0]?.id ?? seedSceneId, spec.scale);
      updatePage({ ...page, frames: [...page.frames, frame] }); setSelectedFrameId(frame.id);
    }
    setInspector('selection'); setMobilePane('sheet');
  }
  function removeFrame() { if (!page || !selectedFrame) return; updatePage({ ...page, frames: page.frames.filter(frame => frame.id !== selectedFrame.id) }); setSelectedFrameId(undefined); }
  function onKey(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && key === 's') { event.preventDefault(); void saveDraft(); return; }
    if (editingText(event.target)) return;
    if (modifier && (key === 'z' || key === 'y')) { event.preventDefault(); if (key === 'y' || event.shiftKey) draft.redo(); else draft.undo(); return; }
    if (event.key === 'Escape') { draft.finish(true); setSelectedFrameId(undefined); return; }
    if (mode !== 'edit' || !selectedFrame || !page) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeFrame(); }
    if (modifier && key === 'd') {
      event.preventDefault();
      const next = constrainFrame({ ...structuredClone(selectedFrame), id: crypto.randomUUID(), x: selectedFrame.x + 5, y: selectedFrame.y + 5 }, page);
      if (page.frames.length < 40) {
        draft.commit({ ...value, spec: { ...spec, customPages: pages.map((item, index) => index === pageIndex ? { ...page, frames: [...page.frames, next] } : item) },
          viewImages: images[selectedFrame.id] ? { ...images, [next.id]: images[selectedFrame.id]! } : value.viewImages });
        setSelectedFrameId(next.id);
      }
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      if (!draft.isActive()) draft.begin();
      const amount = event.shiftKey ? 10 : 1;
      const frame = constrainFrame({ ...selectedFrame,
        x: selectedFrame.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0),
        y: selectedFrame.y + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0),
      }, page);
      draft.preview({ ...value, spec: { ...spec, customPages: pages.map((item, index) => index === pageIndex ? { ...item, frames: item.frames.map(f => f.id === frame.id ? frame : f) } : item) } });
    }
  }
  async function showProof() {
    setMode('proof'); setMobilePane('sheet');
    if (!proofCurrent && valid && !freezeDisabled && !preview.busy) await preview.prepare(value, proofKey);
  }
  async function exportPdf() {
    if (mode !== 'proof' || !proofCurrent) await showProof();
    else await preview.download(proofKey, `${selectedScenes[0]?.productionName ?? 'Buehne'}-${spec.revisionName}`);
  }
  const onCaptureReady = useCallback((handle: StageCaptureHandle | null) => { capture.current = handle; setCaptureReady(!!handle); }, []);
  const captureScene = scenes.find(scene => scene.id === selectedFrame?.source.sceneId) ?? selectedScenes[0];
  async function captureView() {
    if (!capture.current || !captureScene) return;
    setCapturing(true); setCaptureError('');
    try {
      const savedCamera = capture.current.getCamera?.();
      const png = await capture.current.capturePng();
      let nextPages = pages;
      let target = selectedFrame?.kind === 'view3d' ? selectedFrame : undefined;
      if (!target && page?.automaticKey && sheet?.frames.some(frame => frame.kind === 'view3d')) {
        const next = editableDrawingPage(page, sheet, spec);
        target = next.frames.find(frame => frame.kind === 'view3d');
        nextPages = pages.map((item, index) => index === pageIndex ? next : item);
      }
      if (!target) {
        const next = newStudioPage(spec, captureScene.id);
        target = newStudioFrame('view3d', bodyRect(next.paper, next.orientation), captureScene.id, spec.scale);
        next.name = 'Raumsicht'; next.frames = [target]; nextPages = [...pages, next]; setActivePage(pages.length);
      }
      if (savedCamera) nextPages = nextPages.map(page => ({ ...page, frames: page.frames.map(frame => frame.id === target!.id ? { ...frame, camera: savedCamera } : frame) }));
      draft.commit({ ...value, spec: { ...spec, customPages: nextPages }, viewImages: { ...images, [target.id]: png } });
      setSelectedFrameId(target.id); setCaptureOpen(false); setInspector('selection');
    } catch (caught) { setCaptureError(caught instanceof Error ? caught.message : 'Die Aufnahme ist fehlgeschlagen.'); }
    finally { setCapturing(false); }
  }

  return <section ref={studioRoot} className="recipient-document-workspace document-studio" role="dialog" aria-modal="true" aria-label="Dokument erstellen" data-mobile-pane={mobilePane}
    onKeyDown={onKey} onKeyUp={event => { if (event.key.startsWith('Arrow') && draft.isActive()) draft.finish(); }}>
    <header className="studio-header">
      <button type="button" className="studio-back" aria-label="Zurück zum Editor" title="Zurück zum Editor" onClick={() => void close()}><ToolIcon name="back" /></button>
      <div className="studio-title"><span>DOKUMENTSTUDIO</span><h2>{selectedScenes[0]?.productionName ?? 'Produktion'}</h2></div>
      <span className={`studio-save-state${saveError ? ' has-error' : ''}`} role="status">{saving ? 'Speichert …' : saveError ? 'Nicht gespeichert' : draft.dirty ? 'Ungespeichert' : 'Gespeichert'}</span>
      <div className="studio-history" role="group" aria-label="Dokumentverlauf">
        <button type="button" className="studio-icon" aria-label="Rückgängig" title="Rückgängig · Strg+Z" disabled={!draft.canUndo} onClick={draft.undo}><ToolIcon name="undo" /></button>
        <button type="button" className="studio-icon" aria-label="Wiederholen" title="Wiederholen · Strg+Umschalt+Z" disabled={!draft.canRedo} onClick={draft.redo}><ToolIcon name="redo" /></button>
      </div>
      <div className="studio-mode" role="group" aria-label="Dokumentansicht">
        <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>Bearbeiten</button>
        <button type="button" aria-pressed={mode === 'proof'} onClick={() => void showProof()}>Druckvorschau</button>
      </div>
      <button type="button" className="studio-export" disabled={preview.busy || !valid || freezeDisabled || gestureActive || !!layoutResult.error} onClick={() => void exportPdf()}>
        {preview.busy ? 'PDF wird vorbereitet …' : mode === 'proof' && proofCurrent ? 'PDF herunterladen' : mode === 'proof' ? 'Vorschau aktualisieren' : 'PDF exportieren'}<span aria-hidden="true">↗</span>
      </button>
    </header>
    <nav className="studio-mobile-nav" aria-label="Studiobereich">
      {([['pages', 'Seiten'], ['sheet', 'Blatt'], ['settings', 'Eigenschaften']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={mobilePane === key} onClick={() => setMobilePane(key)}>{label}</button>)}
    </nav>
    {(saveError || preview.error || layoutResult.error) && <div className="studio-error" role="alert">
      <span>{saveError || preview.error || layoutResult.error}</span>
      {saveError ? <button type="button" onClick={() => void saveDraft()}>Speichern erneut versuchen</button> : layoutResult.error ? <button type="button" onClick={() => void resetAutomatic({})}>Seiten neu aufbauen</button> : <button type="button" onClick={() => { if (proofCurrent) void preview.download(proofKey, `${selectedScenes[0]?.productionName ?? 'Buehne'}-${spec.revisionName}`); else void showProof(); }}>Erneut versuchen</button>}
    </div>}
    <div className="studio-body">
      <aside className="studio-rail" aria-label="Dokumentseiten">
        <div className="studio-rail-tabs" role="group" aria-label="Seitenleiste">
          {([['pages', 'Seiten'], ['contents', 'Inhalt'], ['layouts', 'Layouts']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={rail === key} onClick={() => setRail(key)}>{label}</button>)}
        </div>
        <div className="studio-panel-scroll">
          {rail === 'pages' && <>
            <div className="studio-panel-heading"><h3>Dein Dokument</h3><span>{pages.length} {pages.length === 1 ? 'Seite' : 'Seiten'}</span></div>
            <div className="studio-thumbnails">{pages.map((item, index) => {
              const thumb = item.automaticKey ? layout?.sheets.find(s => s.sourceKey === item.automaticKey) : layout?.sheets.find(s => s.pageId === item.id);
              return <button type="button" key={item.id} className={`studio-page-card${pageIndex === index ? ' is-active' : ''}`} aria-current={pageIndex === index ? 'page' : undefined}
                aria-label={`Seite ${index + 1}: ${item.name}`} onClick={() => selectPage(index)}>
                <div className="studio-thumb-sheet">{thumb && <DocumentSheetArtwork sheet={thumb} images={images} />}</div>
                <span className="studio-thumb-caption"><b>{String(index + 1).padStart(2, '0')}</b><span>{item.name}<small>{item.paper} · {item.orientation === 'landscape' ? 'Querformat' : 'Hochformat'}</small></span></span>
              </button>;
            })}</div>
          </>}
          {rail === 'contents' && <>
            <div className="studio-panel-heading"><h3>Inhalte</h3></div><p className="studio-hint">Die automatische Zusammenstellung berücksichtigt diese Abschnitte.</p>
            {(Object.entries(DOCUMENT_SECTION_LABELS) as [DocumentSection, string][]).map(([section, label]) => <label className="studio-check" key={section}>
              <input type="checkbox" checked={(spec.sections ?? []).includes(section)} onChange={() => void resetAutomatic({ sections: (spec.sections ?? []).includes(section) ? spec.sections?.filter(item => item !== section) : [...spec.sections ?? [], section] })} />{label}
            </label>)}
            <button type="button" className="studio-secondary studio-wide" onClick={() => { setCaptureOpen(true); setCaptureError(''); }}>Raumsicht aufnehmen</button>
          </>}
          {rail === 'layouts' && <>
            <div className="studio-panel-heading"><h3>Ein guter Anfang</h3></div><p className="studio-hint">Ein Layout fügt eine neue, frei bearbeitbare Seite ein.</p>
            {PAGE_LAYOUTS.map(preset => <button key={preset.id} type="button" className="studio-layout-card" disabled={pages.length >= 80} onClick={() => addPage(preset.id)}>
              <span className={`studio-layout-mini is-${preset.id}`} aria-hidden="true">{preset.kinds.map((kind, index) => <i key={index} data-kind={kind} />)}</span>
              <strong>{preset.label}</strong><span>{preset.hint}</span><small>+ Seite einfügen</small>
            </button>)}
          </>}
        </div>
        <div className="studio-rail-footer"><button type="button" className="studio-secondary studio-wide" disabled={pages.length >= 80} onClick={() => setRail('layouts')}><ToolIcon name="plus" /> Seite hinzufügen</button></div>
      </aside>

      <main className="studio-workbench" aria-label={mode === 'edit' ? 'Blatt bearbeiten' : 'Druckvorschau'}>
        <div className="studio-contextbar">
          <div><span className="studio-page-number">{String(pageIndex + 1).padStart(2, '0')}</span><strong>{page?.name ?? 'Dokument'}</strong><span className="studio-context-format">{page?.paper} · {page?.orientation === 'landscape' ? 'Querformat' : 'Hochformat'}</span></div>
          {mode === 'edit' && <div className="studio-page-actions" role="group" aria-label="Seitenaktionen">
            <button type="button" className="studio-icon" aria-label="Seite nach oben" title="Seite nach oben" disabled={pageIndex === 0} onClick={() => movePage(-1)}>↑</button>
            <button type="button" className="studio-icon" aria-label="Seite nach unten" title="Seite nach unten" disabled={pageIndex === pages.length - 1} onClick={() => movePage(1)}>↓</button>
            <button type="button" className="studio-text-action" disabled={pages.length >= 80} onClick={duplicatePage}>Duplizieren</button>
            <button type="button" className="studio-text-action" disabled={pages.length <= 1} onClick={() => void removePage()}>Entfernen</button>
          </div>}
        </div>
        {mode === 'edit' ? <>
          <div className="studio-canvas-scroll" ref={canvas}>
            <div className="studio-paper-wrap" style={{ width: `${fitWidth * zoom}px`, maxWidth: 'none' }}>
              {sheet && page ? <DocumentSheet key={`${page.id}:${cancelGesture}`} sheet={sheet} page={page} images={images} selectedId={selectedFrameId}
                onSelect={id => { setSelectedFrameId(id); setInspector('selection'); }} onEditAutomatic={editDrawing}
                onBegin={draft.begin} onFinish={cancel => draft.finish(cancel)} onPreview={frame => {
                  draft.preview({ ...value, spec: { ...spec, customPages: pages.map((item, index) => index === pageIndex ? { ...item, frames: item.frames.map(f => f.id === frame.id ? frame : f) } : item) } });
                }} /> : <div className="studio-empty"><h3>Noch keine Seiten</h3><p>Wähle ein Layout oder ergänze einen Abschnitt.</p><button type="button" onClick={() => addPage()}>Grundriss einfügen</button></div>}
            </div>
          </div>
          <div className="studio-canvas-tools"><span>Entwurf</span><button type="button" className="studio-icon" aria-label="Verkleinern" onClick={() => setZoom(z => Math.max(0.5, z - 0.15))}><ToolIcon name="minus" /></button><b>{Math.round(zoom * 100)} %</b><button type="button" className="studio-icon" aria-label="Vergrößern" onClick={() => setZoom(z => Math.min(2.5, z + 0.15))}><ToolIcon name="plus" /></button><button type="button" className="studio-icon" aria-label="Blatt einpassen" onClick={() => setZoom(1)}><ToolIcon name="expand" /></button></div>
        </> : <div className="studio-proof-area">
          <div className={`studio-proof-status${!proofCurrent ? ' is-stale' : ''}`} role="status">
            {preview.busy ? 'Die Druckvorschau wird vorbereitet. Die bisherige Vorschau bleibt sichtbar.' : proofCurrent ? `${preview.proof?.job.pageCount ?? 0} Blatt bereit. ${preview.proof?.issued ? 'Diese Fassung wurde herausgegeben.' : 'Prüfe die Seiten vor dem Export.'}` : preview.proof ? 'Diese Vorschau ist veraltet. Bitte vor dem Export aktualisieren.' : 'Die Druckvorschau zeigt die tatsächlichen PDF-Seiten.'}
          </div>
          {preview.proof ? <iframe title="PDF-Vorschau" className="studio-pdf-preview" src={`${preview.proof.url}#toolbar=0&page=${proofPage}&view=Fit`} /> : <div className="studio-empty"><ToolIcon name="front" /><h3>{preview.busy ? 'Dein Dokument entsteht …' : 'Bereit für die Druckvorschau'}</h3><p>Zeichnungen bleiben maßstäblich. Schriften und Seitenumbrüche werden für das PDF gesetzt.</p>{!preview.busy && <button type="button" disabled={!valid || freezeDisabled} onClick={() => void showProof()}>Druckvorschau erstellen</button>}</div>}
        </div>}
      </main>

      <aside className="studio-inspector" aria-label="Dokumenteigenschaften">
        <div className="studio-rail-tabs" role="group" aria-label="Eigenschaftenbereich">
          <button type="button" aria-pressed={inspector === 'document'} onClick={() => setInspector('document')}>Dokument</button>
          <button type="button" aria-pressed={inspector === 'selection'} onClick={() => setInspector('selection')}>{selectedFrame ? 'Rahmen' : 'Blatt'}</button>
        </div>
        <div className="studio-panel-scroll">
          {inspector === 'document' ? <>
            <div className="studio-panel-heading"><h3>Für den richtigen Zweck</h3></div>
            <div className="studio-presets">{(Object.entries(DOCUMENT_PURPOSES) as [DocumentPurpose, typeof DOCUMENT_PURPOSES[DocumentPurpose]][]).map(([key, option]) => <button type="button" key={key} aria-pressed={spec.purpose === key} onClick={() => void choosePurpose(key)}><span>{option.label}</span><small>{option.description}</small></button>)}</div>
            <div className="studio-inspector-section"><h3>Dokument</h3>
              <label>Bezeichnung der Fassung<input maxLength={120} value={spec.revisionName} onChange={event => patchSpec({ revisionName: event.target.value })} /></label>
              <label>Umfang<select value={spec.kind === 'package' && spec.scenes.length === scenes.length ? 'production' : spec.scenes.length > 1 ? 'venue' : 'scene'} onChange={event => {
                const ids = scopeIds(scenes, event.target.value as Scope, seedSceneId, seedVenueId);
                void resetAutomatic({ scenes: ids.map(sceneId => ({ sceneId, elevationGroupIds: [] })), kind: event.target.value !== 'scene' || ids.length > 1 ? 'package' : 'scene' });
              }}><option value="scene">Dieses Bühnenbild</option><option value="venue">Diese Spielstätte</option><option value="production">Ganze Produktion</option></select></label>
              <div className="studio-field-pair"><label>Papier<select value={spec.paper} onChange={event => void resetAutomatic({ paper: event.target.value as PaperSize })}>{(['A4', 'A3', 'A2', 'A1'] as const).map(size => <option key={size}>{size}</option>)}</select></label>
              <label>Ausrichtung<select value={spec.orientation} onChange={event => void resetAutomatic({ orientation: event.target.value as ExportDocumentSpec['orientation'] })}><option value="auto">Automatisch</option><option value="portrait">Hochformat</option><option value="landscape">Querformat</option></select></label></div>
              <label>Maßstab<select value={spec.scale} onChange={event => void resetAutomatic({ scale: Number(event.target.value) as 25 | 50 | 100 })}>{[25, 50, 100].map(scale => <option key={scale} value={scale}>1:{scale}</option>)}</select></label>
            </div>
            <details className="studio-details"><summary>Einleitung und Kontakt</summary><label>Einleitung<textarea aria-label="Einleitung" rows={4} maxLength={2000} value={spec.introduction ?? ''} onChange={event => patchSpec({ introduction: event.target.value })} /></label><label>Kontakt und Absprachen<textarea aria-label="Kontakt und Absprachen" rows={3} maxLength={500} value={spec.contact ?? ''} onChange={event => patchSpec({ contact: event.target.value })} /></label></details>
            <details className="studio-details"><summary>Sichtbare Ebenen</summary>{EXPORT_LAYER_OPTIONS.map(option => <label className="studio-check" key={option.key}><input type="checkbox" checked={resolveExportLayers(spec.layers)[option.key]} onChange={event => patchSpec({ layers: { ...spec.layers, [option.key]: event.target.checked } })} />{option.label}</label>)}</details>
            {spec.customPages?.length ? <button type="button" className="studio-text-action studio-reset" onClick={() => void resetAutomatic({})}>Automatischen Seitenaufbau wiederherstellen</button> : null}
          </> : page && <>
            <div className="studio-panel-heading"><h3>{selectedFrame ? FRAME_LABELS[selectedFrame.kind] : 'Blatteinstellungen'}</h3><span>{selectedFrame ? 'Rahmen' : `Seite ${pageIndex + 1}`}</span></div>
            {!selectedFrame ? <>
              <label>Blattname<input value={page.name} maxLength={120} onChange={event => updatePage({ ...page, name: event.target.value })} /></label>
              <div className="studio-field-pair"><label>Papier<select value={page.paper} disabled={!!page.automaticKey} onChange={event => { const next = { ...page, paper: event.target.value as PaperSize }; updatePage({ ...next, frames: next.frames.map(frame => constrainFrame(frame, next)) }); }}>{(['A4', 'A3', 'A2', 'A1'] as const).map(size => <option key={size}>{size}</option>)}</select></label><label>Ausrichtung<select value={page.orientation} disabled={!!page.automaticKey} onChange={event => { const next = { ...page, orientation: event.target.value as DocumentPage['orientation'] }; updatePage({ ...next, frames: next.frames.map(frame => constrainFrame(frame, next)) }); }}><option value="portrait">Hochformat</option><option value="landscape">Querformat</option></select></label></div>
              {page.automaticKey && <div className="studio-auto-note"><ToolIcon name="settings" /><p>Automatisch gesetzt. Listen und Folgeblätter bleiben vollständig. Das Papierformat stellst du unter „Dokument“ ein.</p></div>}
              {page.automaticKey && sheet?.frames.some(frame => frame.kind === 'plan' || frame.kind === 'elevation' || frame.kind === 'view3d') && <button type="button" className="studio-secondary studio-wide" onClick={editDrawing}>Zeichnung bearbeiten</button>}
              {!page.automaticKey && <p className="studio-hint">Wähle einen Rahmen auf dem Blatt. Ziehen verschiebt; der Griff ändert die Größe. Alt setzt das Einrasten aus.</p>}
              <div className="studio-inspector-section"><h3>Auf dieser Seite</h3>{(page.automaticKey ? sheet?.frames ?? [] : page.frames).map(frame => <button type="button" className="studio-frame-list-item" key={frame.id} disabled={!!page.automaticKey && frame.kind !== 'plan' && frame.kind !== 'elevation' && frame.kind !== 'view3d'} onClick={() => { if (page.automaticKey) { if (frame.kind === 'plan' || frame.kind === 'elevation' || frame.kind === 'view3d') editDrawing(); } else setSelectedFrameId(frame.id); }}><span>{FRAME_LABELS[frame.kind]}</span><span aria-hidden="true">↗</span></button>)}</div>
            </> : <>
              <label>Beschriftung<input value={selectedFrame.label ?? ''} maxLength={80} onChange={event => patchFrame({ label: event.target.value })} /></label>
              <label>Bühnenbild<select value={selectedFrame.source.sceneId ?? selectedScenes[0]?.id} onChange={event => patchFrame({ source: { role: 'primary', sceneId: event.target.value }, crop: undefined })}>{selectedScenes.map(scene => <option value={scene.id} key={scene.id}>{scene.name} · {scene.venueName}</option>)}</select></label>
              {(selectedFrame.kind === 'plan' || selectedFrame.kind === 'elevation') && <label>Rahmenmaßstab<select value={selectedFrame.scale ?? spec.scale} onChange={event => patchFrame({ scale: Number(event.target.value) as 25 | 50 | 100 })}>{[25, 50, 100].map(scale => <option key={scale} value={scale}>1:{scale}</option>)}</select></label>}
              {selectedFrame.kind === 'elevation' && <label>Wandgruppe<select value={selectedFrame.source.groupId ?? ''} onChange={event => patchFrame({ source: { ...selectedFrame.source, groupId: event.target.value || undefined } })}><option value="">Automatische Wandgruppe</option>{(scenes.find(scene => scene.id === selectedFrame.source.sceneId)?.layout.groups ?? []).map((group, index) => <option key={group.id} value={group.id}>Wandgruppe {index + 1}</option>)}</select></label>}
              {(selectedFrame.kind === 'plan' || selectedFrame.kind === 'elevation') && <p className="studio-hint">Die Größe ändert den Zeichenbereich, nie den Maßstab. Große Zeichnungen erhalten Folgeblätter.</p>}
              <div className="studio-inspector-section"><h3>Position und Größe <span>mm</span></h3><div className="studio-field-pair">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{({ x: 'X', y: 'Y', width: 'Breite', height: 'Höhe' })[key]}<input aria-label={`Rahmen ${key === 'width' ? 'Breite' : key === 'height' ? 'Höhe' : key.toUpperCase()} (mm)`} type="number" min={key === 'width' || key === 'height' ? 10 : 0} step="1" value={Number(selectedFrame[key].toFixed(1))} onChange={event => { if (event.target.value !== '') patchFrame({ [key]: event.target.valueAsNumber }); }} /></label>)}</div></div>
              {selectedFrame.kind === 'notes' && <label>Text<textarea aria-label="Text" rows={7} maxLength={4000} value={selectedFrame.text ?? ''} onChange={event => patchFrame({ text: event.target.value })} /></label>}
              {selectedFrame.kind === 'view3d' && <><p className="studio-hint">Perspektivische Ansicht · ohne Maßstab</p><button type="button" className="studio-secondary studio-wide" onClick={() => { setCaptureOpen(true); setCaptureError(''); }}>{images[selectedFrame.id] ? 'Raumsicht neu aufnehmen' : 'Raumsicht aufnehmen'}</button></>}
              {selectedFrame.kind === 'plan' && <details className="studio-details"><summary>Zeichnung und Ausschnitt</summary>{EXPORT_LAYER_OPTIONS.map(option => <label className="studio-check" key={option.key}><input type="checkbox" checked={resolveExportLayers({ ...spec.layers, ...selectedFrame.layers })[option.key]} onChange={event => patchFrame({ layers: { ...selectedFrame.layers, [option.key]: event.target.checked } })} />{option.label}</label>)}{selectedFrame.crop && <button type="button" className="studio-text-action" onClick={() => patchFrame({ crop: undefined })}>Ganze Zeichnung zeigen</button>}</details>}
              <button type="button" className="studio-text-action studio-reset" onClick={removeFrame}>Rahmen entfernen</button>
            </>}
            <div className="studio-inspector-section"><h3>Einfügen</h3><div className="studio-insert-grid">{(Object.entries(FRAME_LABELS) as [FrameKind, string][]).map(([kind, label]) => <button type="button" key={kind} className="studio-secondary" onClick={() => addFrame(kind)}><ToolIcon name="plus" />{label}</button>)}</div></div>
          </>}
        </div>
        <div className="studio-inspector-footer"><button type="button" className="studio-text-action" disabled={saving || !valid} onClick={() => void saveDraft()}>{saving ? 'Speichert …' : 'Entwurf speichern'}</button><span>{saveError ? 'Bitte erneut speichern' : saving ? 'Änderungen werden gespeichert' : draft.dirty ? 'Speichert nach der Eingabe' : 'Entwurf ist gespeichert'}</span></div>
      </aside>
    </div>
    <footer className="studio-statusbar"><span>{spec.customPages?.length ? 'Individuelles Layout' : 'Automatischer Seitenaufbau'}<i />{layout?.pageCount ?? 0} Blatt im Entwurf</span><button type="button" className={notices.length ? 'has-notices' : ''} onClick={() => setShowNotices(show => !show)} aria-expanded={showNotices}>{notices.length ? `${notices.length} Hinweise anzeigen` : 'Keine offenen Hinweise'}<span aria-hidden="true">{showNotices ? '⌄' : '⌃'}</span></button></footer>
    {showNotices && <div className="studio-notices" role="region" aria-label="Dokumenthinweise"><div><h3>Vor dem Export prüfen</h3><button type="button" className="studio-icon" aria-label="Hinweise schließen" onClick={() => setShowNotices(false)}>×</button></div>{notices.length ? <ul>{notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul> : <p>Keine offenen Hinweise. Prüfe die Druckvorschau vor dem Export.</p>}</div>}
    {captureOpen && captureScene && <div className="studio-capture" role="region" aria-label="Raumsicht aufnehmen"><header><div><span>RAUMSICHT</span><h3>{captureScene.name}</h3></div><button type="button" className="studio-icon" aria-label="Aufnahme schließen" disabled={capturing} onClick={() => setCaptureOpen(false)}>×</button></header><p>Richte die Kamera aus. Die Aufnahme wird genau so in das Dokument übernommen.</p>
      <EditorDockContext.Provider value={null}><SurfaceRegistryProvider workspaceId={workspaceId} productionId={productionId}><StageView workspaceId={workspaceId} layout={captureScene.layout} venue={captureScene.venue} assets={loaded.assets} initialView="audience" onCaptureReady={onCaptureReady} /></SurfaceRegistryProvider></EditorDockContext.Provider>
      {captureError && <p role="alert">{captureError}</p>}<button type="button" disabled={!captureReady || capturing} onClick={() => void captureView()}>{capturing ? 'Aufnahme wird erstellt …' : 'Ansicht übernehmen'}</button>
    </div>}
  </section>;
}
