import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type PointerEvent } from 'react';
import { z } from 'zod';
import { applyWallFinish, selectionPivot } from '../../shared/editing.js';
import { navigatePlan } from './planNavigation.js';
import { sceneResizeDocument, resizedScene } from '../../shared/sceneResize.js';
import { editorCommand } from './interactionKeys.js';
import { layoutSelectionRotation, transformLayoutGesture, type TransformOperation } from '../../shared/plannerTransforms.js';
import type { StageEditing } from './StageEditing.js';
import { assemblyCaption } from '../../shared/assembly.js';
import { copySelection, cutSelection, pasteClipboard, removeSelection, type ClipboardMember, type LayoutClipboard } from '../../shared/clipboard.js';
import { groupContaining, type GroupMember } from '../../shared/groups.js';
import { execute, history, redo, undo, type History } from '../../shared/history.js';
import { layoutSchema, newBrace, newWall, wallCorners, wallSchema, type Brace, type Layout, type Scene, type VenueGeometry, type Wall } from '../../shared/layout.js';
import {
  SNAP_NOTICE, alignBraceToNearestWall, planRotationAt,
  snapStatusText, snapWallPose, type SnapGuide,
} from '../../shared/snapping.js';
import { membersInBounds, normalizeBounds, type PlanBounds } from '../../shared/selection.js';
import {
  AUDIENCE_FLOOR_ID, layoutDiagnostics, newPlatform, newStair, platformCentroid, reassignLayoutSupports,
  supportingSurfaces, type Platform, type StairUnit,
} from '../../shared/levels.js';
import { placeholderCorners, type Placeholder } from '../../shared/placeholders.js';
import { overheadBoxCorners, overheadClearance } from '../../shared/overhead.js';
import { braceCorners } from '../../shared/braceTransforms.js';
import { doorOpenAngleDegrees, isDoorOpening, resolveWall, typesOf, type Opening, type WallElementType } from '../../shared/wall-types.js';
import { measuredOutline } from '../../shared/venue.js';
import { planningWalls } from '../../shared/planningGeometry.js';
import { useViewportWheel } from './viewportWheel.js';
import { LEASE_HEARTBEAT_MS } from '../../shared/leases.js';
import { ApiError, request } from '../api.js';
import { Autosave, SaveConflict } from './autosave.js';
import { BraceInspector } from './BraceInspector.js';
import { BraceLayer } from './BraceLayer.js';
import { PlatformInspector, StairInspector } from './PlatformInspector.js';
import { PlatformLayer, SurfaceField } from './PlatformLayer.js';
import { RotationHandle } from './RotationHandle.js';
import { AssetLibrary } from './AssetLibrary.js';
import { assetListSchema, type Asset } from '../../shared/assets.js';
import { newPlaceholder } from '../../shared/placeholders.js';
import { StageView } from './StageView.js';
import { ExportPanel } from './ExportPanel.js';
import { WallTypePanel } from './WallTypePanel.js';
import { VenuePanel, InfrastructureMarks } from './VenuePanel.js';
import { useEditingLease } from './useEditingLease.js';
import { OverheadMarks } from './VenueOverhead.js';
import { KeepClearMarks } from './KeepClearZones.js';
import { objectOverlapWarnings } from '../../shared/overlap.js';
import { keepClearWarnings } from '../../shared/keepClear.js';
import { InventoryPanel } from './InventoryPanel.js';
import { AssemblyPanel } from './AssemblyPanel.js';
import { GroupInspector } from './GroupInspector.js';
import { ClipboardPanel } from './ClipboardPanel.js';
import { PlaceholderInspector, PlaceholderLibrary, addPlaceholder } from './PlaceholderInspector.js';
import { PlaceholderLayer } from './PlaceholderLayer.js';
import { ToolIcon } from './ToolIcon.js';
import { WallToolButton } from './WallToolButton.js';
import { AlignmentGuides, CentrelineMark, SnapToggle } from './SnapGuides.js';

const MaterialPicker = lazy(() => import('./MaterialPicker.js'));
const statusText = { saved: 'Gespeichert', pending: 'Änderungen ausstehend …', saving: 'Speichert …', failed: 'Speichern fehlgeschlagen', conflict: 'Neuere Fassung vorhanden' };
export function Editor({ initial, workspaceId, readOnly: permissionReadOnly, onClose, onDirty, onRequestEditing }: {
  initial: Scene; workspaceId: string; readOnly: boolean; onClose: () => void; onDirty: (value: boolean) => void; onRequestEditing?: () => void;
}) {
  const [state, setState] = useState<History>(() => history<Layout>({
    ...initial.layout, braces: initial.layout.braces ?? [], connections: initial.layout.connections ?? [],
    groups: initial.layout.groups ?? [], placeholders: initial.layout.placeholders ?? [],
  }));
  const root = useRef<HTMLElement>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [viewMode, setViewMode] = useState<'split' | 'plan' | 'stage'>('split');
  const [viewShare, setViewShare] = useState(55);
  const current = useRef(state);
  const stageGesture = useRef<{ layout: Layout; members: ClipboardMember[] } | undefined>(undefined);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetError, setAssetError] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    let active = true;
    request(`/api/workspaces/${workspaceId}/assets`).then(data => { if (active) setAssets(assetListSchema.parse(data)); }).catch(() => { if (active) setAssetError('Die Objektbibliothek konnte nicht geladen werden.'); });
    return () => { active = false; };
  }, [workspaceId]);
  const [selectedType, setSelectedType] = useState<string>();
  const [picked, setPicked] = useState<ClipboardMember[]>([]);
  const presentIds = new Set([...state.present.walls, ...state.present.braces, ...state.present.platforms ?? [], ...state.present.stairs ?? [], ...state.present.placeholders ?? []].map(item => item.id));
  const primary = picked.find(item => presentIds.has(item.id));
  const selected = primary?.kind === 'wall' ? primary.id : undefined;
  const selectedBrace = primary?.kind === 'brace' ? primary.id : undefined;
  const selectedPlatform = primary?.kind === 'platform' ? primary.id : undefined;
  const selectedStair = primary?.kind === 'stair' ? primary.id : undefined;
  const selectedPlaceholder = primary?.kind === 'placeholder' ? primary.id : undefined;
  const pickedPlatforms = picked.filter(item => item.kind === 'platform').map(item => item.id);
  useEffect(() => { root.current?.querySelector('.wall-inspector')?.scrollTo({ top: 0 }); }, [primary?.id]);
  const [clipboard, setClipboard] = useState<LayoutClipboard>();
  const [placing, setPlacing] = useState<{ wall: Wall; pendingType?: WallElementType }>();
  const placingRef = useRef<{ wall: Wall; pendingType?: WallElementType } | undefined>(undefined);
  const objectPlacement = useRef<{ start: Layout; latest: Layout; member: ClipboardMember; origin: { x: number; y: number } } | undefined>(undefined);
  const [groupPreview, setGroupPreview] = useState<Layout>();
  const [panelLabels, setPanelLabels] = useState<Record<string, string>>({});
  const [exportsOpen, setExportsOpen] = useState(false);
  const [venueOpen, setVenueOpen] = useState(false);
  const [venueDirty, setVenueDirty] = useState(false);
  const [venue, setVenue] = useState<VenueGeometry>(initial.venue);
  const [updateAvailable, setUpdateAvailable] = useState(!!initial.venueUpdateAvailable);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [snapStatus, setSnapStatus] = useState<string>();
  const [marqueeBox, setMarqueeBox] = useState<PlanBounds>();
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const planGesture = useRef<{
    start: Layout; latest: Layout; members: ClipboardMember[]; previousSelection: ClipboardMember[];
    pointer: { x: number; y: number }; pivot: { x: number; y: number }; operation: TransformOperation;
  } | undefined>(undefined);
  const marqueeDrag = useRef<{ x: number; y: number; endX: number; endY: number; additive: boolean; previousSelection: ClipboardMember[] } | undefined>(undefined);
  const panDrag = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | undefined>(undefined);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const svg = useRef<SVGSVGElement>(null);
  const [saver] = useState(() => new Autosave({
    ...initial.layout, braces: initial.layout.braces ?? [], connections: initial.layout.connections ?? [],
    groups: initial.layout.groups ?? [], placeholders: initial.layout.placeholders ?? [],
  }, initial.revision, async (layout, revision) => {
    try {
      const result = await request(`/api/workspaces/${workspaceId}/scenes/${initial.id}/layout`, { revision, layout }, 'PUT');
      return z.object({ revision: z.number().int() }).parse(result).revision;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 423)) throw new SaveConflict(error.status === 423 ? 'lease' : 'revision');
      throw error;
    }
  }));
  const saveState = useSyncExternalStore(saver.subscribe, saver.getSnapshot);
  const readOnly = permissionReadOnly || saveState.status === 'conflict';
  const venueLease = useEditingLease(`/api/workspaces/${workspaceId}/venues/${initial.venueId}`, venueOpen && !readOnly);
  useEffect(() => { if (venueOpen && !readOnly) void venueLease.acquire(); }, [venueOpen, readOnly]);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recovering, setRecovering] = useState(false);
  async function recoverDraft() {
    const name = window.prompt('Name der Szenenvorlage', `${initial.name} – gesicherter Entwurf`);
    if (!name) return;
    setRecovering(true);
    try {
      await request(`/api/workspaces/${workspaceId}/scenes/${initial.id}/recover`, {
        name, layout: current.current.present, sourceSurfaces: (venue.platforms ?? []).map(({ id, label }) => ({ id, label })),
      });
      setRecoveryMessage('Entwurf als Szenenvorlage gesichert. Sie finden ihn in der Übersicht.');
    } catch (error) { setRecoveryMessage(error instanceof ApiError ? error.message : 'Entwurf konnte nicht gesichert werden. Bitte herunterladen.'); }
    finally { setRecovering(false); }
  }
  const dirty = venueDirty || saveState.dirty || !!groupPreview || !!placing;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (readOnly) return;
    const tick = window.setInterval(() => {
      request(`/api/workspaces/${workspaceId}/scenes/${initial.id}/lease/heartbeat`, {}).catch(error => {
        saver.markConflict('lease');
      });
    }, LEASE_HEARTBEAT_MS);
    return () => clearInterval(tick);
  }, [readOnly, saver, workspaceId, initial.id]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saver.getSnapshot().dirty || busyGesture()) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); saver.dispose(); onDirty(false); };
  }, [saver, onDirty]);
  function apply(next: History) {
    if (readOnly || busyGesture() || next === current.current) return;
    current.current = next;
    setState(next);
    saver.queue(next.present);
  }
  function commit(layout: Layout) {
    const withSupports = reassignLayoutSupports(layout, venue);
    const valid = layoutSchema.safeParse(withSupports);
    if (!valid.success) { setSnapStatus('Änderung nicht übernommen: ungültige Maße oder Objektverweise.'); return; }
    apply(execute(current.current, valid.data));
  }
  function adoptVenue(result: { venue: VenueGeometry; layout: Layout; revision: number; venueUpdateAvailable: boolean }) {
    setVenue(result.venue);
    const next = history({
      ...result.layout, braces: result.layout.braces ?? [], connections: result.layout.connections ?? [],
      groups: result.layout.groups ?? [], placeholders: result.layout.placeholders ?? [],
    });
    current.current = next;
    setState(next);
    saver.adopt(next.present, result.revision);
    setUpdateAvailable(!!result.venueUpdateAvailable);
  }
  function replace(wall: Wall) { commit({ ...current.current.present, walls: current.current.present.walls.map(item => item.id === wall.id ? wall : item) }); }
  function applyWall(wall: Wall) {
    const present = current.current.present;
    const withPrimary = { ...present, walls: present.walls.map(item => item.id === wall.id ? wall : item) };
    const wallIds = selection().flatMap(item => item.kind === 'wall' ? [item.id] : []);
    const targets = wallIds.includes(wall.id) ? wallIds : [wall.id];
    commit(targets.length > 1 ? applyWallFinish(withPrimary, targets, wall.finish) : withPrimary);
  }
  function applyType(type: WallElementType) {
    const present = current.current.present;
    const types = typesOf(present);
    commit({
      ...present,
      wallTypes: types.some(item => item.id === type.id) ? types.map(item => item.id === type.id ? type : item) : [...types, type],
      walls: present.walls.map(wall => wall.typeId === type.id ? { ...wall, width: type.width, height: type.height, thickness: type.thickness } : wall),
    });
    setSelectedType(type.id);
  }
  function beginPlacingWall(type?: WallElementType) {
    const present = current.current.present;
    if (readOnly || busyGesture() || present.walls.length >= 250) return;
    const types = typesOf(present);
    let pendingType: WallElementType | undefined;
    let wall: Wall;
    if (type) {
      const known = types.find(item => item.id === type.id)
        ?? types.find(item => item.name === type.name && item.width === type.width && item.height === type.height && item.thickness === type.thickness
          && item.openings.length === type.openings.length);
      const resolved = known ?? type;
      pendingType = known ? undefined : resolved;
      wall = {
        ...newWall(crypto.randomUUID(), venue.width / 2, venue.depth / 2),
        typeId: resolved.id, label: resolved.name, width: resolved.width, height: resolved.height, thickness: resolved.thickness,
      };
      setSelectedType(resolved.id);
    } else {
      wall = newWall(crypto.randomUUID(), venue.width / 2, venue.depth / 2);
    }
    const draft = { wall, pendingType };
    placingRef.current = draft;
    setPlacing(draft);
    setGuides([]);
    setSnapStatus('Klicken zum Platzieren · Escape abbricht');
  }
  function cancelPlacing() {
    objectPlacement.current = undefined; setGroupPreview(undefined);
    placingRef.current = undefined;
    setPlacing(undefined);
    setGuides([]);
    setSnapStatus(undefined);
  }
  function commitPlacing() {
    const object = objectPlacement.current;
    if (object) {
      objectPlacement.current = undefined; setGroupPreview(undefined);
      commit(object.latest); pick(object.member, false); setGuides([]); setSnapStatus(undefined); return;
    }
    const draft = placingRef.current;
    if (!draft) return;
    const present = current.current.present;
    if (present.walls.length >= 250) { cancelPlacing(); return; }
    const types = typesOf(present);
    placingRef.current = undefined;
    commit({
      ...present,
      wallTypes: draft.pendingType ? [...types, draft.pendingType] : present.wallTypes,
      walls: [...present.walls, draft.wall],
    });
    placingRef.current = undefined;
    setPlacing(undefined);
    setGuides([]);
    setSnapStatus(undefined);
    pick({ kind: 'wall', id: draft.wall.id }, false);
  }
  function placeType(type: WallElementType) {
    beginPlacingWall(type);
  }
  function removeType(id: string) {
    const present = current.current.present;
    commit({
      ...present,
      wallTypes: typesOf(present).filter(type => type.id !== id),
      walls: present.walls.map(wall => wall.typeId === id ? { ...wall, typeId: undefined } : wall),
    });
    setSelectedType(undefined);
  }
  function replaceBrace(brace: Brace) { commit({ ...current.current.present, braces: current.current.present.braces.map(item => item.id === brace.id ? brace : item) }); }
  function replacePlaceholder(item: Placeholder) {
    commit({ ...current.current.present, placeholders: (current.current.present.placeholders ?? []).map(entry => entry.id === item.id ? item : entry) });
  }
  function replacePlatform(platform: Platform) {
    commit({ ...current.current.present, platforms: (current.current.present.platforms ?? []).map(item => item.id === platform.id ? platform : item) });
  }
  function replaceStair(stair: StairUnit) {
    commit({ ...current.current.present, stairs: (current.current.present.stairs ?? []).map(item => item.id === stair.id ? stair : item) });
  }
  function clearSelection() { pickedRef.current = []; setPicked([]); }
  function setSelection(members: ClipboardMember[]) { pickedRef.current = members; setPicked(members); }
  function selection(): ClipboardMember[] {
    const present = current.current.present;
    const ids = new Set([...present.walls, ...present.braces, ...present.platforms ?? [], ...present.stairs ?? [], ...present.placeholders ?? []].map(item => item.id));
    return pickedRef.current.filter(item => ids.has(item.id));
  }
  function applyHits(hit: ClipboardMember[], additive: boolean) {
    setSelection(additive ? [...selection(), ...hit.filter(item => !selection().some(old => old.id === item.id))] : hit);
  }
  function pick(member: ClipboardMember, additive: boolean) {
    if (busyGesture()) return;
    const old = selection();
    if (additive) setSelection(old.some(item => item.id === member.id) ? old.filter(item => item.id !== member.id) : [member, ...old]);
    else {
      const group = member.kind === 'platform' ? undefined : groupContaining(current.current.present, { kind: member.kind, id: member.id });
      setSelection(group ? [member, ...group.members.filter(item => item.id !== member.id)] : [member]);
    }
  }
  function remove() {
    if (busyGesture()) return;
    commit(removeSelection(current.current.present, selection()));
    clearSelection();
  }
  function copy() {
    if (busyGesture()) return;
    const taken = copySelection(current.current.present, selection());
    if (taken) setClipboard(taken);
  }
  function cut() {
    if (busyGesture()) return;
    const result = cutSelection(current.current.present, selection());
    if (!result.clipboard) return;
    setClipboard(result.clipboard);
    commit(result.layout);
    clearSelection();
  }
  function paste() {
    if (busyGesture()) return;
    if (!clipboard) return;
    const result = pasteClipboard(current.current.present, clipboard, () => crypto.randomUUID());
    commit(result.layout);
    if (result.consumed) setClipboard(undefined);
    setSelection(result.pasted);
    if (!result.consumed && result.pasted.length) setClipboard(copySelection(result.layout, result.pasted));
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (venueOpen) return;
      const command = editorCommand(event);
      if (!command) return;
      event.preventDefault();
      if (command === 'cancel') {
        if (placingRef.current || objectPlacement.current) cancelPlacing();
        else if (planGesture.current || marqueeDrag.current || panDrag.current) finish(true);
        else if (!stageGesture.current) clearSelection();
        return;
      }
      if (readOnly || busyGesture()) return;
      if (command === 'undo') apply(undo(current.current));
      else if (command === 'redo') apply(redo(current.current));
      else if (command === 'copy') copy();
      else if (command === 'cut') cut();
      else if (command === 'paste') paste();
      else if (command === 'delete') remove();
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });
  const selectedWall = state.present.walls.find(wall => wall.id === selected);
  const selectedWallCount = selection().filter(item => item.kind === 'wall').length;
  const wallTypes = typesOf(state.present);
  const selectedBraceItem = state.present.braces.find(brace => brace.id === selectedBrace);
  const selectedPlatformItem = (state.present.platforms ?? []).find(item => item.id === selectedPlatform);
  const selectedStairItem = (state.present.stairs ?? []).find(item => item.id === selectedStair);
  const selectedPlaceholderItem = (state.present.placeholders ?? []).find(item => item.id === selectedPlaceholder);
  const surfaces = supportingSurfaces(venue, state.present);
  const diagnostics = layoutDiagnostics(state.present, venue);
  const liveLayout = groupPreview ?? state.present;
  const overheadWarnings = overheadClearance(liveLayout, venue);
  const overlapWarnings = keepClearWarnings(venue, {
    ...liveLayout,
    placeholders: [...(liveLayout.placeholders ?? []), ...(venue.placeholders ?? [])],
  });
  const raised = surfaces.find(surface => surface.id !== AUDIENCE_FLOOR_ID);
  function point(event: { clientX: number; clientY: number }) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const value = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(value.x), y: Math.round(-value.y) };
  }
  function busyGesture() {
    return !!(placingRef.current || objectPlacement.current || planGesture.current || stageGesture.current || marqueeDrag.current || panDrag.current);
  }
  function startPan(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 1 || busyGesture()) return;
    event.preventDefault(); event.stopPropagation();
    panDrag.current = { clientX: event.clientX, clientY: event.clientY, panX: viewPan.x, panY: viewPan.y };
    event.currentTarget.style.cursor = 'grabbing';
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startObject(event: PointerEvent<SVGGElement>, member: ClipboardMember, operation: TransformOperation = 'translate') {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (busyGesture()) return;
    if (event.shiftKey) { pick(member, true); return; }
    const previousSelection = selection();
    if (!previousSelection.some(item => item.id === member.id)) pick(member, false);
    if (readOnly) return;
    const members = selection();
    const pivot = selectionPivot(current.current.present, members);
    if (!pivot) return;
    planGesture.current = { start: current.current.present, latest: current.current.present, members, previousSelection, pointer: point(event), pivot, operation };
    setGroupPreview(current.current.present);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  const start = (event: PointerEvent<SVGGElement>, wall: Wall) => startObject(event, { kind: 'wall', id: wall.id });
  const startBrace = (event: PointerEvent<SVGGElement>, item: Brace) => startObject(event, { kind: 'brace', id: item.id });
  const startPlatform = (event: PointerEvent<SVGGElement>, item: Platform) => startObject(event, { kind: 'platform', id: item.id });
  const startStair = (event: PointerEvent<SVGGElement>, item: StairUnit) => startObject(event, { kind: 'stair', id: item.id });
  const startPlaceholder = (event: PointerEvent<SVGGElement>, item: Placeholder) => startObject(event, { kind: 'placeholder', id: item.id });
  const startRotate = (event: PointerEvent<SVGGElement>, item: Wall) => startObject(event, { kind: 'wall', id: item.id }, 'rotate');
  const startRotateBrace = (event: PointerEvent<SVGGElement>, item: Brace) => startObject(event, { kind: 'brace', id: item.id }, 'rotate');
  const startPlatformRotate = (event: PointerEvent<SVGGElement>, item: Platform) => startObject(event, { kind: 'platform', id: item.id }, 'rotate');
  const startRotateStair = (event: PointerEvent<SVGGElement>, item: StairUnit) => startObject(event, { kind: 'stair', id: item.id }, 'rotate');
  const startRotatePlaceholder = (event: PointerEvent<SVGGElement>, item: Placeholder) => startObject(event, { kind: 'placeholder', id: item.id }, 'rotate');
  function startMarquee(event: PointerEvent<SVGPathElement>) {
    if (event.button !== 0 || readOnly || busyGesture()) return;
    const position = point(event);
    marqueeDrag.current = { ...position, additive: event.shiftKey, endX: position.x, endY: position.y, previousSelection: selection() };
    if (!event.shiftKey) clearSelection();
    setMarqueeBox(normalizeBounds(position, position));
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function updatePlacingAt(position: { x: number; y: number }, bypass: boolean) {
    const object = objectPlacement.current;
    if (object) {
      const result = transformLayoutGesture(object.start, venue, [object.member], { x: position.x - object.origin.x, y: position.y - object.origin.y, rotation: 0 }, 'translate', bypass);
      object.latest = result.layout; setGroupPreview(result.layout); setGuides(result.guides); return;
    }
    const draft = placingRef.current;
    if (!draft) return;
    const clamp = (value: number) => Math.max(-100000, Math.min(100000, Math.round(value)));
    const types = draft.pendingType ? [...typesOf(current.current.present), draft.pendingType] : typesOf(current.current.present);
    const walls = planningWalls(current.current.present, venue);
    const next = { ...draft.wall, x: clamp(position.x), y: clamp(position.y) };
    const snapped = snapWallPose(resolveWall(next, types), walls, venue.stageCentreline, { bypass });
    const wall = { ...next, x: clamp(snapped.x), y: clamp(snapped.y) };
    const updated = { ...draft, wall };
    placingRef.current = updated;
    setPlacing(updated);
    setGuides(snapped.guides);
    setSnapStatus(snapStatusText({ guides: snapped.guides }) ?? 'Klicken zum Platzieren · Escape abbricht');
  }
  function move(event: PointerEvent) {
    const panning = panDrag.current;
    if (panning) {
      const rect = svg.current?.getBoundingClientRect();
      if (rect && rect.width && rect.height) {
        const mmPerPxX = viewW / rect.width;
        const mmPerPxY = viewH / rect.height;
        setViewPan({
          x: panning.panX - (event.clientX - panning.clientX) * mmPerPxX,
          y: panning.panY + (event.clientY - panning.clientY) * mmPerPxY,
        });
      }
      return;
    }
    const position = point(event);
    const bypass = event.altKey || !snapEnabled;
    if (placingRef.current || objectPlacement.current) { updatePlacingAt(position, bypass); return; }
    const marquee = marqueeDrag.current;
    if (marquee) { marquee.endX = position.x; marquee.endY = position.y; setMarqueeBox(normalizeBounds(marquee, position)); return; }
    const held = planGesture.current;
    if (!held) return;
    const delta = held.operation === 'translate'
      ? { x: position.x - held.pointer.x, y: position.y - held.pointer.y, rotation: 0 }
      : { x: 0, y: 0, rotation: planRotationAt(held.pivot, position) - planRotationAt(held.pivot, held.pointer) };
    const result = transformLayoutGesture(held.start, venue, held.members, delta, held.operation, bypass);
    held.latest = result.layout;
    setGroupPreview(result.layout); setGuides(result.guides);
    setSnapStatus(snapStatusText({ guides: result.guides }));
  }
  function finish(cancelled = false) {
    if (panDrag.current) { panDrag.current = undefined; if (svg.current) svg.current.style.cursor = ''; return; }
    const marquee = marqueeDrag.current;
    marqueeDrag.current = undefined; setMarqueeBox(undefined);
    if (marquee) {
      if (cancelled) setSelection(marquee.previousSelection);
      else applyHits(membersInBounds(current.current.present, normalizeBounds(marquee, { x: marquee.endX, y: marquee.endY })), marquee.additive);
      return;
    }
    const held = planGesture.current;
    planGesture.current = undefined;
    setGroupPreview(undefined); setGuides([]); setSnapStatus(undefined);
    if (!held) return;
    if (cancelled) setSelection(held.previousSelection);
    else if (JSON.stringify(held.start) !== JSON.stringify(held.latest)) commit(held.latest);
  }
  // Bounds stay fixed during a gesture, so moving an object cannot move its coordinate system.
  const shown = groupPreview ?? state.present;
  const groupedIds = new Set(selection().map(item => `${item.kind}:${item.id}`));
  const selectionBundle = selection().length > 1 ? { members: selection(), rotation: layoutSelectionRotation(state.present, selection()) } : undefined;
  const selectionCentre = selectionBundle ? selectionPivot(shown, selectionBundle.members) : undefined;
  const selectionHandleWidth = 1200;
  const corners = [
    ...state.present.walls.flatMap(wall => wallCorners(resolveWall(wall, wallTypes))),
    ...state.present.braces.flatMap(braceCorners),
    ...(state.present.placeholders ?? []).flatMap(placeholderCorners),
  ];
  const floor = measuredOutline(venue);
  const infra = [...(venue.connectionPoints ?? []), ...(venue.cableRoutingCorridors ?? []).flatMap(corridor => corridor.path),
    ...(venue.overheadBoxes ?? []).flatMap(overheadBoxCorners),
    ...(venue.keepClearZones ?? []).flatMap(zone => zone.polygon),
    ...(venue.stageCentreline ? [venue.stageCentreline] : [])];
  const minX = Math.min(0, ...floor.map(p => p.x), ...infra.map(p => p.x), ...corners.map(p => p.x)) - 600;
  const maxX = Math.max(venue.width, ...floor.map(p => p.x), ...infra.map(p => p.x), ...corners.map(p => p.x)) + 600;
  const minY = Math.min(0, ...floor.map(p => p.y), ...infra.map(p => p.y), ...corners.map(p => p.y)) - 800;
  const maxY = Math.max(venue.depth, ...floor.map(p => p.y), ...infra.map(p => p.y), ...corners.map(p => p.y)) + 600;
  const fitW = Math.max(1, maxX - minX), fitH = Math.max(1, maxY - minY);
  const viewW = fitW / viewZoom, viewH = fitH / viewZoom;
  const viewCx = (minX + maxX) / 2 + viewPan.x, viewCy = (minY + maxY) / 2 + viewPan.y;
  const viewBox = `${viewCx - viewW / 2} ${-(viewCy + viewH / 2)} ${viewW} ${viewH}`;
  const objectOverlaps = objectOverlapWarnings(shown);
  function onPlanWheel(event: WheelEvent) {
    if (busyGesture()) return;
    const next = navigatePlan(event, { zoom: viewZoom, pan: viewPan, centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } }, point(event));
    if (next) { event.preventDefault(); setViewZoom(next.zoom); setViewPan(next.pan); }
  }
  useViewportWheel(svg, onPlanWheel, !venueOpen);
  function stageSelect(id: string, additive: boolean) {
    if (busyGesture()) return;
    const member = membersInBounds(current.current.present, { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity }).find(item => item.id === id);
    if (member) pick(member, additive);
  }
  const stageTransform: StageEditing['onTransform'] = (phase, delta, bypass, operation = 'translate') => {
    if (readOnly) return;
    if (phase === 'begin') { if (!busyGesture()) { stageGesture.current = { layout: current.current.present, members: selection() }; setGroupPreview(current.current.present); } return; }
    if (phase === 'cancel') { stageGesture.current = undefined; setGroupPreview(undefined); setGuides([]); return; }
    const held = stageGesture.current;
    if (!held) return;
    const result = transformLayoutGesture(held.layout, venue, held.members, delta, operation, bypass);
    setGuides(result.guides);
    if (phase === 'preview') setGroupPreview(result.layout);
    else { stageGesture.current = undefined; setGroupPreview(undefined); setGuides([]); if (JSON.stringify(result.layout) !== JSON.stringify(held.layout)) commit(result.layout); }
  };
  const stageResize: StageEditing['onPushPull'] = (phase, next) => {
    if (readOnly) return;
    if (phase === 'begin') { if (!busyGesture()) { stageGesture.current = { layout: current.current.present, members: selection() }; setGroupPreview(current.current.present); } return; }
    if (phase === 'cancel') { stageGesture.current = undefined; setGroupPreview(undefined); return; }
    const held = stageGesture.current;
    if (!held) return;
    const result = resizedScene(held.layout, next);
    if (phase === 'preview') setGroupPreview(result);
    else { stageGesture.current = undefined; setGroupPreview(undefined); if (JSON.stringify(result) !== JSON.stringify(held.layout)) commit(result); }
  };
  function placeAsset(asset: Asset) {
    if (readOnly || busyGesture()) return;
    setLibraryOpen(false);
    if (viewMode === 'stage') setViewMode('split');
    const definition = asset.definition, id = crypto.randomUUID(), x = venue.width / 2, y = venue.depth / 2;
    if (definition.kind === 'wall') {
      const { typeId: _type, panelId: _panel, assemblyNumber: _assembly, ...template } = definition.template;
      const wall = { ...template, id, label: asset.name, x, y, rotation: 0, supportingSurfaceId: AUDIENCE_FLOOR_ID };
      const draft = { wall };
      placingRef.current = draft;
      setPlacing(draft);
      setGuides([]);
      setSnapStatus('Klicken zum Platzieren · Escape abbricht');
    } else {
      const brace = definition.kind === 'brace' ? { ...definition.template, id, label: asset.name, x, y, rotation: 0, supportingSurfaceId: AUDIENCE_FLOOR_ID } : undefined;
      const item = definition.kind === 'model' ? { ...newPlaceholder('box', id, x, y), label: asset.name, assetId: asset.id, width: definition.width, height: definition.height, depth: definition.depth } : undefined;
      const start = brace ? { ...current.current.present, braces: [...current.current.present.braces, brace] }
        : { ...current.current.present, placeholders: [...current.current.present.placeholders ?? [], item!] };
      objectPlacement.current = { start, latest: start, member: { kind: brace ? 'brace' : 'placeholder', id }, origin: { x, y } };
      setGroupPreview(start); setGuides([]); setSnapStatus('Klicken zum Platzieren · Escape abbricht');
    }
  }
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...initial, revision: saveState.revision, layout: current.current.present }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `buehnenentwurf-${initial.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section ref={root} className="editor" aria-label="Bühnenbild bearbeiten">
    <div className="editor-heading"><button className="quiet back-button" disabled={dirty} onClick={onClose} title="Zur Übersicht" aria-label="Zur Übersicht"><ToolIcon name="back" /></button><div><p className="eyebrow">{initial.productionName} · {initial.venueName}</p><h2>{initial.name}</h2></div>
      <span className={`save-status ${saveState.status}`} role="status">{permissionReadOnly
        ? (initial.lease ? `Nur Ansicht · Bearbeitung durch ${initial.lease.holderName}` : 'Nur Ansicht')
        : saveState.status === 'conflict' && saveState.conflictKind === 'lease' ? 'Bearbeitung abgelaufen' : statusText[saveState.status]}</span><div className="document-history">{!readOnly && <>
      <button className="quiet" disabled={!!groupPreview || !!placing || !state.past.length} onClick={() => apply(undo(current.current))} hidden={venueOpen} title="Rückgängig (Strg+Z)" aria-label="Rückgängig"><ToolIcon name="undo" /></button>
      <button className="quiet" disabled={!!groupPreview || !!placing || !state.future.length} onClick={() => apply(redo(current.current))} hidden={venueOpen} title="Wiederholen (Strg+Shift+Z)" aria-label="Wiederholen"><ToolIcon name="redo" /></button></>}</div><span className="document-kind">{venueOpen ? 'Spielstätte bearbeiten' : 'Bühnenbild'}</span></div>
    <div className="workspace-commandbar">
    <div className="editor-toolbar">
      <button className="quiet" aria-expanded={venueOpen} disabled={venueOpen ? venueDirty : dirty} onClick={() => { setVenueOpen(open => !open); setExportsOpen(false); }}>{venueOpen ? 'Spielstätte schließen' : 'Spielstätte'}</button>
      <button className="quiet" aria-expanded={exportsOpen} onClick={() => { setExportsOpen(open => !open); setLibraryOpen(false); }}>{exportsOpen ? 'Export schließen' : 'Konstruktionsplan'}</button>
      {!readOnly && <SnapToggle enabled={snapEnabled} onChange={setSnapEnabled} />}

      {snapStatus && <span className="snap-status" role="status">{snapStatus}</span>}

    </div>
    <div className="workspace-viewbar" hidden={venueOpen} role="toolbar" aria-label="Ansichten">
      <div className="view-modes">{(['split', 'plan', 'stage'] as const).map(mode => <button key={mode} type="button" className="quiet" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>{mode === 'split' ? '2D + 3D' : mode === 'plan' ? 'Grundriss' : 'Raumansicht'}</button>)}</div>
      <label className="split-control" hidden={viewMode !== 'split'}>Aufteilung<input aria-label="Ansichten aufteilen" type="range" min="30" max="70" value={viewShare} onChange={event => setViewShare(Number(event.target.value))} /></label>
      <button type="button" className="quiet" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(open => !open)} title={inspectorOpen ? 'Eigenschaften ausblenden' : 'Eigenschaften einblenden'} aria-label="Eigenschaften"><ToolIcon name="tray" /></button>
      <button type="button" className="quiet" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen(); }} title="Vollbild" aria-label="Vollbild"><ToolIcon name="expand" /></button>
    </div>
    </div>
    <div className="tool-rail" hidden={venueOpen} role="toolbar" aria-label="Objekte hinzufügen">
      <button className="quiet" onClick={() => { setLibraryOpen(open => !open); setExportsOpen(false); }} aria-expanded={libraryOpen} title="Objektbibliothek" aria-label="Objektbibliothek"><ToolIcon name="library" /><span>Bibliothek</span></button>
      {!readOnly && <><WallToolButton
        disabled={!!groupPreview || state.present.walls.length >= 250}
        sceneTypes={wallTypes}
        onAddPlain={() => beginPlacingWall()}
        onAddType={placeType} />
      <button disabled={!!groupPreview || !!placing || state.present.braces.length >= 250} onClick={() => {
        const brace = newBrace(crypto.randomUUID(), venue.width / 2, venue.depth / 2);
        commit({ ...state.present, braces: [...state.present.braces, brace] }); pick({ kind: 'brace', id: brace.id }, false);
      }} title="Stütze hinzufügen" aria-label="Stütze hinzufügen"><ToolIcon name="brace" /><span>Stütze</span></button>
      <button disabled={!!groupPreview || !!placing || (state.present.platforms ?? []).length >= 250} onClick={() => {
        const platform = newPlatform(crypto.randomUUID(), venue.width / 2, venue.depth / 2);
        commit({ ...state.present, platforms: [...state.present.platforms ?? [], platform] }); pick({ kind: 'platform', id: platform.id }, false);
      }} title="Podest hinzufügen" aria-label="Podest hinzufügen"><ToolIcon name="platform" /><span>Podest</span></button>
      <button disabled={!!groupPreview || !!placing || !raised || (state.present.stairs ?? []).length >= 250} onClick={() => {
        if (!raised) return;
        const stair = newStair(crypto.randomUUID(), AUDIENCE_FLOOR_ID, raised.id, venue.width / 2, venue.depth / 2);
        commit({ ...state.present, stairs: [...state.present.stairs ?? [], stair] }); pick({ kind: 'stair', id: stair.id }, false);
      }} title="Treppe hinzufügen" aria-label="Treppe hinzufügen"><ToolIcon name="stairs" /><span>Treppe</span></button>
      </>}
    </div>
    {assetError && <p className="error" role="alert">{assetError}</p>}
    {libraryOpen && !venueOpen && <AssetLibrary workspaceId={workspaceId} assets={assets} readOnly={readOnly || busyGesture()} selected={selectedWall ?? selectedBraceItem} onCreated={asset => setAssets(items => [...items, asset])} onArchive={id => setAssets(items => items.map(asset => asset.id === id ? { ...asset, archived: true } : asset))} onPlace={placeAsset} />}
    {venueOpen && !readOnly && <p role="status">{venueLease.message || 'Bearbeitung wird angefordert …'} {!venueLease.holding && <button onClick={() => void venueLease.acquire()}>Bearbeitung erneut anfordern</button>}</p>}
    {venueOpen && <VenuePanel workspaceId={workspaceId} sceneId={initial.id} venue={venue} venueUpdateAvailable={updateAvailable} readOnly={readOnly || !venueLease.holding} onDirty={setVenueDirty} onSaved={adoptVenue} />}
    {exportsOpen && <div className="export-drawer"><ExportPanel workspaceId={workspaceId} sceneId={initial.id} productionId={initial.productionId}
      readOnly={readOnly} freezeDisabled={dirty || saveState.status !== 'saved'} groups={state.present.groups ?? []} walls={state.present.walls} /></div>}
    {['failed', 'conflict'].includes(saveState.status) && <div className="error" role="alert">
      <p>{saveState.status === 'conflict'
        ? (saveState.conflictKind === 'lease'
          ? 'Die Bearbeitungsberechtigung ist abgelaufen. Ihre Änderungen bleiben hier erhalten und werden nicht überschrieben.'
          : 'Eine neuere Fassung ist gespeichert. Ihre Änderungen bleiben hier erhalten und werden nicht darübergeschrieben.')
        : 'Ihre Änderungen sind noch nicht gespeichert. Prüfen Sie die Verbindung; bei abgelaufener Anmeldung sichern Sie zunächst den lokalen Entwurf.'}</p>
      {saveState.status === 'failed' && <button onClick={() => saver.retry()}>Speichern erneut versuchen</button>}{' '}
      <button onClick={downloadDraft}>Lokalen Entwurf herunterladen</button>{' '}
      <button disabled={recovering} onClick={() => void recoverDraft()}>Entwurf als Szenenvorlage sichern</button>
      {recoveryMessage && <p role="status">{recoveryMessage}</p>}
      <button className="quiet" onClick={() => { if (window.confirm('Lokale Änderungen verwerfen und die gespeicherte Fassung laden?')) { saver.dispose(); onDirty(false); onClose(); } }}>Gespeicherte Fassung laden</button>
    </div>}
    {permissionReadOnly && onRequestEditing && <p role="status">Eine Bearbeitung ist möglich, sobald die bisherige Freigabe endet (spätestens 45 Sekunden nach dem letzten Lebenszeichen). <button onClick={onRequestEditing}>Bearbeitung erneut anfordern</button></p>}
    {!venueOpen && <div className="editor-grid" data-inspector-open={inspectorOpen}><div className="editor-views" data-mode={viewMode} style={viewMode === 'split' ? { gridTemplateColumns: `minmax(0, ${viewShare}fr) minmax(0, ${100 - viewShare}fr)` } : { gridTemplateColumns: 'minmax(0, 1fr)' }}><div className="plan-canvas" hidden={viewMode === 'stage'}>
      <div className="plan-viewbar"><h3>Grundriss <span>2D</span></h3><div className="plan-zoom">
      <button type="button" className="quiet" onClick={() => setViewZoom(z => Math.min(8, z * 1.25))} title="Grundriss vergrößern" aria-label="Vergrößern"><ToolIcon name="plus" /></button>
      <button type="button" className="quiet" onClick={() => setViewZoom(z => Math.max(0.4, z / 1.25))} title="Grundriss verkleinern" aria-label="Verkleinern"><ToolIcon name="minus" /></button>
      <button type="button" className="quiet" onClick={() => { setViewZoom(1); setViewPan({ x: 0, y: 0 }); }}>Passend</button>
      <span className="muted">{Math.round(viewZoom * 100)} %</span></div></div>
      <svg ref={svg} role="img" aria-label="Grundriss der Spielstätte" viewBox={viewBox}
        className={placing || objectPlacement.current ? 'placing-cursor' : undefined}
        onPointerDownCapture={event => {
          if ((!placingRef.current && !objectPlacement.current) || event.button !== 0 || readOnly) return;
          updatePlacingAt(point(event), event.altKey || !snapEnabled);
          commitPlacing();
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={startPan}
        onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}
        onAuxClick={event => event.preventDefault()}>
        <defs>
          <pattern id="half-metre-grid" width="500" height="500" patternUnits="userSpaceOnUse">
            <path d="M 500 0 L 0 0 0 500" fill="none" stroke="#ebefe6" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </pattern>
          <pattern id="metre-grid" width="1000" height="1000" patternUnits="userSpaceOnUse">
            <rect width="1000" height="1000" fill="url(#half-metre-grid)" />
            <path d="M 1000 0 L 0 0 0 1000" fill="none" stroke="#cfd6c6" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
          </pattern>
        </defs>
        <path data-testid="venue-floor" d={`${floor.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
          fill="url(#metre-grid)" stroke="#718469" strokeWidth="2" vectorEffect="non-scaling-stroke" onPointerDown={startMarquee} />
        {(venue.walls ?? []).map(wall => <polygon key={wall.id} data-testid={`venue-wall-${wall.id}`} points={wallCorners(resolveWall(wall, venue.wallTypes ?? [])).map(p => `${p.x},${-p.y}`).join(' ')} fill="#8b8478" stroke="#625b50" vectorEffect="non-scaling-stroke" pointerEvents="none"><title>{wall.label} · feste Spielstättenwand</title></polygon>)}
        {(venue.placeholders ?? []).map(item => <g key={item.id} data-testid={`venue-placeholder-${item.id}`}
          transform={`translate(${item.x} ${-item.y}) rotate(${-item.rotation})`} pointerEvents="none">
          <rect x={-item.width / 2} y={-item.depth / 2} width={item.width} height={item.depth}
            fill="#8fa07a99" stroke="#625b50" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <title>{item.label} · fester Publikumsstuhl</title>
        </g>)}
        <text x={venue.width / 2} y={-venue.depth - 200} textAnchor="middle" fontSize="180">{venue.width} mm</text>
        <text x="-170" y={-venue.depth / 2} textAnchor="middle" fontSize="180" transform={`rotate(-90 -170 ${-venue.depth / 2})`}>{venue.depth} mm</text>
        <text x={venue.width / 2} y="420" textAnchor="middle" fontSize="190">↑ Publikum · Blick zur Bühne</text>
        <text x={venue.width / 2} y="620" textAnchor="middle" fontSize="140">V Vorderseite · R Rückseite</text>
        <PlatformLayer venuePlatforms={venue.platforms ?? []} layoutPlatforms={shown.platforms ?? []}
          venueStairs={venue.stairs ?? []} layoutStairs={shown.stairs ?? []}
          selectedId={selectedPlatform ?? selectedStair}
          selectedPlatformIds={pickedPlatforms}
          selectedMemberIds={groupedIds}
          readOnly={readOnly}
          onPlatformPointerDown={startPlatform}
          onStairPointerDown={startStair}
          onSelect={(kind, id, additive) => pick({ kind, id }, !!additive)} />
        {shown.walls.map(wall => {
          const resolved = resolveWall(wall, wallTypes);
          const chosen = selected === wall.id || groupedIds.has(`wall:${wall.id}`);
          return <g key={wall.id} data-testid={`wall-${wall.id}`} aria-label={wall.label} className={readOnly ? '' : 'draggable-wall'} transform={`translate(${wall.x} ${-wall.y}) rotate(${-wall.rotation})`} onPointerDown={event => start(event, wall)}>
            <line x1={-resolved.width / 2} x2={resolved.width / 2} stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke" />
            <rect x={-resolved.width / 2} y={-resolved.thickness / 2} width={resolved.width} height={resolved.thickness} fill={selected === wall.id ? '#b67c35' : chosen ? '#8a6a3a' : '#315d49'} stroke={chosen ? '#986122' : '#315d49'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {resolved.openings.map(opening => {
              const x0 = -resolved.width / 2 + opening.left;
              const open = isDoorOpening(opening) ? doorOpenAngleDegrees(wall.doorOpenPercent ?? 0) * Math.PI / 180 : 0;
              const hingeX = isDoorOpening(opening)
                ? (opening.hinge === 'left' ? x0 : x0 + opening.width)
                : x0;
              const dir = isDoorOpening(opening) && opening.hinge === 'right' ? -1 : 1;
              const leafEndX = hingeX + dir * opening.width * Math.cos(open);
              const leafEndY = opening.width * Math.sin(open);
              return <g key={opening.id}>
                <rect data-testid={`plan-opening-${opening.id}`} data-width={opening.width} data-height={opening.height} data-left={opening.left} data-sill={opening.sill}
                  data-hinge={opening.hinge ?? ''}
                  x={x0} y={-resolved.thickness / 2} width={opening.width} height={resolved.thickness} fill="#f8faf5" stroke={chosen ? '#986122' : '#315d49'} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                {isDoorOpening(opening) && <>
                  <line data-testid={`plan-door-leaf-${opening.id}`} x1={hingeX} y1={0} x2={leafEndX} y2={leafEndY}
                    stroke="#c8c4b8" strokeWidth="28" strokeLinecap="square" vectorEffect="non-scaling-stroke" />
                  <circle cx={hingeX} cy={0} r={18} fill="#986122" />
                </>}
              </g>;
            })}
            <text y={-resolved.thickness / 2 - 160} textAnchor="middle" fontSize="150" pointerEvents="none" data-testid={`assembly-label-${wall.id}`}>
              {wall.assemblyNumber ? assemblyCaption(wall.assemblyNumber, wall.panelId ? panelLabels[wall.panelId] : undefined) : wall.label}
            </text>
            <text y={resolved.thickness / 2 + 90} textAnchor="middle" fontSize="110" pointerEvents="none">V</text>
            <text y={-resolved.thickness / 2 - 40} textAnchor="middle" fontSize="110" pointerEvents="none">R</text>
          </g>;
        })}
        {objectPlacement.current && <g data-testid="placing-object" pointerEvents="none" />}
        {placing && (() => {
          const types = placing.pendingType ? [...wallTypes, placing.pendingType] : wallTypes;
          const resolved = resolveWall(placing.wall, types);
          return <g data-testid="placing-wall" className="placing-wall" pointerEvents="none"
            transform={`translate(${placing.wall.x} ${-placing.wall.y}) rotate(${-placing.wall.rotation})`}>
            <rect x={-resolved.width / 2} y={-resolved.thickness / 2} width={resolved.width} height={resolved.thickness}
              fill="#315d49" stroke="#986122" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {resolved.openings.map(opening => <rect key={opening.id}
              x={-resolved.width / 2 + opening.left} y={-resolved.thickness / 2} width={opening.width} height={resolved.thickness}
              fill="#f8faf5" stroke="#986122" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
            <text y={-resolved.thickness / 2 - 160} textAnchor="middle" fontSize="150">{placing.wall.label}</text>
          </g>;
        })()}
        <BraceLayer braces={shown.braces} selectedId={selectedBrace} groupedIds={groupedIds} readOnly={readOnly} onPointerDown={startBrace} />
        <PlaceholderLayer placeholders={shown.placeholders ?? []} selectedId={selectedPlaceholder}
          readOnly={readOnly} groupedIds={groupedIds} onPointerDown={startPlaceholder} />
        <InfrastructureMarks pins={venue.connectionPoints ?? []} corridors={venue.cableRoutingCorridors ?? []} />
        <OverheadMarks boxes={venue.overheadBoxes ?? []} />
        <KeepClearMarks zones={venue.keepClearZones ?? []} />
        <CentrelineMark centreline={venue.stageCentreline} />
        <AlignmentGuides guides={guides} />
        {marqueeBox && <rect data-testid="selection-marquee" className="selection-marquee"
          x={marqueeBox.minX} y={-marqueeBox.maxY} width={marqueeBox.maxX - marqueeBox.minX} height={marqueeBox.maxY - marqueeBox.minY}
          pointerEvents="none" />}
        {selectionCentre && selectionBundle && !readOnly && (
          <RotationHandle centre={selectionCentre} rotation={selectionBundle.rotation} width={selectionHandleWidth}
            testId="rotate-selection" label="Auswahl drehen"
            onPointerDown={event => {
              if (event.button !== 0) return;
              event.stopPropagation();
              if (busyGesture()) return;
              startObject(event, selectionBundle.members[0]!, 'rotate');
            }} />
        )}
        {selectedWall && !readOnly && !selectionBundle && (() => {
          const wall = shown.walls.find(item => item.id === selectedWall.id) ?? selectedWall;
          const resolved = resolveWall(wall, wallTypes);
          return <RotationHandle centre={wall} rotation={wall.rotation} width={resolved.width}
            testId={`rotate-${wall.id}`} label="Wand drehen" onPointerDown={event => startRotate(event, wall)} />;
        })()}
        {selectedBraceItem && !readOnly && !selectionBundle && (() => {
          const brace = shown.braces.find(item => item.id === selectedBraceItem.id) ?? selectedBraceItem;
          return <RotationHandle centre={brace} rotation={brace.rotation} width={brace.footprintWidth}
            testId={`rotate-brace-${brace.id}`} label="Stütze drehen" onPointerDown={event => startRotateBrace(event, brace)} />;
        })()}
        {selectedPlatformItem && !readOnly && !selectionBundle && (() => {
          const platform = (shown.platforms ?? []).find(item => item.id === selectedPlatformItem.id) ?? selectedPlatformItem;
          const centre = platformCentroid(platform.outline);
          const box = platform.outline.reduce((acc, point) => ({
            minX: Math.min(acc.minX, point.x), maxX: Math.max(acc.maxX, point.x),
            minY: Math.min(acc.minY, point.y), maxY: Math.max(acc.maxY, point.y),
          }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
          return <RotationHandle centre={centre} rotation={0} width={Math.max(box.maxX - box.minX, 1)}
            testId={`rotate-platform-${platform.id}`} label="Podest drehen" onPointerDown={event => startPlatformRotate(event, platform)} />;
        })()}
        {selectedStairItem && !readOnly && !selectionBundle && (() => {
          const stair = (shown.stairs ?? []).find(item => item.id === selectedStairItem.id) ?? selectedStairItem;
          return <RotationHandle centre={stair} rotation={stair.rotation} width={stair.width}
            testId={`rotate-stair-${stair.id}`} label="Treppe drehen" onPointerDown={event => startRotateStair(event, stair)} />;
        })()}
        {selectedPlaceholderItem && !readOnly && !selectionBundle && (() => {
          const item = (shown.placeholders ?? []).find(entry => entry.id === selectedPlaceholderItem.id) ?? selectedPlaceholderItem;
          return <RotationHandle centre={item} rotation={item.rotation} width={item.width}
            testId={`rotate-placeholder-${item.id}`} label="Platzhalter drehen" onPointerDown={event => startRotatePlaceholder(event, item)} />;
        })()}
      </svg>

      {diagnostics.map(item => <p key={`${item.kind}-${item.objectId}`} className="warning" role="status">{item.message}</p>)}
      {overheadWarnings.map(item => <p key={`${item.kind}-${item.objectId}-${item.obstructionId ?? ''}`}
        className="warning" role="status" data-testid="overhead-warning">{item.message}</p>)}
      {overlapWarnings.map(item => <p key={`${item.zoneId}-${item.objectId}`} className="warning" role="status">{item.message}</p>)}
      {objectOverlaps.map(item => <p key={`${item.aId}-${item.bId}`} className="warning" role="status" data-testid="object-overlap">{item.message}</p>)}
    </div>
    {viewMode !== 'plan' && <StageView layout={placing ? {
      ...shown,
      wallTypes: placing.pendingType ? [...typesOf(shown), placing.pendingType] : shown.wallTypes,
      walls: [...shown.walls, placing.wall],
    } : shown} venue={venue} assets={assets} workspaceId={workspaceId}
      selectedIds={selection().map(item => item.id)} pivot={selectionPivot(state.present, selection())} snapEnabled={snapEnabled}
      onLightingChange={readOnly ? undefined : lighting => { if (!busyGesture()) commit({ ...current.current.present, lighting }); }}
      onSelect={stageSelect} onClearSelection={() => { if (!busyGesture() && !stageGesture.current) { clearSelection(); } }}
      onTransform={readOnly ? undefined : stageTransform} onPushPull={readOnly ? undefined : stageResize}
      resizeScope="scene" resizeDocument={sceneResizeDocument(shown, venue)} />}
    </div><aside className="wall-inspector" inert={busyGesture()}>
      <div className="inspector-title"><ToolIcon name="settings" /><h3>Eigenschaften</h3><span>mm</span></div>
      <div className="selection-properties">
      <h3>{selectedPlaceholderItem ? 'Platzhalter' : selectedPlatformItem ? 'Podest' : selectedStairItem ? 'Treppe' : selectedBraceItem ? 'Gewichtete Stütze' : selectedWall ? (selectedWallCount > 1 ? `${selectedWallCount} Wandelemente` : 'Wandelement') : 'Keine Auswahl'}</h3>
      <label htmlFor="wall-selection">Auswahl</label>
      <select id="wall-selection" value={selectedWall ? `wall:${selectedWall.id}` : selectedBraceItem ? `brace:${selectedBraceItem.id}` : selectedPlatformItem ? `platform:${selectedPlatformItem.id}` : selectedStairItem ? `stair:${selectedStairItem.id}` : selectedPlaceholderItem ? `placeholder:${selectedPlaceholderItem.id}` : ''} onChange={event => {
        const value = event.target.value;
        if (value.startsWith('brace:')) pick({ kind: 'brace', id: value.slice(6) }, false);
        else if (value.startsWith('platform:')) pick({ kind: 'platform', id: value.slice(9) }, false);
        else if (value.startsWith('stair:')) pick({ kind: 'stair', id: value.slice(6) }, false);
        else if (value.startsWith('placeholder:')) pick({ kind: 'placeholder', id: value.slice(12) }, false);
        else if (value) pick({ kind: 'wall', id: value.replace(/^wall:/, '') }, false);
        else { clearSelection(); }
      }}>
        <option value="">Objekt auswählen</option>
        {state.present.walls.map((wall, index) => <option key={wall.id} value={`wall:${wall.id}`}>{index + 1}. {wall.label}</option>)}
        {state.present.braces.map((brace, index) => <option key={brace.id} value={`brace:${brace.id}`}>{state.present.walls.length + index + 1}. {brace.label}</option>)}
        {(state.present.platforms ?? []).map((platform, index) => <option key={platform.id} value={`platform:${platform.id}`}>P{index + 1}. {platform.label}</option>)}
        {(state.present.stairs ?? []).map((stair, index) => <option key={stair.id} value={`stair:${stair.id}`}>T{index + 1}. {stair.label}</option>)}
        {(state.present.placeholders ?? []).map((item, index) => <option key={item.id} value={`placeholder:${item.id}`}>M{index + 1}. {item.label}</option>)}
      </select>
      {selectedWall ? <WallForm key={JSON.stringify(selectedWall)} wall={selectedWall} openings={resolveWall(selectedWall, wallTypes).openings} typed={!!selectedWall.typeId} surfaces={surfaces} readOnly={readOnly} bulkWallCount={selectedWallCount} onApply={applyWall} onRemove={remove} />
        : selectedBraceItem ? <BraceInspector key={JSON.stringify(selectedBraceItem)} brace={selectedBraceItem} surfaces={surfaces} readOnly={readOnly} onApply={replaceBrace} onRemove={remove}
            onAlign={() => {
              const walls = planningWalls(current.current.present, venue);
              const aligned = alignBraceToNearestWall(selectedBraceItem, walls, { force: true });
              if (aligned) replaceBrace(aligned);
            }} />
          : selectedPlatformItem ? <PlatformInspector key={JSON.stringify(selectedPlatformItem)} platform={selectedPlatformItem} readOnly={readOnly} onApply={replacePlatform} onRemove={remove} />
            : selectedStairItem ? <StairInspector key={JSON.stringify(selectedStairItem)} stair={selectedStairItem} surfaces={surfaces} readOnly={readOnly} onApply={replaceStair} onRemove={remove} />
              : selectedPlaceholderItem ? <PlaceholderInspector key={JSON.stringify(selectedPlaceholderItem)} item={selectedPlaceholderItem} surfaces={surfaces} readOnly={readOnly} onApply={replacePlaceholder} onRemove={remove} />
                : <p className="muted">Wählen Sie ein Objekt im Grundriss oder fügen Sie eine Wand, ein Podest, eine Treppe oder einen Platzhalter hinzu.</p>}
      </div>
      <details className="inspector-section"><summary>Wandtypen</summary><div className="inspector-section-body">
      <WallTypePanel types={wallTypes} selectedId={selectedType} readOnly={readOnly}
        onSelect={setSelectedType} onCreate={applyType} onApply={applyType} onPlace={placeType} onRemove={removeType} />
      </div></details>
      <details className="inspector-section"><summary>Platteninventar</summary><div className="inspector-section-body">
      <InventoryPanel workspaceId={workspaceId} layout={state.present} selectedWall={selectedWall} readOnly={readOnly}
        onAssign={panelId => selectedWall && replace({ ...selectedWall, panelId })}
        onUnassign={() => selectedWall && replace((({ panelId: _removed, ...rest }) => rest)(selectedWall))}
        onPanels={items => setPanelLabels(Object.fromEntries(items.map(item => [item.id, item.label])))} />
      </div></details>
      <details className="inspector-section"><summary>Aufbau & Verbindungen</summary><div className="inspector-section-body">
      <AssemblyPanel layout={state.present} selectedWall={selectedWall} readOnly={readOnly} onChange={commit} />
      </div></details>
      <details className="inspector-section"><summary>Gruppieren</summary><div className="inspector-section-body">
      <GroupInspector layout={state.present} picked={picked.filter((item): item is GroupMember => item.kind !== 'platform')} readOnly={readOnly} onChange={commit} />
      </div></details>
      <details className="inspector-section" open><summary>Zwischenablage</summary><div className="inspector-section-body">
      <ClipboardPanel selection={selection()} canPaste={!!clipboard} busy={!!groupPreview || !!placing}
        readOnly={readOnly} onCopy={copy} onCut={cut} onPaste={paste} />
      </div></details>
      <details className="inspector-section"><summary>Platzhalter</summary><div className="inspector-section-body">
      <PlaceholderLibrary readOnly={readOnly} disabled={!!groupPreview || !!placing || (state.present.placeholders ?? []).length >= 250}
        onAdd={kind => {
          const item = addPlaceholder(kind, venue.width / 2, venue.depth / 2);
          commit({ ...state.present, placeholders: [...state.present.placeholders ?? [], item] });
          pick({ kind: 'placeholder', id: item.id }, false);
        }} />
      </div></details>
    </aside></div>}
    <div className="workspace-statusbar"><span><span className="status-dot" />{venueOpen ? 'Spielstättenentwurf' : 'Bühnenbild'} · {state.present.walls.length} Wände</span><span className="status-hint">Klicken zum Auswählen · Ziehen zum Verschieben · Strg+Z rückgängig</span><button className="quiet" aria-expanded={helpOpen} onClick={() => setHelpOpen(open => !open)}><ToolIcon name="help" /> Bedienung</button><span>Maße in mm</span></div>
    {helpOpen && <div className="workspace-help"><h3>Arbeiten im Grundriss</h3>      <p className="muted viewport-hint">Raster: 1 m / 50 cm · Strg+Mausrad zoomen · Mittelklick oder Shift+Mausrad verschieben · Auf dem Boden ziehen: Mehrfachauswahl · Orange ↻ dreht · Stützen an Wänden · {SNAP_NOTICE}</p><p>Strg/Cmd+C kopiert die Auswahl, Strg/Cmd+V fügt sie ein. Entf löscht ausgewählte Objekte. Escape bricht Platzieren und Bewegungen ab oder hebt die Auswahl auf (auch in der Raumsicht · Klick in freien Raum).</p></div>}
  </section>;
}

function WallForm({ wall, openings, typed, surfaces, readOnly, bulkWallCount = 1, onApply, onRemove }: {
  wall: Wall; openings: Opening[]; typed: boolean; surfaces: ReturnType<typeof supportingSurfaces>; readOnly: boolean; bulkWallCount?: number; onApply: (wall: Wall) => void; onRemove: () => void;
}) {
  const [error, setError] = useState('');
  const doors = openings.filter(isDoorOpening);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const keys = typed ? ['x', 'y', 'rotation'] : ['x', 'y', 'rotation', 'width', 'height', 'thickness'];
    const doorRaw = data.get('doorOpenPercent');
    const result = wallSchema.safeParse({
      ...wall, finish: data.get('finish') || undefined, label: data.get('label'),
      ...Object.fromEntries(keys.map(key => [key, Number(data.get(key))])),
      doorOpenPercent: doors.length && doorRaw !== null && doorRaw !== '' ? Number(doorRaw) : undefined,
    });
    if (!result.success) { setError('Bitte prüfen Sie die Maße und die Bezeichnung.'); return; }
    setError(''); onApply(result.data);
  }
  return <form onSubmit={submit}><fieldset disabled={readOnly}>
    {bulkWallCount > 1 && <p className="muted">{bulkWallCount} Wände ausgewählt. Die Oberfläche wird auf alle übernommen; übrige Felder gelten nur für die hervorgehobene Wand.</p>}
    <label htmlFor="wall-label">Bezeichnung</label><input id="wall-label" name="label" defaultValue={wall.label} maxLength={120} required />
    <SurfaceField id="wall-surface" value={wall.supportingSurfaceId} surfaces={surfaces} />
    <div className="numeric-fields">{(typed ? [
      ['x', 'X (mm)', -100000, 100000], ['y', 'Y (mm)', -100000, 100000], ['rotation', 'Drehung (°)', -360, 360],
    ] as const : [
      ['width', 'Breite (mm)', 1, 100000], ['height', 'Höhe (mm)', 1, 100000], ['thickness', 'Dicke (mm)', 1, 100000],
      ['x', 'X (mm)', -100000, 100000], ['y', 'Y (mm)', -100000, 100000], ['rotation', 'Drehung (°)', -360, 360],
    ] as const).map(([key, label, min, max]) => <div key={key}><label htmlFor={`wall-${key}`}>{label}</label><input id={`wall-${key}`} name={key} type="number" step="any" min={min} max={max} defaultValue={wall[key]} required /></div>)}</div>
    {doors.length > 0 && <>
      <label htmlFor="wall-door-open">Türöffnung (%)</label>
      <input id="wall-door-open" name="doorOpenPercent" type="number" min={0} max={100} step={1} defaultValue={wall.doorOpenPercent ?? 0} />
      <p className="muted">Scharnier {doors.map(door => door.hinge === 'left' ? 'links' : 'rechts').join(', ')} · Blatt 800×2000 mm weiß · Zarge 25×50 mm außen. 0 % geschlossen, 100 % = 90° offen.</p>
    </>}
    <Suspense fallback={<p>Materialbibliothek wird geladen …</p>}><MaterialPicker id="wall-finish" value={wall.finish} /></Suspense>
    <p className="muted">{typed ? 'Außenmaße und Öffnungen kommen vom Wandtyp.' : 'X/Y beziehen sich auf die Wandmitte. Ursprung: vordere linke Ecke der Spielstätte.'}</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!readOnly && <div className="form-actions"><button type="submit">Übernehmen</button><button className="quiet" type="button" onClick={onRemove}>Wand löschen</button></div>}
  </fieldset></form>;
}
