import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent, type WheelEvent } from 'react';
import { z } from 'zod';
import { ApiError, request } from '../api.js';
import { askPrompt } from '../ConfirmDialog.js';
import { listStockItems } from '../partsApi.js';
import type { StockItem } from '../../shared/parts/catalog.js';
import { STARTER_PART_IDS } from '../../shared/parts/starter/index.js';
import { AUDIENCE_FLOOR_ID, supportingSurfaces } from '../../shared/levels.js';
import { execute, history, redo, undo, type History } from '../../shared/history.js';
import type { Layout, LayoutObject, Scene, VenueGeometry } from '../../shared/layout.js';
import { resolveLayoutObjectDetails } from '../../shared/layoutObjects.js';
import { resolvedObjectOverlapWarnings, overlappingResolvedObjectIds } from '../../shared/overlap.js';
import { resolvedKeepClearWarnings } from '../../shared/keepClear.js';
import { resolvedOverheadClearance } from '../../shared/overhead.js';
import { snapObjectConnectors } from '../../shared/snapping.js';
import { copySelection, cutSelection, pasteClipboard, removeSelection, type ClipboardMember, type LayoutClipboard } from '../../shared/clipboard.js';
import { canFormGroup, formGroup, groupContaining, ungroup } from '../../shared/groups.js';
import { membersInBounds, normalizeBounds } from '../../shared/selection.js';
import { defaultPlanDisplay, type PlanDisplayOptions } from '../../shared/planDisplay.js';
import { Autosave, SaveConflict } from './autosave.js';
import { EditorDock, EditorDockContext, useEditorDock } from './EditorDock.js';
import { EditorMenu } from './EditorMenu.js';
import { EditorMenuBar } from './EditorMenuBar.js';
import { PlanDisplayToggles } from './PlanDisplayToggles.js';
import { PlanObjects, PlanVenue } from './PlanDrawingLayers.js';
import { GroupInspector } from './GroupInspector.js';
import { PartInspector } from './PartInspector.js';
import { StageView } from './StageView.js';
import { InfrastructureMarks, VenuePanel } from './VenuePanel.js';
import { PlatformLayer } from './PlatformLayer.js';
import { CableRunMarks } from './CableRuns.js';
import { CurtainMarks, OverheadMarks, TrussMarks } from './VenueOverhead.js';
import { KeepClearMarks } from './KeepClearZones.js';
import { CentrelineMark } from './SnapGuides.js';
import { MeasureLayer } from './MeasureLayer.js';
import { DimensionLayer } from './DimensionLayer.js';
import { RecipientDocumentWorkspace } from './RecipientDocumentWorkspace.js';
import { downloadExchangeFile } from './exchangeDownload.js';
import type { ExchangeFormat } from '../../shared/exchange/formats.js';
import { SurfaceRegistryPanel } from './SurfaceRegistryPanel.js';
import { SurfaceRegistryProvider } from './SurfaceRegistryContext.js';
import { ToolIcon } from './ToolIcon.js';
import { useEditingLease } from './useEditingLease.js';
import { useLayoutParts } from './useLayoutParts.js';
import { adjustPendingCount } from './usePendingApplyForm.js';
import { effectiveCurtains } from '../../shared/venueFixtures.js';
import { resolveDimension } from '../../shared/dimensions.js';
import { useFeedbackAdapter } from '../feedback/Feedback.js';
import { captureWorkView } from '../feedback/capture.js';
import { recordFeedbackActivity } from '../feedback/activity.js';
import type { StageCaptureHandle } from './StageCapture.js';

const statusText = {
  saved: 'Gespeichert',
  pending: 'Änderungen ausstehend …',
  saving: 'Speichert …',
  failed: 'Speichern fehlgeschlagen',
  conflict: 'Neuere Fassung vorhanden',
} as const;

type InsertChoice = { partId: string; revision: number; label: string; variant?: string };
type DragState = {
  start: Layout;
  ids: string[];
  point: { x: number; y: number };
  latest: Layout;
};
type MarqueeState = {
  start: { x: number; y: number };
  current: { x: number; y: number };
  additive: boolean;
};

function uniqueRefs(layout: Layout) {
  return [...new Map(layout.objects.map(object => [`${object.part.id}@${object.part.revision}`, object.part])).values()];
}

export function Editor({ initial, workspaceId, readOnly: permissionReadOnly, canRename = false, onClose, onDirty, onRequestEditing }: {
  initial: Scene;
  workspaceId: string;
  readOnly: boolean;
  canRename?: boolean;
  onClose: () => void;
  onDirty: (value: boolean) => void;
  onRequestEditing?: () => void;
}) {
  const [state, setState] = useState<History<Layout>>(() => history(initial.layout));
  const [preview, setPreview] = useState<Layout>();
  const shown = preview ?? state.present;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<LayoutClipboard>();
  const [insertChoice, setInsertChoice] = useState<InsertChoice>();
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [sceneName, setSceneName] = useState(initial.name);
  const [venue, setVenue] = useState<VenueGeometry>(initial.venue);
  const [venueName, setVenueName] = useState(initial.venueName);
  const [venueVersionId, setVenueVersionId] = useState(initial.venueVersionId);
  const [venueUpdateAvailable, setVenueUpdateAvailable] = useState(!!initial.venueUpdateAvailable);
  const [venueOpen, setVenueOpen] = useState(false);
  const [venueDirty, setVenueDirty] = useState(false);
  const [exportsOpen, setExportsOpen] = useState(false);
  const [view, setView] = useState<'plan' | 'stage' | 'split'>('plan');
  const [planDisplay, setPlanDisplay] = useState<PlanDisplayOptions>(defaultPlanDisplay);
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [catalogMessage, setCatalogMessage] = useState('');
  const [pendingForms, setPendingForms] = useState(0);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recovering, setRecovering] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const feedbackCapture = useRef<StageCaptureHandle | null>(null);
  const setFeedbackCapture = useCallback((handle: StageCaptureHandle | null) => { feedbackCapture.current = handle; }, []);
  const drag = useRef<DragState | undefined>(undefined);
  const marquee = useRef<MarqueeState | undefined>(undefined);
  const [marqueePreview, setMarqueePreview] = useState<MarqueeState>();
  const dock = useEditorDock('scene');
  const catalog = useLayoutParts(workspaceId, shown);
  const supports = useMemo(() => supportingSurfaces(venue), [venue]);
  const supportElevations = useMemo(
    () => new Map(supports.map(surface => [surface.id, surface.elevation])),
    [supports],
  );
  const resolution = useMemo(
    () => resolveLayoutObjectDetails(shown, catalog.index, { supportElevations }),
    [shown, catalog.index, supportElevations],
  );
  const objects = resolution.objects;
  const selected = objects.find(object => object.object.id === selectedIds[0]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedMembers = selectedIds.map(id => ({ kind: 'object' as const, id }));
  const selectedGroup = selectedMembers[0] ? groupContaining(shown, selectedMembers[0]) : undefined;
  const overlapWarnings = useMemo(() => resolvedObjectOverlapWarnings(objects), [objects]);
  const overlapIds = useMemo(() => overlappingResolvedObjectIds(objects), [objects]);
  const keepClear = useMemo(() => resolvedKeepClearWarnings(venue, objects), [venue, objects]);
  const overhead = useMemo(() => resolvedOverheadClearance(objects, venue), [objects, venue]);
  const sceneCurtains = useMemo(() => effectiveCurtains(venue, shown), [venue, shown]);
  const resolvedDimensions = useMemo(() => (shown.dimensions ?? []).flatMap(dimension => {
    const resolved = resolveDimension(dimension, venue, shown, objects);
    return resolved ? [resolved] : [];
  }), [shown, venue, objects]);
  const latestById = useMemo(() => new Map(catalog.summaries.map(part => [part.id, part.latestRevision])), [catalog.summaries]);
  const summaryById = useMemo(() => new Map(catalog.summaries.map(part => [part.id, part])), [catalog.summaries]);
  const supportOptions = useMemo(() => [
    ...supports.map(surface => ({ id: surface.id, label: surface.label })),
    ...objects.filter(object => object.resolved.surfaces.length > 0).map(object => ({ id: object.object.id, label: `${object.object.label} · Bauteilfläche` })),
  ], [supports, objects]);

  const [saver] = useState(() => new Autosave(initial.layout, initial.revision, async (layout, revision) => {
    try {
      const result = await request(`/api/workspaces/${workspaceId}/scenes/${initial.id}/layout`, {
        revision,
        layout,
      }, 'PUT');
      return z.object({ revision: z.number().int() }).parse(result).revision;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 423)) {
        throw new SaveConflict(error.status === 423 ? 'lease' : 'revision');
      }
      throw error;
    }
  }));
  const saveState = useSyncExternalStore(saver.subscribe, saver.getSnapshot);
  const readOnly = permissionReadOnly || saveState.status === 'conflict';
  const exchangeBlocked = saveState.dirty || venueDirty || pendingForms > 0;
  const sceneLease = useEditingLease(`/api/workspaces/${workspaceId}/scenes/${initial.id}`, !permissionReadOnly);

  useEffect(() => { recordFeedbackActivity({ action: `save.${saveState.status}`, area: 'plans' }); }, [saveState.status]);
  useEffect(() => {
    if (!permissionReadOnly) void sceneLease.acquire();
  }, [permissionReadOnly]);
  useEffect(() => {
    let active = true;
    void listStockItems(workspaceId).then(items => { if (active) setStockItems(items); }).catch(() => {});
    return () => { active = false; };
  }, [workspaceId]);
  useEffect(() => () => saver.dispose(), [saver]);
  useEffect(() => { onDirty(saveState.dirty || venueDirty || pendingForms > 0); }, [saveState.dirty, venueDirty, pendingForms, onDirty]);
  useEffect(() => {
    setSelectedIds(ids => ids.filter(id => state.present.objects.some(object => object.id === id)));
  }, [state.present.objects]);

  function commit(layout: Layout) {
    setPreview(undefined);
    setState(current => execute(current, layout));
    saver.queue(layout);
    recordFeedbackActivity({ action: 'editor.change', area: 'plans' });
  }
  function commitObject(object: LayoutObject) {
    commit({ ...state.present, objects: state.present.objects.map(item => item.id === object.id ? object : item) });
  }
  function removeSelected() {
    if (readOnly || !selectedIds.length) return;
    commit(removeSelection(state.present, selectedIds.map(id => ({ kind: 'object', id }))));
    setSelectedIds([]);
  }
  function performUndo() {
    const next = undo(state);
    setState(next);
    saver.queue(next.present);
    setSelectedIds([]);
    recordFeedbackActivity({ action: 'editor.undo', area: 'plans' });
  }
  function performRedo() {
    const next = redo(state);
    setState(next);
    saver.queue(next.present);
    setSelectedIds([]);
    recordFeedbackActivity({ action: 'editor.redo', area: 'plans' });
  }
  function planPoint(event: Pick<PointerEvent<SVGSVGElement | SVGGElement>, 'clientX' | 'clientY'>) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: venue.width / 2, y: venue.depth / 2 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: -point.y };
  }
  function beginObjectDrag(event: PointerEvent<SVGGElement>, object: (typeof objects)[number]) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const group = groupContaining(shown, { kind: 'object', id: object.object.id });
    const targetIds = group?.members.map(member => member.id) ?? [object.object.id];
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const allSelected = targetIds.every(id => selectedIds.includes(id));
    const ids = additive
      ? allSelected ? selectedIds.filter(id => !targetIds.includes(id)) : [...new Set([...selectedIds, ...targetIds])]
      : selectedIds.includes(object.object.id) ? selectedIds : targetIds;
    setSelectedIds(ids);
    if (readOnly || (additive && allSelected)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: state.present, ids, point: planPoint(event), latest: state.present };
  }
  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    const point = planPoint(event);
    if (!current) {
      const box = marquee.current;
      if (box) {
        box.current = point;
        setMarqueePreview({ ...box });
      }
      return;
    }
    const dx = point.x - current.point.x, dy = point.y - current.point.y;
    const ids = new Set(current.ids);
    const latest = {
      ...current.start,
      objects: current.start.objects.map(object => ids.has(object.id)
        ? { ...object, x: object.x + dx, y: object.y + dy }
        : object),
    };
    current.latest = latest;
    setPreview(latest);
  }
  function endDrag(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current) {
      const box = marquee.current;
      if (!box) return;
      marquee.current = undefined;
      setMarqueePreview(undefined);
      const point = planPoint(event);
      const moved = Math.hypot(point.x - box.start.x, point.y - box.start.y) > 10;
      if (!moved) {
        if (!box.additive) setSelectedIds([]);
        return;
      }
      const hits = membersInBounds(objects, normalizeBounds(box.start, point)).flatMap(member => {
        const group = groupContaining(shown, member);
        return group?.members.map(item => item.id) ?? [member.id];
      });
      setSelectedIds(currentIds => box.additive
        ? [...new Set([...currentIds, ...hits])]
        : [...new Set(hits)]);
      return;
    }
    drag.current = undefined;
    const point = planPoint(event);
    if (Math.hypot(point.x - current.point.x, point.y - current.point.y) <= 1) {
      setPreview(undefined);
      return;
    }
    let latest = current.latest;
    if (current.ids.length === 1 && !event.altKey) {
      const details = resolveLayoutObjectDetails(latest, catalog.index, { supportElevations });
      const moving = details.byId.get(current.ids[0]!);
      if (moving) {
        const snap = snapObjectConnectors(moving, details.objects);
        if (snap.guides.length) {
          latest = {
            ...latest,
            objects: latest.objects.map(object => object.id === moving.object.id ? { ...object, x: snap.x, y: snap.y } : object),
            ...(snap.connection?.targetObject ? {
              joints: [
                ...latest.joints.filter(joint => !(joint.a.object === moving.object.id && joint.a.connector === snap.connection!.moving)),
                {
                  id: crypto.randomUUID(),
                  a: { object: moving.object.id, connector: snap.connection.moving },
                  b: { object: snap.connection.targetObject, connector: snap.connection.target },
                },
              ],
            } : {}),
          };
        }
      }
    }
    commit(latest);
  }
  function chooseInsert(choice: InsertChoice) {
    if (readOnly) return;
    setInsertChoice(choice);
    dock.closeAfterPlacement();
  }
  function placeAt(point: { x: number; y: number }) {
    if (!insertChoice || readOnly) return;
    const object: LayoutObject = {
      id: crypto.randomUUID(),
      label: insertChoice.label,
      part: { id: insertChoice.partId, revision: insertChoice.revision },
      ...(insertChoice.variant ? { variant: insertChoice.variant } : {}),
      x: Math.max(-100000, Math.min(100000, point.x)),
      y: Math.max(-100000, Math.min(100000, point.y)),
      rotation: 0,
      support: AUDIENCE_FLOOR_ID,
    };
    commit({ ...state.present, objects: [...state.present.objects, object] });
    setSelectedIds([object.id]);
    setInsertChoice(undefined);
  }
  function backgroundPointer(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    if (insertChoice) {
      placeAt(planPoint(event));
      return;
    }
    const point = planPoint(event);
    const box = { start: point, current: point, additive: event.shiftKey || event.ctrlKey || event.metaKey };
    marquee.current = box;
    setMarqueePreview(box);
  }
  function copy() {
    const copied = copySelection(state.present, selectedIds.map(id => ({ kind: 'object', id })));
    if (copied) setClipboard(copied);
  }
  function cut() {
    if (readOnly) return;
    const result = cutSelection(state.present, selectedIds.map(id => ({ kind: 'object', id })));
    if (result.clipboard) setClipboard(result.clipboard);
    commit(result.layout);
    setSelectedIds([]);
  }
  function paste() {
    if (readOnly || !clipboard) return;
    const result = pasteClipboard(state.present, clipboard, () => crypto.randomUUID(), { x: 200, y: 200 });
    commit(result.layout);
    setSelectedIds(result.pasted.map(member => member.id));
    if (result.consumed) setClipboard(undefined);
  }
  async function renameScene() {
    const next = await askPrompt({
      title: 'Bühnenbild umbenennen',
      inputLabel: 'Name des Bühnenbilds',
      defaultValue: sceneName,
      confirmLabel: 'Umbenennen',
    });
    if (!next || next === sceneName) return;
    try {
      const result = await request(`/api/workspaces/${workspaceId}/scenes/${initial.id}`, { name: next }, 'PATCH');
      setSceneName(z.object({ name: z.string() }).parse(result).name);
    } catch {
      setCatalogMessage('Der Name konnte nicht gespeichert werden.');
    }
  }
  async function exportExchange(format: ExchangeFormat) {
    setCatalogMessage('');
    try {
      await downloadExchangeFile(workspaceId, initial.id, sceneName, format);
    } catch (error) {
      setCatalogMessage(error instanceof ApiError ? error.message : 'Der Export konnte nicht erstellt werden.');
    }
  }
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([
      JSON.stringify({ ...initial, name: sceneName, revision: saveState.revision, layout: state.present }, null, 2),
    ], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `buehnenentwurf-${initial.id}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function recoverDraft() {
    const name = await askPrompt({
      title: 'Entwurf als Bühnenbildvorlage sichern',
      message: 'Unter diesem Namen erscheint die Vorlage in der Übersicht.',
      defaultValue: `${sceneName} – gesicherter Entwurf`,
      inputLabel: 'Name der Bühnenbildvorlage',
      confirmLabel: 'Sichern',
    });
    if (!name) return;
    setRecovering(true);
    setRecoveryMessage('');
    try {
      await request(`/api/workspaces/${workspaceId}/scenes/${initial.id}/recover`, {
        name,
        layout: state.present,
        sourceSurfaces: (venue.platforms ?? []).map(({ id, label }) => ({ id, label })),
      });
      setRecoveryMessage('Entwurf als Bühnenbildvorlage gesichert. Sie finden ihn in der Übersicht.');
    } catch (error) {
      setRecoveryMessage(error instanceof ApiError ? error.message : 'Entwurf konnte nicht gesichert werden. Bitte herunterladen.');
    } finally {
      setRecovering(false);
    }
  }

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) performRedo(); else performUndo();
      } else if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault(); performRedo();
      } else if (modifier && event.key.toLowerCase() === 'c') {
        event.preventDefault(); copy();
      } else if (modifier && event.key.toLowerCase() === 'x') {
        event.preventDefault(); cut();
      } else if (modifier && event.key.toLowerCase() === 'v') {
        event.preventDefault(); paste();
      } else if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault(); saver.saveNow();
      } else if (modifier && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        const members = selectedIds.map(id => ({ kind: 'object' as const, id }));
        const group = members[0] ? groupContaining(state.present, members[0]) : undefined;
        if (group) commit(ungroup(state.present, group.id));
        else if (canFormGroup(state.present, members)) commit(formGroup(state.present, members, crypto.randomUUID()));
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault(); removeSelected();
      } else if (event.key === 'Escape') {
        setInsertChoice(undefined); setSelectedIds([]); setPreview(undefined); drag.current = undefined;
        marquee.current = undefined; setMarqueePreview(undefined);
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  const essentialIds = new Set<string>(Object.values(STARTER_PART_IDS));
  const essentials = catalog.summaries.filter(part => !part.archived && (part.favourite || essentialIds.has(part.id)));
  const allParts = catalog.summaries.filter(part => !part.archived);
  const toolChoices: InsertChoice[] = essentials.flatMap(part => part.variants.length
    ? part.variants.map(variant => ({ partId: part.id, revision: part.latestRevision, label: `${part.name} · ${variant.label}`, variant: variant.key }))
    : [{ partId: part.id, revision: part.latestRevision, label: part.name }]);
  const viewWidth = venue.width / viewZoom;
  const viewHeight = venue.depth / viewZoom;
  const viewCx = venue.width / 2 + viewPan.x;
  const viewCy = venue.depth / 2 + viewPan.y;
  function wheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    if (event.ctrlKey) setViewZoom(value => Math.max(0.25, Math.min(8, value * Math.exp(-event.deltaY * 0.002))));
    else setViewPan(value => ({ x: value.x + event.deltaX / viewZoom, y: value.y + event.deltaY / viewZoom }));
  }

  useFeedbackAdapter(() => ({
    work: {
      productionId: initial.productionId, sceneId: initial.id, venueId: initial.venueId,
      production: initial.productionName, layout: sceneName, venue: venueName,
      revision: saveState.revision, venueVersionId, view,
      tool: insertChoice ? 'place-part' : 'select', saveStatus: saveState.status,
      dirty: saveState.dirty, unappliedInputs: pendingForms > 0, readOnly,
      selection: selectedIds.slice(0, 200),
      display: { ...planDisplay, zoom: viewZoom, panX: viewPan.x, panY: viewPan.y, panel: dock.active ?? '' },
    },
    snapshot: JSON.stringify({ version: 1, kind: 'layout', layout: state.present, venue }),
    capture: exportsOpen ? undefined : () => captureWorkView(view, svg.current, feedbackCapture.current),
  }), 2);

  if (venueOpen) {
    return <section className="editor scene-editor"><VenuePanel workspaceId={workspaceId} sceneId={initial.id} venue={venue} venueId={initial.venueId}
      venueName={venueName} venueUpdateAvailable={venueUpdateAvailable} readOnly={readOnly}
      sceneLayout={state.present} onDirty={setVenueDirty} onClose={() => setVenueOpen(false)}
      onVenueRenamed={update => { setVenueName(update.name); setVenueVersionId(update.venueVersionId); }}
      onSaved={result => {
        setVenue(result.venue);
        setVenueVersionId(result.venueVersionId ?? venueVersionId);
        setVenueUpdateAvailable(result.venueUpdateAvailable);
        setState(history(result.layout));
        saver.adopt(result.layout, result.revision);
        setVenueDirty(false);
      }} /></section>;
  }
  if (exportsOpen) {
    return <section className="editor scene-editor"><RecipientDocumentWorkspace workspaceId={workspaceId} productionId={initial.productionId}
      seedSceneId={initial.id} seedVenueId={initial.venueId}
      liveScene={{ ...initial, name: sceneName, venueName, venueVersionId, venue, layout: state.present, revision: saveState.revision }}
      freezeDisabled={saveState.dirty} onClose={() => setExportsOpen(false)} /></section>;
  }

  const plan = <div className="plan-workspace">
    <div className="plan-canvas"><svg ref={svg} data-testid="plan-canvas" role="img" aria-label="Grundriss der Spielstätte"
      viewBox={`${viewCx - viewWidth / 2} ${-(viewCy + viewHeight / 2)} ${viewWidth} ${viewHeight}`}
      onWheel={wheel} onPointerDown={backgroundPointer} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <defs><pattern id="metre-grid" width="1000" height="1000" patternUnits="userSpaceOnUse">
        <path d="M 1000 0 L 0 0 0 1000" fill="none" stroke="#d8dfd2" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </pattern></defs>
      <PlanVenue venue={venue} shown={shown} readOnly={readOnly} planDisplay={planDisplay} />
      <PlatformLayer venuePlatforms={venue.platforms ?? []} layoutPlatforms={[]}
        venueStairs={venue.stairs ?? []} layoutStairs={[]} readOnly display={planDisplay}
        onSelect={() => {}} />
      <PlanObjects objects={objects} selectedIds={selectedSet} overlapIds={overlapIds} readOnly={readOnly}
        planDisplay={planDisplay} start={beginObjectDrag} />
      <InfrastructureMarks pins={venue.connectionPoints ?? []} corridors={venue.cableRoutingCorridors ?? []} display={planDisplay} />
      <CableRunMarks runs={shown.cableRuns ?? []} readOnly />
      <OverheadMarks boxes={venue.overheadBoxes ?? []} display={planDisplay} />
      <TrussMarks trusses={venue.trusses ?? []} display={planDisplay} hangPlan={venue.hangPlan} />
      <CurtainMarks curtains={sceneCurtains} display={planDisplay} />
      <KeepClearMarks zones={venue.keepClearZones ?? []} display={planDisplay} />
      <CentrelineMark centreline={venue.stageCentreline} showLabel={planDisplay.showTexts} />
      <MeasureLayer lines={shown.measureLines ?? []} />
      <DimensionLayer dimensions={resolvedDimensions} />
      {marqueePreview && (() => {
        const box = normalizeBounds(marqueePreview.start, marqueePreview.current);
        return <rect data-testid="selection-marquee" className="selection-marquee"
          x={box.minX} y={-box.maxY} width={box.maxX - box.minX} height={box.maxY - box.minY}
          pointerEvents="none" vectorEffect="non-scaling-stroke" />;
      })()}
    </svg></div>
    {insertChoice && <p className="plan-placement-hint" role="status">„{insertChoice.label}“: Position im Grundriss anklicken · Escape bricht ab.</p>}
    <div className="plan-status" aria-live="polite">
      {catalog.error && <p className="warning">{catalog.error}</p>}
      {resolution.issues.map(issue => <p key={`${issue.kind}-${issue.objectId}-${issue.message}`} className="warning">{issue.message}</p>)}
      {overlapWarnings.map(warning => <p key={`${warning.aId}-${warning.bId}`} className="warning" data-testid="object-overlap">{warning.message}</p>)}
      {keepClear.map(warning => <p key={`${warning.zoneId}-${warning.objectId}`} className="warning">{warning.message}</p>)}
      {overhead.map(warning => <p key={`${warning.kind}-${warning.objectId}-${warning.obstructionId ?? ''}`} className="warning">{warning.message}</p>)}
    </div>
  </div>;

  const stage = <StageView layout={shown} venue={venue} workspaceId={workspaceId} selectedIds={selectedIds}
    onFeedbackCaptureReady={setFeedbackCapture}
    onSelect={(id, additive) => setSelectedIds(current => additive ? [...new Set([...current, id])] : [id])}
    onClearSelection={() => setSelectedIds([])}
    onLightingChange={readOnly ? undefined : lighting => commit({ ...state.present, lighting })}
    onLightLooksChange={readOnly ? undefined : patch => commit({ ...state.present, ...patch })} />;

  return <SurfaceRegistryProvider workspaceId={workspaceId} productionId={initial.productionId}>
    <EditorDockContext value={dock}>
      <section className="editor editor-shell scene-editor">
        <EditorMenuBar>
          <EditorMenu label="Datei">
            <button type="button" onClick={() => setExportsOpen(true)}>Ausgabe erstellen</button>
            <button type="button" data-testid="export-gltf" disabled={exchangeBlocked} title={exchangeBlocked ? 'Erst speichern, dann exportieren.' : 'Bühnenbild und Spielstätte als glTF-Datei (.glb) für Visualisierungen'}
              onClick={() => void exportExchange('gltf')}>Export als glTF (.glb)</button>
            <button type="button" data-testid="export-mvr" disabled={exchangeBlocked} title={exchangeBlocked ? 'Erst speichern, dann exportieren.' : 'Bühnenbild als MVR-Datei (DIN SPEC 15801) für Lichtpulte und Visualisierer'}
              onClick={() => void exportExchange('mvr')}>Export als MVR</button>
            <button type="button" onClick={onClose}>Bühnenbild schließen</button>
          </EditorMenu>
          <EditorMenu label="Bearbeiten">
            <button type="button" disabled={readOnly || !state.past.length} onClick={performUndo}>Rückgängig</button>
            <button type="button" disabled={readOnly || !state.future.length} onClick={performRedo}>Wiederholen</button>
            <button type="button" disabled={!selectedIds.length} onClick={copy}>Kopieren</button>
            <button type="button" disabled={readOnly || !selectedIds.length} onClick={cut}>Ausschneiden</button>
            <button type="button" disabled={readOnly || !clipboard} onClick={paste}>Einfügen</button>
            <button type="button" disabled={readOnly || !selectedIds.length} onClick={removeSelected}>Löschen</button>
            <button type="button" disabled={readOnly || !canFormGroup(state.present, selectedMembers)}
              onClick={() => commit(formGroup(state.present, selectedMembers, crypto.randomUUID()))}>Gruppieren</button>
            <button type="button" disabled={readOnly || !selectedGroup}
              onClick={() => selectedGroup && commit(ungroup(state.present, selectedGroup.id))}>Gruppe auflösen</button>
          </EditorMenu>
          <EditorMenu label="Ansicht">
            <button type="button" onClick={() => setView('plan')}>Grundriss</button>
            <button type="button" onClick={() => setView('stage')}>Raumsicht</button>
            <button type="button" onClick={() => setView('split')}>Geteilt</button>
            <button type="button" onClick={() => setVenueOpen(true)}>Spielstätte bearbeiten</button>
          </EditorMenu>
        </EditorMenuBar>
        <header className="editor-toolbar editor-heading compact-editor-heading">
          <button type="button" className="quiet back-button" onClick={onClose} aria-label="Zur Übersicht">←</button>
          <div><h2>{sceneName}</h2><p className="muted scene-context">{initial.productionName} · {venueName} · Layout v2</p></div>
          {canRename && !readOnly && <button type="button" className="quiet" onClick={renameScene}>Umbenennen</button>}
          <span className={`save-state save-status save-${saveState.status}`} role="status">
            {pendingForms > 0
              ? 'Nicht übernommene Eingaben'
              : saveState.status === 'conflict' && saveState.conflictKind === 'lease'
                ? 'Bearbeitung abgelaufen'
                : statusText[saveState.status]}
          </span>
          {saveState.status === 'failed' && <button type="button" onClick={() => saver.retry()}>Erneut speichern</button>}
          {permissionReadOnly && onRequestEditing && <button type="button" onClick={onRequestEditing}>Bearbeitung anfordern</button>}
        </header>
        {sceneLease.message && !permissionReadOnly && <p className="muted lease-status">{sceneLease.message}</p>}
        {['failed', 'conflict'].includes(saveState.status) && <div className="error" role="alert">
          <p>{saveState.status === 'conflict'
            ? saveState.conflictKind === 'lease'
              ? 'Die Bearbeitungsberechtigung ist abgelaufen. Ihre Änderungen bleiben hier erhalten und werden nicht überschrieben.'
              : 'Eine neuere Fassung ist gespeichert. Ihre Änderungen bleiben hier erhalten und werden nicht darübergeschrieben.'
            : 'Ihre Änderungen sind noch nicht gespeichert. Prüfen Sie die Verbindung.'}</p>
          <button type="button" onClick={downloadDraft}>Lokalen Entwurf herunterladen</button>
          <button type="button" disabled={recovering} onClick={() => void recoverDraft()}>Entwurf als Bühnenbildvorlage sichern</button>
          {recoveryMessage && <p role="status">{recoveryMessage}</p>}
        </div>}
        {catalogMessage && <p role="alert" className="error">{catalogMessage}</p>}
        <nav className="tool-rail" aria-label="Bauteile einsetzen">
            {toolChoices.map(choice => <button key={`${choice.partId}:${choice.variant ?? ''}`} type="button"
              className={insertChoice?.partId === choice.partId && insertChoice.variant === choice.variant ? 'active' : ''}
              disabled={readOnly || catalog.loading} onClick={() => chooseInsert(choice)}
              title={`${choice.label} einsetzen`} aria-label={`${choice.label} einsetzen`}>
              <ToolIcon name={choice.partId === STARTER_PART_IDS.wall ? 'wall' : choice.partId === STARTER_PART_IDS.brace ? 'brace' : 'plus'} />
              <span>{choice.label}</span>
            </button>)}
        </nav>
        <div className="workspace-main editor-grid dock-grid" data-dock-open={!!dock.active}>
          <div className={`editor-canvas editor-views editor-view-${view}`}>
            {view !== 'stage' && plan}
            {view !== 'plan' && stage}
          </div>
          <EditorDock dock={dock} stageVisible={view !== 'plan'} onShowStage={() => setView('stage')}
            display={<PlanDisplayToggles value={planDisplay} onChange={setPlanDisplay} />}
            library={<div className="part-library"><h3>Bauteile</h3>
              <p className="muted">Favoriten und Starterteile stehen zusätzlich direkt in der Werkzeugleiste.</p>
              {allParts.map(part => <div key={part.id} className="library-row"><div><strong>{part.name}</strong><br /><span className="muted">{part.category}</span></div>
                <button type="button" disabled={readOnly} onClick={() => chooseInsert({ partId: part.id, revision: part.latestRevision, label: part.name })}>Einsetzen</button></div>)}
              <SurfaceRegistryPanel readOnly={readOnly} />
            </div>}
            properties={selectedGroup
              ? <GroupInspector layout={state.present} picked={selectedMembers} readOnly={readOnly}
                onPendingChange={pending => setPendingForms(count => adjustPendingCount(count, pending))}
                onChange={commit} />
              : selected
              ? <PartInspector item={selected} summary={summaryById.get(selected.object.part.id)}
                latestRevision={latestById.get(selected.object.part.id)} stockItems={stockItems}
                supports={supportOptions} readOnly={readOnly}
                onApply={commitObject} onRemove={removeSelected}
                onPendingChange={pending => setPendingForms(count => adjustPendingCount(count, pending))}
                onUpdateRevision={() => {
                  const revision = latestById.get(selected.object.part.id);
                  if (revision) commitObject({ ...selected.object, part: { ...selected.object.part, revision } });
                }} />
              : <aside className="wall-inspector"><h3>Keine Auswahl</h3><p className="muted">Bauteil im Grundriss oder in der Raumsicht wählen.</p>
                <p>{shown.objects.length} Bauteile · {shown.joints.length} Verbindungen</p>
                {uniqueRefs(shown).length > 0 && <p className="muted">{uniqueRefs(shown).length} verwendete Bauteilrevisionen</p>}</aside>} />
        </div>
        <div className="workspace-statusbar">
          <span><span className="status-dot" />Bühnenbild · {shown.objects.length} Bauteile</span>
          <span className="selection-count" hidden={!selectedIds.length} data-testid="selection-count">{selectedIds.length} ausgewählt</span>
          <span>Maße in mm</span>
        </div>
      </section>
    </EditorDockContext>
  </SurfaceRegistryProvider>;
}
