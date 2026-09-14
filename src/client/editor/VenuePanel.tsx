import { defaultLighting, type StageLightingSettings } from '../../shared/lighting.js';
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { newWall, applyVenueResultSchema, saveVenueResultSchema, venueGeometrySchema, type Layout, type VenueGeometry } from '../../shared/layout.js';
import {
  newCableRoutingCorridor, newConnectionPoint, type CableRoutingCorridor, type ConnectionKind, type ConnectionPoint,
} from '../../shared/infrastructure.js';
import { venueReferenceSchema, type VenueReference } from '../../shared/contracts.js';
import { VenueLevels } from './VenueLevels.js';
import { OverheadMarks, VenueOverhead } from './VenueOverhead.js';
import { KeepClearMarks, KeepClearZones } from './KeepClearZones.js';
import { calibrationSchema, measuredOutline, millimetresPerUnit, type Calibration, type PlanPoint } from '../../shared/venue.js';
import { type Platform, type StairUnit, AUDIENCE_FLOOR_ID, newPlatform, newStair, platformBounds, platformCentroid, stairCorners } from '../../shared/levels.js';
import { type OverheadBox, newOverheadBox, EXAMPLE_CEILING_HEIGHT } from '../../shared/overhead.js';
import { newKeepClearZone, type KeepClearZone } from '../../shared/keepClear.js';
import { newPlaceholder, type Placeholder } from '../../shared/placeholders.js';
import { defaultCentreline, planRotationAt, SNAP_NOTICE, snapStatusText, snapWallPose, type SnapGuide, type StageCentreline } from '../../shared/snapping.js';
import { CentrelineMark, AlignmentGuides, SnapToggle } from './SnapGuides.js';
import { RotationHandle } from './RotationHandle.js';
import { PlaceholderLayer } from './PlaceholderLayer.js';
import {
  copyVenueSelection, cutVenueSelection, pasteVenueSelection, removeVenueSelection, transformVenue,
  venueObjects, venueObjectsInBounds, venueSelectionPivot, type VenueClipboard,
} from '../../shared/venueEditing.js';
import { normalizeBounds, type PlanBounds } from '../../shared/selection.js';
import { useDocumentDraft } from './useDocumentDraft.js';
import { StageView } from './StageView.js';
import { ClipboardPanel } from './ClipboardPanel.js';
import type { StageEditing } from './StageEditing.js';
import { useViewportWheel } from './viewportWheel.js';
import { ApiError, request, upload } from '../api.js';
import { ToolIcon } from './ToolIcon.js';

type ClickMode = 'select' | 'vertex' | 'a' | 'b' | 'pin' | 'corridor' | 'zone';
type ViewMode = 'split' | 'plan' | 'stage';
type VenueDraft = {
  lighting: StageLightingSettings;
  walls: NonNullable<VenueGeometry['walls']>; vertices: PlanPoint[]; platforms: Platform[]; stairs: StairUnit[];
  placeholders: Placeholder[];
  ceilingHeight: number | ''; overheadBoxes: OverheadBox[]; fileId: string | undefined; page: number; calibration: Calibration;
  pins: ConnectionPoint[]; corridors: CableRoutingCorridor[]; zones: KeepClearZone[]; centreline: StageCentreline;
};

function draftFromVenue(venue: VenueGeometry, draft: VenueDraft): VenueDraft {
  return {
    ...draft,
    walls: venue.walls ?? [], platforms: venue.platforms ?? [], stairs: venue.stairs ?? [],
    placeholders: venue.placeholders ?? [],
    overheadBoxes: venue.overheadBoxes ?? [], pins: venue.connectionPoints ?? [],
    corridors: venue.cableRoutingCorridors ?? [], zones: venue.keepClearZones ?? [],
  };
}

function outlineRotation(outline: { x: number; y: number }[]) {
  const a = outline[0], b = outline[1];
  if (!a || !b) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}

function optionalNotes(value?: string) {
  const notes = value?.trim();
  return notes ? notes : undefined;
}

type VenuePersistence = {
  sceneId: string;
  onSaved: (result: { venue: VenueGeometry; layout: Layout; revision: number; venueUpdateAvailable: boolean }) => void;
  onPublish?: never;
} | {
  sceneId?: never;
  onSaved?: never;
  onPublish: (venue: VenueGeometry) => Promise<void>;
};

export function VenuePanel({ workspaceId, sceneId, venue, venueUpdateAvailable = false, readOnly, onSaved, onDirty, onPublish }: {
  workspaceId: string; venue: VenueGeometry; venueUpdateAvailable?: boolean; readOnly: boolean;
  onDirty?: (dirty: boolean) => void;
} & VenuePersistence) {
  const draft = useDocumentDraft({
    lighting: venue.lighting ?? defaultLighting,
    walls: venue.walls ?? [], vertices: measuredOutline(venue), platforms: venue.platforms ?? [], stairs: venue.stairs ?? [],
    placeholders: venue.placeholders ?? [],
    ceilingHeight: (venue.ceilingHeight ?? '') as number | '', overheadBoxes: venue.overheadBoxes ?? [],
    fileId: venue.trace?.fileId, page: venue.trace?.page ?? 1,
    calibration: venue.trace?.calibration ?? { pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 }, distanceMm: 1000 },
    pins: venue.connectionPoints ?? [], corridors: venue.cableRoutingCorridors ?? [], zones: venue.keepClearZones ?? [],
    centreline: venue.stageCentreline ?? defaultCentreline(venue),
  });
  const [lighting, setLighting] = draft.field('lighting');
  const [walls, setWalls] = draft.field('walls');
  const [vertices, setVertices] = draft.field('vertices');
  const [platforms, setPlatforms] = draft.field('platforms');
  const [stairs, setStairs] = draft.field('stairs');
  const [placeholders, setPlaceholders] = draft.field('placeholders');
  const [ceilingHeight, setCeilingHeight] = draft.field('ceilingHeight');
  const [overheadBoxes, setOverheadBoxes] = draft.field('overheadBoxes');
  const [fileId, setFileId] = draft.field('fileId');
  const [page, setPage] = draft.field('page');
  const [calibration, setCalibration] = draft.field('calibration');
  const [pins, setPins] = draft.field('pins');
  const [corridors, setCorridors] = draft.field('corridors');
  const [zones, setZones] = draft.field('zones');
  const [centreline, setCentreline] = draft.field('centreline');
  const [click, setClick] = useState<ClickMode>('select');
  const [pinKind, setPinKind] = useState<ConnectionKind>('power');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<VenueClipboard>();
  const [marqueeBox, setMarqueeBox] = useState<PlanBounds>();
  const selected = selectedIds[0];
  const vertexDrag = useRef<number | undefined>(undefined);
  const transformStart = useRef<VenueDraft | undefined>(undefined);
  const objectDrag = useRef<{ ids: string[]; x: number; y: number; start: VenueDraft } | undefined>(undefined);
  const marqueeDrag = useRef<{ x: number; y: number; endX: number; endY: number; additive: boolean } | undefined>(undefined);
  const panDrag = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | undefined>(undefined);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [viewShare, setViewShare] = useState(55);
  const [helpOpen, setHelpOpen] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [snapStatus, setSnapStatus] = useState<string>();
  const objectRotate = useRef<{
    id: string; hinge: { x: number; y: number }; startAngle: number; startRotation: number; start: VenueDraft;
  } | undefined>(undefined);
  useEffect(() => { onDirty?.(draft.dirty); }, [draft.dirty, onDirty]);
  const [meta, setMeta] = useState<VenueReference>();
  const [overlay, setOverlay] = useState<{ href: string; pixelWidth: number; pixelHeight: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const svg = useRef<SVGSVGElement>(null);
  const parsed = calibrationSchema.safeParse(calibration);
  const unit = parsed.success ? millimetresPerUnit(parsed.data) : 1;
  useEffect(() => {
    if (!fileId) { setMeta(undefined); setOverlay(undefined); return; }
    let cancelled = false;
    const base = `/api/workspaces/${workspaceId}/venue-references/${fileId}`;
    request(base).then(async data => {
      const record = venueReferenceSchema.parse(data);
      const response = await fetch(`${base}/file`, { credentials: 'same-origin' });
      if (!response.ok) throw new ApiError(response.status, 'Vorlage fehlgeschlagen.');
      const bytes = await response.arrayBuffer();
      const image = record.kind === 'pdf'
        ? await pdfPageImage(bytes, page)
        : { href: URL.createObjectURL(new Blob([bytes], { type: record.mediaType })), pixelWidth: record.pixelWidth ?? 1, pixelHeight: record.pixelHeight ?? 1 };
      if (!cancelled) { setMeta(record); setOverlay(image); }
    }).catch(() => { if (!cancelled) setError('Die Vorlage konnte nicht geladen werden.'); });
    return () => { cancelled = true; };
  }, [fileId, page, workspaceId]);
  function planPoint(event: PointerEvent) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const value = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(value.x), y: Math.round(-value.y) };
  }
  function toSource(point: PlanPoint): PlanPoint {
    const height = overlay?.pixelHeight ?? 0;
    return { x: Math.round(point.x / unit), y: Math.round(height - point.y / unit) };
  }
  function onPlan(event: PointerEvent) {
    if (event.button === 1) {
      event.preventDefault();
      panDrag.current = { clientX: event.clientX, clientY: event.clientY, panX: pan.x, panY: pan.y };
      if (svg.current) svg.current.style.cursor = 'grabbing';
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      return;
    }
    if (readOnly || event.button !== 0) return;
    if (click === 'select') return; // Marquee starts on the outline fill only.
    const point = planPoint(event);
    if (click === 'vertex') setVertices(current => [...current, point]);
    else if (click === 'pin') setPins(current => current.length >= 250 ? current : [...current, newConnectionPoint(crypto.randomUUID(), pinKind, point.x, point.y)]);
    else if (click === 'corridor') setCorridors(current => {
      if (!current.length) return [newCableRoutingCorridor(crypto.randomUUID(), [point, { x: point.x + 1000, y: point.y }])];
      const last = current[current.length - 1]!;
      if (last.path.length >= 500) return current;
      return current.map((corridor, index) => index === current.length - 1 ? { ...corridor, path: [...corridor.path, point] } : corridor);
    });
    else if (click === 'zone') setZones(current => {
      if (!current.length) return [newKeepClearZone(crypto.randomUUID(), AUDIENCE_FLOOR_ID, point.x, point.y)];
      const last = current[current.length - 1]!;
      if (last.polygon.length >= 500) return current;
      return current.map((zone, index) => index === current.length - 1 ? { ...zone, polygon: [...zone.polygon, point] } : zone);
    });
    else if (click === 'a' || click === 'b') setCalibration(current => ({ ...current, [click === 'a' ? 'pointA' : 'pointB']: overlay ? toSource(point) : point }));
  }
  function startMarquee(event: PointerEvent) {
    if (readOnly || event.button !== 0 || click !== 'select') return;
    event.stopPropagation();
    const point = planPoint(event);
    marqueeDrag.current = { ...point, additive: event.shiftKey, endX: point.x, endY: point.y };
    if (!event.shiftKey) setSelectedIds([]);
    setMarqueeBox(normalizeBounds(point, point));
    svg.current?.setPointerCapture(event.pointerId);
  }
  function beginObjectDrag(event: PointerEvent, id: string) {
    event.stopPropagation();
    if (event.button !== 0) return;
    const ids = event.shiftKey
      ? (selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id])
      : (selectedIds.includes(id) ? selectedIds : [id]);
    setSelectedIds(ids);
    setClick('select');
    if (readOnly || !ids.length) return;
    const point = planPoint(event);
    objectDrag.current = { ids, x: point.x, y: point.y, start: draft.value };
    draft.begin();
    setGuides([]);
    setSnapStatus(undefined);
    svg.current?.setPointerCapture(event.pointerId);
  }
  function beginObjectRotate(event: PointerEvent, id: string, hinge: { x: number; y: number }, startRotation: number) {
    event.stopPropagation();
    if (event.button !== 0 || readOnly) return;
    setSelectedIds([id]);
    setClick('select');
    const point = planPoint(event);
    objectRotate.current = {
      id, hinge, startAngle: planRotationAt(hinge, point), startRotation, start: draft.value,
    };
    draft.begin();
    setGuides([]);
    svg.current?.setPointerCapture(event.pointerId);
  }
  async function chooseFile(file?: File) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const stored = venueReferenceSchema.parse(await upload(`/api/workspaces/${workspaceId}/venue-references`, file));
      setFileId(stored.id); setMeta(stored); setPage(1);
    } catch { setError('Die Datei konnte nicht hochgeladen werden.'); }
    finally { setBusy(false); }
  }
  async function save(event?: FormEvent) {
    event?.preventDefault();
    const trace = fileId ? {
      fileId, ...(meta?.kind === 'pdf' ? { page } : {}),
      ...(parsed.success ? { calibration: parsed.data } : {}),
    } : undefined;
    const result = venueGeometrySchema.safeParse({
      schemaVersion: 1, width: venue.width, depth: venue.depth, outline: vertices, trace,
      connectionPoints: pins.map(pin => ({ ...pin, notes: optionalNotes(pin.notes) })),
      cableRoutingCorridors: corridors.map(corridor => ({ ...corridor, notes: optionalNotes(corridor.notes) })),
      walls, wallTypes: venue.wallTypes, platforms, stairs, placeholders, lighting,
      ...(ceilingHeight === '' ? {} : { ceilingHeight }),
      overheadBoxes, keepClearZones: zones, stageCentreline: centreline,
    });
    if (!result.success) { setError('Bitte prüfen Sie den Umriss, die Kalibrierung, die Anschlüsse und die Überbauungen.'); return; }
    setBusy(true); setError('');
    try {
      if (onPublish) await onPublish(result.data);
      else {
        const body = saveVenueResultSchema.parse(await request(`/api/workspaces/${workspaceId}/scenes/${sceneId}/venue`, { venue: result.data }, 'PUT'));
        onSaved?.({ ...body, venueUpdateAvailable: false });
      }
      draft.markSaved();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409 ? 'Eine neuere Spielstättenfassung ist vorhanden. Ihr Entwurf bleibt erhalten. Sichern Sie ihn vor dem Neuladen.' : caught instanceof ApiError && caught.status === 400 ? 'Ungültiger Umriss oder ungültige Vorlage.' : 'Die Spielstätte konnte nicht gespeichert werden.');
    } finally { setBusy(false); }
  }
  async function applyUpdate() {
    if (!sceneId) return;
    setBusy(true); setError('');
    try {
      const body = applyVenueResultSchema.parse(await request(`/api/workspaces/${workspaceId}/scenes/${sceneId}/venue-apply`, {}));
      onSaved?.({ venue: body.venue, layout: body.layout, revision: body.revision, venueUpdateAvailable: !!body.venueUpdateAvailable });
    } catch { setError('Die Spielstättenfassung konnte nicht übernommen werden.'); }
    finally { setBusy(false); }
  }
  const width = overlay ? overlay.pixelWidth * unit : Math.max(venue.width, ...vertices.map(point => point.x));
  const height = overlay ? overlay.pixelHeight * unit : Math.max(venue.depth, ...vertices.map(point => point.y));
  const planLeft = Math.min(0, ...vertices.map(p => p.x)) - 400;
  const planTop = -Math.max(height, ...vertices.map(p => p.y)) - 400;
  const planWidth = Math.max(width, ...vertices.map(p => p.x)) - planLeft + 400;
  const planHeight = Math.max(height, ...vertices.map(p => p.y)) + 1200;
  const candidate = venueGeometrySchema.safeParse({ ...venue, lighting, outline: vertices, walls, platforms, stairs, placeholders, overheadBoxes,
    ceilingHeight: ceilingHeight === '' ? undefined : ceilingHeight, keepClearZones: zones, connectionPoints: pins, cableRoutingCorridors: corridors, stageCentreline: centreline });
  const previewVenue = candidate.success ? candidate.data : venue;
  const liveLayout: Layout = { schemaVersion: 1, walls: [], braces: [], placeholders };
  const pivot = venueSelectionPivot(previewVenue, selectedIds);
  function sourceFromDraft(start: VenueDraft): VenueGeometry {
    return {
      ...previewVenue, walls: start.walls, platforms: start.platforms, stairs: start.stairs, placeholders: start.placeholders,
      overheadBoxes: start.overheadBoxes, connectionPoints: start.pins,
      cableRoutingCorridors: start.corridors, keepClearZones: start.zones,
    };
  }
  function onPlanMove(event: PointerEvent) {
    const panning = panDrag.current;
    if (panning) {
      const rect = svg.current?.getBoundingClientRect();
      if (rect?.width && rect.height) {
        const mmPerPxX = (planWidth / zoom) / rect.width;
        const mmPerPxY = (planHeight / zoom) / rect.height;
        setPan({
          x: panning.panX - (event.clientX - panning.clientX) * mmPerPxX,
          y: panning.panY + (event.clientY - panning.clientY) * mmPerPxY,
        });
      }
      return;
    }
    const point = planPoint(event);
    const bypass = event.altKey || !snapEnabled;
    const turning = objectRotate.current;
    if (turning) {
      const delta = planRotationAt(turning.hinge, point) - turning.startAngle;
      const rotation = bypass ? turning.startRotation + delta : Math.round((turning.startRotation + delta) / 15) * 15;
      const moved = transformVenue(sourceFromDraft(turning.start), [turning.id], { x: 0, y: 0, rotation: rotation - turning.startRotation });
      draft.preview(draftFromVenue(moved, turning.start));
      setGuides([]);
      setSnapStatus(bypass ? 'Einrasten aus (Alt)' : undefined);
      return;
    }
    const marquee = marqueeDrag.current;
    if (marquee) {
      marquee.endX = point.x; marquee.endY = point.y;
      setMarqueeBox(normalizeBounds(marquee, point));
      return;
    }
    const dragging = objectDrag.current;
    if (dragging) {
      let moved = transformVenue(sourceFromDraft(dragging.start), dragging.ids, { x: point.x - dragging.x, y: point.y - dragging.y, rotation: 0 });
      let nextGuides: SnapGuide[] = [];
      if (!bypass && dragging.ids.length === 1) {
        const id = dragging.ids[0]!;
        const wall = moved.walls?.find(item => item.id === id);
        if (wall) {
          const others = (moved.walls ?? []).filter(item => item.id !== id);
          const snapped = snapWallPose(wall, others, centreline, { bypass });
          moved = { ...moved, walls: moved.walls?.map(item => item.id === id ? { ...item, x: snapped.x, y: snapped.y } : item) };
          nextGuides = snapped.guides;
        }
      }
      draft.preview(draftFromVenue(moved, dragging.start));
      setGuides(nextGuides);
      setSnapStatus(snapStatusText({ guides: nextGuides }) ?? (bypass ? 'Einrasten aus (Alt)' : undefined));
      return;
    }
    if (vertexDrag.current === undefined) return;
    setVertices(current => current.map((v, i) => i === vertexDrag.current ? point : v));
  }
  function endPlanGesture(cancel = false) {
    if (panDrag.current) {
      panDrag.current = undefined;
      if (svg.current) svg.current.style.cursor = '';
      return;
    }
    const marquee = marqueeDrag.current;
    marqueeDrag.current = undefined;
    if (marquee) {
      const ids = venueObjectsInBounds(previewVenue, normalizeBounds(marquee, { x: marquee.endX, y: marquee.endY }));
      setSelectedIds(current => marquee.additive ? [...new Set([...current, ...ids])] : ids);
      setMarqueeBox(undefined);
      return;
    }
    if (objectRotate.current) { objectRotate.current = undefined; draft.finish(cancel); setGuides([]); setSnapStatus(undefined); return; }
    if (objectDrag.current) { objectDrag.current = undefined; draft.finish(cancel); setGuides([]); setSnapStatus(undefined); return; }
    if (vertexDrag.current !== undefined) { vertexDrag.current = undefined; draft.finish(cancel); }
  }
  function copy() {
    const taken = copyVenueSelection(previewVenue, selectedIds);
    if (taken) setClipboard(taken);
  }
  function cut() {
    const result = cutVenueSelection(previewVenue, selectedIds);
    if (result.blocked) { setError('Abhängige Podestbezüge müssen mitgelöscht werden.'); return; }
    if (!result.clipboard) return;
    setClipboard(result.clipboard);
    draft.commit(draftFromVenue(result.venue, draft.value));
    setSelectedIds([]);
  }
  function paste() {
    if (!clipboard) return;
    const result = pasteVenueSelection(previewVenue, clipboard, () => crypto.randomUUID());
    if (!result.ids.length) return;
    draft.commit(draftFromVenue(result.venue, draft.value));
    setSelectedIds(result.ids);
    if (clipboard.cut) setClipboard(undefined);
    else setClipboard(copyVenueSelection(result.venue, result.ids));
  }
  function remove() {
    const result = removeVenueSelection(previewVenue, selectedIds);
    if (result.blocked) { setError('Abhängige Podestbezüge müssen mitgelöscht werden.'); return; }
    draft.commit(draftFromVenue(result.venue, draft.value));
    setSelectedIds([]);
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (draft.dirty) { event.preventDefault(); event.returnValue = ''; } };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        vertexDrag.current = undefined; objectDrag.current = undefined; objectRotate.current = undefined; marqueeDrag.current = undefined; panDrag.current = undefined;
        if (svg.current) svg.current.style.cursor = '';
        setMarqueeBox(undefined); draft.finish(true);
        setGuides([]); setSnapStatus(undefined);
        setSelectedIds([]);
      }
      if (readOnly || event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? draft.redo() : draft.undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copy(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') { event.preventDefault(); cut(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); paste(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); }
    };
    window.addEventListener('beforeunload', warn); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('keydown', key); };
  });
  const transform: StageEditing['onTransform'] = (phase, delta, bypass) => {
    if (readOnly) return;
    if (phase === 'begin') { transformStart.current = draft.value; draft.begin(); return; }
    if (phase === 'cancel') { draft.finish(true); transformStart.current = undefined; return; }
    const start = transformStart.current;
    if (!start || !selected) return;
    const moved = transformVenue(sourceFromDraft(start), selectedIds, { ...delta, rotation: bypass ? delta.rotation : Math.round(delta.rotation / 15) * 15 });
    draft.preview(draftFromVenue(moved, start));
    if (phase === 'commit') { draft.finish(); transformStart.current = undefined; }
  };
  useViewportWheel(svg, event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    setZoom(value => Math.max(.4, Math.min(8, value * (event.deltaY < 0 ? 1.1 : 1 / 1.1))));
  });
  const selectedWall = walls.find(wall => wall.id === selected);
  const selectedWallIndex = selectedWall ? walls.findIndex(wall => wall.id === selectedWall.id) : -1;
  const selectedObject = venueObjects(previewVenue).find(item => item.id === selected);
  function addFixedWall() {
    const wall = newWall(crypto.randomUUID(), venue.width / 2, venue.depth / 2);
    setWalls(items => [...items, wall]);
    setSelectedIds([wall.id]);
    setClick('select');
  }
  return <section className="venue-editor" aria-label="Spielstätte">
    <div className="workspace-commandbar">
      <div className="editor-toolbar">
        {!readOnly && <>
          <button type="button" className="quiet" disabled={!draft.canUndo || busy} onClick={draft.undo} title="Spielstätte rückgängig" aria-label="Spielstätte rückgängig"><ToolIcon name="undo" /></button>
          <button type="button" className="quiet" disabled={!draft.canRedo || busy} onClick={draft.redo} title="Spielstätte wiederholen" aria-label="Spielstätte wiederholen"><ToolIcon name="redo" /></button>
          <button type="button" disabled={!draft.dirty || busy} onClick={() => void save()}>Spielstätte speichern</button>
          <button type="button" className="quiet" disabled={!draft.dirty || busy} onClick={() => { draft.discard(); setError(''); }}>Spielstättenentwurf verwerfen</button>
          <button type="button" className="quiet" onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify({ venue, draft: draft.value }, null, 2)], { type: 'application/json' }));
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'spielstaettenentwurf.json'; anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>Entwurf herunterladen</button>
        </>}
        {venueUpdateAvailable && !readOnly && <button type="button" disabled={busy} onClick={() => void applyUpdate()}>Spielstättenfassung übernehmen</button>}
        {!readOnly && <SnapToggle enabled={snapEnabled} onChange={setSnapEnabled} />}
        {snapStatus && <span className="snap-status" role="status">{snapStatus}</span>}
        <span className={`save-status ${draft.dirty ? 'pending' : ''}`} role="status">{draft.dirty ? 'Unveröffentlichter Spielstättenentwurf' : 'Spielstättenfassung gespeichert'}</span>
      </div>
      <div className="workspace-viewbar" role="toolbar" aria-label="Ansichten">
        <div className="view-modes">{(['split', 'plan', 'stage'] as const).map(mode => <button key={mode} type="button" className="quiet" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>{mode === 'split' ? '2D + 3D' : mode === 'plan' ? 'Grundriss' : 'Raumansicht'}</button>)}</div>
        <label className="split-control" hidden={viewMode !== 'split'}>Aufteilung<input aria-label="Ansichten aufteilen" type="range" min="30" max="70" value={viewShare} onChange={event => setViewShare(Number(event.target.value))} /></label>
      <button type="button" className="quiet" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(open => !open)} title={inspectorOpen ? 'Eigenschaften ausblenden' : 'Eigenschaften einblenden'} aria-label="Eigenschaften"><ToolIcon name="tray" /></button>
      </div>
    </div>
    {!readOnly && <div className="tool-rail" role="toolbar" aria-label="Spielstättenwerkzeuge">
      <button type="button" className="quiet" aria-pressed={click === 'select'} onClick={() => setClick('select')} title="Auswählen" aria-label="Auswählen"><ToolIcon name="settings" /><span>Auswahl</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'vertex'} onClick={() => { setClick('vertex'); setVertices(current => [...current, { x: venue.width / 2, y: venue.depth / 2 }]); }} title="Eckpunkt hinzufügen" aria-label="Eckpunkt hinzufügen"><ToolIcon name="plus" /><span>Eckpunkt</span></button>
      <button type="button" disabled={walls.length >= 250} onClick={addFixedWall} title="Feste Wand hinzufügen" aria-label="Feste Wand hinzufügen"><ToolIcon name="wall" /><span>Wand</span></button>
      <button type="button" disabled={platforms.length >= 250} onClick={() => {
        const platform = newPlatform(crypto.randomUUID(), venue.width / 2, venue.depth * 0.75);
        setPlatforms(items => [...items, platform]); setSelectedIds([platform.id]); setClick('select');
      }} title="Permanentes Podest hinzufügen" aria-label="Permanentes Podest hinzufügen"><ToolIcon name="platform" /><span>Podest</span></button>
      <button type="button" disabled={!platforms[0] || stairs.length >= 250} onClick={() => {
        const raised = platforms[0]; if (!raised) return;
        const stair = newStair(crypto.randomUUID(), AUDIENCE_FLOOR_ID, raised.id, venue.width / 2, venue.depth / 2);
        setStairs(items => [...items, stair]); setSelectedIds([stair.id]); setClick('select');
      }} title="Permanente Treppe hinzufügen" aria-label="Permanente Treppe hinzufügen"><ToolIcon name="stairs" /><span>Treppe</span></button>
      <button type="button" className="quiet" disabled={placeholders.length >= 250} onClick={() => {
        const item = newPlaceholder('chair', crypto.randomUUID(), Math.round(venue.width / 2), Math.round(venue.depth * 0.2));
        setPlaceholders(items => [...items, item]); setSelectedIds([item.id]); setClick('select');
      }} title="Publikumsstuhl hinzufügen" aria-label="Publikumsstuhl hinzufügen"><ToolIcon name="library" /><span>Stuhl</span></button>
      <button type="button" className="quiet" disabled={pins.length >= 250} aria-pressed={click === 'pin' && pinKind === 'power'} onClick={() => {
        const pin = newConnectionPoint(crypto.randomUUID(), 'power', Math.round(venue.width / 2), Math.round(venue.depth / 2));
        setPinKind('power'); setClick('select'); setPins(current => [...current, pin]); setSelectedIds([pin.id]);
      }} title="Stromanschluss hinzufügen" aria-label="Stromanschluss hinzufügen"><ToolIcon name="plus" /><span>Strom</span></button>
      <button type="button" className="quiet" disabled={zones.length >= 250} onClick={() => {
        const zone = { ...newKeepClearZone(crypto.randomUUID(), AUDIENCE_FLOOR_ID, Math.round(venue.width / 2), Math.round(venue.depth / 2)), label: 'Notausgang', reason: 'Notausgang' };
        setZones(current => [...current, zone]); setSelectedIds([zone.id]); setClick('select');
      }} title="Notausgang / Freihaltezone hinzufügen" aria-label="Notausgang / Freihaltezone hinzufügen"><ToolIcon name="expand" /><span>Notausgang</span></button>
      <button type="button" className="quiet" disabled={overheadBoxes.length >= 250} onClick={() => {
        const box = { ...newOverheadBox(crypto.randomUUID(), Math.round(venue.width / 2), Math.round(venue.depth * 0.75)), label: 'Lüftungskanal' };
        setOverheadBoxes(current => [...current, box]);
        if (ceilingHeight === '') setCeilingHeight(EXAMPLE_CEILING_HEIGHT);
        setSelectedIds([box.id]); setClick('select');
      }} title="Lüftungskanal / Höhenbeschränkung hinzufügen" aria-label="Lüftungskanal / Höhenbeschränkung hinzufügen"><ToolIcon name="expand" /><span>Lüftung</span></button>
    </div>}
    <div className="editor-grid" data-inspector-open={inspectorOpen}>
      <div className="editor-views venue-editor-views" data-mode={viewMode} style={viewMode === 'split' ? { gridTemplateColumns: `minmax(0, ${viewShare}fr) minmax(0, ${100 - viewShare}fr)` } : { gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <div className="plan-canvas venue-plan" hidden={viewMode === 'stage'}>
          <div className="plan-viewbar"><h3>Spielstättengrundriss <span>2D</span></h3><div className="plan-zoom">
            <button type="button" className="quiet" onClick={() => setZoom(z => Math.min(8, z * 1.25))} title="Vergrößern" aria-label="Vergrößern"><ToolIcon name="plus" /></button>
            <button type="button" className="quiet" onClick={() => setZoom(z => Math.max(0.4, z / 1.25))} title="Verkleinern" aria-label="Verkleinern"><ToolIcon name="minus" /></button>
            <button type="button" className="quiet" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Spielstätte einpassen</button>
            <span className="muted">{Math.round(zoom * 100)} %</span>
          </div></div>
          <svg ref={svg} role="img" aria-label="Umriss der Spielstätte" viewBox={`${planLeft + planWidth * (1 - 1 / zoom) / 2 + pan.x} ${planTop + planHeight * (1 - 1 / zoom) / 2 - pan.y} ${planWidth / zoom} ${planHeight / zoom}`}
            onPointerDown={onPlan}
            onPointerMove={onPlanMove}
            onPointerUp={() => endPlanGesture()}
            onPointerCancel={() => endPlanGesture(true)}
            onLostPointerCapture={() => { if (panDrag.current || objectDrag.current || objectRotate.current || vertexDrag.current !== undefined || marqueeDrag.current) endPlanGesture(true); }}
            onAuxClick={event => event.preventDefault()}>
            <defs>
              <pattern id="venue-half-metre-grid" width="500" height="500" patternUnits="userSpaceOnUse">
                <path d="M 500 0 L 0 0 0 500" fill="none" stroke="#ebefe6" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              </pattern>
              <pattern id="venue-metre-grid" width="1000" height="1000" patternUnits="userSpaceOnUse">
                <rect width="1000" height="1000" fill="url(#venue-half-metre-grid)" />
                <path d="M 1000 0 L 0 0 0 1000" fill="none" stroke="#cfd6c6" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
              </pattern>
            </defs>
            {overlay && <image href={overlay.href} x="0" y={-overlay.pixelHeight * unit} width={overlay.pixelWidth * unit} height={overlay.pixelHeight * unit} opacity="0.55" />}
            <path data-testid="venue-outline" d={`${vertices.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
              fill="url(#venue-metre-grid)" stroke="#718469" strokeWidth="2" vectorEffect="non-scaling-stroke"
              onPointerDown={startMarquee} />
            {vertices.map((point, index) => <circle key={index} data-testid={`venue-vertex-${index}`} cx={point.x} cy={-point.y} r="65" fill="#b67c35" onPointerDown={event => { if (readOnly || event.button !== 0) return; event.stopPropagation(); vertexDrag.current = index; draft.begin(); svg.current?.setPointerCapture(event.pointerId); }} />)}
            {platforms.map(platform => <path key={platform.id} data-testid={`venue-platform-${platform.id}`}
              d={`${platform.outline.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
              fill={selectedIds.includes(platform.id) ? 'rgba(182,124,53,0.35)' : 'rgba(113,132,105,0.25)'} stroke="#718469" strokeWidth="2" vectorEffect="non-scaling-stroke"
              onPointerDown={event => beginObjectDrag(event, platform.id)} />)}
            {stairs.map(stair => {
              const corners = stairCorners(stair);
              return <path key={stair.id} data-testid={`venue-stair-${stair.id}`}
                d={`${corners.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
                fill={selectedIds.includes(stair.id) ? 'rgba(182,124,53,0.35)' : 'rgba(90,110,138,0.3)'} stroke="#5a6e8a" strokeWidth="2" vectorEffect="non-scaling-stroke"
                onPointerDown={event => beginObjectDrag(event, stair.id)} />;
            })}
            {walls.map(wall => <g key={wall.id} data-testid={`venue-wall-${wall.id}`} className={readOnly ? '' : 'draggable-wall'} transform={`translate(${wall.x} ${-wall.y}) rotate(${-wall.rotation})`} onPointerDown={event => beginObjectDrag(event, wall.id)}>
              <line x1={-wall.width / 2} x2={wall.width / 2} stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke" />
              <rect x={-wall.width / 2} y={-wall.thickness / 2} width={wall.width} height={wall.thickness} fill={selectedIds.includes(wall.id) ? '#b67c35' : '#315d49'} stroke="#315d49" strokeWidth="5" vectorEffect="non-scaling-stroke" />
            </g>)}
            <PlaceholderLayer placeholders={placeholders} selectedId={selectedIds.length === 1 ? selected : undefined} readOnly={readOnly}
              groupedIds={new Set(selectedIds.map(id => `placeholder:${id}`))}
              onPointerDown={(event, item) => beginObjectDrag(event, item.id)} />
            <InfrastructureMarks pins={pins} corridors={corridors} selectedIds={selectedIds} onPointerDown={beginObjectDrag} />
            <OverheadMarks boxes={overheadBoxes} selectedIds={selectedIds} onPointerDown={beginObjectDrag} />
            <KeepClearMarks zones={zones} selectedIds={selectedIds} onPointerDown={beginObjectDrag} />
            <CentrelineMark centreline={centreline} />
            <AlignmentGuides guides={guides} />
            {selectedWall && !readOnly && selectedIds.length === 1 && <RotationHandle centre={selectedWall} rotation={selectedWall.rotation} width={selectedWall.width}
              testId={`rotate-venue-wall-${selectedWall.id}`} label="Feste Wand drehen" onPointerDown={event => beginObjectRotate(event, selectedWall.id, selectedWall, selectedWall.rotation)} />}
            {selectedIds.length === 1 && !readOnly && (() => {
              const platform = platforms.find(item => item.id === selected);
              if (!platform) return null;
              const centre = platformCentroid(platform.outline);
              return <RotationHandle centre={centre} rotation={outlineRotation(platform.outline)} width={platformBounds(platform.outline).width}
                testId={`rotate-venue-platform-${platform.id}`} label="Podest drehen"
                onPointerDown={event => beginObjectRotate(event, platform.id, centre, outlineRotation(platform.outline))} />;
            })()}
            {selectedIds.length === 1 && !readOnly && (() => {
              const stair = stairs.find(item => item.id === selected);
              if (!stair) return null;
              return <RotationHandle centre={stair} rotation={stair.rotation} width={stair.width}
                testId={`rotate-venue-stair-${stair.id}`} label="Treppe drehen"
                onPointerDown={event => beginObjectRotate(event, stair.id, stair, stair.rotation)} />;
            })()}
            {selectedIds.length === 1 && !readOnly && (() => {
              const item = placeholders.find(entry => entry.id === selected);
              if (!item) return null;
              return <RotationHandle centre={item} rotation={item.rotation} width={item.width}
                testId={`rotate-venue-placeholder-${item.id}`} label="Platzhalter drehen"
                onPointerDown={event => beginObjectRotate(event, item.id, item, item.rotation)} />;
            })()}
            {marqueeBox && <rect data-testid="venue-selection-marquee" className="selection-marquee"
              x={marqueeBox.minX} y={-marqueeBox.maxY} width={marqueeBox.maxX - marqueeBox.minX} height={marqueeBox.maxY - marqueeBox.minY} />}
          </svg>
        </div>
        {viewMode !== 'plan' && <StageView onLightingChange={readOnly ? undefined : setLighting} layout={liveLayout} venue={previewVenue} venueEditable workspaceId={workspaceId} selectedIds={selectedIds} pivot={pivot} onSelect={(id, additive) => setSelectedIds(ids => additive ? ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] : [id])} onClearSelection={() => setSelectedIds([])} onTransform={readOnly ? undefined : transform} snapEnabled={snapEnabled} />}
      </div>
      <aside className="wall-inspector">
        <div className="inspector-title"><ToolIcon name="settings" /><h3>Eigenschaften</h3><span>mm</span></div>
        <div className="selection-properties">
          <h3>{selectedWall ? `Feste Wand ${selectedWallIndex + 1}` : selectedObject?.label ?? 'Keine Auswahl'}</h3>
          <label htmlFor="venue-selection">Spielstättenobjekt auswählen</label>
          <select id="venue-selection" value={selected ?? ''} onChange={event => setSelectedIds(event.target.value ? [event.target.value] : [])}>
            <option value="">Objekt auswählen</option>
            {walls.map((wall, index) => <option key={wall.id} value={wall.id}>Feste Wand {index + 1}</option>)}
            {venueObjects(previewVenue).filter(item => !walls.some(wall => wall.id === item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          {selectedWall && selectedWallIndex >= 0 ? <fieldset disabled={readOnly || busy}>
            <label>Bezeichnung<input value={selectedWall.label} onChange={event => setWalls(items => items.map(item => item.id === selectedWall.id ? { ...item, label: event.target.value } : item))} /></label>
            <div className="numeric-fields">{(['x', 'y', 'rotation', 'width', 'height', 'thickness'] as const).map(key => <label key={key}>{key}<input aria-label={`Feste Wand ${selectedWallIndex + 1} ${key}`} type="number" value={selectedWall[key]} onChange={event => setWalls(items => items.map(item => item.id === selectedWall.id ? { ...item, [key]: Number(event.target.value) } : item))} /></label>)}</div>
            <div className="form-actions">
              <button type="button" className="quiet" onClick={() => { setWalls(items => items.filter(item => item.id !== selectedWall.id)); setSelectedIds([]); }}>Feste Wand entfernen</button>
              <button type="button" className="quiet" onClick={() => remove()}>Löschen</button>
            </div>
          </fieldset> : selectedIds.length ? <fieldset disabled={readOnly || busy}>
            <p className="muted">{selectedIds.length} Objekt{selectedIds.length === 1 ? '' : 'e'} ausgewählt. Ziehen zum Verschieben · Orange ↻ dreht · Entf löscht.</p>
            {selectedObject?.kind === 'pin' && (() => {
              const pin = pins.find(item => item.id === selected)!;
              return <div className="numeric-fields">
                <label>Bezeichnung<input value={pin.label} onChange={event => setPins(items => items.map(item => item.id === pin.id ? { ...item, label: event.target.value } : item))} /></label>
                <label>X<input aria-label={`${pin.label} X`} type="number" value={pin.x} onChange={event => setPins(items => items.map(item => item.id === pin.id ? { ...item, x: Number(event.target.value) } : item))} /></label>
                <label>Y<input aria-label={`${pin.label} Y`} type="number" value={pin.y} onChange={event => setPins(items => items.map(item => item.id === pin.id ? { ...item, y: Number(event.target.value) } : item))} /></label>
              </div>;
            })()}
            {selectedObject?.kind === 'overhead' && (() => {
              const box = overheadBoxes.find(item => item.id === selected)!;
              return <>
                <div className="numeric-fields">
                  <label>Bezeichnung<input value={box.label} onChange={event => setOverheadBoxes(items => items.map(item => item.id === box.id ? { ...item, label: event.target.value } : item))} /></label>
                  {([['x', 'X'], ['y', 'Y'], ['bottomHeight', 'Unterkante'], ['thickness', 'Dicke'], ['length', 'Länge'], ['width', 'Breite']] as const).map(([key, label]) =>
                    <label key={key}>{label}<input aria-label={`${box.label} ${label}`} type="number" value={box[key]}
                      onChange={event => setOverheadBoxes(items => items.map(item => item.id === box.id ? { ...item, [key]: Number(event.target.value) } : item))} /></label>)}
                </div>
                <div><label htmlFor="venue-ceiling-selected">Deckenhöhe über Fußboden (mm)</label>
                  <input id="venue-ceiling-selected" type="number" min={1} step="any" value={ceilingHeight}
                    placeholder={`${EXAMPLE_CEILING_HEIGHT}`}
                    onChange={event => setCeilingHeight(event.target.value === '' ? '' : Number(event.target.value))} /></div>
              </>;
            })()}
            {selectedObject?.kind === 'placeholder' && (() => {
              const item = placeholders.find(entry => entry.id === selected)!;
              return <div className="numeric-fields">
                <label>Bezeichnung<input value={item.label} onChange={event => setPlaceholders(items => items.map(entry => entry.id === item.id ? { ...entry, label: event.target.value } : entry))} /></label>
                {([['x', 'X'], ['y', 'Y'], ['rotation', 'Drehung'], ['width', 'Breite'], ['depth', 'Tiefe']] as const).map(([key, label]) =>
                  <label key={key}>{label}<input aria-label={`${item.label} ${label}`} type="number" value={item[key]}
                    onChange={event => setPlaceholders(items => items.map(entry => entry.id === item.id ? { ...entry, [key]: Number(event.target.value) } : entry))} /></label>)}
              </div>;
            })()}
            <div className="form-actions"><button type="button" className="quiet" onClick={() => remove()}>Auswahl löschen</button></div>
          </fieldset> : <p className="muted">Objekt im Grundriss wählen oder links Wand, Podest, Stuhl, Strom, Notausgang oder Lüftung hinzufügen.</p>}
        </div>
        <details className="inspector-section" open><summary>Zwischenablage</summary><div className="inspector-section-body">
          <ClipboardPanel selection={selectedIds.map(id => ({ kind: 'wall', id }))} canPaste={!!clipboard} busy={busy} readOnly={readOnly}
            onCopy={copy} onCut={cut} onPaste={paste} />
        </div></details>
        <details className="inspector-section"><summary>Umriss</summary><div className="inspector-section-body">
          <fieldset disabled={readOnly || busy}>
            {vertices.map((point, index) => <div className="numeric-fields" key={index}>
              <div><label htmlFor={`vertex-x-${index}`}>Eckpunkt {index + 1} X (mm)</label>
                <input id={`vertex-x-${index}`} type="number" step="any" value={point.x} onChange={event => setVertices(current => current.map((item, i) => i === index ? { ...item, x: Number(event.target.value) } : item))} /></div>
              <div><label htmlFor={`vertex-y-${index}`}>Eckpunkt {index + 1} Y (mm)</label>
                <input id={`vertex-y-${index}`} type="number" step="any" value={point.y} onChange={event => setVertices(current => current.map((item, i) => i === index ? { ...item, y: Number(event.target.value) } : item))} /></div>
            </div>)}
            <div className="form-actions">
              <button type="button" className="quiet" onClick={() => { setClick('vertex'); setVertices(current => [...current, { x: venue.width / 2, y: venue.depth / 2 }]); }}>Eckpunkt hinzufügen</button>
              <button type="button" className="quiet" disabled={vertices.length <= 3} onClick={() => setVertices(current => current.slice(0, -1))}>Letzten Eckpunkt entfernen</button>
            </div>
          </fieldset>
        </div></details>
        <details className="inspector-section"><summary>Vorlage & Maßstab</summary><div className="inspector-section-body">
          <fieldset disabled={readOnly || busy}>
            <label htmlFor="venue-file">Vorlage hochladen</label>
            <input id="venue-file" type="file" accept="image/png,image/jpeg,application/pdf" onChange={event => void chooseFile(event.currentTarget.files?.[0])} />
            {meta?.kind === 'pdf' && <div><label htmlFor="venue-page">PDF-Seite</label>
              <input id="venue-page" type="number" min={1} max={meta.pageCount ?? 1} value={page} onChange={event => setPage(Number(event.target.value))} /></div>}
            <p className="muted">Zwei Referenzpunkte und eine bekannte Strecke setzen den Maßstab.</p>
            <div className="form-actions">
              <button type="button" className={click === 'a' ? '' : 'quiet'} onClick={() => setClick('a')}>Punkt A in der Vorlage</button>
              <button type="button" className={click === 'b' ? '' : 'quiet'} onClick={() => setClick('b')}>Punkt B in der Vorlage</button>
            </div>
            <div className="numeric-fields">
              {([['pointA', 'Punkt A'], ['pointB', 'Punkt B']] as const).flatMap(([key, label]) => (
                [['x', `${label} X`], ['y', `${label} Y`]] as const).map(([axis, name]) => <div key={name}>
                  <label htmlFor={`cal-${key}-${axis}`}>{name}</label>
                  <input id={`cal-${key}-${axis}`} type="number" step="any" value={calibration[key][axis]}
                    onChange={event => setCalibration(current => ({ ...current, [key]: { ...current[key], [axis]: Number(event.target.value) } }))} />
                </div>))}
              <div><label htmlFor="cal-distance">Bekannte Strecke (mm)</label>
                <input id="cal-distance" type="number" min={1} step="any" value={calibration.distanceMm}
                  onChange={event => setCalibration(current => ({ ...current, distanceMm: Number(event.target.value) }))} /></div>
            </div>
            {parsed.success && <p className="muted">Maßstab: {millimetresPerUnit(parsed.data)} mm je Vorlagen-Einheit</p>}
          </fieldset>
        </div></details>
        <details className="inspector-section"><summary>Anschlüsse & Kabelwege</summary><div className="inspector-section-body">
          <fieldset disabled={readOnly || busy}>
            <InfrastructureFields venue={venue} pins={pins} corridors={corridors} click={click} pinKind={pinKind}
              onClick={setClick} onPinKind={setPinKind} onPins={setPins} onCorridors={setCorridors} />
          </fieldset>
        </div></details>
        <details className="inspector-section"><summary>Podeste & Treppen</summary><div className="inspector-section-body">
          <VenueLevels venue={venue} platforms={platforms} stairs={stairs} readOnly={readOnly} onPlatforms={setPlatforms} onStairs={setStairs} />
        </div></details>
        <details className="inspector-section"><summary>Überbauung</summary><div className="inspector-section-body">
          <VenueOverhead venue={venue} ceilingHeight={ceilingHeight} boxes={overheadBoxes} readOnly={readOnly}
            onCeilingHeight={setCeilingHeight} onBoxes={setOverheadBoxes} />
        </div></details>
        <details className="inspector-section"><summary>Freihaltezonen</summary><div className="inspector-section-body">
          <KeepClearZones venue={venue} zones={zones} click={click} readOnly={readOnly} onClick={value => setClick(value)} onZones={setZones} />
        </div></details>
        <details className="inspector-section"><summary>Bühnenmittellinie</summary><div className="inspector-section-body">
          <fieldset disabled={readOnly || busy}><CentrelineFields centreline={centreline} onChange={setCentreline} /></fieldset>
        </div></details>
      </aside>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="workspace-statusbar">
      <span><span className="status-dot" />Spielstättenentwurf · {walls.length} feste Wände</span>
      <span className="status-hint">Ziehen zum Verschieben · Orange ↻ dreht · Entf löscht · {SNAP_NOTICE}</span>
      <button type="button" className="quiet" aria-expanded={helpOpen} onClick={() => setHelpOpen(open => !open)}><ToolIcon name="help" /> Bedienung</button>
      <span>Maße in mm</span>
    </div>
    {helpOpen && <div className="workspace-help"><h3>Spielstätte gestalten</h3>
      <p className="muted">Werkzeuge links legen feste Wände, Podeste, Publikumsstühle, Strom, Notausgänge und Lüftungskanäle an. Im Grundriss: Objekte ziehen, ↻ drehen, Boden aufziehen für Mehrfachauswahl. Einrasten wie im Bühnenbild (Alt umgeht).</p>
      <p>Entf oder Ausschneiden entfernt die Auswahl. Deckenhöhe und Überbauungen prüfen Höhenkonflikte mit dem Bühnenbild. Speichern schreibt eine neue Spielstättenfassung; bestehende Produktionen übernehmen sie erst auf Wunsch.</p>
    </div>}
  </section>;
}

function CentrelineFields({ centreline, onChange }: {
  centreline: StageCentreline; onChange: (value: StageCentreline) => void;
}) {
  return <div className="venue-centreline">
    <h4>Bühnenmittellinie</h4>
    <p className="muted">Ein Punkt auf der Linie und die Richtung in Grad. 90° verläuft vom Publikum weg. Beispielwerte, keine gemessene Spielstätte. Spiegeln ist nicht vorgesehen.</p>
    <div className="numeric-fields">
      <div><label htmlFor="centreline-x">Mittellinie X (mm)</label>
        <input id="centreline-x" type="number" step="any" value={centreline.x}
          onChange={event => onChange({ ...centreline, x: Number(event.target.value) })} /></div>
      <div><label htmlFor="centreline-y">Mittellinie Y (mm)</label>
        <input id="centreline-y" type="number" step="any" value={centreline.y}
          onChange={event => onChange({ ...centreline, y: Number(event.target.value) })} /></div>
      <div><label htmlFor="centreline-rotation">Mittellinie Drehung (°)</label>
        <input id="centreline-rotation" type="number" step="any" min={-360} max={360} value={centreline.rotation}
          onChange={event => onChange({ ...centreline, rotation: Number(event.target.value) })} /></div>
    </div>
  </div>;
}

export function InfrastructureMarks({ pins, corridors, selectedIds = [], onPointerDown }: {
  pins: ConnectionPoint[]; corridors: CableRoutingCorridor[]; selectedIds?: readonly string[];
  onPointerDown?: (event: PointerEvent, id: string) => void;
}) {
  return <g>
    {corridors.map(corridor => <g key={corridor.id} data-testid={`cable-corridor-${corridor.id}`} className={onPointerDown ? 'draggable-wall' : undefined}
      onPointerDown={onPointerDown ? event => onPointerDown(event, corridor.id) : undefined}>
      <path d={corridor.path.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')}
        fill="none" stroke={selectedIds.includes(corridor.id) ? '#b67c35' : '#5a6e8a'} strokeWidth="3" strokeDasharray="80 50" vectorEffect="non-scaling-stroke" />
      <text x={corridor.path[0]?.x} y={-(corridor.path[0]?.y ?? 0) - 80} fontSize="140" pointerEvents="none">{corridor.label}</text>
    </g>)}
    {pins.map(pin => <g key={pin.id} data-testid={`connection-point-${pin.id}`} data-kind={pin.kind} className={onPointerDown ? 'draggable-wall' : undefined}
      onPointerDown={onPointerDown ? event => onPointerDown(event, pin.id) : undefined}>
      <circle cx={pin.x} cy={-pin.y} r="90" fill="transparent" />
      <circle cx={pin.x} cy={-pin.y} r="55" fill={selectedIds.includes(pin.id) ? '#b67c35' : '#d9c6a1'} stroke="#986122" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <text x={pin.x} y={-pin.y - 80} textAnchor="middle" fontSize="140" pointerEvents="none">{pin.label}</text>
    </g>)}
  </g>;
}

function InfrastructureFields({ venue, pins, corridors, click, pinKind, onClick, onPinKind, onPins, onCorridors }: {
  venue: VenueGeometry; pins: ConnectionPoint[]; corridors: CableRoutingCorridor[];
  click: ClickMode; pinKind: ConnectionKind;
  onClick: (value: ClickMode) => void;
  onPinKind: (kind: ConnectionKind) => void;
  onPins: (value: ConnectionPoint[] | ((current: ConnectionPoint[]) => ConnectionPoint[])) => void;
  onCorridors: (value: CableRoutingCorridor[] | ((current: CableRoutingCorridor[]) => CableRoutingCorridor[])) => void;
}) {
  const centre = { x: Math.round(venue.width / 2), y: Math.round(venue.depth / 2) };
  return <div className="infrastructure">
    <h4>Anschlüsse und Kabelwege</h4>
    <p className="muted">Bekannte Strom- und Audioanschlüsse und mögliche Kabelwege. Keine Lastberechnung und keine Kabelstückliste.</p>
    <div className="form-actions">
      <button type="button" className="quiet" disabled={pins.length >= 250} onClick={() => {
        onPinKind('power'); onClick('pin');
        onPins(current => [...current, newConnectionPoint(crypto.randomUUID(), 'power', centre.x, centre.y)]);
      }}>Stromanschluss hinzufügen</button>
      <button type="button" className="quiet" disabled={pins.length >= 250} onClick={() => {
        onPinKind('audio'); onClick('pin');
        onPins(current => [...current, newConnectionPoint(crypto.randomUUID(), 'audio', centre.x, centre.y)]);
      }}>Audioanschluss hinzufügen</button>
      <button type="button" className="quiet" disabled={corridors.length >= 250} onClick={() => {
        onClick('corridor');
        onCorridors(current => [...current, newCableRoutingCorridor(crypto.randomUUID(), [
          { x: 0, y: centre.y }, { x: venue.width, y: centre.y },
        ])]);
      }}>Kabelkorridor hinzufügen</button>
      <button type="button" className={click === 'pin' ? '' : 'quiet'} onClick={() => onClick('pin')}>Anschluss in der Zeichnung setzen</button>
      <button type="button" className={click === 'corridor' ? '' : 'quiet'} onClick={() => onClick('corridor')}>Korridorpunkt in der Zeichnung setzen</button>
    </div>
    {pins.map((pin, index) => <div className="opening-fields" key={pin.id}>
      <p>{index + 1}. Anschluss</p>
      <div><label htmlFor={`pin-kind-${pin.id}`}>Anschluss {index + 1} Art</label>
        <select id={`pin-kind-${pin.id}`} value={pin.kind} onChange={event => {
          const kind = event.target.value as ConnectionKind;
          onPinKind(kind);
          onPins(current => current.map(item => item.id === pin.id ? { ...item, kind, label: item.label === 'Strom' || item.label === 'Audio' ? (kind === 'power' ? 'Strom' : 'Audio') : item.label } : item));
        }}>
          <option value="power">Strom</option>
          <option value="audio">Audio</option>
        </select></div>
      <div><label htmlFor={`pin-label-${pin.id}`}>Anschluss {index + 1} Bezeichnung</label>
        <input id={`pin-label-${pin.id}`} maxLength={120} value={pin.label} onChange={event => onPins(current => current.map(item => item.id === pin.id ? { ...item, label: event.target.value } : item))} /></div>
      <div><label htmlFor={`pin-x-${pin.id}`}>Anschluss {index + 1} X (mm)</label>
        <input id={`pin-x-${pin.id}`} type="number" step="any" value={pin.x} onChange={event => onPins(current => current.map(item => item.id === pin.id ? { ...item, x: Number(event.target.value) } : item))} /></div>
      <div><label htmlFor={`pin-y-${pin.id}`}>Anschluss {index + 1} Y (mm)</label>
        <input id={`pin-y-${pin.id}`} type="number" step="any" value={pin.y} onChange={event => onPins(current => current.map(item => item.id === pin.id ? { ...item, y: Number(event.target.value) } : item))} /></div>
      <div><label htmlFor={`pin-notes-${pin.id}`}>Anschluss {index + 1} Notiz</label>
        <input id={`pin-notes-${pin.id}`} maxLength={500} value={pin.notes ?? ''} onChange={event => onPins(current => current.map(item => item.id === pin.id ? { ...item, notes: event.target.value } : item))} /></div>
      <button type="button" className="quiet" onClick={() => onPins(current => current.filter(item => item.id !== pin.id))}>Anschluss entfernen</button>
    </div>)}
    {corridors.map((corridor, index) => <div className="opening-fields" key={corridor.id}>
      <p>{index + 1}. Kabelkorridor</p>
      <div><label htmlFor={`corridor-label-${corridor.id}`}>Kabelkorridor {index + 1} Bezeichnung</label>
        <input id={`corridor-label-${corridor.id}`} maxLength={120} value={corridor.label} onChange={event => onCorridors(current => current.map(item => item.id === corridor.id ? { ...item, label: event.target.value } : item))} /></div>
      <div><label htmlFor={`corridor-notes-${corridor.id}`}>Kabelkorridor {index + 1} Notiz</label>
        <input id={`corridor-notes-${corridor.id}`} maxLength={500} value={corridor.notes ?? ''} onChange={event => onCorridors(current => current.map(item => item.id === corridor.id ? { ...item, notes: event.target.value } : item))} /></div>
      {corridor.path.map((point, pointIndex) => [
        <div key={`x-${pointIndex}`}><label htmlFor={`corridor-${corridor.id}-p${pointIndex}-x`}>Kabelkorridor {index + 1} Punkt {pointIndex + 1} X (mm)</label>
          <input id={`corridor-${corridor.id}-p${pointIndex}-x`} type="number" step="any" value={point.x}
            onChange={event => onCorridors(current => current.map(item => item.id === corridor.id ? { ...item, path: item.path.map((entry, i) => i === pointIndex ? { ...entry, x: Number(event.target.value) } : entry) } : item))} /></div>,
        <div key={`y-${pointIndex}`}><label htmlFor={`corridor-${corridor.id}-p${pointIndex}-y`}>Kabelkorridor {index + 1} Punkt {pointIndex + 1} Y (mm)</label>
          <input id={`corridor-${corridor.id}-p${pointIndex}-y`} type="number" step="any" value={point.y}
            onChange={event => onCorridors(current => current.map(item => item.id === corridor.id ? { ...item, path: item.path.map((entry, i) => i === pointIndex ? { ...entry, y: Number(event.target.value) } : entry) } : item))} /></div>,
      ])}
      <button type="button" className="quiet" onClick={() => onCorridors(current => current.map(item => item.id === corridor.id ? { ...item, path: [...item.path, { x: centre.x, y: centre.y }] } : item))}>Punkt hinzufügen</button>
      <button type="button" className="quiet" disabled={corridor.path.length <= 2} onClick={() => onCorridors(current => current.map(item => item.id === corridor.id ? { ...item, path: item.path.slice(0, -1) } : item))}>Letzten Punkt entfernen</button>
      <button type="button" className="quiet" onClick={() => onCorridors(current => current.filter(item => item.id !== corridor.id))}>Kabelkorridor entfernen</button>
    </div>)}
  </div>;
}

async function pdfPageImage(bytes: ArrayBuffer, pageNumber: number) {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  try {
    const pdfPage = await pdf.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const canvasContext = canvas.getContext('2d');
    if (!canvasContext) throw new Error('canvas');
    await pdfPage.render({ canvas, canvasContext, viewport }).promise;
    return { href: canvas.toDataURL('image/png'), pixelWidth: canvas.width, pixelHeight: canvas.height };
  } finally { await pdf.cleanup(); }
}
