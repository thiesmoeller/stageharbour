import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import { z } from 'zod';
import { ApiError, request } from '../api.js';
import { askPrompt } from '../ConfirmDialog.js';
import { listStockItems } from '../partsApi.js';
import type { StockItem } from '../../shared/parts/catalog.js';
import { STARTER_PART_IDS } from '../../shared/parts/starter/index.js';
import { supportingSurfaces } from '../../shared/levels.js';
import { execute, history, redo, undo, type History } from '../../shared/history.js';
import type { Layout, LayoutObject, Scene, VenueGeometry } from '../../shared/layout.js';
import { layoutSupportOptions, resolveLayoutObjectDetails, type ResolvedLayoutObject } from '../../shared/layoutObjects.js';
import { resolvedObjectOverlapWarnings, overlappingResolvedObjectIds } from '../../shared/overlap.js';
import { resolvedKeepClearWarnings } from '../../shared/keepClear.js';
import { resolvedOverheadClearance } from '../../shared/overhead.js';
import { SNAP_NOTICE, planRotationAt, snapStatusText, type SnapGuide } from '../../shared/snapping.js';
import { selectionPivot } from '../../shared/editing.js';
import { objectSnapShapes, transformLayoutGesture, type GestureConnection, type TransformOperation } from '../../shared/plannerTransforms.js';
import { resizedScene, sceneResizeDocument } from '../../shared/sceneResize.js';
import { clipboardPivot, copySelection, cutSelection, pasteClipboard, removeSelection, type ClipboardMember, type LayoutClipboard } from '../../shared/clipboard.js';
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
import { CableRunMarks, CableRunsPanel } from './CableRuns.js';
import { CurtainMarks, OverheadMarks, TrussMarks } from './VenueOverhead.js';
import { KeepClearMarks } from './KeepClearZones.js';
import { AlignmentGuides, CentrelineMark, SnapToggle } from './SnapGuides.js';
import { RotationHandle } from './RotationHandle.js';
import { navigatePlan } from './planNavigation.js';
import { useViewportWheel } from './viewportWheel.js';
import { canvasModeForWidth, useNarrowEditor } from './useNarrowEditor.js';
import type { StageEditing } from './StageEditing.js';
import { localCapabilities } from '../local/mode.js';
import { scopedStorageKey } from '../local/storageScope.js';
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
import { adjustPendingCount, usePendingApplyForm } from './usePendingApplyForm.js';
import { effectiveCurtains, effectiveVenueDoorOpen, setCurtainOpenPercent, setVenueDoorOpenPercent, venueDooredWalls } from '../../shared/venueFixtures.js';
import { dimensionFromPlacement, dimensionSnapPoints, dimensionValue, nearestSnap, resolveDimension, type SnapAnchor } from '../../shared/dimensions.js';
import { insertCableRunVertex, nearestCableRunInsert, newCableRun, removeCableRunVertex, setCableRunVertex } from '../../shared/infrastructure.js';
import type { PlanPoint } from '../../shared/venue.js';
import { FeedbackButton, useFeedbackAdapter } from '../feedback/Feedback.js';
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
type ViewMode = 'plan' | 'stage' | 'split';
type Member = { kind: 'object'; id: string };
/** One pointer gesture in the plan: the layout it began from, what moves, and the latest snapped result. */
type PlanGesture = {
  start: Layout;
  resolved: readonly ResolvedLayoutObject[];
  members: Member[];
  point: { x: number; y: number };
  pivot: { x: number; y: number };
  operation: TransformOperation;
  latest: Layout;
  connection?: GestureConnection;
};
type ToolGroup = { category: string; choices: InsertChoice[] };
type VenueFixtureSelection = { kind: 'curtain' | 'door'; id: string };
type DimensionGesture = { a?: SnapAnchor; b?: SnapAnchor; cursor?: PlanPoint; hover?: SnapAnchor };
type ObjectPlacement = {
  start: Layout;
  latest: Layout;
  members: ClipboardMember[];
  origin: PlanPoint;
  consumed: boolean;
};

const PLAN_MARGIN_MM = 700;
const VIEW_PREFERENCE = scopedStorageKey('stage-planner.editor.view');
const VIEW_LABELS: Record<ViewMode, string> = { plan: 'Grundriss', stage: 'Raumsicht', split: 'Geteilt' };
const CATEGORY_ORDER = ['Wände', 'Stützen', 'Podeste', 'Möbel', 'Requisite', 'Darsteller', 'Technik'];
const CATEGORY_ICONS: Record<string, Parameters<typeof ToolIcon>[0]['name']> = {
  Wände: 'wall', Stützen: 'brace', Podeste: 'platform', Möbel: 'table', Requisite: 'box', Darsteller: 'person', Technik: 'speaker',
};
/** The part a category offers first: the everyday one, not the alphabetically first. */
const PRIMARY_PARTS: string[] = [
  STARTER_PART_IDS.wall, STARTER_PART_IDS.brace, STARTER_PART_IDS.deck, STARTER_PART_IDS.table,
  STARTER_PART_IDS.box, STARTER_PART_IDS.person, STARTER_PART_IDS.speaker,
];
const choiceKey = (choice: InsertChoice) => `${choice.partId}:${choice.variant ?? ''}`;

function savedView(): ViewMode {
  try {
    const saved = window.localStorage.getItem(VIEW_PREFERENCE);
    return saved === 'plan' || saved === 'stage' || saved === 'split' ? saved : 'plan';
  } catch { return 'plan'; }
}

function withConnection(layout: Layout, moving: string, connection: GestureConnection | undefined): Layout {
  if (!connection) return layout;
  return {
    ...layout,
    joints: [
      ...layout.joints.filter(joint => !(joint.a.object === moving && joint.a.connector === connection.moving)),
      { id: crypto.randomUUID(), a: { object: moving, connector: connection.moving }, b: { object: connection.targetObject, connector: connection.target } },
    ],
  };
}
type MarqueeState = {
  start: { x: number; y: number };
  current: { x: number; y: number };
  additive: boolean;
};

function stockAssignments(objects: Layout['objects'], exceptId: string) {
  const labels = new Map<string, string[]>();
  for (const object of objects) {
    if (object.id === exceptId || !object.stockItemId) continue;
    labels.set(object.stockItemId, [...labels.get(object.stockItemId) ?? [], object.label]);
  }
  return labels;
}

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
  const [viewMode, setViewMode] = useState<ViewMode>(savedView);
  const [viewShare, setViewShare] = useState(55);
  const narrowEditor = useNarrowEditor();
  const view = canvasModeForWidth(viewMode, narrowEditor);
  const setView = setViewMode;
  useEffect(() => { try { window.localStorage.setItem(VIEW_PREFERENCE, viewMode); } catch { /* private mode */ } }, [viewMode]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [snapStatus, setSnapStatus] = useState<string>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [lastUsed, setLastUsed] = useState<Record<string, string>>({});
  const [toolMenu, setToolMenu] = useState<{ category: string; left: number; top: number }>();
  const root = useRef<HTMLElement>(null);
  const [planDisplay, setPlanDisplay] = useState<PlanDisplayOptions>(defaultPlanDisplay);
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [catalogMessage, setCatalogMessage] = useState('');
  const [pendingForms, setPendingForms] = useState(0);
  const [cablesOpen, setCablesOpen] = useState(false);
  const [cableDrawing, setCableDrawing] = useState<{ points: PlanPoint[]; cursor?: PlanPoint } | null>(null);
  const [selectedCableRunId, setSelectedCableRunId] = useState<string>();
  const [selectedCableVertex, setSelectedCableVertex] = useState<number>();
  const [dimensioning, setDimensioning] = useState<DimensionGesture | null>(null);
  const [selectedDimension, setSelectedDimension] = useState<string>();
  const [fixtureSelection, setFixtureSelection] = useState<VenueFixtureSelection>();
  const [placingGhost, setPlacingGhost] = useState(false);
  const lastPlanPoint = useRef<PlanPoint>({ x: initial.venue.width / 2, y: initial.venue.depth / 2 });
  const objectPlacement = useRef<ObjectPlacement | undefined>(undefined);
  const cableVertexDrag = useRef<{ runId: string; index: number; start: Layout; latest: Layout } | undefined>(undefined);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recovering, setRecovering] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const feedbackCapture = useRef<StageCaptureHandle | null>(null);
  const setFeedbackCapture = useCallback((handle: StageCaptureHandle | null) => { feedbackCapture.current = handle; }, []);
  const drag = useRef<PlanGesture | undefined>(undefined);
  const stageGesture = useRef<{ layout: Layout; members: Member[]; resolved: readonly ResolvedLayoutObject[] } | undefined>(undefined);
  const resizeGesture = useRef<Layout | undefined>(undefined);
  const panDrag = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | undefined>(undefined);
  const marquee = useRef<MarqueeState | undefined>(undefined);
  const [marqueePreview, setMarqueePreview] = useState<MarqueeState>();
  const dock = useEditorDock('scene');
  const catalog = useLayoutParts(workspaceId, shown);
  const supports = useMemo(() => supportingSurfaces(venue), [venue]);
  const supportOptionsForLayout = useMemo(() => layoutSupportOptions(venue), [venue]);
  const resolution = useMemo(
    () => resolveLayoutObjectDetails(shown, catalog.index, supportOptionsForLayout),
    [shown, catalog.index, supportOptionsForLayout],
  );
  const objects = resolution.objects;
  const selected = objects.find(object => object.object.id === selectedIds[0]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedMembers: Member[] = selectedIds.map(id => ({ kind: 'object' as const, id }));
  const snapShapes = useMemo(() => objectSnapShapes(objects), [objects]);
  const selectedGroup = selectedMembers[0] ? groupContaining(shown, selectedMembers[0]) : undefined;
  const overlapWarnings = useMemo(() => resolvedObjectOverlapWarnings(objects), [objects]);
  const overlapIds = useMemo(() => overlappingResolvedObjectIds(objects), [objects]);
  const keepClear = useMemo(() => resolvedKeepClearWarnings(venue, objects), [venue, objects]);
  const overhead = useMemo(() => resolvedOverheadClearance(objects, venue), [objects, venue]);
  const sceneCurtains = useMemo(() => effectiveCurtains(venue, shown), [venue, shown]);
  const venueDoors = useMemo(() => venueDooredWalls(venue), [venue]);
  const selectedCurtain = fixtureSelection?.kind === 'curtain'
    ? sceneCurtains.find(item => item.id === fixtureSelection.id) : undefined;
  const selectedVenueDoor = fixtureSelection?.kind === 'door'
    ? venueDoors.find(wall => wall.id === fixtureSelection.id) : undefined;
  const resolvedDimensions = useMemo(() => (shown.dimensions ?? []).flatMap(dimension => {
    const resolved = resolveDimension(dimension, venue, shown, objects);
    return resolved ? [resolved] : [];
  }), [shown, venue, objects]);
  const dimensionPreview = dimensioning?.a && dimensioning.b && dimensioning.cursor ? (() => {
    const placed = dimensionFromPlacement(dimensioning.a.point, dimensioning.b.point, dimensioning.cursor);
    return {
      id: 'preview', orientation: placed.orientation,
      a: dimensioning.a.point, b: dimensioning.b.point, offset: placed.offset,
      valueMm: dimensionValue(placed.orientation, dimensioning.a.point, dimensioning.b.point),
    };
  })() : undefined;
  const cableDraftPath = cableDrawing ? (() => {
    const { points, cursor } = cableDrawing;
    if (!cursor) return points;
    const last = points.at(-1);
    if (last && last.x === cursor.x && last.y === cursor.y) return points;
    return [...points, cursor];
  })() : undefined;
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
    recordFeedbackActivity({ action: 'editor.undo', area: 'plans' });
  }
  function performRedo() {
    const next = redo(state);
    setState(next);
    saver.queue(next.present);
    recordFeedbackActivity({ action: 'editor.redo', area: 'plans' });
  }
  function planPoint(event: Pick<PointerEvent<SVGSVGElement | SVGGElement>, 'clientX' | 'clientY'>) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: venue.width / 2, y: venue.depth / 2 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: -point.y };
  }
  const busyGesture = () => !!(drag.current || stageGesture.current || resizeGesture.current || marquee.current || panDrag.current || objectPlacement.current || cableVertexDrag.current);
  function clearGestureFeedback() { setPreview(undefined); setGuides([]); setSnapStatus(undefined); }
  function clearPlanSelection() {
    setSelectedDimension(undefined);
    setSelectedCableRunId(undefined);
    setSelectedCableVertex(undefined);
    setFixtureSelection(undefined);
  }
  function cancelPlacement() {
    const active = !!objectPlacement.current;
    objectPlacement.current = undefined;
    setPlacingGhost(false);
    if (!active) return;
    setPreview(undefined);
    setGuides([]);
    setSnapStatus(undefined);
    setSelectedIds([]);
  }
  function cancelGesture() {
    const placing = !!objectPlacement.current;
    drag.current = undefined; stageGesture.current = undefined; marquee.current = undefined; panDrag.current = undefined;
    cableVertexDrag.current = undefined;
    objectPlacement.current = undefined;
    setPlacingGhost(false);
    setMarqueePreview(undefined);
    clearGestureFeedback();
    if (placing) setSelectedIds([]);
  }
  function beginGesture(event: PointerEvent<SVGGElement>, ids: string[], operation: TransformOperation) {
    const members: Member[] = ids.map(id => ({ kind: 'object', id }));
    const point = planPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      start: state.present, resolved: objects, members, point, operation, latest: state.present,
      pivot: selectionPivot(state.present, members) ?? point,
    };
  }
  function beginObjectDrag(event: PointerEvent<SVGGElement>, object: (typeof objects)[number]) {
    if (event.button !== 0 || busyGesture()) return;
    event.stopPropagation();
    const group = groupContaining(shown, { kind: 'object', id: object.object.id });
    const targetIds = group?.members.map(member => member.id) ?? [object.object.id];
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const allSelected = targetIds.every(id => selectedIds.includes(id));
    const ids = additive
      ? allSelected ? selectedIds.filter(id => !targetIds.includes(id)) : [...new Set([...selectedIds, ...targetIds])]
      : selectedIds.includes(object.object.id) ? selectedIds : targetIds;
    setSelectedIds(ids);
    clearPlanSelection();
    if (readOnly || preview || (additive && allSelected)) return;
    beginGesture(event, ids, 'translate');
  }
  function beginRotation(event: PointerEvent<SVGGElement>) {
    if (event.button !== 0 || readOnly || preview || busyGesture() || !selectedIds.length) return;
    event.stopPropagation();
    beginGesture(event, selectedIds, 'rotate');
  }
  function updatePlacement(position: PlanPoint, bypass: boolean) {
    const placing = objectPlacement.current;
    if (!placing) return;
    const result = transformLayoutGesture(placing.start, venue, placing.members, {
      x: position.x - placing.origin.x, y: position.y - placing.origin.y, rotation: 0,
    }, 'translate', bypass);
    placing.latest = result.layout;
    setPreview(result.layout);
    setGuides(result.guides);
    setSnapStatus(snapStatusText({ guides: result.guides }) ?? 'Klicken zum Platzieren · Escape bricht ab');
  }
  function commitPlacement() {
    const placing = objectPlacement.current;
    if (!placing) return;
    objectPlacement.current = undefined;
    setPlacingGhost(false);
    setGuides([]);
    setSnapStatus(undefined);
    commit(placing.latest);
    setSelectedIds(placing.members.map(member => member.id));
    if (placing.consumed) setClipboard(undefined);
    else {
      const copied = copySelection(placing.latest, placing.members);
      if (copied) setClipboard(copied);
    }
  }
  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    const point = planPoint(event);
    lastPlanPoint.current = point;
    const panning = panDrag.current;
    if (panning) {
      const scale = (svg.current?.viewBox.baseVal.width ?? venue.width) / Math.max(1, svg.current?.clientWidth ?? 1);
      setViewPan({ x: panning.panX - (event.clientX - panning.clientX) * scale, y: panning.panY + (event.clientY - panning.clientY) * scale });
      return;
    }
    if (objectPlacement.current) {
      updatePlacement(point, event.altKey || !snapEnabled);
      return;
    }
    const cableVertex = cableVertexDrag.current;
    if (cableVertex) {
      const layout = {
        ...cableVertex.start,
        cableRuns: (cableVertex.start.cableRuns ?? []).map(run => run.id === cableVertex.runId
          ? setCableRunVertex(run, cableVertex.index, { x: Math.round(point.x), y: Math.round(point.y) }) : run),
      };
      cableVertex.latest = layout;
      setPreview(layout);
      return;
    }
    if (cableDrawing) {
      setCableDrawing(current => current ? { ...current, cursor: point } : current);
      return;
    }
    const current = drag.current;
    if (!current) {
      const box = marquee.current;
      if (box) {
        box.current = point;
        setMarqueePreview({ ...box });
      }
      return;
    }
    const bypass = event.altKey || !snapEnabled;
    let rotation = 0;
    if (current.operation === 'rotate') {
      rotation = planRotationAt(current.pivot, point) - planRotationAt(current.pivot, current.point);
      rotation = ((rotation + 540) % 360) - 180;
    }
    const delta = current.operation === 'rotate'
      ? { x: 0, y: 0, rotation }
      : { x: point.x - current.point.x, y: point.y - current.point.y, rotation: 0 };
    const result = transformLayoutGesture(current.start, venue, current.members, delta, current.operation, bypass, current.resolved);
    current.latest = result.layout;
    current.connection = result.connection;
    setPreview(result.layout);
    setGuides(result.guides);
    const turned = current.operation === 'rotate' ? result.layout.objects.find(item => item.id === current.members[0]?.id) : undefined;
    setSnapStatus(turned && current.members.length === 1
      ? `Drehung ${Math.round(turned.rotation * 10) / 10}°${bypass ? '' : ' · rastet in 15°-Schritten'}`
      : snapStatusText({ guides: result.guides }));
  }
  function endDrag(event: PointerEvent<SVGSVGElement>) {
    if (panDrag.current) { panDrag.current = undefined; return; }
    if (cableVertexDrag.current) {
      const latest = cableVertexDrag.current.latest;
      const moved = latest !== cableVertexDrag.current.start;
      cableVertexDrag.current = undefined;
      setPreview(undefined);
      setGuides([]);
      setSnapStatus(undefined);
      if (event.type !== 'pointercancel' && moved) commit(latest);
      return;
    }
    const current = drag.current;
    if (!current) {
      const box = marquee.current;
      if (!box) return;
      marquee.current = undefined;
      setMarqueePreview(undefined);
      const point = planPoint(event);
      const moved = Math.hypot(point.x - box.start.x, point.y - box.start.y) > 10;
      if (!moved) {
        if (!box.additive) { setSelectedIds([]); clearPlanSelection(); }
        return;
      }
      clearPlanSelection();
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
    setGuides([]); setSnapStatus(undefined);
    const point = planPoint(event);
    if (event.type === 'pointercancel' || Math.hypot(point.x - current.point.x, point.y - current.point.y) <= 1) {
      setPreview(undefined);
      return;
    }
    commit(current.members.length === 1 ? withConnection(current.latest, current.members[0]!.id, current.connection) : current.latest);
  }
  const stageTransform: StageEditing['onTransform'] = (phase, delta, bypass, operation = 'translate') => {
    if (readOnly) return;
    if (phase === 'begin') {
      if (!busyGesture() && selectedMembers.length) {
        stageGesture.current = { layout: state.present, members: selectedMembers, resolved: objects };
        setPreview(state.present);
      }
      return;
    }
    const held = stageGesture.current;
    if (phase === 'cancel') { stageGesture.current = undefined; clearGestureFeedback(); return; }
    if (!held) return;
    const result = transformLayoutGesture(held.layout, venue, held.members, delta, operation, bypass, held.resolved);
    setGuides(result.guides);
    if (phase === 'preview') { setPreview(result.layout); return; }
    stageGesture.current = undefined;
    clearGestureFeedback();
    if (JSON.stringify(result.layout) !== JSON.stringify(held.layout)) {
      commit(held.members.length === 1 ? withConnection(result.layout, held.members[0]!.id, result.connection) : result.layout);
    }
  };
  const stageResize: StageEditing['onPushPull'] = (phase, next) => {
    if (readOnly) return;
    if (phase === 'begin') {
      if (!busyGesture()) { resizeGesture.current = state.present; setPreview(state.present); }
      return;
    }
    if (phase === 'cancel') { resizeGesture.current = undefined; setPreview(undefined); return; }
    const held = resizeGesture.current;
    if (!held) return;
    const result = resizedScene(held, next, catalog.index);
    if (phase === 'preview') { setPreview(result); return; }
    resizeGesture.current = undefined;
    setPreview(undefined);
    if (JSON.stringify(result) !== JSON.stringify(held)) commit(result);
  };
  const resizeDocument = useMemo(
    () => sceneResizeDocument(shown, venue, catalog.index),
    [shown, venue, catalog.index],
  );
  function chooseInsert(choice: InsertChoice, category?: string) {
    if (readOnly || busyGesture()) return;
    cancelPlacement();
    setDimensioning(null);
    setCableDrawing(null);
    setSnapStatus(undefined);
    setToolMenu(undefined);
    if (category) setLastUsed(used => ({ ...used, [category]: choiceKey(choice) }));
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
      // A click is not millimetre-precise; whole millimetres keep the numbers readable.
      x: Math.max(-100000, Math.min(100000, Math.round(point.x))),
      y: Math.max(-100000, Math.min(100000, Math.round(point.y))),
      rotation: 0,
    };
    commit({ ...state.present, objects: [...state.present.objects, object] });
    setSelectedIds([object.id]);
    setInsertChoice(undefined);
  }
  function backgroundPointer(event: PointerEvent<SVGSVGElement>) {
    if (busyGesture()) return;
    if (event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panDrag.current = { clientX: event.clientX, clientY: event.clientY, panX: viewPan.x, panY: viewPan.y };
      return;
    }
    if (event.button !== 0) return;
    if (dimensioning || cableDrawing) return;
    if (insertChoice) {
      placeAt(planPoint(event));
      clearPlanSelection();
      return;
    }
    const point = planPoint(event);
    const box = { start: point, current: point, additive: event.shiftKey || event.ctrlKey || event.metaKey };
    event.currentTarget.setPointerCapture(event.pointerId);
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
  function beginObjectPlacement(layout: Layout, members: ClipboardMember[], origin: PlanPoint, consumed: boolean) {
    if (readOnly || busyGesture()) return;
    setDimensioning(null);
    setCableDrawing(null);
    setInsertChoice(undefined);
    clearPlanSelection();
    objectPlacement.current = { start: layout, latest: layout, members, origin, consumed };
    setPlacingGhost(true);
    setPreview(layout);
    setGuides([]);
    setSelectedIds(members.map(member => member.id));
    setSnapStatus('Klicken zum Platzieren · Escape bricht ab');
    if (consumed) setClipboard(undefined);
  }
  function paste() {
    if (readOnly || !clipboard || busyGesture()) return;
    if (view === 'stage') setViewMode('plan');
    const cursor = lastPlanPoint.current;
    const pivot = clipboardPivot(clipboard) ?? cursor;
    const result = pasteClipboard(state.present, clipboard, () => crypto.randomUUID(), {
      x: cursor.x - pivot.x, y: cursor.y - pivot.y,
    });
    if (!result.pasted.length) return;
    beginObjectPlacement(result.layout, result.pasted, cursor, result.consumed);
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

  function dimensionReach(pixels = 16) {
    const rect = svg.current?.getBoundingClientRect();
    const width = (venue.width + 2 * PLAN_MARGIN_MM) / viewZoom;
    return rect && rect.width ? (width / rect.width) * pixels : pixels * 20;
  }
  function finishCableDrawing(path: PlanPoint[]) {
    const rounded = path.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }));
    const distinct = rounded.filter((point, index) => index === 0 || point.x !== rounded[index - 1]!.x || point.y !== rounded[index - 1]!.y);
    if (distinct.length < 2 || (state.present.cableRuns ?? []).length >= 250) {
      setCableDrawing(null);
      setSnapStatus(distinct.length < 2 ? 'Kabelweg braucht mindestens zwei Punkte.' : undefined);
      return;
    }
    const run = newCableRun(crypto.randomUUID(), distinct);
    const end = distinct.at(-1)!;
    const pin = (venue.connectionPoints ?? []).find(item => Math.hypot(item.x - end.x, item.y - end.y) <= 250);
    const finished = pin
      ? setCableRunVertex({ ...run, end: { ...run.end, label: pin.label, connectionPointId: pin.id } }, run.path.length - 1, { x: pin.x, y: pin.y })
      : run;
    commit({ ...state.present, cableRuns: [...state.present.cableRuns ?? [], finished] });
    setSelectedIds([]);
    setSelectedDimension(undefined);
    setFixtureSelection(undefined);
    setSelectedCableRunId(finished.id);
    setSelectedCableVertex(undefined);
    setCablesOpen(true);
    setCableDrawing(null);
    setSnapStatus(undefined);
  }
  function pickDimension(event: PointerEvent<SVGRectElement>) {
    if (event.button !== 0 || !dimensioning || readOnly) return;
    event.stopPropagation();
    const at = planPoint(event);
    lastPlanPoint.current = at;
    const hit = nearestSnap(dimensionSnapPoints(venue, state.present, objects), at, dimensionReach());
    if (!dimensioning.a) {
      if (!hit) return;
      setDimensioning({ a: hit, hover: hit });
      setSnapStatus('Zweiten Punkt wählen. Es rastet an Ecken und Kantenmitten ein.');
      return;
    }
    if (!dimensioning.b) {
      if (!hit || (hit.point.x === dimensioning.a.point.x && hit.point.y === dimensioning.a.point.y)) return;
      setDimensioning({ ...dimensioning, b: hit, cursor: at, hover: hit });
      setSnapStatus('Maßlinie zur Seite ziehen, dann klicken zum Ablegen.');
      return;
    }
    const placed = dimensionFromPlacement(dimensioning.a.point, dimensioning.b.point, at);
    commit({
      ...state.present,
      dimensions: [...(state.present.dimensions ?? []), {
        id: crypto.randomUUID(), ...placed, a: dimensioning.a.anchor, b: dimensioning.b.anchor,
      }],
    });
    setDimensioning(null);
    setSnapStatus(undefined);
  }
  function hoverDimension(event: PointerEvent<SVGRectElement>) {
    if (!dimensioning) return;
    const at = planPoint(event);
    lastPlanPoint.current = at;
    const hover = nearestSnap(dimensionSnapPoints(venue, state.present, objects), at, dimensionReach());
    setDimensioning({ ...dimensioning, cursor: at, hover });
    if (dimensioning.a && dimensioning.b) {
      const placed = dimensionFromPlacement(dimensioning.a.point, dimensioning.b.point, at);
      setSnapStatus(`${Math.round(dimensionValue(placed.orientation, dimensioning.a.point, dimensioning.b.point))} mm · klicken zum Ablegen`);
    } else if (hover) setSnapStatus(dimensioning.a ? 'Zweiten Punkt wählen.' : 'Ersten Punkt wählen.');
  }
  function selectDimension(id: string) {
    setDimensioning(null);
    setSnapStatus(undefined);
    setSelectedIds([]);
    setSelectedCableRunId(undefined);
    setSelectedCableVertex(undefined);
    setFixtureSelection(undefined);
    setSelectedDimension(id);
  }
  function pickVenueFixture(fixture: VenueFixtureSelection) {
    if (busyGesture()) return;
    setSelectedIds([]);
    setSelectedDimension(undefined);
    setSelectedCableRunId(undefined);
    setSelectedCableVertex(undefined);
    setFixtureSelection(fixture);
    dock.setActive('properties');
  }
  function focusPlan() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    svg.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      if (cableDrawing && (event.key === 'Enter' || event.key === 'NumpadEnter') && !typing) {
        event.preventDefault();
        finishCableDrawing(cableDrawing.points);
        return;
      }
      if (typing) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (busyGesture()) {
        // A running gesture owns the document: Escape cancels it and keeps the selection, everything else waits.
        if (event.key === 'Escape') { event.preventDefault(); cancelGesture(); }
        else if (modifier || event.key === 'Delete' || event.key === 'Backspace') event.preventDefault();
        return;
      }
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
        event.preventDefault();
        if (readOnly) return;
        if (selectedCableRunId) {
          const run = state.present.cableRuns?.find(item => item.id === selectedCableRunId);
          if (run && selectedCableVertex !== undefined && selectedCableVertex > 0 && selectedCableVertex < run.path.length - 1 && run.path.length > 2) {
            commit({
              ...state.present,
              cableRuns: (state.present.cableRuns ?? []).map(item => item.id === selectedCableRunId
                ? removeCableRunVertex(item, selectedCableVertex) : item),
            });
            setSelectedCableVertex(undefined);
          } else {
            commit({ ...state.present, cableRuns: (state.present.cableRuns ?? []).filter(item => item.id !== selectedCableRunId) });
            setSelectedCableRunId(undefined);
            setSelectedCableVertex(undefined);
          }
        } else if (selectedDimension) {
          commit({ ...state.present, dimensions: (state.present.dimensions ?? []).filter(item => item.id !== selectedDimension) });
          setSelectedDimension(undefined);
        } else removeSelected();
      } else if (event.key === 'Escape') {
        // The room view has just left its move/rotate tool with this key press; keep the selection.
        if ((event as KeyboardEvent & { stageToolExitHandled?: boolean }).stageToolExitHandled) return;
        if (cableDrawing) { setCableDrawing(null); setSnapStatus(undefined); }
        else if (dimensioning) { setDimensioning(null); setSnapStatus(undefined); }
        else if (placingGhost) cancelPlacement();
        else if (selectedCableVertex !== undefined) setSelectedCableVertex(undefined);
        else if (selectedCableRunId) { setSelectedCableRunId(undefined); setSelectedCableVertex(undefined); }
        else if (selectedDimension) setSelectedDimension(undefined);
        else if (fixtureSelection) setFixtureSelection(undefined);
        else if (toolMenu) setToolMenu(undefined);
        else if (helpOpen) setHelpOpen(false);
        else if (insertChoice) setInsertChoice(undefined);
        else setSelectedIds([]);
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  const essentialIds = new Set<string>(Object.values(STARTER_PART_IDS));
  const allParts = catalog.summaries.filter(part => !part.archived);
  const toolGroups = useMemo<ToolGroup[]>(() => {
    const rank = (id: string) => { const at = PRIMARY_PARTS.indexOf(id); return at < 0 ? PRIMARY_PARTS.length : at; };
    const byCategory = new Map<string, InsertChoice[]>();
    const essentials = catalog.summaries
      .filter(part => !part.archived && (part.favourite || essentialIds.has(part.id)))
      .map((part, index) => ({ part, index }))
      .sort((a, b) => rank(a.part.id) - rank(b.part.id) || a.index - b.index);
    for (const { part } of essentials) {
      const choices: InsertChoice[] = part.variants.length
        ? part.variants.map(variant => ({ partId: part.id, revision: part.latestRevision, label: `${part.name} · ${variant.label}`, variant: variant.key }))
        : [{ partId: part.id, revision: part.latestRevision, label: part.name }];
      byCategory.set(part.category, [...byCategory.get(part.category) ?? [], ...choices]);
    }
    const order = (category: string) => { const at = CATEGORY_ORDER.indexOf(category); return at < 0 ? CATEGORY_ORDER.length : at; };
    return [...byCategory].map(([category, choices]) => ({ category, choices }))
      .sort((a, b) => order(a.category) - order(b.category) || a.category.localeCompare(b.category, 'de'));
  }, [catalog.summaries]);
  const openGroup = toolMenu && toolGroups.find(group => group.category === toolMenu.category);
  // Room around the stage for its dimension labels and the audience note.
  const viewWidth = (venue.width + 2 * PLAN_MARGIN_MM) / viewZoom;
  const viewHeight = (venue.depth + 2 * PLAN_MARGIN_MM) / viewZoom;
  const viewCx = venue.width / 2 + viewPan.x;
  const viewCy = venue.depth / 2 + viewPan.y;
  useViewportWheel(svg, event => {
    const next = navigatePlan(event, { zoom: viewZoom, pan: viewPan, centre: { x: venue.width / 2, y: venue.depth / 2 } }, planPoint(event));
    event.preventDefault();
    setViewZoom(next.zoom); setViewPan(next.pan);
  }, view !== 'stage' && !venueOpen && !exportsOpen);
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen();
  }
  const rotationHandle = (() => {
    if (readOnly || insertChoice || dimensioning || cableDrawing || placingGhost || !selectedIds.length) return null;
    if (selectedIds.length === 1) {
      if (!selected) return null;
      const shape = snapShapes.get(selected.object.id);
      return <RotationHandle centre={selected.object} rotation={selected.object.rotation} width={Math.max(shape?.width ?? 0, 600)}
        testId={`rotate-${selected.object.id}`} label={`${selected.object.label} drehen`} onPointerDown={beginRotation} />;
    }
    const pivot = selectionPivot(shown, selectedMembers);
    const points = objects.filter(item => selectedSet.has(item.object.id)).flatMap(item => item.footprint);
    if (!pivot || !points.length) return null;
    const reach = Math.max(...points.map(point => Math.abs(point.x - pivot.x)));
    return <RotationHandle centre={pivot} rotation={0} width={Math.max(reach * 2, 600)}
      testId="rotate-selection" label="Auswahl drehen" onPointerDown={beginRotation} />;
  })();

  useFeedbackAdapter(() => ({
    work: {
      productionId: initial.productionId, sceneId: initial.id, venueId: initial.venueId,
      production: initial.productionName, layout: sceneName, venue: venueName,
      revision: saveState.revision, venueVersionId, view,
      tool: insertChoice || placingGhost ? 'place-part' : dimensioning ? 'dimension' : cableDrawing ? 'cable' : 'select', saveStatus: saveState.status,
      dirty: saveState.dirty, unappliedInputs: pendingForms > 0, readOnly,
      selection: selectedIds.slice(0, 200),
      display: { ...planDisplay, snapEnabled, zoom: viewZoom, panX: viewPan.x, panY: viewPan.y, panel: dock.active ?? '' },
    },
    snapshot: JSON.stringify({ version: 1, kind: 'layout', layout: state.present, venue }),
    capture: exportsOpen ? undefined : () => captureWorkView(view, svg.current, feedbackCapture.current),
  }), 2);

  function capturePlanPointer(event: PointerEvent<SVGSVGElement>) {
    if (cableDrawing !== null && event.button === 0 && !readOnly) {
      const at = planPoint(event);
      const rounded = { x: Math.round(at.x), y: Math.round(at.y) };
      lastPlanPoint.current = rounded;
      const last = cableDrawing.points.at(-1);
      if (last && last.x === rounded.x && last.y === rounded.y) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const points = [...cableDrawing.points, rounded];
      setCableDrawing({ points, cursor: rounded });
      setSnapStatus(points.length < 2
        ? 'Nächsten Punkt setzen · Escape bricht ab.'
        : `${points.length} Punkte · Enter oder Doppelklick beendet · Escape bricht ab.`);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (objectPlacement.current && event.button === 0 && !readOnly) {
      const at = planPoint(event);
      lastPlanPoint.current = at;
      updatePlacement(at, event.altKey || !snapEnabled);
      commitPlacement();
      event.preventDefault();
      event.stopPropagation();
    }
  }
  function finishCableOnDoubleClick(event: { preventDefault(): void; clientX: number; clientY: number }) {
    if (cableDrawing === null || readOnly) return;
    event.preventDefault();
    const at = planPoint(event);
    const rounded = { x: Math.round(at.x), y: Math.round(at.y) };
    const last = cableDrawing.points.at(-1);
    const path = last && last.x === rounded.x && last.y === rounded.y ? cableDrawing.points : [...cableDrawing.points, rounded];
    finishCableDrawing(path);
  }

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
    <div className="plan-canvas">
      <div className="plan-viewbar"><h3>Grundriss <span>2D</span></h3>
        <div className="plan-zoom">
          <button type="button" className="quiet" onClick={() => setViewZoom(zoom => Math.min(8, zoom * 1.25))} title="Grundriss vergrößern" aria-label="Vergrößern"><ToolIcon name="plus" /></button>
          <button type="button" className="quiet" onClick={() => setViewZoom(zoom => Math.max(0.4, zoom / 1.25))} title="Grundriss verkleinern" aria-label="Verkleinern"><ToolIcon name="minus" /></button>
          <button type="button" className="quiet" title="Ganze Bühne zeigen" onClick={() => { setViewZoom(1); setViewPan({ x: 0, y: 0 }); }}>Passend</button>
          <span className="muted">{Math.round(viewZoom * 100)} %</span>
        </div>
      </div>
      <svg ref={svg} tabIndex={-1} data-testid="plan-canvas" role="img" aria-label="Grundriss der Spielstätte"
      className={insertChoice || placingGhost || dimensioning || cableDrawing ? 'placing-cursor' : undefined}
      viewBox={`${viewCx - viewWidth / 2} ${-(viewCy + viewHeight / 2)} ${viewWidth} ${viewHeight}`}
      onPointerDownCapture={capturePlanPointer} onDoubleClick={finishCableOnDoubleClick}
      onPointerDown={backgroundPointer} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <defs><pattern id="metre-grid" width="1000" height="1000" patternUnits="userSpaceOnUse">
        <path d="M 1000 0 L 0 0 0 1000" fill="none" stroke="#d8dfd2" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </pattern></defs>
      <PlanVenue venue={venue} shown={shown} readOnly={readOnly} planDisplay={planDisplay}
        fixtureSelection={fixtureSelection} pickVenueFixture={pickVenueFixture} />
      <PlatformLayer venuePlatforms={venue.platforms ?? []} layoutPlatforms={[]}
        venueStairs={venue.stairs ?? []} layoutStairs={[]} readOnly display={planDisplay}
        onSelect={() => {}} />
      <PlanObjects objects={objects} selectedIds={selectedSet} overlapIds={overlapIds} readOnly={readOnly}
        planDisplay={planDisplay} start={beginObjectDrag} />
      <InfrastructureMarks pins={venue.connectionPoints ?? []} corridors={venue.cableRoutingCorridors ?? []} display={planDisplay} />
      <CableRunMarks runs={shown.cableRuns ?? []} selectedId={selectedCableRunId} selectedVertexIndex={selectedCableVertex}
        draftPath={cableDraftPath} readOnly={readOnly || !!cableDrawing}
        onPathPointerDown={readOnly || cableDrawing ? undefined : (event, runId) => {
          if (busyGesture()) return;
          const at = planPoint(event);
          if (selectedCableRunId === runId) {
            const run = state.present.cableRuns?.find(item => item.id === runId);
            const insert = run && run.path.length < 500 ? nearestCableRunInsert(run, at, Number.POSITIVE_INFINITY) : undefined;
            if (run && insert) {
              commit({
                ...state.present,
                cableRuns: (state.present.cableRuns ?? []).map(item => item.id === runId
                  ? insertCableRunVertex(item, insert.afterIndex, insert.point) : item),
              });
              setSelectedCableVertex(insert.afterIndex + 1);
              setCablesOpen(true);
              focusPlan();
              return;
            }
          }
          setSelectedIds([]);
          setSelectedDimension(undefined);
          setFixtureSelection(undefined);
          setSelectedCableRunId(runId);
          setSelectedCableVertex(undefined);
          setCablesOpen(true);
          focusPlan();
        }}
        onVertexPointerDown={readOnly || cableDrawing ? undefined : (event, runId, index) => {
          if (event.button !== 0 || busyGesture()) return;
          event.stopPropagation();
          event.preventDefault();
          setSelectedIds([]);
          setSelectedDimension(undefined);
          setFixtureSelection(undefined);
          setSelectedCableRunId(runId);
          setSelectedCableVertex(index);
          setCablesOpen(true);
          focusPlan();
          const start = state.present;
          cableVertexDrag.current = { runId, index, start, latest: start };
          setPreview(start);
          svg.current?.setPointerCapture(event.pointerId);
        }} />
      <OverheadMarks boxes={venue.overheadBoxes ?? []} display={planDisplay} />
      <TrussMarks trusses={venue.trusses ?? []} display={planDisplay} hangPlan={venue.hangPlan} />
      <CurtainMarks curtains={sceneCurtains} selectedIds={fixtureSelection?.kind === 'curtain' ? [fixtureSelection.id] : []}
        display={planDisplay}
        onPointerDown={readOnly ? undefined : (event, id) => {
          event.stopPropagation();
          if (event.button !== 0 || busyGesture()) return;
          pickVenueFixture({ kind: 'curtain', id });
        }} />
      <KeepClearMarks zones={venue.keepClearZones ?? []} display={planDisplay} />
      <CentrelineMark centreline={venue.stageCentreline} showLabel={planDisplay.showTexts} />
      <MeasureLayer lines={shown.measureLines ?? []} />
      <AlignmentGuides guides={guides} />
      {rotationHandle}
      {marqueePreview && (() => {
        const box = normalizeBounds(marqueePreview.start, marqueePreview.current);
        return <rect data-testid="selection-marquee" className="selection-marquee"
          x={box.minX} y={-box.maxY} width={box.maxX - box.minX} height={box.maxY - box.minY}
          pointerEvents="none" vectorEffect="non-scaling-stroke" />;
      })()}
      {dimensioning && <rect data-testid="dimension-target" x={viewCx - viewWidth / 2} y={-(viewCy + viewHeight / 2)} width={viewWidth} height={viewHeight}
        fill="white" fillOpacity={0} pointerEvents="all" onPointerDown={pickDimension} onPointerMove={hoverDimension} />}
      <DimensionLayer dimensions={resolvedDimensions} preview={dimensionPreview} selectedId={selectedDimension}
        passPointer={dimensioning !== null} snapRadius={dimensionReach(16)}
        snaps={dimensioning ? [dimensioning.a?.point, dimensioning.b?.point, dimensioning.hover?.point].flatMap(item => item ? [item] : []) : []}
        onSelect={selectDimension} />
    </svg></div>
    {(insertChoice || placingGhost) && <p className="plan-placement-hint" role="status">{insertChoice
      ? `„${insertChoice.label}“: Position im Grundriss anklicken · Escape bricht ab.`
      : 'Klicken zum Platzieren · Escape bricht ab.'}</p>}
    <div className="plan-status" aria-live="polite">
      {catalog.error && <p className="warning">{catalog.error}</p>}
      {resolution.issues.map(issue => <p key={`${issue.kind}-${issue.objectId}-${issue.message}`} className="warning">{issue.message}</p>)}
      {overlapWarnings.map(warning => <p key={`${warning.aId}-${warning.bId}`} className="warning" data-testid="object-overlap">{warning.message}</p>)}
      {keepClear.map(warning => <p key={`${warning.zoneId}-${warning.objectId}`} className="warning">{warning.message}</p>)}
      {overhead.map(warning => <p key={`${warning.kind}-${warning.objectId}-${warning.obstructionId ?? ''}`} className="warning">{warning.message}</p>)}
    </div>
  </div>;

  const stage = <StageView layout={shown} venue={venue} workspaceId={workspaceId} selectedIds={selectedIds}
    pivot={selectionPivot(state.present, selectedMembers)} snapEnabled={snapEnabled} planDisplay={planDisplay}
    onFeedbackCaptureReady={setFeedbackCapture}
    onSelect={(id, additive) => { if (!busyGesture()) setSelectedIds(current => additive ? [...new Set([...current, id])] : [id]); }}
    onClearSelection={() => { if (!busyGesture()) setSelectedIds([]); }}
    onTransform={readOnly ? undefined : stageTransform}
    onPushPull={readOnly ? undefined : stageResize}
    resizeScope="scene" resizeDocument={resizeDocument}
    onLightingChange={readOnly ? undefined : lighting => { if (!busyGesture()) commit({ ...state.present, lighting }); }}
    onLightLooksChange={readOnly ? undefined : patch => { if (!busyGesture()) commit({ ...state.present, ...patch }); }}
    onHangPlanChange={readOnly ? undefined : hangPlan => {
      if (busyGesture()) return;
      setVenue(current => ({ ...current, hangPlan }));
      setVenueDirty(true);
    }} />;

  return <SurfaceRegistryProvider workspaceId={workspaceId} productionId={initial.productionId}>
    <EditorDockContext value={dock}>
      <section ref={root} className="editor editor-shell scene-editor" aria-label="Bühnenbild bearbeiten">
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
            <button type="button" onClick={() => dock.setOpen('properties', open => !open)}>{dock.active === 'properties' ? 'Eigenschaften ausblenden' : 'Eigenschaften einblenden'}</button>
            <button type="button" onClick={() => dock.setActive('display')}>Anzeige einstellen</button>
            <button type="button" onClick={() => dock.setActive('lighting')}>Licht einstellen</button>
            <label className="split-control" hidden={view !== 'split'}>Aufteilung<input aria-label="Ansichten aufteilen" type="range" min="30" max="70" value={viewShare} onChange={event => setViewShare(Number(event.target.value))} /></label>
            <button type="button" onClick={toggleFullscreen}>Vollbild umschalten</button>
            <button type="button" onClick={() => setVenueOpen(true)}>Spielstätte bearbeiten</button>
          </EditorMenu>
          <EditorMenu label="Einfügen">
            <button type="button" onClick={() => dock.setActive('library')}>Bibliothek öffnen</button>
          </EditorMenu>
          <EditorMenu label="Hilfe">
            {!localCapabilities.local && <FeedbackButton />}
            <button type="button" onClick={() => setHelpOpen(open => !open)}>{helpOpen ? 'Bedienung ausblenden' : 'Bedienung anzeigen'}</button>
            <a href="#/hilfe">Zur vollständigen Hilfe</a>
          </EditorMenu>
        </EditorMenuBar>
        <header className="editor-toolbar editor-heading compact-editor-heading">
          <button type="button" className="quiet back-button" onClick={onClose} title="Zur Übersicht" aria-label="Zur Übersicht"><ToolIcon name="back" /></button>
          <div className="scene-title"><h2 title={sceneName}>{sceneName}</h2><span className="scene-context">{initial.productionName} · {venueName}</span></div>
          {canRename && !readOnly && <button type="button" className="quiet" onClick={renameScene}>Umbenennen</button>}
          {!readOnly && <div className="document-history">
            <button type="button" className="quiet" disabled={!!preview || !state.past.length} onClick={performUndo} title="Rückgängig (Strg+Z)" aria-label="Rückgängig"><ToolIcon name="undo" /></button>
            <button type="button" className="quiet" disabled={!!preview || !state.future.length} onClick={performRedo} title="Wiederholen (Strg+Umschalt+Z)" aria-label="Wiederholen"><ToolIcon name="redo" /></button>
          </div>}
          {!readOnly && <SnapToggle enabled={snapEnabled} onChange={setSnapEnabled} />}
          <span className={`save-state save-status save-${saveState.status}`} role="status">
            {pendingForms > 0
              ? 'Nicht übernommene Eingaben'
              : saveState.status === 'conflict' && saveState.conflictKind === 'lease'
                ? 'Bearbeitung abgelaufen'
                : statusText[saveState.status]}
          </span>
          {saveState.status === 'failed' && <button type="button" onClick={() => saver.retry()}>Erneut speichern</button>}
          {permissionReadOnly && onRequestEditing && <button type="button" onClick={onRequestEditing}>Bearbeitung anfordern</button>}
          <div className="workspace-viewbar" role="toolbar" aria-label="Ansichten">
            <div className="view-modes">{(narrowEditor ? (['plan', 'stage'] as const) : (['plan', 'stage', 'split'] as const)).map(mode =>
              <button key={mode} type="button" className="quiet" aria-pressed={view === mode} onClick={() => setView(mode)}>{VIEW_LABELS[mode]}</button>)}</div>
            <button type="button" className="quiet" onClick={toggleFullscreen} title="Vollbild" aria-label="Vollbild"><ToolIcon name="expand" /></button>
          </div>
        </header>
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
        <div className="tool-rail" role="toolbar" aria-label="Werkzeuge">
          <button type="button" aria-pressed={!insertChoice && !dimensioning && !cableDrawing && !placingGhost} className={insertChoice || dimensioning || cableDrawing || placingGhost ? '' : 'active'}
            onClick={() => {
              setInsertChoice(undefined); setToolMenu(undefined); setDimensioning(null); setCableDrawing(null);
              setSelectedDimension(undefined); setSelectedCableRunId(undefined); setSelectedCableVertex(undefined);
              cancelPlacement(); setSnapStatus(undefined);
            }} title="Auswählen, verschieben, drehen (Esc)" aria-label="Auswahl">
            <ToolIcon name="select" /><span>Auswahl</span>
          </button>
          <button type="button" aria-pressed={dimensioning !== null} disabled={readOnly || !!preview || (state.present.dimensions ?? []).length >= 200}
            onClick={() => {
              cancelPlacement(); setInsertChoice(undefined); setToolMenu(undefined); setCableDrawing(null); setSelectedDimension(undefined);
              if (dimensioning) { setDimensioning(null); setSnapStatus(undefined); }
              else {
                setDimensioning({});
                setSnapStatus('Ersten Punkt wählen. Der rote Punkt zeigt Ecke oder Kantenmitte. Escape bricht ab.');
              }
            }} title="Maß zwischen zwei Punkten, dann die Maßlinie zur Seite ziehen" aria-label="Maß hinzufügen">
            <ToolIcon name="expand" /><span>Maß</span>
          </button>
          <button type="button" aria-pressed={cableDrawing !== null} disabled={readOnly || !!preview || (state.present.cableRuns ?? []).length >= 250}
            onClick={() => {
              cancelPlacement(); setInsertChoice(undefined); setToolMenu(undefined); setDimensioning(null);
              setSelectedCableRunId(undefined); setSelectedCableVertex(undefined); setCablesOpen(true);
              if (cableDrawing) { setCableDrawing(null); setSnapStatus(undefined); }
              else {
                setCableDrawing({ points: [] });
                setSnapStatus('Kabel-Polylinie: Punkte im Grundriss setzen · Enter oder Doppelklick beendet · Escape bricht ab.');
              }
            }} title="Tatsächlichen Kabelweg als Polylinie zeichnen" aria-label="Kabel zeichnen">
            <ToolIcon name="expand" /><span>Kabel</span>
          </button>
          {toolGroups.map(group => {
            const primary = group.choices.find(choice => choiceKey(choice) === lastUsed[group.category]) ?? group.choices[0]!;
            const placing = !!insertChoice && group.choices.some(choice => choiceKey(choice) === choiceKey(insertChoice));
            return <div key={group.category} className="wall-tool">
              <button type="button" className={`wall-tool-primary${placing ? ' active' : ''}`} aria-pressed={placing}
                disabled={readOnly || catalog.loading} onClick={() => chooseInsert(primary, group.category)}
                title={`${primary.label} einsetzen`} aria-label={`${primary.label} einsetzen`}>
                <ToolIcon name={CATEGORY_ICONS[group.category] ?? 'plus'} /><span>{group.category}</span>
              </button>
              {group.choices.length > 1 && <button type="button" className="wall-tool-menu" disabled={readOnly || catalog.loading}
                aria-haspopup="dialog" aria-expanded={toolMenu?.category === group.category}
                title={`${group.category}: alle Bauteile und Größen`} aria-label={`${group.category}: weitere Bauteile`}
                onClick={event => {
                  const box = event.currentTarget.getBoundingClientRect();
                  setToolMenu(open => open?.category === group.category ? undefined
                    : { category: group.category, left: box.right + 6, top: Math.max(8, Math.min(box.top, window.innerHeight - 360)) });
                }}><span aria-hidden="true">▸</span></button>}
            </div>;
          })}
          <button type="button" onClick={() => { setToolMenu(undefined); dock.setActive('library'); }} title="Alle Bauteile in der Bibliothek" aria-label="Bibliothek öffnen">
            <ToolIcon name="library" /><span>Mehr …</span>
          </button>
        </div>
        {cablesOpen && <CableRunsPanel runs={state.present.cableRuns ?? []} selectedId={selectedCableRunId}
          onSelect={id => {
            setSelectedCableRunId(id);
            setSelectedCableVertex(undefined);
            if (id) { setSelectedIds([]); setSelectedDimension(undefined); setFixtureSelection(undefined); }
          }}
          onClose={() => setCablesOpen(false)}
          onChange={cableRuns => { if (!readOnly && !busyGesture()) commit({ ...state.present, cableRuns }); }} />}
        {openGroup && toolMenu && <>
          <div className="tool-menu-backdrop" onPointerDown={() => setToolMenu(undefined)} />
          <div className="wall-type-dialog tool-menu" role="dialog" aria-label={openGroup.category} style={{ left: toolMenu.left, top: toolMenu.top }}>
            <header><strong>{openGroup.category} einsetzen</strong>
              <button type="button" className="quiet" aria-label="Schließen" onClick={() => setToolMenu(undefined)}>×</button></header>
            <div className="wall-type-choices">{openGroup.choices.map(choice => {
              const [name, size] = choice.label.split(' · ');
              return <button key={choiceKey(choice)} type="button" aria-label={choice.label} onClick={() => chooseInsert(choice, openGroup.category)}>
                <strong>{name}</strong>{size && <span>{size}</span>}
              </button>;
            })}</div>
          </div>
        </>}
        <div className="workspace-main editor-grid dock-grid" data-dock-open={!!dock.active}>
          <div className={`editor-canvas editor-views editor-view-${view}`} data-mode={view}
            style={view === 'split' ? { gridTemplateColumns: `minmax(0, ${viewShare}fr) minmax(0, ${100 - viewShare}fr)` } : undefined}>
            {view !== 'stage' && plan}
            {view !== 'plan' && stage}
          </div>
          <EditorDock dock={dock} stageVisible={view !== 'plan'} onShowStage={() => setView('stage')}
            display={<PlanDisplayToggles value={planDisplay} onChange={setPlanDisplay} />}
            library={<div className="part-library"><h3>Bauteile</h3>
              <p className="muted">Die gängigen Bauteile stehen links in der Werkzeugleiste, nach Art sortiert.</p>
              {allParts.map(part => <div key={part.id} className="library-row"><div><strong>{part.name}</strong><br /><span className="muted">{part.category}</span></div>
                <button type="button" disabled={readOnly} onClick={() => chooseInsert({ partId: part.id, revision: part.latestRevision, label: part.name })}>Einsetzen</button></div>)}
              <SurfaceRegistryPanel readOnly={readOnly} />
            </div>}
            properties={selectedCurtain
              ? <aside className="wall-inspector"><h3>Molton-Vorhang</h3>
                <FixtureChoices curtains={sceneCurtains} doors={venueDoors} selected={fixtureSelection} onPick={pickVenueFixture} />
                <VenueCurtainOpenForm key={selectedCurtain.id} openPercent={selectedCurtain.openPercent} readOnly={readOnly}
                  onPendingChange={pending => setPendingForms(count => adjustPendingCount(count, pending))}
                  onApply={openPercent => { if (!busyGesture()) commit(setCurtainOpenPercent(state.present, selectedCurtain.id, openPercent)); }} />
              </aside>
              : selectedVenueDoor
              ? <aside className="wall-inspector"><h3>Spielstättentür</h3>
                <FixtureChoices curtains={sceneCurtains} doors={venueDoors} selected={fixtureSelection} onPick={pickVenueFixture} />
                <VenueDoorOpenForm key={selectedVenueDoor.id} openPercent={effectiveVenueDoorOpen(selectedVenueDoor, shown)} readOnly={readOnly}
                  onPendingChange={pending => setPendingForms(count => adjustPendingCount(count, pending))}
                  onApply={doorOpenPercent => { if (!busyGesture()) commit(setVenueDoorOpenPercent(state.present, selectedVenueDoor.id, doorOpenPercent)); }} />
              </aside>
              : selectedDimension
              ? <aside className="wall-inspector"><h3>Maß</h3><p className="muted">Ausgewähltes Maß ist orange hervorgehoben. Entf löscht es · Escape hebt die Auswahl auf.</p></aside>
              : selectedCableRunId
              ? <aside className="wall-inspector"><h3>Kabelweg</h3><p className="muted">Kabelweg orange. Nochmal auf die Linie klicken fügt einen Zwischenpunkt ein · Zwischenpunkt + Entf entfernt ihn · Entf ohne Punktwahl löscht den Weg · Endpunkte nur verschieben.</p></aside>
              : selectedGroup
              ? <GroupInspector layout={state.present} picked={selectedMembers} readOnly={readOnly}
                onPendingChange={pending => setPendingForms(count => adjustPendingCount(count, pending))}
                onChange={commit} />
              : selected
              ? <PartInspector item={selected} summary={summaryById.get(selected.object.part.id)}
                latestRevision={latestById.get(selected.object.part.id)} stockItems={stockItems}
                assignedElsewhere={stockAssignments(shown.objects, selected.object.id)}
                supports={supportOptions} readOnly={readOnly}
                onApply={commitObject} onRemove={removeSelected}
                onPendingChange={pending => setPendingForms(count => adjustPendingCount(count, pending))}
                onUpdateRevision={() => {
                  const revision = latestById.get(selected.object.part.id);
                  if (revision) commitObject({ ...selected.object, part: { ...selected.object.part, revision } });
                }} />
              : <aside className="wall-inspector"><h3>Keine Auswahl</h3><p className="muted">Bauteil im Grundriss oder in der Raumsicht wählen.</p>
                <FixtureChoices curtains={sceneCurtains} doors={venueDoors} onPick={pickVenueFixture} />
                <p>{shown.objects.length} Bauteile · {shown.joints.length} Verbindungen</p>
                {uniqueRefs(shown).length > 0 && <p className="muted">{uniqueRefs(shown).length} verwendete Bauteilrevisionen</p>}</aside>} />
        </div>
        <div className="workspace-statusbar">
          <span><span className="status-dot" />Bühnenbild · {shown.objects.length} Bauteile</span>
          <span className="selection-count" hidden={!selectedIds.length && !selectedDimension && !selectedCableRunId} data-testid="selection-count">{selectedCableRunId && selectedCableVertex !== undefined && selectedCableVertex > 0 && selectedCableVertex < ((shown.cableRuns ?? []).find(run => run.id === selectedCableRunId)?.path.length ?? 0) - 1 ? '1 Zwischenpunkt ausgewählt' : selectedCableRunId ? '1 Kabelweg ausgewählt' : selectedDimension ? '1 Maß ausgewählt' : `${selectedIds.length} ausgewählt`}</span>
          <span className="status-hint" role="status" title={snapStatus}>{snapStatus
            ?? (insertChoice ? 'Klicken setzt das Bauteil · Esc bricht ab'
              : placingGhost ? 'Klicken zum Platzieren · Escape bricht ab'
              : selectedIds.length ? 'Ziehen verschiebt · Oranger Griff ↻ dreht · Alt hält das Einrasten an · Entf löscht'
                : 'Klicken wählt aus · Ziehen auf freier Fläche wählt mehrere · Strg+Z macht rückgängig')}</span>
          {sceneLease.message && !permissionReadOnly && <span className="lease-status">{sceneLease.message}</span>}
          <button type="button" className="quiet" aria-expanded={helpOpen} onClick={() => setHelpOpen(open => !open)}><ToolIcon name="help" /> Bedienung</button>
          <span>Maße in mm</span>
        </div>
        {helpOpen && <div className="workspace-help"><h3>Arbeiten im Grundriss</h3>
          <p className="muted viewport-hint">Raster: 1 m · Zwei-Finger-Scroll oder Mittelklick verschiebt den Ausschnitt · Pinch oder Strg+Scroll zoomt · „Passend“ zeigt wieder die ganze Bühne.</p>
          <p>Bauteil links wählen und im Grundriss anklicken. Ziehen verschiebt, der orange Griff ↻ dreht in 15°-Schritten. Ziehen auf freier Fläche wählt alle vollständig umschlossenen Bauteile.</p>
          <p>In der Raumsicht zieht „Größe ziehen“ an Wänden und Podesten. Ein Bühnenelement bleibt ein Umriss, rastet auf 0,5&nbsp;m, und die Fugen zeigen die Lagerstücke (2×1, 2×0,5, 1×1, 1×0,5&nbsp;m).</p>
          <p>Einrasten: {SNAP_NOTICE} Der Schalter „Einrasten“ oben stellt es ab, die Alt-Taste setzt es für eine Bewegung aus.</p>
          <p>Strg+C kopiert, Strg+V hängt die Kopie an den Zeiger — Klick setzt sie, Escape bricht ab. Maß misst zwischen zwei Punkten, Kabel zeichnet einen Weg (Enter oder Doppelklick beendet). Entf löscht, Esc bricht Einsetzen und Bewegungen ab. Überschneidungen erscheinen rot.</p>
          <p><a href="#/hilfe">Zur vollständigen Hilfe</a></p>
        </div>}
      </section>
    </EditorDockContext>
  </SurfaceRegistryProvider>;
}

function FixtureChoices({ curtains, doors, selected, onPick }: {
  curtains: readonly { id: string; label: string }[];
  doors: readonly { id: string; label: string }[];
  selected?: VenueFixtureSelection;
  onPick: (fixture: VenueFixtureSelection) => void;
}) {
  if (!curtains.length && !doors.length) return null;
  const value = selected ? `${selected.kind}:${selected.id}` : '';
  return <>
    <label htmlFor="fixture-selection">Vorhang oder Tür</label>
    <select id="fixture-selection" value={value} onChange={event => {
      const [kind, id] = event.target.value.split(':');
      if ((kind === 'curtain' || kind === 'door') && id) onPick({ kind, id });
    }}>
      <option value="">Im Plan wählen</option>
      {curtains.map((curtain, index) => <option key={curtain.id} value={`curtain:${curtain.id}`}>V{index + 1}. {curtain.label}</option>)}
      {doors.map((door, index) => <option key={door.id} value={`door:${door.id}`}>Tür{index + 1}. {door.label}</option>)}
    </select>
  </>;
}

function VenueCurtainOpenForm({ openPercent, readOnly, onPendingChange, onApply }: {
  openPercent: number; readOnly: boolean; onPendingChange?: (pending: boolean) => void; onApply: (openPercent: number) => void;
}) {
  const { pending, resetKey, clearPending, discard, formProps } = usePendingApplyForm(onPendingChange);
  return <form key={resetKey} onSubmit={event => {
    event.preventDefault();
    const value = Number(new FormData(event.currentTarget).get('openPercent'));
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    clearPending(); onApply(value);
  }} {...formProps}><fieldset disabled={readOnly}>
    <p className="muted">Position und Spur kommen von der Spielstätte. Nur die Öffnung gilt für dieses Bühnenbild.</p>
    <label htmlFor="venue-curtain-open">Öffnung (%)</label>
    <input id="venue-curtain-open" name="openPercent" type="number" min={0} max={100} step={1} defaultValue={openPercent} data-testid="venue-curtain-open" />
    <p className="muted">0 % geschlossen, 100 % vollständig geöffnet / gerafft.</p>
    {!readOnly && <div className="form-actions">
      <button type="submit">Übernehmen</button>
      {pending && <button className="quiet" type="button" onClick={discard}>Verwerfen</button>}
    </div>}
  </fieldset></form>;
}

function VenueDoorOpenForm({ openPercent, readOnly, onPendingChange, onApply }: {
  openPercent: number; readOnly: boolean; onPendingChange?: (pending: boolean) => void; onApply: (openPercent: number) => void;
}) {
  const { pending, resetKey, clearPending, discard, formProps } = usePendingApplyForm(onPendingChange);
  return <form key={resetKey} onSubmit={event => {
    event.preventDefault();
    const value = Number(new FormData(event.currentTarget).get('doorOpenPercent'));
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    clearPending(); onApply(value);
  }} {...formProps}><fieldset disabled={readOnly}>
    <p className="muted">Feste Spielstättenwand — nur die Türöffnung ist pro Bühnenbild änderbar.</p>
    <label htmlFor="venue-door-open">Türöffnung (%)</label>
    <input id="venue-door-open" name="doorOpenPercent" type="number" min={0} max={100} step={1} defaultValue={openPercent} data-testid="venue-door-open" />
    <p className="muted">0 % geschlossen, 100 % = 90° offen.</p>
    {!readOnly && <div className="form-actions">
      <button type="submit">Übernehmen</button>
      {pending && <button className="quiet" type="button" onClick={discard}>Verwerfen</button>}
    </div>}
  </fieldset></form>;
}
