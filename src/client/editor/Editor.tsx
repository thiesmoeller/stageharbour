import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type PointerEvent, type WheelEvent } from 'react';
import { z } from 'zod';
import { assemblyCaption } from '../../shared/assembly.js';
import { copySelection, cutSelection, pasteClipboard, removeSelection, type ClipboardMember, type LayoutClipboard } from '../../shared/clipboard.js';
import { dropMember, groupContaining, membersPivot, transformGroup, transformMembers, type GroupMember } from '../../shared/groups.js';
import { execute, history, redo, undo, type History } from '../../shared/history.js';
import { newBrace, newWall, wallCorners, wallSchema, type Brace, type Layout, type Scene, type VenueGeometry, type Wall } from '../../shared/layout.js';
import {
  SNAP_NOTICE, alignBraceToNearestWall, braceContactHinge, planRotationAt, rotateBraceOnContact, rotateToward,
  snapBracePose, snapMembersPose, snapRotation, snapStatusText, snapWallPose, type SnapGuide,
} from '../../shared/snapping.js';
import { membersInBounds, normalizeBounds, type PlanBounds } from '../../shared/selection.js';
import {
  AUDIENCE_FLOOR_ID, layoutDiagnostics, newPlatform, newStair, platformCentroid, rotatePlatformOutline,
  supportingSurfaces, translatePlatformOutline, type Platform, type StairUnit,
} from '../../shared/levels.js';
import { placeholderCorners, type Placeholder } from '../../shared/placeholders.js';
import { overheadBoxCorners, overheadClearance } from '../../shared/overhead.js';
import { braceCorners } from '../../shared/braceTransforms.js';
import { resolveWall, typesOf, type WallElementType } from '../../shared/wall-types.js';
import { measuredOutline } from '../../shared/venue.js';
import { LEASE_HEARTBEAT_MS } from '../../shared/leases.js';
import { ApiError, request } from '../api.js';
import { Autosave, SaveConflict } from './autosave.js';
import { BraceInspector } from './BraceInspector.js';
import { BraceLayer } from './BraceLayer.js';
import { PlatformInspector, StairInspector } from './PlatformInspector.js';
import { PlatformLayer, SurfaceField } from './PlatformLayer.js';
import { RotationHandle } from './RotationHandle.js';
import { StageView } from './StageView.js';
import { ExportPanel } from './ExportPanel.js';
import { WallTypePanel } from './WallTypePanel.js';
import { VenuePanel, InfrastructureMarks } from './VenuePanel.js';
import { OverheadMarks } from './VenueOverhead.js';
import { KeepClearMarks } from './KeepClearZones.js';
import { objectOverlapWarnings, placementOverlaps, braceFootprint, placeholderFootprint, platformFootprint, stairFootprint, wallFootprint } from '../../shared/overlap.js';
import { keepClearWarnings } from '../../shared/keepClear.js';
import { InventoryPanel } from './InventoryPanel.js';
import { AssemblyPanel } from './AssemblyPanel.js';
import { GroupInspector } from './GroupInspector.js';
import { ClipboardPanel } from './ClipboardPanel.js';
import { PlaceholderInspector, PlaceholderLibrary, addPlaceholder } from './PlaceholderInspector.js';
import { PlaceholderLayer } from './PlaceholderLayer.js';
import { AlignmentGuides, CentrelineMark, SnapToggle } from './SnapGuides.js';

const statusText = { saved: 'Gespeichert', pending: 'Änderungen ausstehend …', saving: 'Speichert …', failed: 'Speichern fehlgeschlagen', conflict: 'Neuere Fassung vorhanden' };
export function Editor({ initial, workspaceId, readOnly, onClose, onDirty }: {
  initial: Scene; workspaceId: string; readOnly: boolean; onClose: () => void; onDirty: (value: boolean) => void;
}) {
  const [state, setState] = useState(() => history({
    ...initial.layout, braces: initial.layout.braces ?? [], connections: initial.layout.connections ?? [],
    groups: initial.layout.groups ?? [], placeholders: initial.layout.placeholders ?? [],
  }));
  const current = useRef(state);
  const [selected, setSelected] = useState<string>();
  const [selectedType, setSelectedType] = useState<string>();
  const [selectedBrace, setSelectedBrace] = useState<string>();
  const [selectedPlatform, setSelectedPlatform] = useState<string>();
  const [selectedStair, setSelectedStair] = useState<string>();
  const [selectedPlaceholder, setSelectedPlaceholder] = useState<string>();
  const [picked, setPicked] = useState<GroupMember[]>([]);
  const [pickedPlatforms, setPickedPlatforms] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<LayoutClipboard>();
  const [preview, setPreview] = useState<Wall>();
  const [previewBrace, setPreviewBrace] = useState<Brace>();
  const [previewPlatform, setPreviewPlatform] = useState<Platform>();
  const [previewStair, setPreviewStair] = useState<StairUnit>();
  const [previewPlaceholder, setPreviewPlaceholder] = useState<Placeholder>();
  const [groupPreview, setGroupPreview] = useState<Layout>();
  const [panelLabels, setPanelLabels] = useState<Record<string, string>>({});
  const [exportsOpen, setExportsOpen] = useState(false);
  const [venueOpen, setVenueOpen] = useState(false);
  const [venue, setVenue] = useState<VenueGeometry>(initial.venue);
  const [updateAvailable, setUpdateAvailable] = useState(!!initial.venueUpdateAvailable);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [snapStatus, setSnapStatus] = useState<string>();
  const [marqueeBox, setMarqueeBox] = useState<PlanBounds>();
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const gesture = useRef<{ wall: Wall; x: number; y: number; latest: Wall } | undefined>(undefined);
  const rotateDrag = useRef<{ wall: Wall; latest: Wall; angleSnapped: boolean } | undefined>(undefined);
  const braceDrag = useRef<{ brace: Brace; x: number; y: number; latest: Brace } | undefined>(undefined);
  const braceRotate = useRef<{ brace: Brace; latest: Brace; angleSnapped: boolean; hinge?: { x: number; y: number }; startAngle: number } | undefined>(undefined);
  const platformDrag = useRef<{ platform: Platform; x: number; y: number; latest: Platform } | undefined>(undefined);
  const platformRotate = useRef<{ platform: Platform; centre: { x: number; y: number }; startAngle: number; baseOutline: Platform['outline']; latest: Platform; angleSnapped: boolean } | undefined>(undefined);
  const stairDrag = useRef<{ stair: StairUnit; x: number; y: number; latest: StairUnit } | undefined>(undefined);
  const stairRotate = useRef<{ stair: StairUnit; latest: StairUnit; angleSnapped: boolean } | undefined>(undefined);
  const placeholderDrag = useRef<{ item: Placeholder; x: number; y: number; latest: Placeholder } | undefined>(undefined);
  const placeholderRotate = useRef<{ item: Placeholder; latest: Placeholder; angleSnapped: boolean } | undefined>(undefined);
  const groupDrag = useRef<{
    x: number; y: number; start: Layout; latest: Layout;
    members: GroupMember[]; baseRotation: number; groupId?: string;
  } | undefined>(undefined);
  const groupRotate = useRef<{
    start: Layout; latest: Layout; members: GroupMember[]; baseRotation: number; groupId?: string;
    pivot: { x: number; y: number }; pointerStart: number; angleSnapped: boolean;
  } | undefined>(undefined);
  const marqueeDrag = useRef<{ x: number; y: number; endX: number; endY: number; additive: boolean } | undefined>(undefined);
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
  const dirty = saveState.dirty || !!preview || !!previewBrace || !!previewPlatform || !!previewStair || !!previewPlaceholder || !!groupPreview;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (readOnly) return;
    const tick = window.setInterval(() => {
      request(`/api/workspaces/${workspaceId}/scenes/${initial.id}/lease/heartbeat`, {}).catch(error => {
        if (error instanceof ApiError && error.status === 423) saver.markConflict('lease');
      });
    }, LEASE_HEARTBEAT_MS);
    return () => clearInterval(tick);
  }, [readOnly, saver, workspaceId, initial.id]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saver.getSnapshot().dirty || gesture.current || braceDrag.current || placeholderDrag.current || groupDrag.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); saver.dispose(); onDirty(false); };
  }, [saver, onDirty]);
  function apply(next: History) {
    if (readOnly || next === current.current) return;
    current.current = next;
    setState(next);
    saver.queue(next.present);
  }
  function commit(layout: Layout) { apply(execute(current.current, layout)); }
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
    replace({ ...wall, rotation: snapEnabled ? snapRotation(wall.rotation) : wall.rotation });
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
  function placeType(type: WallElementType) {
    const present = current.current.present;
    if (present.walls.length >= 250) return;
    const wall: Wall = { ...newWall(crypto.randomUUID(), venue.width / 2, venue.depth / 2), typeId: type.id, label: type.name, width: type.width, height: type.height, thickness: type.thickness };
    commit({ ...present, walls: [...present.walls, wall] });
    pick({ kind: 'wall', id: wall.id }, false);
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
  function clearSelection(except?: 'wall' | 'brace' | 'platform' | 'stair' | 'placeholder') {
    if (except !== 'wall') setSelected(undefined);
    if (except !== 'brace') setSelectedBrace(undefined);
    if (except !== 'platform') setSelectedPlatform(undefined);
    if (except !== 'stair') setSelectedStair(undefined);
    if (except !== 'placeholder') setSelectedPlaceholder(undefined);
  }
  function applyHits(hit: ReturnType<typeof membersInBounds>, additive: boolean) {
    const groupable = hit.flatMap(item => item.kind === 'platform' ? [] : [{ kind: item.kind, id: item.id } satisfies GroupMember]);
    const platforms = hit.flatMap(item => item.kind === 'platform' ? [item.id] : []);
    if (additive) {
      setPicked(current => {
        const keys = new Set(current.map(item => `${item.kind}:${item.id}`));
        const next = [...current];
        for (const item of groupable) {
          const key = `${item.kind}:${item.id}`;
          if (keys.has(key)) continue;
          keys.add(key); next.push(item);
        }
        return next;
      });
      setPickedPlatforms(current => [...new Set([...current, ...platforms])]);
    } else {
      setPicked(groupable);
      setPickedPlatforms(platforms);
    }
    clearSelection();
    const wall = groupable.find(item => item.kind === 'wall');
    const brace = groupable.find(item => item.kind === 'brace');
    const stair = groupable.find(item => item.kind === 'stair');
    const placeholder = groupable.find(item => item.kind === 'placeholder');
    if (wall) { setSelected(wall.id); clearSelection('wall'); }
    else if (brace) { setSelectedBrace(brace.id); clearSelection('brace'); }
    else if (stair) { setSelectedStair(stair.id); clearSelection('stair'); }
    else if (placeholder) { setSelectedPlaceholder(placeholder.id); clearSelection('placeholder'); }
    else if (platforms[0]) { setSelectedPlatform(platforms[0]); clearSelection('platform'); }
  }
  function pick(member: GroupMember, additive: boolean) {
    if (!additive) setPickedPlatforms([]);
    setPicked(current => additive
      ? current.some(item => item.kind === member.kind && item.id === member.id)
        ? current.filter(item => !(item.kind === member.kind && item.id === member.id))
        : [...current, member]
      : [member]);
    if (member.kind === 'wall') { setSelected(member.id); clearSelection('wall'); }
    else if (member.kind === 'brace') { setSelectedBrace(member.id); clearSelection('brace'); }
    else if (member.kind === 'stair') { setSelectedStair(member.id); clearSelection('stair'); }
    else { setSelectedPlaceholder(member.id); clearSelection('placeholder'); }
  }
  function memberInPicked(member: GroupMember) {
    return pickedRef.current.some(item => item.kind === member.kind && item.id === member.id);
  }
  /** Keep multi-select when dragging an already-selected member; otherwise replace. */
  function selectForDrag(member: GroupMember, additive: boolean) {
    if (additive) { pick(member, true); return undefined; }
    const keepMulti = memberInPicked(member) && pickedRef.current.length > 1;
    if (!keepMulti) pick(member, false);
    else if (member.kind === 'wall') { setSelected(member.id); clearSelection('wall'); }
    else if (member.kind === 'brace') { setSelectedBrace(member.id); clearSelection('brace'); }
    else if (member.kind === 'stair') { setSelectedStair(member.id); clearSelection('stair'); }
    else { setSelectedPlaceholder(member.id); clearSelection('placeholder'); }
    return dragTargets(member, keepMulti);
  }
  function dragTargets(member: GroupMember, keepMulti: boolean) {
    const formal = groupContaining(current.current.present, member);
    if (formal) return { members: formal.members, groupId: formal.id, baseRotation: formal.rotation };
    if (keepMulti) return { members: [...pickedRef.current], baseRotation: 0 };
  }
  function beginSelectionDrag(position: { x: number; y: number }, targets: { members: GroupMember[]; groupId?: string; baseRotation: number }, event: PointerEvent<SVGGElement>) {
    groupDrag.current = {
      ...position, start: current.current.present, latest: current.current.present,
      members: targets.members, groupId: targets.groupId, baseRotation: targets.baseRotation,
    };
    setGroupPreview(current.current.present);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function remove() {
    const present = current.current.present;
    const members = selection();
    const placeholders = picked.filter(item => item.kind === 'placeholder');
    if (!members.length && !placeholders.length) {
      if (selectedPlaceholder) {
        commit(dropMember({ ...present, placeholders: (present.placeholders ?? []).filter(item => item.id !== selectedPlaceholder) }, { kind: 'placeholder', id: selectedPlaceholder }));
        setSelectedPlaceholder(undefined); setPicked([]); setPickedPlatforms([]);
      }
      return;
    }
    let next = members.length ? removeSelection(present, members) : present;
    for (const item of placeholders) next = dropMember(next, item);
    if (selectedPlaceholder && !placeholders.some(item => item.id === selectedPlaceholder)) {
      next = dropMember({ ...next, placeholders: (next.placeholders ?? []).filter(item => item.id !== selectedPlaceholder) }, { kind: 'placeholder', id: selectedPlaceholder });
    }
    commit(next);
    clearSelection(); setPicked([]); setPickedPlatforms([]);
  }
  function selection(): ClipboardMember[] {
    const members: ClipboardMember[] = [];
    for (const item of picked) {
      if (item.kind === 'wall' || item.kind === 'brace' || item.kind === 'stair') {
        members.push({ kind: item.kind, id: item.id });
      }
    }
    for (const id of pickedPlatforms) {
      if (!members.some(item => item.kind === 'platform' && item.id === id)) members.push({ kind: 'platform', id });
    }
    if (selected && !members.some(item => item.kind === 'wall' && item.id === selected)) members.push({ kind: 'wall', id: selected });
    if (selectedBrace && !members.some(item => item.kind === 'brace' && item.id === selectedBrace)) members.push({ kind: 'brace', id: selectedBrace });
    if (selectedStair && !members.some(item => item.kind === 'stair' && item.id === selectedStair)) members.push({ kind: 'stair', id: selectedStair });
    if (selectedPlatform && !members.some(item => item.kind === 'platform' && item.id === selectedPlatform)) {
      members.push({ kind: 'platform', id: selectedPlatform });
    }
    return members;
  }
  function copy() {
    const taken = copySelection(current.current.present, selection());
    if (taken) setClipboard(taken);
  }
  function cut() {
    const result = cutSelection(current.current.present, selection());
    if (!result.clipboard) return;
    setClipboard(result.clipboard);
    commit(result.layout);
    clearSelection(); setPicked([]); setPickedPlatforms([]);
  }
  function paste() {
    if (!clipboard) return;
    const result = pasteClipboard(current.current.present, clipboard, () => crypto.randomUUID());
    commit(result.layout);
    if (result.consumed) setClipboard(undefined);
    setPicked(result.pasted.flatMap(item => item.kind === 'wall' || item.kind === 'brace' || item.kind === 'stair' ? [{ kind: item.kind, id: item.id }] : []));
    setPickedPlatforms(result.pasted.flatMap(item => item.kind === 'platform' ? [item.id] : []));
    const wall = result.pasted.find(item => item.kind === 'wall');
    const brace = result.pasted.find(item => item.kind === 'brace');
    const stair = result.pasted.find(item => item.kind === 'stair');
    const platform = result.pasted.find(item => item.kind === 'platform');
    if (wall) { setSelected(wall.id); clearSelection('wall'); }
    else if (brace) { setSelectedBrace(brace.id); clearSelection('brace'); }
    else if (stair) { setSelectedStair(stair.id); clearSelection('stair'); }
    else if (platform) { setSelectedPlatform(platform.id); clearSelection('platform'); }
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (readOnly || gesture.current || rotateDrag.current || braceDrag.current || braceRotate.current || platformDrag.current || platformRotate.current || placeholderDrag.current || groupDrag.current || marqueeDrag.current || event.target instanceof HTMLElement && (event.target.closest('input, textarea, select, button') || event.target.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); apply(event.shiftKey ? redo(current.current) : undo(current.current));
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); apply(redo(current.current));
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault(); copy();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
        event.preventDefault(); cut();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault(); paste();
      } else if (event.key === 'Delete') { event.preventDefault(); remove(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });
  const selectedWall = state.present.walls.find(wall => wall.id === selected);
  const wallTypes = typesOf(state.present);
  const selectedBraceItem = state.present.braces.find(brace => brace.id === selectedBrace);
  const selectedPlatformItem = (state.present.platforms ?? []).find(item => item.id === selectedPlatform);
  const selectedStairItem = (state.present.stairs ?? []).find(item => item.id === selectedStair);
  const selectedPlaceholderItem = (state.present.placeholders ?? []).find(item => item.id === selectedPlaceholder);
  const surfaces = supportingSurfaces(venue, state.present);
  const diagnostics = layoutDiagnostics(state.present, venue);
  const liveLayout = {
    ...state.present,
    walls: state.present.walls.map(wall => preview?.id === wall.id ? preview : wall),
    braces: state.present.braces.map(brace => previewBrace?.id === brace.id ? previewBrace : brace),
    placeholders: (state.present.placeholders ?? []).map(item => previewPlaceholder?.id === item.id ? previewPlaceholder : item),
  };
  const overheadWarnings = overheadClearance(liveLayout, venue);
  const overlapWarnings = keepClearWarnings(venue, liveLayout);
  const raised = surfaces.find(surface => surface.id !== AUDIENCE_FLOOR_ID);
  function point(event: { clientX: number; clientY: number }) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const value = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: value.x, y: -value.y };
  }
  function startRotate(event: PointerEvent<SVGGElement>, wall: Wall) {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation();
    if (busyGesture()) return;
    const targets = selectForDrag({ kind: 'wall', id: wall.id }, false);
    if (targets && targets.members.length > 1) {
      beginSelectionRotate(point(event), targets, event);
      return;
    }
    pick({ kind: 'wall', id: wall.id }, false);
    rotateDrag.current = { wall, latest: wall, angleSnapped: false };
    setPreview(wall);
    setSnapStatus(undefined);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function busyGesture() {
    return !!(gesture.current || rotateDrag.current || braceDrag.current || braceRotate.current || platformDrag.current || platformRotate.current || stairDrag.current || stairRotate.current || placeholderDrag.current || placeholderRotate.current || groupDrag.current || groupRotate.current || marqueeDrag.current);
  }
  function beginSelectionRotate(position: { x: number; y: number }, targets: { members: GroupMember[]; groupId?: string; baseRotation: number }, event: PointerEvent<SVGGElement>) {
    const pivot = membersPivot(current.current.present, targets.members);
    if (!pivot) return;
    groupRotate.current = {
      start: current.current.present, latest: current.current.present,
      members: targets.members, groupId: targets.groupId, baseRotation: targets.baseRotation,
      pivot, pointerStart: planRotationAt(pivot, position), angleSnapped: false,
    };
    setGroupPreview(current.current.present);
    setSnapStatus(undefined);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startRotateBrace(event: PointerEvent<SVGGElement>, brace: Brace) {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation();
    if (busyGesture()) return;
    const targets = selectForDrag({ kind: 'brace', id: brace.id }, false);
    if (targets && targets.members.length > 1) {
      beginSelectionRotate(point(event), targets, event);
      return;
    }
    pick({ kind: 'brace', id: brace.id }, false);
    const types = typesOf(current.current.present);
    const walls = current.current.present.walls.map(wall => resolveWall(wall, types));
    const contact = braceContactHinge(brace, walls);
    const hinge = contact?.hinge;
    const position = point(event);
    braceRotate.current = {
      brace, latest: brace, angleSnapped: false, hinge,
      startAngle: planRotationAt(hinge ?? brace, position),
    };
    setPreviewBrace(brace);
    setSnapStatus(hinge ? 'Drehung an der Wand' : undefined);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function start(event: PointerEvent<SVGGElement>, wall: Wall) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (event.shiftKey) { pick({ kind: 'wall', id: wall.id }, true); return; }
    if (readOnly || busyGesture()) { pick({ kind: 'wall', id: wall.id }, false); return; }
    const targets = selectForDrag({ kind: 'wall', id: wall.id }, false);
    const position = point(event);
    if (targets) {
      beginSelectionDrag(position, targets, event);
      return;
    }
    gesture.current = { wall, ...position, latest: wall };
    setPreview(wall);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startBrace(event: PointerEvent<SVGGElement>, brace: Brace) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (event.shiftKey) { pick({ kind: 'brace', id: brace.id }, true); return; }
    if (readOnly || busyGesture()) { pick({ kind: 'brace', id: brace.id }, false); return; }
    const targets = selectForDrag({ kind: 'brace', id: brace.id }, false);
    const position = point(event);
    if (targets) {
      beginSelectionDrag(position, targets, event);
      return;
    }
    braceDrag.current = { brace, ...position, latest: brace };
    setPreviewBrace(brace);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startPlatform(event: PointerEvent<SVGGElement>, platform: Platform) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (event.shiftKey) {
      setPickedPlatforms(current => current.includes(platform.id) ? current.filter(id => id !== platform.id) : [...current, platform.id]);
      setSelectedPlatform(platform.id); clearSelection('platform');
      return;
    }
    setPicked([]);
    setPickedPlatforms([platform.id]);
    setSelectedPlatform(platform.id); clearSelection('platform');
    if (readOnly || busyGesture()) return;
    const position = point(event);
    platformDrag.current = { platform, ...position, latest: platform };
    setPreviewPlatform(platform);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startPlatformRotate(event: PointerEvent<SVGGElement>, platform: Platform) {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation();
    setPicked([]); setPickedPlatforms([platform.id]); setSelectedPlatform(platform.id); clearSelection('platform');
    if (busyGesture()) return;
    const centre = platformCentroid(platform.outline);
    const position = point(event);
    platformRotate.current = {
      platform, centre, startAngle: Math.atan2(position.y - centre.y, position.x - centre.x) * 180 / Math.PI,
      baseOutline: platform.outline, latest: platform, angleSnapped: false,
    };
    setPreviewPlatform(platform);
    setSnapStatus(undefined);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startStair(event: PointerEvent<SVGGElement>, stair: StairUnit) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (event.shiftKey) { pick({ kind: 'stair', id: stair.id }, true); return; }
    if (readOnly || busyGesture()) { pick({ kind: 'stair', id: stair.id }, false); return; }
    const targets = selectForDrag({ kind: 'stair', id: stair.id }, false);
    const position = point(event);
    if (targets) {
      beginSelectionDrag(position, targets, event);
      return;
    }
    stairDrag.current = { stair, ...position, latest: stair };
    setPreviewStair(stair);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startRotateStair(event: PointerEvent<SVGGElement>, stair: StairUnit) {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation();
    if (busyGesture()) return;
    const targets = selectForDrag({ kind: 'stair', id: stair.id }, false);
    if (targets && targets.members.length > 1) {
      beginSelectionRotate(point(event), targets, event);
      return;
    }
    pick({ kind: 'stair', id: stair.id }, false);
    stairRotate.current = { stair, latest: stair, angleSnapped: false };
    setPreviewStair(stair);
    setSnapStatus(undefined);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startRotatePlaceholder(event: PointerEvent<SVGGElement>, item: Placeholder) {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation();
    if (busyGesture()) return;
    const targets = selectForDrag({ kind: 'placeholder', id: item.id }, false);
    if (targets && targets.members.length > 1) {
      beginSelectionRotate(point(event), targets, event);
      return;
    }
    pick({ kind: 'placeholder', id: item.id }, false);
    placeholderRotate.current = { item, latest: item, angleSnapped: false };
    setPreviewPlaceholder(item);
    setSnapStatus(undefined);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startPlaceholder(event: PointerEvent<SVGGElement>, item: Placeholder) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (event.shiftKey) { pick({ kind: 'placeholder', id: item.id }, true); return; }
    if (readOnly || busyGesture()) { pick({ kind: 'placeholder', id: item.id }, false); return; }
    const targets = selectForDrag({ kind: 'placeholder', id: item.id }, false);
    const position = point(event);
    if (targets) {
      beginSelectionDrag(position, targets, event);
      return;
    }
    placeholderDrag.current = { item, ...position, latest: item };
    setPreviewPlaceholder(item);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startMarquee(event: PointerEvent<SVGPathElement>) {
    if (event.button !== 0 || readOnly) return;
    if (busyGesture()) return;
    const position = point(event);
    marqueeDrag.current = { ...position, additive: event.shiftKey, endX: position.x, endY: position.y };
    if (!event.shiftKey) {
      clearSelection();
      setPicked([]);
      setPickedPlatforms([]);
    }
    setMarqueeBox(normalizeBounds(position, position));
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const position = point(event);
    const clamp = (value: number) => Math.max(-100000, Math.min(100000, Math.round(value)));
    const bypass = event.altKey || !snapEnabled;
    const types = typesOf(current.current.present);
    const walls = current.current.present.walls.map(wall => resolveWall(wall, types));
    const marquee = marqueeDrag.current;
    if (marquee) {
      marquee.endX = position.x;
      marquee.endY = position.y;
      setMarqueeBox(normalizeBounds(marquee, position));
      return;
    }
    const rotating = rotateDrag.current;
    if (rotating) {
      const turned = rotateToward(rotating.wall, position, { bypass });
      rotating.latest = { ...rotating.wall, rotation: turned.rotation };
      rotating.angleSnapped = turned.angleSnapped;
      setPreview(rotating.latest);
      setGuides([]);
      setSnapStatus(snapStatusText({ rotation: turned.rotation, angleSnapped: turned.angleSnapped })
        ?? `Drehung · ${Math.round(turned.rotation * 10) / 10}°`);
      return;
    }
    const braceTurning = braceRotate.current;
    if (braceTurning) {
      if (braceTurning.hinge) {
        const raw = planRotationAt(braceTurning.hinge, position);
        const delta = raw - braceTurning.startAngle;
        const absolute = braceTurning.brace.rotation + delta;
        const turned = bypass ? { rotation: absolute, angleSnapped: false }
          : { rotation: snapRotation(absolute), angleSnapped: Math.abs(snapRotation(absolute) - absolute) > 1e-9 };
        braceTurning.latest = rotateBraceOnContact(braceTurning.brace, braceTurning.hinge, turned.rotation);
        braceTurning.angleSnapped = turned.angleSnapped;
        setPreviewBrace(braceTurning.latest);
        setGuides([]);
        setSnapStatus(snapStatusText({ rotation: turned.rotation, angleSnapped: turned.angleSnapped })
          ?? `Drehung an der Wand · ${Math.round(turned.rotation * 10) / 10}°`);
        return;
      }
      const turned = rotateToward(braceTurning.brace, position, { bypass });
      braceTurning.latest = { ...braceTurning.brace, rotation: turned.rotation };
      braceTurning.angleSnapped = turned.angleSnapped;
      setPreviewBrace(braceTurning.latest);
      setGuides([]);
      setSnapStatus(snapStatusText({ rotation: turned.rotation, angleSnapped: turned.angleSnapped })
        ?? `Drehung · ${Math.round(turned.rotation * 10) / 10}°`);
      return;
    }
    const stairTurning = stairRotate.current;
    if (stairTurning) {
      const turned = rotateToward(stairTurning.stair, position, { bypass });
      stairTurning.latest = { ...stairTurning.stair, rotation: turned.rotation };
      stairTurning.angleSnapped = turned.angleSnapped;
      setPreviewStair(stairTurning.latest);
      setGuides([]);
      setSnapStatus(snapStatusText({ rotation: turned.rotation, angleSnapped: turned.angleSnapped })
        ?? `Drehung · ${Math.round(turned.rotation * 10) / 10}°`);
      return;
    }
    const placeholderTurning = placeholderRotate.current;
    if (placeholderTurning) {
      const turned = rotateToward(placeholderTurning.item, position, { bypass });
      placeholderTurning.latest = { ...placeholderTurning.item, rotation: turned.rotation };
      placeholderTurning.angleSnapped = turned.angleSnapped;
      setPreviewPlaceholder(placeholderTurning.latest);
      setGuides([]);
      setSnapStatus(snapStatusText({ rotation: turned.rotation, angleSnapped: turned.angleSnapped })
        ?? `Drehung · ${Math.round(turned.rotation * 10) / 10}°`);
      return;
    }
    const platformTurning = platformRotate.current;
    if (platformTurning) {
      const raw = Math.atan2(position.y - platformTurning.centre.y, position.x - platformTurning.centre.x) * 180 / Math.PI;
      const delta = raw - platformTurning.startAngle;
      const absolute = bypass ? delta : (() => {
        const turned = rotateToward(platformTurning.centre, {
          x: platformTurning.centre.x + Math.cos((platformTurning.startAngle + delta) * Math.PI / 180),
          y: platformTurning.centre.y + Math.sin((platformTurning.startAngle + delta) * Math.PI / 180),
        }, { bypass: false });
        return turned.rotation - platformTurning.startAngle;
      })();
      // Simpler: rotate outline by delta from base, with optional angle snap on absolute orientation of first edge
      const unsnapped = rotatePlatformOutline(platformTurning.baseOutline, delta, platformTurning.centre);
      if (bypass) {
        platformTurning.latest = { ...platformTurning.platform, outline: unsnapped };
        platformTurning.angleSnapped = false;
        setPreviewPlatform(platformTurning.latest);
        setGuides([]);
        setSnapStatus(`Drehung · ${Math.round(delta * 10) / 10}°`);
        return;
      }
      const snappedAbs = rotateToward(platformTurning.centre, position, { bypass: false });
      const snappedDelta = snappedAbs.rotation - platformTurning.startAngle;
      platformTurning.latest = { ...platformTurning.platform, outline: rotatePlatformOutline(platformTurning.baseOutline, snappedDelta, platformTurning.centre) };
      platformTurning.angleSnapped = snappedAbs.angleSnapped;
      setPreviewPlatform(platformTurning.latest);
      setGuides([]);
      setSnapStatus(snapStatusText({ rotation: snappedAbs.rotation, angleSnapped: snappedAbs.angleSnapped })
        ?? `Drehung · ${Math.round(snappedDelta * 10) / 10}°`);
      return;
    }
    const grouped = groupDrag.current;
    if (grouped) {
      const pivot = membersPivot(grouped.start, grouped.members);
      if (!pivot) return;
      const snapped = snapMembersPose(grouped.start, grouped.members, {
        x: clamp(pivot.x + position.x - grouped.x), y: clamp(pivot.y + position.y - grouped.y), rotation: grouped.baseRotation,
      }, grouped.baseRotation, venue.stageCentreline, { bypass });
      grouped.latest = grouped.groupId
        ? transformGroup(grouped.start, grouped.groupId, {
          x: clamp(snapped.pose.x), y: clamp(snapped.pose.y), rotation: snapped.pose.rotation,
        })
        : transformMembers(grouped.start, grouped.members, {
          x: clamp(snapped.pose.x), y: clamp(snapped.pose.y), rotation: snapped.pose.rotation,
        }, grouped.baseRotation);
      setGroupPreview(grouped.latest);
      setGuides(snapped.guides);
      setSnapStatus(snapStatusText({ guides: snapped.guides }));
      return;
    }
    const turningGroup = groupRotate.current;
    if (turningGroup) {
      const pointerAngle = planRotationAt(turningGroup.pivot, position);
      let delta = pointerAngle - turningGroup.pointerStart;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      const raw = turningGroup.baseRotation + delta;
      const rotation = bypass ? raw : snapRotation(raw);
      turningGroup.angleSnapped = !bypass && rotation !== raw;
      const pose = { x: turningGroup.pivot.x, y: turningGroup.pivot.y, rotation };
      turningGroup.latest = turningGroup.groupId
        ? transformGroup(turningGroup.start, turningGroup.groupId, pose)
        : transformMembers(turningGroup.start, turningGroup.members, pose, turningGroup.baseRotation);
      setGroupPreview(turningGroup.latest);
      setGuides([]);
      setSnapStatus(snapStatusText({ rotation, angleSnapped: turningGroup.angleSnapped })
        ?? `Drehung · ${Math.round(rotation * 10) / 10}°`);
      return;
    }
    const wallDrag = gesture.current;
    if (wallDrag) {
      const next = { ...wallDrag.wall, x: clamp(wallDrag.wall.x + position.x - wallDrag.x), y: clamp(wallDrag.wall.y + position.y - wallDrag.y) };
      const snapped = snapWallPose(resolveWall(next, types), walls.filter(wall => wall.id !== next.id), venue.stageCentreline, { bypass });
      wallDrag.latest = { ...next, x: clamp(snapped.x), y: clamp(snapped.y) };
      setPreview(wallDrag.latest);
      setGuides(snapped.guides);
      setSnapStatus(snapStatusText({ guides: snapped.guides }));
      return;
    }
    const drag = braceDrag.current;
    if (drag) {
      const next = { ...drag.brace, x: clamp(drag.brace.x + position.x - drag.x), y: clamp(drag.brace.y + position.y - drag.y) };
      const snapped = snapBracePose(next, walls, venue.stageCentreline, { bypass });
      drag.latest = { ...next, x: clamp(snapped.x), y: clamp(snapped.y) };
      setPreviewBrace(drag.latest);
      setGuides(snapped.guides);
      setSnapStatus(snapStatusText({ guides: snapped.guides }));
      return;
    }
    const heldStair = stairDrag.current;
    if (heldStair) {
      const next = { ...heldStair.stair, x: clamp(heldStair.stair.x + position.x - heldStair.x), y: clamp(heldStair.stair.y + position.y - heldStair.y) };
      const snapped = snapWallPose(
        { id: next.id, x: next.x, y: next.y, rotation: next.rotation, width: next.width, thickness: next.run },
        walls, venue.stageCentreline, { bypass },
      );
      heldStair.latest = { ...next, x: clamp(snapped.x), y: clamp(snapped.y) };
      setPreviewStair(heldStair.latest);
      setGuides(snapped.guides);
      setSnapStatus(snapStatusText({ guides: snapped.guides }));
      return;
    }
    const heldPlatform = platformDrag.current;
    if (heldPlatform) {
      heldPlatform.latest = {
        ...heldPlatform.platform,
        outline: translatePlatformOutline(heldPlatform.platform.outline, position.x - heldPlatform.x, position.y - heldPlatform.y),
      };
      setPreviewPlatform(heldPlatform.latest);
      return;
    }
    const held = placeholderDrag.current;
    if (!held) return;
    const next = { ...held.item, x: clamp(held.item.x + position.x - held.x), y: clamp(held.item.y + position.y - held.y) };
    const snapped = snapWallPose(
      { id: next.id, x: next.x, y: next.y, rotation: next.rotation, width: next.width, thickness: next.depth },
      walls, venue.stageCentreline, { bypass },
    );
    held.latest = { ...next, x: clamp(snapped.x), y: clamp(snapped.y) };
    setPreviewPlaceholder(held.latest);
    setGuides(snapped.guides);
    setSnapStatus(snapStatusText({ guides: snapped.guides }));
  }
  function finish(cancelled = false) {
    const marquee = marqueeDrag.current;
    marqueeDrag.current = undefined;
    setMarqueeBox(undefined);
    if (marquee) {
      if (!cancelled) {
        applyHits(membersInBounds(current.current.present, normalizeBounds(marquee, { x: marquee.endX, y: marquee.endY })), marquee.additive);
      }
      return;
    }
    const grouped = groupDrag.current;
    groupDrag.current = undefined;
    const turningGroup = groupRotate.current;
    groupRotate.current = undefined;
    setGroupPreview(undefined);
    setGuides([]);
    setSnapStatus(undefined);
    if (grouped && !cancelled) commit(grouped.latest);
    if (turningGroup && !cancelled) commit(turningGroup.latest);
    if (grouped || turningGroup) return;
    const rotating = rotateDrag.current;
    rotateDrag.current = undefined;
    if (rotating) {
      setPreview(undefined);
      if (!cancelled) replace(rotating.latest);
      return;
    }
    const braceTurning = braceRotate.current;
    braceRotate.current = undefined;
    if (braceTurning) {
      setPreviewBrace(undefined);
      if (!cancelled) replaceBrace(braceTurning.latest);
      return;
    }
    const stairTurning = stairRotate.current;
    stairRotate.current = undefined;
    if (stairTurning) {
      setPreviewStair(undefined);
      if (!cancelled) replaceStair(stairTurning.latest);
      return;
    }
    const placeholderTurning = placeholderRotate.current;
    placeholderRotate.current = undefined;
    if (placeholderTurning) {
      setPreviewPlaceholder(undefined);
      if (!cancelled) replacePlaceholder(placeholderTurning.latest);
      return;
    }
    const platformTurning = platformRotate.current;
    platformRotate.current = undefined;
    if (platformTurning) {
      setPreviewPlatform(undefined);
      if (!cancelled) replacePlatform(platformTurning.latest);
      return;
    }
    const wallDrag = gesture.current;
    gesture.current = undefined;
    setPreview(undefined);
    if (wallDrag && !cancelled) {
      if (!rejectIfOverlap(wallFootprint(wallDrag.latest))) replace(wallDrag.latest);
    }
    const drag = braceDrag.current;
    braceDrag.current = undefined;
    setPreviewBrace(undefined);
    if (drag && !cancelled) {
      const types = typesOf(current.current.present);
      const walls = current.current.present.walls.map(wall => resolveWall(wall, types));
      const aligned = alignBraceToNearestWall(drag.latest, walls) ?? drag.latest;
      if (!rejectIfOverlap(braceFootprint(aligned))) replaceBrace(aligned);
    }
    const heldStair = stairDrag.current;
    stairDrag.current = undefined;
    setPreviewStair(undefined);
    if (heldStair && !cancelled) {
      if (!rejectIfOverlap(stairFootprint(heldStair.latest))) replaceStair(heldStair.latest);
    }
    const heldPlatform = platformDrag.current;
    platformDrag.current = undefined;
    setPreviewPlatform(undefined);
    if (heldPlatform && !cancelled) {
      if (!rejectIfOverlap(platformFootprint(heldPlatform.latest))) replacePlatform(heldPlatform.latest);
    }
    const held = placeholderDrag.current;
    placeholderDrag.current = undefined;
    setPreviewPlaceholder(undefined);
    if (held && !cancelled) {
      if (!rejectIfOverlap(placeholderFootprint(held.latest))) replacePlaceholder(held.latest);
    }
  }
  // Bounds stay fixed during a gesture, so moving an object cannot move its coordinate system.
  const shown = groupPreview ?? {
    ...state.present,
    walls: state.present.walls.map(wall => preview?.id === wall.id ? preview : wall),
    braces: state.present.braces.map(brace => previewBrace?.id === brace.id ? previewBrace : brace),
    platforms: (state.present.platforms ?? []).map(item => previewPlatform?.id === item.id ? previewPlatform : item),
    stairs: (state.present.stairs ?? []).map(item => previewStair?.id === item.id ? previewStair : item),
    placeholders: (state.present.placeholders ?? []).map(item => previewPlaceholder?.id === item.id ? previewPlaceholder : item),
  };
  const groupedIds = new Set<string>();
  for (const member of picked) {
    const group = groupContaining(state.present, member);
    for (const item of group?.members ?? [member]) groupedIds.add(`${item.kind}:${item.id}`);
  }
  for (const id of pickedPlatforms) groupedIds.add(`platform:${id}`);
  const selectionBundle = (() => {
    for (const member of picked) {
      const formal = groupContaining(state.present, member);
      if (formal) return { members: formal.members, groupId: formal.id, rotation: formal.rotation };
    }
    if (picked.length > 1) return { members: picked, rotation: 0 };
  })();
  const selectionCentre = selectionBundle ? membersPivot(shown, selectionBundle.members) : undefined;
  const selectionHandleWidth = selectionBundle
    ? Math.max(1200, ...selectionBundle.members.flatMap(member => {
      if (member.kind !== 'wall') return [];
      const wall = shown.walls.find(item => item.id === member.id);
      return wall ? [resolveWall(wall, wallTypes).width] : [];
    }))
    : 1200;
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
  function rejectIfOverlap(footprint: Parameters<typeof placementOverlaps>[1]) {
    if (placementOverlaps(current.current.present, footprint)) {
      setSnapStatus('Überschneidung — Position nicht übernommen');
      return true;
    }
    return false;
  }
  function onPlanWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    if (event.shiftKey) {
      setViewPan(pan => ({ x: pan.x + event.deltaX * 2 / viewZoom, y: pan.y - event.deltaY * 2 / viewZoom }));
      return;
    }
    const cursor = point(event);
    const factor = Math.exp(-event.deltaY * 0.0015);
    const next = Math.min(8, Math.max(0.4, viewZoom * factor));
    const ratio = viewZoom / next;
    const newCx = cursor.x - (cursor.x - viewCx) * ratio;
    const newCy = cursor.y - (cursor.y - viewCy) * ratio;
    setViewZoom(next);
    setViewPan({ x: newCx - (minX + maxX) / 2, y: newCy - (minY + maxY) / 2 });
  }
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...initial, revision: saveState.revision, layout: current.current.present }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `buehnenentwurf-${initial.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="editor" aria-label="Bühnenbild bearbeiten">
    <div className="editor-heading"><div><p className="eyebrow">{initial.productionName} · {initial.venueName}</p><h2>{initial.name}</h2></div>
      <button className="quiet" disabled={dirty} onClick={onClose}>Zur Übersicht</button></div>
    <div className="editor-toolbar">
      {!readOnly && <><button disabled={!!preview || !!previewBrace || !!previewPlatform || !!previewStair || !!previewPlaceholder || !!groupPreview || state.present.walls.length >= 250} onClick={() => {
        const wall = newWall(crypto.randomUUID(), venue.width / 2, venue.depth / 2);
        commit({ ...state.present, walls: [...state.present.walls, wall] }); pick({ kind: 'wall', id: wall.id }, false);
      }}>Wand hinzufügen</button>
      <button disabled={!!preview || !!previewBrace || !!previewPlatform || !!previewStair || !!previewPlaceholder || !!groupPreview || state.present.braces.length >= 250} onClick={() => {
        const brace = newBrace(crypto.randomUUID(), venue.width / 2, venue.depth / 2);
        commit({ ...state.present, braces: [...state.present.braces, brace] }); pick({ kind: 'brace', id: brace.id }, false);
      }}>Stütze hinzufügen</button>
      <button disabled={!!preview || !!previewBrace || !!previewPlatform || !!previewStair || !!previewPlaceholder || !!groupPreview || (state.present.platforms ?? []).length >= 250} onClick={() => {
        const platform = newPlatform(crypto.randomUUID(), venue.width / 2, venue.depth / 2);
        commit({ ...state.present, platforms: [...state.present.platforms ?? [], platform] }); setSelectedPlatform(platform.id); clearSelection('platform'); setPicked([]); setPickedPlatforms([platform.id]);
      }}>Podest hinzufügen</button>
      <button disabled={!!preview || !!previewBrace || !!previewPlatform || !!previewStair || !!previewPlaceholder || !!groupPreview || !raised || (state.present.stairs ?? []).length >= 250} onClick={() => {
        if (!raised) return;
        const stair = newStair(crypto.randomUUID(), AUDIENCE_FLOOR_ID, raised.id, venue.width / 2, venue.depth / 2);
        commit({ ...state.present, stairs: [...state.present.stairs ?? [], stair] }); pick({ kind: 'stair', id: stair.id }, false);
      }}>Treppe hinzufügen</button>
      <button className="quiet" disabled={!!preview || !!previewBrace || !!previewPlatform || !!previewStair || !!previewPlaceholder || !!groupPreview || !state.past.length} onClick={() => apply(undo(current.current))}>Rückgängig</button>
      <button className="quiet" disabled={!!preview || !!previewBrace || !!previewPlatform || !!previewStair || !!previewPlaceholder || !!groupPreview || !state.future.length} onClick={() => apply(redo(current.current))}>Wiederholen</button></>}
      <button className="quiet" onClick={() => setVenueOpen(open => !open)}>{venueOpen ? 'Spielstätte schließen' : 'Spielstätte'}</button>
      <button className="quiet" onClick={() => setExportsOpen(open => !open)}>{exportsOpen ? 'Export schließen' : 'Konstruktionsplan'}</button>
      {!readOnly && <SnapToggle enabled={snapEnabled} onChange={setSnapEnabled} />}
      <button type="button" className="quiet" onClick={() => setViewZoom(z => Math.min(8, z * 1.25))}>Vergrößern</button>
      <button type="button" className="quiet" onClick={() => setViewZoom(z => Math.max(0.4, z / 1.25))}>Verkleinern</button>
      <button type="button" className="quiet" onClick={() => { setViewZoom(1); setViewPan({ x: 0, y: 0 }); }}>Passend</button>
      <span className="muted">{Math.round(viewZoom * 100)} %</span>
      {snapStatus && <span className="snap-status" role="status">{snapStatus}</span>}
      <span className={`save-status ${saveState.status}`} role="status">{readOnly
        ? (initial.lease ? `Nur Ansicht · Bearbeitung durch ${initial.lease.holderName}` : 'Nur Ansicht')
        : saveState.status === 'conflict' && saveState.conflictKind === 'lease' ? 'Bearbeitung abgelaufen' : statusText[saveState.status]}</span>
    </div>
    {venueOpen && <VenuePanel workspaceId={workspaceId} sceneId={initial.id} venue={venue} venueUpdateAvailable={updateAvailable} readOnly={readOnly} onSaved={adoptVenue} />}
    {exportsOpen && <ExportPanel workspaceId={workspaceId} sceneId={initial.id} productionId={initial.productionId}
      readOnly={readOnly} freezeDisabled={dirty || saveState.status !== 'saved'} groups={state.present.groups ?? []} walls={state.present.walls} />}
    {['failed', 'conflict'].includes(saveState.status) && <div className="error" role="alert">
      <p>{saveState.status === 'conflict'
        ? (saveState.conflictKind === 'lease'
          ? 'Die Bearbeitungsberechtigung ist abgelaufen. Ihre Änderungen bleiben hier erhalten und werden nicht überschrieben.'
          : 'Eine neuere Fassung ist gespeichert. Ihre Änderungen bleiben hier erhalten und werden nicht darübergeschrieben.')
        : 'Ihre Änderungen sind noch nicht gespeichert. Prüfen Sie die Verbindung; bei abgelaufener Anmeldung sichern Sie zunächst den lokalen Entwurf.'}</p>
      {saveState.status === 'failed' && <button onClick={() => saver.retry()}>Speichern erneut versuchen</button>}{' '}
      <button onClick={downloadDraft}>Lokalen Entwurf herunterladen</button>{' '}
      <button className="quiet" onClick={() => { if (window.confirm('Lokale Änderungen verwerfen und die gespeicherte Fassung laden?')) { saver.dispose(); onDirty(false); onClose(); } }}>Gespeicherte Fassung laden</button>
    </div>}
    <div className="editor-grid"><div className="editor-views"><div className="plan-canvas">
      <svg ref={svg} role="img" aria-label="Grundriss der Spielstätte" viewBox={viewBox}
        onWheel={onPlanWheel}
        onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}>
        <defs><pattern id="metre-grid" width="1000" height="1000" patternUnits="userSpaceOnUse"><path d="M 1000 0 L 0 0 0 1000" fill="none" stroke="#dfe5d9" strokeWidth="1" vectorEffect="non-scaling-stroke" /></pattern></defs>
        <path data-testid="venue-floor" d={`${floor.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
          fill="url(#metre-grid)" stroke="#718469" strokeWidth="2" vectorEffect="non-scaling-stroke" onPointerDown={startMarquee} />
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
          onSelect={(kind, id, additive) => {
            if (kind === 'platform') {
              if (additive) {
                setPickedPlatforms(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
              } else {
                setPicked([]);
                setPickedPlatforms([id]);
              }
              setSelectedPlatform(id); clearSelection('platform');
            }
            else pick({ kind: 'stair', id }, !!additive);
          }} />
        {shown.walls.map(wall => {
          const resolved = resolveWall(wall, wallTypes);
          const chosen = selected === wall.id || groupedIds.has(`wall:${wall.id}`);
          return <g key={wall.id} data-testid={`wall-${wall.id}`} aria-label={wall.label} className={readOnly ? '' : 'draggable-wall'} transform={`translate(${wall.x} ${-wall.y}) rotate(${-wall.rotation})`} onPointerDown={event => start(event, wall)}>
            <line x1={-resolved.width / 2} x2={resolved.width / 2} stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke" />
            <rect x={-resolved.width / 2} y={-resolved.thickness / 2} width={resolved.width} height={resolved.thickness} fill={selected === wall.id ? '#b67c35' : chosen ? '#8a6a3a' : '#315d49'} stroke={chosen ? '#986122' : '#315d49'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {resolved.openings.map(opening => <rect key={opening.id} data-testid={`plan-opening-${opening.id}`} data-width={opening.width} data-height={opening.height} data-left={opening.left} data-sill={opening.sill}
              x={-resolved.width / 2 + opening.left} y={-resolved.thickness / 2} width={opening.width} height={resolved.thickness} fill="#f8faf5" stroke={chosen ? '#986122' : '#315d49'} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
            <text y={-resolved.thickness / 2 - 160} textAnchor="middle" fontSize="150" pointerEvents="none" data-testid={`assembly-label-${wall.id}`}>
              {wall.assemblyNumber ? assemblyCaption(wall.assemblyNumber, wall.panelId ? panelLabels[wall.panelId] : undefined) : wall.label}
            </text>
            <text y={resolved.thickness / 2 + 90} textAnchor="middle" fontSize="110" pointerEvents="none">V</text>
            <text y={-resolved.thickness / 2 - 40} textAnchor="middle" fontSize="110" pointerEvents="none">R</text>
          </g>;
        })}
        <BraceLayer braces={shown.braces} selectedId={selectedBrace} groupedIds={groupedIds} preview={groupPreview ? undefined : previewBrace} readOnly={readOnly} onPointerDown={startBrace} />
        <PlaceholderLayer placeholders={shown.placeholders ?? []} selectedId={selectedPlaceholder} preview={groupPreview ? undefined : previewPlaceholder}
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
              beginSelectionRotate(point(event), {
                members: selectionBundle.members,
                groupId: 'groupId' in selectionBundle ? selectionBundle.groupId : undefined,
                baseRotation: selectionBundle.rotation,
              }, event);
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
      <p className="muted">Raster: 1 m · Mausrad zoomen · Shift+Mausrad verschieben · Auf dem Boden ziehen: Mehrfachauswahl · Orange ↻ dreht · Stützen an Wänden · {SNAP_NOTICE}</p>
      {diagnostics.map(item => <p key={`${item.kind}-${item.objectId}`} className="warning" role="status">{item.message}</p>)}
      {overheadWarnings.map(item => <p key={`${item.kind}-${item.objectId}-${item.obstructionId ?? ''}`}
        className="warning" role="status" data-testid="overhead-warning">{item.message}</p>)}
      {overlapWarnings.map(item => <p key={`${item.zoneId}-${item.objectId}`} className="warning" role="status">{item.message}</p>)}
      {objectOverlaps.map(item => <p key={`${item.aId}-${item.bId}`} className="warning" role="status" data-testid="object-overlap">{item.message}</p>)}
    </div>
    <StageView layout={shown} venue={venue} />
    </div><aside className="wall-inspector">
      <WallTypePanel types={wallTypes} selectedId={selectedType} readOnly={readOnly}
        onSelect={setSelectedType} onCreate={applyType} onApply={applyType} onPlace={placeType} onRemove={removeType} />
      <InventoryPanel workspaceId={workspaceId} layout={state.present} selectedWall={selectedWall} readOnly={readOnly}
        onAssign={panelId => selectedWall && replace({ ...selectedWall, panelId })}
        onUnassign={() => selectedWall && replace((({ panelId: _removed, ...rest }) => rest)(selectedWall))}
        onPanels={items => setPanelLabels(Object.fromEntries(items.map(item => [item.id, item.label])))} />
      <AssemblyPanel layout={state.present} selectedWall={selectedWall} readOnly={readOnly} onChange={commit} />
      <GroupInspector layout={state.present} picked={picked} readOnly={readOnly} onChange={commit} />
      <ClipboardPanel selection={selection()} canPaste={!!clipboard} busy={!!preview || !!previewBrace || !!previewPlatform || !!previewStair || !!previewPlaceholder || !!groupPreview}
        readOnly={readOnly} onCopy={copy} onCut={cut} onPaste={paste} />
      <PlaceholderLibrary readOnly={readOnly} disabled={!!preview || !!previewBrace || !!previewPlatform || !!previewStair || !!previewPlaceholder || !!groupPreview || (state.present.placeholders ?? []).length >= 250}
        onAdd={kind => {
          const item = addPlaceholder(kind, venue.width / 2, venue.depth / 2);
          commit({ ...state.present, placeholders: [...state.present.placeholders ?? [], item] });
          pick({ kind: 'placeholder', id: item.id }, false);
        }} />
      <h3>{selectedPlaceholderItem ? 'Platzhalter' : selectedPlatformItem ? 'Podest' : selectedStairItem ? 'Treppe' : selectedBraceItem ? 'Gewichtete Stütze' : 'Wandelement'}</h3>
      <label htmlFor="wall-selection">Auswahl</label>
      <select id="wall-selection" value={selectedWall ? `wall:${selectedWall.id}` : selectedBraceItem ? `brace:${selectedBraceItem.id}` : selectedPlatformItem ? `platform:${selectedPlatformItem.id}` : selectedStairItem ? `stair:${selectedStairItem.id}` : selectedPlaceholderItem ? `placeholder:${selectedPlaceholderItem.id}` : ''} onChange={event => {
        const value = event.target.value;
        if (value.startsWith('brace:')) pick({ kind: 'brace', id: value.slice(6) }, false);
        else if (value.startsWith('platform:')) { setSelectedPlatform(value.slice(9)); clearSelection('platform'); setPicked([]); setPickedPlatforms([value.slice(9)]); }
        else if (value.startsWith('stair:')) pick({ kind: 'stair', id: value.slice(6) }, false);
        else if (value.startsWith('placeholder:')) pick({ kind: 'placeholder', id: value.slice(12) }, false);
        else if (value) pick({ kind: 'wall', id: value.replace(/^wall:/, '') }, false);
        else { clearSelection(); setPicked([]); setPickedPlatforms([]); }
      }}>
        <option value="">Objekt auswählen</option>
        {state.present.walls.map((wall, index) => <option key={wall.id} value={`wall:${wall.id}`}>{index + 1}. {wall.label}</option>)}
        {state.present.braces.map((brace, index) => <option key={brace.id} value={`brace:${brace.id}`}>{state.present.walls.length + index + 1}. {brace.label}</option>)}
        {(state.present.platforms ?? []).map((platform, index) => <option key={platform.id} value={`platform:${platform.id}`}>P{index + 1}. {platform.label}</option>)}
        {(state.present.stairs ?? []).map((stair, index) => <option key={stair.id} value={`stair:${stair.id}`}>T{index + 1}. {stair.label}</option>)}
        {(state.present.placeholders ?? []).map((item, index) => <option key={item.id} value={`placeholder:${item.id}`}>M{index + 1}. {item.label}</option>)}
      </select>
      {selectedWall ? <WallForm key={JSON.stringify(selectedWall)} wall={selectedWall} typed={!!selectedWall.typeId} surfaces={surfaces} readOnly={readOnly} onApply={applyWall} onRemove={remove} />
        : selectedBraceItem ? <BraceInspector key={JSON.stringify(selectedBraceItem)} brace={selectedBraceItem} surfaces={surfaces} readOnly={readOnly} onApply={replaceBrace} onRemove={remove}
            onAlign={() => {
              const types = typesOf(current.current.present);
              const walls = current.current.present.walls.map(wall => resolveWall(wall, types));
              const aligned = alignBraceToNearestWall(selectedBraceItem, walls, { force: true });
              if (aligned) replaceBrace(aligned);
            }} />
          : selectedPlatformItem ? <PlatformInspector key={JSON.stringify(selectedPlatformItem)} platform={selectedPlatformItem} readOnly={readOnly} onApply={replacePlatform} onRemove={remove} />
            : selectedStairItem ? <StairInspector key={JSON.stringify(selectedStairItem)} stair={selectedStairItem} surfaces={surfaces} readOnly={readOnly} onApply={replaceStair} onRemove={remove} />
              : selectedPlaceholderItem ? <PlaceholderInspector key={JSON.stringify(selectedPlaceholderItem)} item={selectedPlaceholderItem} surfaces={surfaces} readOnly={readOnly} onApply={replacePlaceholder} onRemove={remove} />
                : <p className="muted">Wählen Sie ein Objekt im Grundriss oder fügen Sie eine Wand, ein Podest, eine Treppe oder einen Platzhalter hinzu.</p>}
    </aside></div>
  </section>;
}

function WallForm({ wall, typed, surfaces, readOnly, onApply, onRemove }: {
  wall: Wall; typed: boolean; surfaces: ReturnType<typeof supportingSurfaces>; readOnly: boolean; onApply: (wall: Wall) => void; onRemove: () => void;
}) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const keys = typed ? ['x', 'y', 'rotation'] : ['x', 'y', 'rotation', 'width', 'height', 'thickness'];
    const surface = String(data.get('supportingSurfaceId') || '');
    const result = wallSchema.safeParse({
      ...wall, label: data.get('label'), supportingSurfaceId: surface || undefined,
      ...Object.fromEntries(keys.map(key => [key, Number(data.get(key))])),
    });
    if (!result.success) { setError('Bitte prüfen Sie die Maße und die Bezeichnung.'); return; }
    setError(''); onApply(result.data);
  }
  return <form onSubmit={submit}><fieldset disabled={readOnly}>
    <label htmlFor="wall-label">Bezeichnung</label><input id="wall-label" name="label" defaultValue={wall.label} maxLength={120} required />
    <SurfaceField id="wall-surface" value={wall.supportingSurfaceId} surfaces={surfaces} />
    <div className="numeric-fields">{(typed ? [
      ['x', 'X (mm)', -100000, 100000], ['y', 'Y (mm)', -100000, 100000], ['rotation', 'Drehung (°)', -360, 360],
    ] as const : [
      ['width', 'Breite (mm)', 1, 100000], ['height', 'Höhe (mm)', 1, 100000], ['thickness', 'Dicke (mm)', 1, 100000],
      ['x', 'X (mm)', -100000, 100000], ['y', 'Y (mm)', -100000, 100000], ['rotation', 'Drehung (°)', -360, 360],
    ] as const).map(([key, label, min, max]) => <div key={key}><label htmlFor={`wall-${key}`}>{label}</label><input id={`wall-${key}`} name={key} type="number" step="any" min={min} max={max} defaultValue={wall[key]} required /></div>)}</div>
    <p className="muted">{typed ? 'Außenmaße und Öffnungen kommen vom Wandtyp.' : 'X/Y beziehen sich auf die Wandmitte. Ursprung: vordere linke Ecke der Spielstätte.'}</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!readOnly && <div className="form-actions"><button type="submit">Übernehmen</button><button className="quiet" type="button" onClick={onRemove}>Wand löschen</button></div>}
  </fieldset></form>;
}
