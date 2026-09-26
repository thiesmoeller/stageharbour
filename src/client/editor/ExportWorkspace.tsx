import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  defaultExportLayers, EXPORT_LAYER_OPTIONS, exportListSchema, exportRevisionSchema, germanDate,
  type ExportLayers, type ExportRevision,
} from '../../shared/export.js';
import {
  defaultCamera, documentPagesFromTemplate, viewFrameId, type CameraPreset, type DocumentFrame, type DocumentPage, type ExportDocumentSpec, type FrameCrop, type SheetOrientation,
} from '../../shared/exportDocument.js';
import type { Asset } from '../../shared/assets.js';
import type { Group } from '../../shared/groups.js';
import type { Layout, VenueGeometry, Wall } from '../../shared/layout.js';
import type { PlanPreviewData } from './PlanPreview.js';
import { REPORT_VIEW_LABELS, type ReportTemplate } from '../../shared/reportTemplate.js';
import { StageView, type StageCaptureHandle } from './StageView.js';
// StageCaptureHandle re-exported from StageView
import { ApiError, request } from '../api.js';

type Job = {
  id: string; status: string; stage: string; pageCount: number | null; error: string | null;
  manifest: { pageCount?: number; sheets?: { index: number; code: string; title: string; scaleLabel: string }[]; diagnostics?: string[] } | null;
  expiresAt: string; issuedRevisionId: string | null;
};

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

export function ExportWorkspace({
  workspaceId, sceneId, productionId, scenes, groups, walls, templates, readOnly, freezeDisabled, onClose, onSaveTemplate,
  planPreview, venueSize, layout, venue, assets = [],
}: {
  workspaceId: string; sceneId?: string; productionId: string;
  scenes: readonly { id: string; name: string }[];
  groups: Group[]; walls: Wall[]; templates: ReportTemplate[];
  readOnly: boolean; freezeDisabled: boolean; onClose: () => void;
  /** Fitted ground plan used to rubber-band the exported window. */
  planPreview?: PlanPreviewData;
  venueSize?: { width: number; depth: number };
  /** Live scene for aiming Raumsicht cameras on this page. */
  layout?: Layout;
  venue?: VenueGeometry;
  assets?: Asset[];
  onSaveTemplate?: (templates: ReportTemplate[]) => Promise<void>;
}) {
  const selectedDefault = sceneId ? [sceneId] : scenes.map(scene => scene.id);
  const [sceneIds, setSceneIds] = useState<string[]>(selectedDefault);
  const [revisionName, setRevisionName] = useState('Fassung');
  const [paper, setPaper] = useState<'A4' | 'A3'>('A4');
  const [orientation, setOrientation] = useState<'auto' | SheetOrientation>('auto');
  const [scale, setScale] = useState<25 | 50 | 100>(50);
  const [preset, setPreset] = useState<'construction' | 'presentation'>('construction');
  const [planCrop, setPlanCrop] = useState<FrameCrop | undefined>();
  const [viewCameras, setViewCameras] = useState<{ id: string; label: string; preset: CameraPreset }[]>([]);
  const [viewImages, setViewImages] = useState<Record<string, string>>({});
  const [activeViewId, setActiveViewId] = useState<string>();
  const stageCapture = useRef<StageCaptureHandle | null>(null);
  const onCaptureReady = useCallback((handle: StageCaptureHandle | null) => { stageCapture.current = handle; }, []);
  const [layers, setLayers] = useState<ExportLayers>(defaultExportLayers);
  const [documentKind, setDocumentKind] = useState<'scene' | 'package'>(scenes.length > 1 ? 'package' : 'scene');
  const [elevationGroupIds, setElevationGroupIds] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [customPages, setCustomPages] = useState<DocumentPage[] | undefined>();
  const [repairs, setRepairs] = useState<{ frameId: string; message: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [past, setPast] = useState<DocumentPage[][]>([]);
  const [future, setFuture] = useState<DocumentPage[][]>([]);
  const [selectedFrame, setSelectedFrame] = useState<string>();
  const [job, setJob] = useState<Job>();
  const [outdated, setOutdated] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'rendering' | 'ready' | 'failed' | 'downloading'>('idle');
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [thumbs, setThumbs] = useState(true);
  const [panel, setPanel] = useState<'settings' | 'preview'>('settings');
  const [history, setHistory] = useState<ExportRevision[]>([]);
  const [issued, setIssued] = useState<ExportRevision>();
  function dropCustomLayout() {
    setCustomPages(undefined);
    setEditing(false);
    setOutdated(true);
  }

  const historyBase = documentKind === 'package'
    ? `/api/workspaces/${workspaceId}/productions/${productionId}/packages`
    : `/api/workspaces/${workspaceId}/scenes/${sceneIds[0] ?? sceneId}/exports`;

  const spec = useMemo<ExportDocumentSpec | undefined>(() => {
    if (!sceneIds.length || !revisionName.trim()) return undefined;
    return {
      schemaVersion: 1, preset, kind: documentKind, revisionName: revisionName.trim(), paper, orientation, scale,
      layers,
      scenes: sceneIds.map(id => ({ sceneId: id, elevationGroupIds: id === (sceneId ?? sceneIds[0]) ? elevationGroupIds : [] })),
      templateId: templateId || undefined,
      planCrop, viewCameras: viewCameras.flatMap(view => {
        const label = view.label.trim();
        if (!label) return [];
        return [{
          id: view.id, label,
          camera: defaultCamera({
            minX: 0, minY: 0, maxX: venueSize?.width ?? 8000, maxY: venueSize?.depth ?? 6000,
          }, view.preset),
        }];
      }),
      customPages,
    };
  }, [sceneIds, revisionName, preset, documentKind, paper, orientation, scale, layers, elevationGroupIds, sceneId, templateId, customPages, planCrop, viewCameras, venueSize?.width, venueSize?.depth]);

  const preparePayload = useMemo(() => {
    if (!spec) return undefined;
    const images = Object.keys(viewImages).length ? viewImages : undefined;
    return images ? { ...spec, viewImages: images } : spec;
  }, [spec, viewImages]);

  useEffect(() => {
    if (!historyBase.includes('/scenes/undefined')) {
      request(historyBase).then(data => setHistory(exportListSchema.parse(data))).catch(() => setHistory([]));
    }
  }, [historyBase, issued?.id]);

  useEffect(() => {
    if (!preparePayload || readOnly) return;
    let stop = false;
    const handle = window.setTimeout(() => {
      setPhase('preparing');
      setError('');
      request(`/api/workspaces/${workspaceId}/documents`, preparePayload).then(async created => {
        let current = created as Job;
        setJob(current);
        while (!stop && (current.status === 'queued' || current.status === 'rendering')) {
          setPhase(current.status === 'rendering' ? 'rendering' : 'preparing');
          await new Promise(resolve => window.setTimeout(resolve, 250));
          current = await request(`/api/workspaces/${workspaceId}/documents/${current.id}`) as Job;
          if (stop) return;
          setJob(current);
        }
        if (current.status !== 'ready') {
          setPhase('failed');
          setError(current.error || 'Die Vorschau konnte nicht erzeugt werden.');
          return;
        }
        const response = await fetch(`/api/workspaces/${workspaceId}/documents/${current.id}/file`, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('preview');
        const url = URL.createObjectURL(await response.blob());
        if (stop) { URL.revokeObjectURL(url); return; }
        setPreviewUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url; });
        setPage(1);
        setOutdated(false);
        setPhase('ready');
      }).catch(caught => {
        if (stop) return;
        setPhase('failed');
        setError(caught instanceof ApiError ? caught.message : 'Die Vorschau konnte nicht erzeugt werden.');
      });
    }, 300);
    return () => { stop = true; window.clearTimeout(handle); };
  }, [workspaceId, preparePayload, readOnly]);

  function editPages(next: DocumentPage[]) {
    setPast(current => [...current, customPages ?? []]);
    setFuture([]);
    setCustomPages(next);
    setOutdated(true);
  }

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find(item => item.id === id);
    if (!template) { setCustomPages(undefined); setRepairs([]); return; }
    const adapted = documentPagesFromTemplate(template, sceneIds[0]);
    setRepairs(adapted.repairs);
    editPages(adapted.pages);
  }

  async function issue() {
    if (!job || job.status !== 'ready' || outdated) return;
    setError('');
    try {
      const created = exportRevisionSchema.parse(await request(`/api/workspaces/${workspaceId}/documents/${job.id}/issue`, {}));
      setIssued(created);
      setPhase('ready');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Das PDF konnte nicht herausgegeben werden.');
    }
  }

  async function download(item?: ExportRevision) {
    setPhase('downloading');
    setError('');
    try {
      const url = item
        ? `${historyBase}/${item.id}/file`
        : job ? `/api/workspaces/${workspaceId}/documents/${job.id}/file` : '';
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('download');
      const blob = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      const safe = (item?.name ?? revisionName).replace(/[^\wÄÖÜäöüß\-]+/g, '_').slice(0, 40);
      anchor.href = blob;
      anchor.download = `${documentKind === 'package' ? 'konstruktionspaket' : 'konstruktionsplan'}-${safe}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(blob), 1000);
    } catch {
      setError('Das PDF konnte nicht heruntergeladen werden.');
    } finally {
      setPhase(job?.status === 'ready' ? 'ready' : 'idle');
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Diese Fassung endgültig löschen?')) return;
    setError('');
    try {
      await request(`${historyBase}/${id}`, undefined, 'DELETE');
      setHistory(current => current.filter(item => item.id !== id));
      if (issued?.id === id) setIssued(undefined);
    } catch {
      setError('Die Fassung konnte nicht gelöscht werden.');
    }
  }

  function openPdf() {
    if (!previewUrl) return;
    window.open(previewUrl, '_blank', 'noopener');
  }

  const selected = customPages?.flatMap(pageItem => pageItem.frames).find(frame => frame.id === selectedFrame);
  const pageCount = job?.manifest?.pageCount ?? job?.pageCount ?? 0;
  const phaseLabel = freezeDisabled ? 'Wartet auf gespeicherte Änderungen.'
    : outdated ? 'Vorschau veraltet.'
      : phase === 'preparing' ? 'Vorbereitung läuft.'
        : phase === 'rendering' ? 'PDF wird gerendert.'
          : phase === 'downloading' ? 'Download läuft.'
            : phase === 'ready' ? 'Vorschau bereit.'
              : phase === 'failed' ? 'Export fehlgeschlagen.'
                : 'Bereit.';

  return <section className="export-workspace" aria-label="Export" data-testid="export-workspace">
    <header className="export-workspace-bar">
      <button type="button" className="quiet" onClick={onClose}>Schließen</button>
      <h2>Export</h2>
      <p role="status">{phaseLabel}{pageCount ? ` ${pageCount} Blatt.` : ''}</p>
      <div className="export-workspace-switch" role="group" aria-label="Ansicht wechseln">
        <button type="button" className="quiet" aria-pressed={panel === 'settings'} onClick={() => setPanel('settings')}>Einstellungen</button>
        <button type="button" className="quiet" aria-pressed={panel === 'preview'} onClick={() => setPanel('preview')}>Vorschau</button>
      </div>
      <button type="button" disabled={readOnly || freezeDisabled || !job || job.status !== 'ready' || outdated || phase === 'preparing'} onClick={() => void issue()}>PDF erstellen</button>
    </header>
    <div className={`export-workspace-body panel-${panel}`}>
      <form className="export-workspace-settings" onSubmit={event => { event.preventDefault(); void issue(); }}>
        <label htmlFor="export-name">Bezeichnung der Fassung</label>
        <input id="export-name" value={revisionName} maxLength={120} required onChange={event => { setRevisionName(event.target.value); setOutdated(true); }} />
        {planPreview && <fieldset>
          <legend>Grundrissausschnitt</legend>
          <PlanCropBand preview={planPreview} crop={planCrop} disabled={readOnly} onChange={next => { setPlanCrop(next); dropCustomLayout(); }} />
          <button type="button" className="quiet" disabled={!planCrop || readOnly} onClick={() => { setPlanCrop(undefined); dropCustomLayout(); }}>Ganze Zeichnung</button>
          <p className="muted">Ziehen Sie ein Rechteck über den Grundriss. Ohne Rechteck gilt die ganze Zeichnung. Der Ausschnitt bleibt im gewählten Maßstab.</p>
        </fieldset>}
        {scenes.length > 1 && <fieldset>
          <legend>Szenen</legend>
          {scenes.map(scene => <label key={scene.id} htmlFor={`export-scene-${scene.id}`}>
            <input id={`export-scene-${scene.id}`} type="checkbox" checked={sceneIds.includes(scene.id)} onChange={event => {
              setSceneIds(current => event.target.checked ? [...current, scene.id] : current.filter(id => id !== scene.id));
              setOutdated(true);
            }} />
            {scene.name}
          </label>)}
        </fieldset>}
        <label htmlFor="export-template">Vorlage</label>
        <select id="export-template" value={templateId} onChange={event => applyTemplate(event.target.value)}>
          <option value="">Automatischer Satz</option>
          {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        {repairs.map(item => <p key={item.frameId} className="error" role="alert">{item.message}</p>)}
        <label htmlFor="export-kind">Umfang</label>
        <select id="export-kind" value={documentKind} onChange={event => { setDocumentKind(event.target.value as 'scene' | 'package'); setOutdated(true); }}>
          <option value="scene">Diese Szene</option>
          <option value="package">Konstruktionspaket</option>
        </select>
        <label htmlFor="export-preset">Ansichten</label>
        <select id="export-preset" value={preset} onChange={event => { setPreset(event.target.value as 'construction' | 'presentation'); setOutdated(true); }}>
          <option value="construction">Konstruktion</option>
          <option value="presentation">Mit Raumsicht</option>
        </select>
        <label htmlFor="export-paper">Papierformat</label>
        <select id="export-paper" value={paper} onChange={event => { setPaper(event.target.value as 'A4' | 'A3'); setOutdated(true); }}>
          <option value="A4">A4</option>
          <option value="A3">A3</option>
        </select>
        <label htmlFor="export-orientation">Ausrichtung</label>
        <select id="export-orientation" value={orientation} onChange={event => { setOrientation(event.target.value as 'auto' | SheetOrientation); setOutdated(true); }}>
          <option value="auto">Automatisch</option>
          <option value="portrait">Hochformat</option>
          <option value="landscape">Querformat</option>
        </select>
        <label htmlFor="export-scale">Maßstab</label>
        <select id="export-scale" value={String(scale)} onChange={event => { setScale(Number(event.target.value) as 25 | 50 | 100); setOutdated(true); }}>
          <option value="25">1:25</option>
          <option value="50">1:50</option>
          <option value="100">1:100</option>
        </select>
        <LayerToggles idPrefix="export-layer" layers={layers} disabled={readOnly} onChange={next => { setLayers(next); setOutdated(true); }} />
        {customPages && <p className="muted">Eine eigene Blattaufteilung ersetzt Ausschnitt und Raumsichten. Eine Änderung hier stellt die automatische Aufteilung wieder her.</p>}
        <fieldset>
          <legend>Raumsichten</legend>
          {viewCameras.map(view => {
            const frameKey = sceneIds[0] ? viewFrameId(sceneIds[0], view.id) : view.id;
            const captured = !!viewImages[frameKey];
            return <div key={view.id} className="export-view-row">
              <label htmlFor={`view-preset-${view.id}`}>Kamerablick
                <select id={`view-preset-${view.id}`} value={view.preset} onChange={event => {
                  const next = event.target.value as CameraPreset;
                  setViewCameras(current => current.map(item => item.id === view.id ? { ...item, preset: next, label: REPORT_VIEW_LABELS[next] } : item));
                  setActiveViewId(view.id);
                  dropCustomLayout();
                }}>
                  {(Object.keys(REPORT_VIEW_LABELS) as CameraPreset[]).map(presetId => <option key={presetId} value={presetId}>{REPORT_VIEW_LABELS[presetId]}</option>)}
                </select>
              </label>
              <label htmlFor={`view-label-${view.id}`}>Bezeichnung
                <input id={`view-label-${view.id}`} value={view.label} maxLength={80} onChange={event => {
                  setViewCameras(current => current.map(item => item.id === view.id ? { ...item, label: event.target.value } : item));
                  dropCustomLayout();
                }} />
              </label>
              <button type="button" className="quiet" aria-pressed={activeViewId === view.id} onClick={() => setActiveViewId(view.id)}>Ausrichten</button>
              <span className="muted">{captured ? 'Für PDF übernommen' : 'Noch kein Bild'}</span>
              <button type="button" className="quiet" onClick={() => {
                setViewCameras(current => current.filter(item => item.id !== view.id));
                setViewImages(current => {
                  const next = { ...current };
                  delete next[frameKey];
                  return next;
                });
                if (activeViewId === view.id) setActiveViewId(undefined);
                dropCustomLayout();
              }}>Entfernen</button>
            </div>;
          })}
          <button type="button" className="quiet" disabled={viewCameras.length >= 12} onClick={() => {
            const id = crypto.randomUUID();
            setViewCameras(current => [...current, { id, preset: 'orbit', label: REPORT_VIEW_LABELS.orbit }]);
            setActiveViewId(id);
            dropCustomLayout();
          }}>Raumsicht hinzufügen</button>
          {layout && venue && viewCameras.length > 0 && (() => {
            const active = viewCameras.find(view => view.id === activeViewId) ?? viewCameras[0];
            if (!active || !sceneIds[0]) return null;
            const frameKey = viewFrameId(sceneIds[0], active.id);
            return <div className="export-stage-aim" data-testid="export-stage-aim">
              <p className="muted">Kamera ausrichten, dann für das PDF übernehmen.</p>
              <button type="button" data-testid="export-capture-view" disabled={readOnly} onClick={event => {
                event.preventDefault();
                void (async () => {
                  try {
                    const capture = stageCapture.current;
                    if (!capture) {
                      setError('Die Raumsicht ist noch nicht bereit. Bitte kurz warten und erneut versuchen.');
                      return;
                    }
                    const png = await capture.capturePng();
                    if (!png.startsWith('data:image/png') || png.length < 256) {
                      setError('Die Aufnahme ist leer. Bitte Kamera neu ausrichten und erneut versuchen.');
                      return;
                    }
                    setViewImages(current => ({ ...current, [frameKey]: png }));
                    setError('');
                    setOutdated(true);
                  } catch (caught) {
                    setError(caught instanceof Error ? caught.message : 'Die Raumsicht konnte nicht aufgenommen werden.');
                  }
                })();
              }}>Für PDF übernehmen</button>
              <StageView layout={layout} venue={venue} assets={assets} workspaceId={workspaceId}
                onCaptureReady={onCaptureReady} initialView={active.preset} title={active.label || 'Raumsicht'} selectedIds={[]}
                onViewChange={next => {
                  setViewCameras(current => current.map(item => item.id === active.id
                    ? { ...item, preset: next, label: item.label.trim() ? item.label : REPORT_VIEW_LABELS[next] }
                    : item));
                }} />
            </div>;
          })()}
        </fieldset>
        {groups.length > 0 && <fieldset>
          <legend>Frontansichten</legend>
          {groups.map((group, index) => {
            const labels = group.members.filter(member => member.kind === 'wall').map(member => walls.find(wall => wall.id === member.id)?.label ?? 'Wand');
            return <label key={group.id} htmlFor={`elevation-group-${group.id}`}>
              <input id={`elevation-group-${group.id}`} type="checkbox" checked={elevationGroupIds.includes(group.id)} onChange={event => {
                setElevationGroupIds(current => event.target.checked ? [...current, group.id] : current.filter(id => id !== group.id));
                setOutdated(true);
              }} />
              {`Gruppe ${index + 1} · ${labels.join(', ')}`}
            </label>;
          })}
        </fieldset>}
        <button type="button" className="quiet" aria-pressed={editing} onClick={() => setEditing(value => !value)}>Layout bearbeiten</button>
        {editing && customPages && <LayoutEditor pages={customPages} selectedId={selectedFrame} onSelect={setSelectedFrame} onChange={editPages}
          onUndo={() => { const previous = past[past.length - 1]; if (!previous) return; setFuture(current => [customPages, ...current]); setPast(current => current.slice(0, -1)); setCustomPages(previous); }}
          onRedo={() => { const next = future[0]; if (!next) return; setPast(current => [...current, customPages]); setFuture(current => current.slice(1)); setCustomPages(next); }}
          canUndo={past.length > 0} canRedo={future.length > 0} />}
        {editing && selected?.kind === 'view3d' && <div role="group" aria-label="Kamerablick">
          {(['orbit', 'audience', 'top', 'front', 'side'] as const).map(presetId => <button key={presetId} type="button" className="quiet" onClick={() => {
            if (!customPages) return;
            const camera = defaultCamera({ minX: 0, minY: 0, maxX: 8000, maxY: 6000 }, presetId);
            editPages(customPages.map(pageItem => ({ ...pageItem, frames: pageItem.frames.map(frame => frame.id === selected.id ? { ...frame, camera } : frame) })));
          }}>{REPORT_VIEW_LABELS[presetId]} übernehmen</button>)}
        </div>}
        {editing && selected && <FrameNumbers frame={selected} onChange={patch => {
          if (!customPages) return;
          editPages(customPages.map(pageItem => ({ ...pageItem, frames: pageItem.frames.map(frame => frame.id === selected.id ? { ...frame, ...patch } : frame) })));
        }} />}
        {onSaveTemplate && customPages && <button type="button" className="quiet" onClick={() => void onSaveTemplate([{
          id: templateId || crypto.randomUUID(), name: revisionName || 'Vorlage',
          pages: customPages.map(pageItem => ({
            id: pageItem.id, name: pageItem.name, paper: pageItem.paper === 'A3' ? 'a3' as const : 'a4' as const, orientation: pageItem.orientation,
            frames: pageItem.frames.map(frame => ({
              id: frame.id, kind: frame.kind, x: frame.x, y: frame.y, width: frame.width, height: frame.height, rotation: frame.rotation === 90 ? 90 as const : 0 as const,
              scale: frame.scale, crop: frame.crop, label: frame.label, sourceRole: frame.source.role, groupIndex: frame.source.groupIndex, camera: frame.camera,
            })),
          })),
        }])}>Als Vorlage speichern</button>}
        {freezeDisabled && <p className="muted">Bitte speichern Sie ausstehende Änderungen, bevor Sie exportieren.</p>}
        {error && <p className="error" role="alert">{error} <button type="button" className="quiet" onClick={() => { setOutdated(true); setError(''); }}>Erneut versuchen</button></p>}
        <details>
          <summary>Frühere Fassungen</summary>
          <ul className="export-list">{history.map(item => <li key={item.id}>
            <strong>{item.name}</strong>
            <span>{germanDate(item.createdAt)} · {item.paper} · 1:{item.scale} · {statusText[item.status]}</span>
            {item.status === 'ready' && <button className="quiet" type="button" onClick={() => void download(item)}>Herunterladen</button>}
            {!readOnly && <button className="quiet" type="button" onClick={() => void remove(item.id)}>Löschen</button>}
          </li>)}</ul>
          {!history.length && <p className="muted">Noch keine herausgegebenen Fassungen.</p>}
        </details>
      </form>
      <div className="export-workspace-preview">
        {outdated && previewUrl && <p role="status">Vorschau veraltet. Die vorherige Fassung bleibt sichtbar.</p>}
        <div className="export-preview-toolbar">
          <button type="button" className="quiet" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Vorheriges Blatt</button>
          <span>Blatt {page}{pageCount ? ` von ${pageCount}` : ''}</span>
          <button type="button" className="quiet" disabled={!pageCount || page >= pageCount} onClick={() => setPage(value => value + 1)}>Nächstes Blatt</button>
          <button type="button" className="quiet" onClick={() => setZoom(value => value === 'fit' ? 1 : 'fit')}>{zoom === 'fit' ? 'Originalgröße' : 'Seite einpassen'}</button>
          <button type="button" className="quiet" disabled={!previewUrl} onClick={openPdf}>PDF öffnen</button>
          <button type="button" className="quiet" disabled={!previewUrl && !issued} onClick={() => void download(issued)}>Herunterladen</button>
          <button type="button" className="quiet" aria-pressed={thumbs} onClick={() => setThumbs(value => !value)}>Miniaturen</button>
        </div>
        <PdfPreview url={previewUrl} page={page} zoom={zoom} onPage={setPage} />
      </div>
      {thumbs && <ThumbnailRail url={previewUrl} page={page} onPage={setPage} />}
    </div>
  </section>;
}

function orderedBand(start: { x: number; y: number }, end: { x: number; y: number }): FrameCrop {
  return {
    minX: Math.round(Math.min(start.x, end.x)), maxX: Math.round(Math.max(start.x, end.x)),
    minY: Math.round(Math.min(start.y, end.y)), maxY: Math.round(Math.max(start.y, end.y)),
  };
}

function PlanCropBand({ preview, crop, disabled, onChange }: {
  preview: PlanPreviewData; crop?: FrameCrop; disabled?: boolean; onChange: (crop: FrameCrop) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; clientX: number; clientY: number } | undefined>(undefined);
  const [band, setBand] = useState<FrameCrop>();
  const shown = band ?? crop;

  function modelPoint(event: { clientX: number; clientY: number }) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return undefined;
    const value = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: value.x, y: -value.y };
  }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || event.button !== 0) return;
    const start = modelPoint(event);
    if (!start) return;
    drag.current = { ...start, clientX: event.clientX, clientY: event.clientY };
    setBand(orderedBand(start, start));
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const start = drag.current;
    if (!start) return;
    const end = modelPoint(event);
    if (end) setBand(orderedBand(start, end));
  }

  function pointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const start = drag.current;
    drag.current = undefined;
    setBand(undefined);
    if (!start || disabled) return;
    const moved = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
    const end = modelPoint(event);
    if (!end || moved < 6) return;
    const next = orderedBand(start, end);
    if (next.maxX - next.minX < 1 || next.maxY - next.minY < 1) return;
    onChange(next);
  }

  const originX = preview.originX ?? 0;
  const originY = preview.originY ?? 0;
  return <svg ref={svg} className="export-plan-band" data-testid="export-plan-band" role="img" aria-label="Gesamter Grundriss, Rechteck ziehen für den Ausschnitt"
    viewBox={bandViewBox(preview)} preserveAspectRatio="xMidYMid meet"
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
    onPointerCancel={() => { drag.current = undefined; setBand(undefined); }}>
    <rect x={originX} y={-(originY + preview.depth)} width={preview.width} height={preview.depth} className="plan-preview-floor" />
    {preview.platforms.map((platform, index) =>
      <polygon key={`p-${index}`} className="plan-preview-platform" points={platform.outline.map(point => `${point.x},${-point.y}`).join(' ')} />)}
    {preview.walls.map((wall, index) =>
      <polygon key={`w-${index}`} className="plan-preview-wall" points={wall.corners.map(point => `${point.x},${-point.y}`).join(' ')} />)}
    {shown && <rect data-testid="export-plan-crop" className="selection-marquee"
      x={shown.minX} y={-shown.maxY} width={shown.maxX - shown.minX} height={shown.maxY - shown.minY} />}
  </svg>;
}

function bandViewBox(preview: PlanPreviewData) {
  const originX = preview.originX ?? 0;
  const originY = preview.originY ?? 0;
  const pad = Math.max(preview.width, preview.depth) * 0.04;
  return `${originX - pad} ${-(originY + preview.depth) - pad} ${preview.width + pad * 2} ${preview.depth + pad * 2}`;
}

function LayoutEditor({ pages, selectedId, onSelect, onChange, onUndo, onRedo, canUndo, canRedo }: {
  pages: DocumentPage[]; selectedId?: string; onSelect: (id: string) => void; onChange: (pages: DocumentPage[]) => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
}) {
  function add(kind: DocumentFrame['kind']) {
    const pageItem = pages[0];
    if (!pageItem) return;
    const frame: DocumentFrame = {
      id: crypto.randomUUID(), kind, x: 20, y: 40, width: 80, height: 60, rotation: 0,
      source: { role: 'primary' }, scale: kind === 'view3d' || kind === 'notes' || kind === 'schedule' ? undefined : 50,
    };
    onChange(pages.map((item, index) => index === 0 ? { ...item, frames: [...item.frames, frame] } : item));
    onSelect(frame.id);
  }
  return <div className="export-layout-editor" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'z') { event.preventDefault(); event.shiftKey ? onRedo() : onUndo(); }
  }}>
    <button type="button" className="quiet" disabled={!canUndo} onClick={onUndo}>Rückgängig</button>
    <button type="button" className="quiet" disabled={!canRedo} onClick={onRedo}>Wiederholen</button>
    <button type="button" className="quiet" onClick={() => add('plan')}>Grundriss</button>
    <button type="button" className="quiet" onClick={() => add('elevation')}>Ansicht</button>
    <button type="button" className="quiet" onClick={() => add('view3d')}>Raumsicht</button>
    <button type="button" className="quiet" onClick={() => add('notes')}>Hinweise</button>
    <button type="button" className="quiet" onClick={() => add('schedule')}>Stückliste</button>
    <ul>{pages.flatMap(pageItem => pageItem.frames).map(frame => <li key={frame.id}>
      <button type="button" className="quiet" aria-pressed={frame.id === selectedId} onClick={() => onSelect(frame.id)}>{frame.kind}</button>
      <button type="button" className="quiet" onClick={() => onChange(pages.map(pageItem => ({ ...pageItem, frames: pageItem.frames.filter(item => item.id !== frame.id) })))}>Löschen</button>
    </li>)}</ul>
  </div>;
}

function FrameNumbers({ frame, onChange }: { frame: DocumentFrame; onChange: (patch: Partial<DocumentFrame>) => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const step = event.shiftKey ? 10 : 1;
      const patch = event.key === 'ArrowLeft' ? { x: frame.x - step } : event.key === 'ArrowRight' ? { x: frame.x + step }
        : event.key === 'ArrowUp' ? { y: frame.y - step } : event.key === 'ArrowDown' ? { y: frame.y + step } : undefined;
      if (!patch) return;
      event.preventDefault();
      onChange(patch);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frame, onChange]);
  return <div className="export-frame-numbers">
    {(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key}
      <input aria-label={key} type="number" value={frame[key]} onChange={event => onChange({ [key]: Number(event.target.value) })} />
    </label>)}
    <label>Drehung
      <input aria-label="Drehung" type="number" value={frame.rotation} onChange={event => onChange({ rotation: Number(event.target.value) as 0 | 90 | 180 | 270 })} />
    </label>
  </div>;
}

function PdfPreview({ url, page, zoom, onPage }: { url?: string; page: number; zoom: 'fit' | number; onPage: (page: number) => void }) {
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!url || !layer) return;
    let cancelled = false;
    const canvas = document.createElement('canvas');
    layer.replaceChildren(canvas);
    void (async () => {
      const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const pdf = await pdfjs.getDocument({ url }).promise;
      if (cancelled) { await pdf.cleanup(); return; }
      const pdfPage = await pdf.getPage(Math.min(page, pdf.numPages));
      const base = pdfPage.getViewport({ scale: 1 });
      const fit = Math.min((layer.clientWidth || 640) / base.width, (layer.clientHeight || 800) / base.height);
      const viewport = pdfPage.getViewport({ scale: zoom === 'fit' ? fit : zoom });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const canvasContext = canvas.getContext('2d');
      if (!canvasContext) return;
      await pdfPage.render({ canvas, canvasContext, viewport }).promise;
      const text = document.createElement('div');
      text.className = 'export-text-layer';
      const content = await pdfPage.getTextContent();
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue;
        const span = document.createElement('span');
        span.textContent = item.str;
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        span.style.left = `${transform[4]}px`;
        span.style.top = `${transform[5] - item.height}px`;
        span.style.fontSize = `${item.height}px`;
        text.append(span);
      }
      const annotations = await pdfPage.getAnnotations();
      for (const note of annotations) {
        if (note.subtype !== 'Link' || !note.rect) continue;
        const left = Math.min(note.rect[0] ?? 0, note.rect[2] ?? 0) * viewport.scale;
        const width = Math.abs((note.rect[2] ?? 0) - (note.rect[0] ?? 0)) * viewport.scale;
        const height = Math.abs((note.rect[3] ?? 0) - (note.rect[1] ?? 0)) * viewport.scale;
        const top = viewport.height - Math.max(note.rect[1] ?? 0, note.rect[3] ?? 0) * viewport.scale;
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'export-pdf-link';
        link.style.left = `${left}px`;
        link.style.top = `${top}px`;
        link.style.width = `${width}px`;
        link.style.height = `${height}px`;
        const dest = typeof note.dest === 'string' ? note.dest : '';
        const match = /blatt-(\d+)/.exec(dest);
        if (match) link.addEventListener('click', () => onPage(Number(match[1])));
        text.append(link);
      }
      if (!cancelled) layer.append(text);
      await pdf.cleanup();
    })();
    return () => { cancelled = true; };
  }, [url, page, zoom, layer, onPage]);
  return <div className={`export-sheet-stage zoom-${zoom === 'fit' ? 'fit' : 'actual'}`} ref={setLayer} role="region" aria-label="Blattvorschau" />;
}

function ThumbnailRail({ url, page, onPage }: { url?: string; page: number; onPage: (page: number) => void }) {
  const [count, setCount] = useState(0);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!url || !host) return;
    let cancelled = false;
    host.replaceChildren();
    void (async () => {
      const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const pdf = await pdfjs.getDocument({ url }).promise;
      if (cancelled) { await pdf.cleanup(); return; }
      setCount(pdf.numPages);
      for (let index = 1; index <= pdf.numPages; index++) {
        const pdfPage = await pdf.getPage(index);
        const viewport = pdfPage.getViewport({ scale: 0.2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const canvasContext = canvas.getContext('2d');
        if (!canvasContext) continue;
        await pdfPage.render({ canvas, canvasContext, viewport }).promise;
        const button = document.createElement('button');
        button.type = 'button';
        button.append(canvas);
        button.addEventListener('click', () => onPage(index));
        button.setAttribute('aria-current', index === page ? 'true' : 'false');
        button.setAttribute('aria-label', `Blatt ${index}`);
        if (!cancelled) host.append(button);
      }
      await pdf.cleanup();
    })();
    return () => { cancelled = true; };
  }, [url, host, page, onPage]);
  return <div className="export-thumb-rail" ref={setHost} aria-label="Blätter" data-count={count} />;
}
