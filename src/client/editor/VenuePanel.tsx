import { useEffect, useRef, useState, lazy, Suspense, type DragEvent, type FormEvent, type PointerEvent } from 'react';
import { newWall, applyVenueResultSchema, saveVenueResultSchema, venueGeometrySchema, type Layout, type VenueGeometry } from '../../shared/layout.js';
import {
  newCableRoutingCorridor, newConnectionPoint, type CableRoutingCorridor, type ConnectionKind, type ConnectionPoint,
} from '../../shared/infrastructure.js';
import { venueReferenceSchema, type VenueReference } from '../../shared/contracts.js';
import { VenueLevels } from './VenueLevels.js';
import { CurtainMarks, OverheadMarks, TrussMarks, VenueOverhead } from './VenueOverhead.js';
import { KeepClearMarks, KeepClearZones } from './KeepClearZones.js';
import { commitDrawnKeepClear, nearFirstVertex, type KeepClearZone } from '../../shared/keepClear.js';
import { calibrationSchema, insertOutlineVertex, measuredOutline, millimetresPerUnit, underlaySourceToPlan, type Calibration, type PlanPoint } from '../../shared/venue.js';
import { defaultPlanDisplay, type PlanDisplayOptions } from '../../shared/planDisplay.js';
import { PlanDisplayToggles } from './PlanDisplayToggles.js';
import { VenueUnderlayDialog } from './VenueUnderlayDialog.js';
import { prepareUnderlayFile, prepareUnderlayFromDataTransfer, prepareUnderlayFromClipboardRead, dataTransferHasUnderlay } from './underlayImport.js';
import { type Platform, type StairUnit, AUDIENCE_FLOOR_ID, PLATFORM_STYLE_LABELS, axisAlignedPlatformOutline, newPlatform, newStair, platformBounds, platformCentroid, reassignVenueSupports, stairCorners, type PlatformStyle } from '../../shared/levels.js';
import { clipPlatformToStageDeck, layoutStageDeckModules, snapStageDeckElevation, snapStageDeckSize } from '../../shared/stageDeck.js';
import { type OverheadBox, newOverheadBox, EXAMPLE_CEILING_HEIGHT } from '../../shared/overhead.js';
import { objectOverlapWarnings } from '../../shared/overlap.js';
import { newPlaceholder, type Placeholder, type PlaceholderKind } from '../../shared/placeholders.js';
import { trussFromSegment, type Truss } from '../../shared/truss.js';
import { curtainFromSegment, type Curtain } from '../../shared/curtains.js';
import { defaultCentreline, planRotationAt, SNAP_NOTICE, snapStatusText, type SnapGuide, type StageCentreline } from '../../shared/snapping.js';
import { CentrelineMark, AlignmentGuides, SnapToggle } from './SnapGuides.js';
import { RotationHandle } from './RotationHandle.js';
import { PlaceholderLayer } from './PlaceholderLayer.js';
import {
  copyVenueSelection, cutVenueSelection, pasteVenueSelection, removeVenueSelection,
  venueObjects, venueObjectsInBounds, venueSelectionPivot, type VenueClipboard,
} from '../../shared/venueEditing.js';
import { normalizeBounds, type PlanBounds } from '../../shared/selection.js';
import { navigatePlan } from './planNavigation.js';
import { editorCommand } from './interactionKeys.js';
import { transformVenueGesture } from '../../shared/plannerTransforms.js';
import { useDocumentDraft } from './useDocumentDraft.js';
import { StageView } from './StageView.js';
import { ClipboardPanel } from './ClipboardPanel.js';
import type { StageEditing } from './StageEditing.js';
import { useViewportWheel } from './viewportWheel.js';
import { ApiError, request, upload } from '../api.js';
import { ToolIcon } from './ToolIcon.js';
import { defaultLighting, type StageLightingSettings } from '../../shared/lighting.js';

const MaterialPicker = lazy(() => import('./MaterialPicker.js'));
type ClickMode = 'select' | 'vertex' | 'pin' | 'corridor' | 'draw-zone' | 'zone-vertex' | 'place' | 'draw-truss' | 'draw-curtain';
type PlaceKind = 'wall' | 'platform' | 'stair' | 'chair' | 'table' | 'person' | 'speaker' | 'box' | 'overhead' | 'power' | 'audio';
const CENTRELINE_SELECTION = 'stage-centreline';
type ViewMode = 'split' | 'plan' | 'stage';
type VenueDraft = {
  lighting: StageLightingSettings;
  walls: NonNullable<VenueGeometry['walls']>; vertices: PlanPoint[]; platforms: Platform[]; stairs: StairUnit[];
  placeholders: Placeholder[];
  ceilingHeight: number | ''; overheadBoxes: OverheadBox[]; trusses: Truss[]; curtains: Curtain[];
  fileId: string | undefined; page: number; rotationDeg: number; calibration: Calibration;
  pins: ConnectionPoint[]; corridors: CableRoutingCorridor[]; zones: KeepClearZone[]; centreline: StageCentreline;
};

function draftFromVenue(venue: VenueGeometry, draft: VenueDraft): VenueDraft {
  return {
    ...draft,
    walls: venue.walls ?? [], platforms: venue.platforms ?? [], stairs: venue.stairs ?? [],
    placeholders: venue.placeholders ?? [],
    overheadBoxes: venue.overheadBoxes ?? [], trusses: venue.trusses ?? [], curtains: venue.curtains ?? [],
    pins: venue.connectionPoints ?? [],
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
    ceilingHeight: (venue.ceilingHeight ?? '') as number | '', overheadBoxes: venue.overheadBoxes ?? [], trusses: venue.trusses ?? [],
    curtains: venue.curtains ?? [],
    fileId: venue.trace?.fileId, page: venue.trace?.page ?? 1,
    rotationDeg: venue.trace?.rotationDeg ?? 0,
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
  const [trusses, setTrusses] = draft.field('trusses');
  const [curtains, setCurtains] = draft.field('curtains');
  const [fileId, setFileId] = draft.field('fileId');
  const [page, setPage] = draft.field('page');
  const [rotationDeg, setRotationDeg] = draft.field('rotationDeg');
  const [calibration, setCalibration] = draft.field('calibration');
  const [pins, setPins] = draft.field('pins');
  const [corridors, setCorridors] = draft.field('corridors');
  const [zones, setZones] = draft.field('zones');
  const [centreline, setCentreline] = draft.field('centreline');
  const [click, setClick] = useState<ClickMode>('select');
  const [placeKind, setPlaceKind] = useState<PlaceKind>('wall');
  const [pinKind, setPinKind] = useState<ConnectionKind>('power');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<VenueClipboard>();
  const [marqueeBox, setMarqueeBox] = useState<PlanBounds>();
  const [drawingZone, setDrawingZone] = useState<PlanPoint[]>([]);
  const [trussDrawStart, setTrussDrawStart] = useState<PlanPoint | undefined>();
  const [trussDrawHover, setTrussDrawHover] = useState<PlanPoint | undefined>();
  const [curtainDrawStart, setCurtainDrawStart] = useState<PlanPoint | undefined>();
  const [curtainDrawHover, setCurtainDrawHover] = useState<PlanPoint | undefined>();
  const selected = selectedIds[0];
  const vertexDrag = useRef<number | undefined>(undefined);
  const zoneVertexDrag = useRef<{ zoneId: string; index: number } | undefined>(undefined);
  const corridorVertexDrag = useRef<{ corridorId: string; index: number } | undefined>(undefined);
  const centrelineDrag = useRef<{ x: number; y: number; start: StageCentreline } | undefined>(undefined);
  const transformStart = useRef<{ draft: VenueDraft; ids: string[] } | undefined>(undefined);
  const gestureSelection = useRef<string[]>([]);
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
    ids: string[]; hinge: { x: number; y: number }; startAngle: number; startRotation: number; start: VenueDraft;
  } | undefined>(undefined);
  useEffect(() => { onDirty?.(draft.dirty); }, [draft.dirty, onDirty]);
  const [meta, setMeta] = useState<VenueReference>();
  const [overlay, setOverlay] = useState<{ href: string; pixelWidth: number; pixelHeight: number }>();
  const [underlayDialogOpen, setUnderlayDialogOpen] = useState(false);
  const [planDisplay, setPlanDisplay] = useState<PlanDisplayOptions>(defaultPlanDisplay);
  const [underlayDrag, setUnderlayDrag] = useState(false);
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
  function planPoint(event: { clientX: number; clientY: number }) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const value = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(value.x), y: Math.round(-value.y) };
  }
  function busyGesture() { return draft.isActive() || !!panDrag.current || !!marqueeDrag.current; }
  function placeAt(point: PlanPoint) {
    if (placeKind === 'wall') {
      const wall = newWall(crypto.randomUUID(), point.x, point.y);
      setWalls(items => [...items, wall]); setSelectedIds([wall.id]);
    } else if (placeKind === 'platform') {
      const platform = newPlatform(crypto.randomUUID(), point.x, point.y);
      setPlatforms(items => [...items, platform]); setSelectedIds([platform.id]);
    } else if (placeKind === 'stair') {
      const raised = platforms[0]; if (!raised) return;
      const stair = newStair(crypto.randomUUID(), AUDIENCE_FLOOR_ID, raised.id, point.x, point.y);
      setStairs(items => [...items, stair]); setSelectedIds([stair.id]);
    } else if (placeKind === 'overhead') {
      const box = { ...newOverheadBox(crypto.randomUUID(), point.x, point.y), label: 'Lüftungskanal' };
      setOverheadBoxes(current => [...current, box]);
      if (ceilingHeight === '') setCeilingHeight(EXAMPLE_CEILING_HEIGHT);
      setSelectedIds([box.id]);
    } else if (placeKind === 'power' || placeKind === 'audio') {
      const kind = placeKind;
      setPinKind(kind);
      const pin = newConnectionPoint(crypto.randomUUID(), kind, point.x, point.y);
      setPins(current => current.length >= 250 ? current : [...current, pin]); setSelectedIds([pin.id]);
    } else {
      const kind = placeKind as PlaceholderKind;
      const item = newPlaceholder(kind, crypto.randomUUID(), point.x, point.y);
      setPlaceholders(items => [...items, item]); setSelectedIds([item.id]);
    }
    setClick('select');
  }
  function onPlan(event: PointerEvent) {
    if (busyGesture()) return;
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
    if (click === 'vertex') {
      const next = insertOutlineVertex(vertices, point);
      if (next) setVertices(next);
      return;
    }
    if (click === 'place') { placeAt(point); return; }
    if (click === 'pin') setPins(current => current.length >= 250 ? current : [...current, newConnectionPoint(crypto.randomUUID(), pinKind, point.x, point.y)]);
    else if (click === 'corridor') setCorridors(current => {
      if (!current.length) return [newCableRoutingCorridor(crypto.randomUUID(), [point, { x: point.x + 1000, y: point.y }])];
      const last = current[current.length - 1]!;
      if (last.path.length >= 500) return current;
      return current.map((corridor, index) => index === current.length - 1 ? { ...corridor, path: [...corridor.path, point] } : corridor);
    });
    else if (click === 'draw-zone') {
      setDrawingZone(current => {
        if (nearFirstVertex(current, point)) {
          const zone = commitDrawnKeepClear(crypto.randomUUID(), current);
          if (zone) { setZones(zones => [...zones, zone]); setSelectedIds([zone.id]); setClick('select'); }
          return [];
        }
        return [...current, point];
      });
    }
    else if (click === 'zone-vertex') {
      const target = zones.find(zone => selectedIds.includes(zone.id)) ?? zones[zones.length - 1];
      if (!target) return;
      const next = insertOutlineVertex(target.polygon, point);
      if (next) setZones(current => current.map(zone => zone.id === target.id ? { ...zone, polygon: next } : zone));
    }
    else if (click === 'draw-truss') {
      if (!trussDrawStart) { setTrussDrawStart(point); setTrussDrawHover(point); return; }
      const truss = trussFromSegment(crypto.randomUUID(), trussDrawStart, point);
      setTrussDrawStart(undefined); setTrussDrawHover(undefined);
      if (!truss || trusses.length >= 250) return;
      setTrusses(current => [...current, truss]); setSelectedIds([truss.id]); setClick('select');
    }
    else if (click === 'draw-curtain') {
      if (!curtainDrawStart) { setCurtainDrawStart(point); setCurtainDrawHover(point); return; }
      const curtain = curtainFromSegment(crypto.randomUUID(), curtainDrawStart, point);
      setCurtainDrawStart(undefined); setCurtainDrawHover(undefined);
      if (!curtain || curtains.length >= 250) return;
      setCurtains(current => [...current, curtain]); setSelectedIds([curtain.id]); setClick('select');
    }

  }
  function startMarquee(event: PointerEvent) {
    if (readOnly || busyGesture() || event.button !== 0 || click !== 'select') return;
    gestureSelection.current = selectedIds;
    event.stopPropagation();
    const point = planPoint(event);
    marqueeDrag.current = { ...point, additive: event.shiftKey, endX: point.x, endY: point.y };
    if (!event.shiftKey) setSelectedIds([]);
    setMarqueeBox(normalizeBounds(point, point));
    svg.current?.setPointerCapture(event.pointerId);
  }
  function beginObjectDrag(event: PointerEvent, id: string) {
    event.stopPropagation();
    if (event.button !== 0 || busyGesture()) return;
    gestureSelection.current = selectedIds;
    const ids = event.shiftKey
      ? (selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id])
      : (selectedIds.includes(id) ? selectedIds : [id]);
    setSelectedIds(ids);
    setClick('select');
    if (event.shiftKey || readOnly || !ids.length) return;
    const point = planPoint(event);
    objectDrag.current = { ids, x: point.x, y: point.y, start: draft.value };
    draft.begin();
    setGuides([]);
    setSnapStatus(undefined);
    svg.current?.setPointerCapture(event.pointerId);
  }
  function beginObjectRotate(event: PointerEvent, id: string, hinge: { x: number; y: number }, startRotation: number) {
    event.stopPropagation();
    if (event.button !== 0 || readOnly || busyGesture()) return;
    gestureSelection.current = selectedIds;
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    setSelectedIds(ids);
    hinge = venueSelectionPivot(previewVenue, ids) ?? hinge;
    setClick('select');
    const point = planPoint(event);
    objectRotate.current = {
      ids, hinge, startAngle: planRotationAt(hinge, point), startRotation, start: draft.value,
    };
    draft.begin();
    setGuides([]);
    svg.current?.setPointerCapture(event.pointerId);
  }
  async function chooseFile(file?: File) {
    if (!file || readOnly) return;
    setBusy(true); setError('');
    try {
      const prepared = await prepareUnderlayFile(file, file.name);
      const stored = venueReferenceSchema.parse(await upload(`/api/workspaces/${workspaceId}/venue-references`, prepared));
      setFileId(stored.id); setMeta(stored); setPage(1); setRotationDeg(0);
      setCalibration({ pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 }, distanceMm: 1000 });
      setUnderlayDialogOpen(true);
    } catch { setError('Die Vorlage konnte nicht übernommen werden. PNG, JPEG, PDF oder ein Screenshot.'); }
    finally { setBusy(false); setUnderlayDrag(false); }
  }
  async function acceptUnderlayTransfer(transfer: DataTransfer) {
    if (readOnly || busy || busyGesture()) return;
    try {
      const prepared = await prepareUnderlayFromDataTransfer(transfer);
      if (!prepared) { setError('Keine Bild- oder PDF-Vorlage erkannt.'); return; }
      await chooseFile(prepared);
    } catch { setError('Die Vorlage konnte nicht übernommen werden. PNG, JPEG, PDF oder ein Screenshot.'); }
  }
  async function pasteUnderlayFromSystemClipboard() {
    if (readOnly || busy || busyGesture()) return;
    try {
      const prepared = await prepareUnderlayFromClipboardRead();
      if (!prepared) {
        setError('Kein Screenshot in der Zwischenablage. In Spectacle „In die Zwischenablage kopieren“, dann hier einfügen.');
        return;
      }
      await chooseFile(prepared);
    } catch {
      setError('Zwischenablage nicht lesbar. Screenshot in Spectacle kopieren, dann Strg+V — oder Datei wählen.');
    }
  }
  function underlayDragOver(event: DragEvent) {
    if (readOnly || busy) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setUnderlayDrag(true);
  }
  function underlayDragLeave(event: DragEvent) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setUnderlayDrag(false);
  }
  const acceptUnderlayRef = useRef(acceptUnderlayTransfer);
  acceptUnderlayRef.current = acceptUnderlayTransfer;
  const pasteObjectsRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (readOnly) return;
    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable=true]')) return;
      const data = event.clipboardData;
      // Prefer system screenshot/PDF (Spectacle → Ctrl+V), like Teams / WhatsApp Web.
      if (data && dataTransferHasUnderlay(data)) {
        event.preventDefault();
        void acceptUnderlayRef.current(data);
        return;
      }
      event.preventDefault();
      pasteObjectsRef.current();
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [readOnly]);
  async function save(event?: FormEvent) {
    event?.preventDefault();
    const trace = fileId ? {
      fileId, ...(meta?.kind === 'pdf' ? { page } : {}),
      ...(rotationDeg ? { rotationDeg } : {}),
      ...(parsed.success ? { calibration: parsed.data } : {}),
    } : undefined;
    const result = venueGeometrySchema.safeParse({
      schemaVersion: 1, width: venue.width, depth: venue.depth, outline: vertices, trace,
      connectionPoints: pins.map(pin => ({ ...pin, notes: optionalNotes(pin.notes) })),
      cableRoutingCorridors: corridors.map(corridor => ({ ...corridor, notes: optionalNotes(corridor.notes) })),
      walls, wallTypes: venue.wallTypes, platforms, stairs, placeholders, lighting,
      ...(ceilingHeight === '' ? {} : { ceilingHeight }),
      overheadBoxes, trusses, curtains, keepClearZones: zones, stageCentreline: centreline,
    });
    if (!result.success) { setError('Bitte prüfen Sie den Umriss, die Kalibrierung, die Anschlüsse und die Überbauungen.'); return; }
    const toSave = reassignVenueSupports(result.data);
    const acknowledged = structuredClone(draft.value);
    setBusy(true); setError('');
    try {
      if (onPublish) await onPublish(toSave);
      else {
        const body = saveVenueResultSchema.parse(await request(`/api/workspaces/${workspaceId}/scenes/${sceneId}/venue`, { venue: toSave }, 'PUT'));
        onSaved?.({ ...body, venueUpdateAvailable: false });
      }
      draft.markSaved(acknowledged);
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
  const overlayW = overlay ? overlay.pixelWidth * unit : 0;
  const overlayH = overlay ? overlay.pixelHeight * unit : 0;
  const overlayBounds = overlay ? (() => {
    const cx = overlayW / 2, cy = overlayH / 2, angle = rotationDeg * Math.PI / 180;
    const corners = [{ x: 0, y: 0 }, { x: overlayW, y: 0 }, { x: overlayW, y: overlayH }, { x: 0, y: overlayH }].map(p => {
      const dx = p.x - cx, dy = p.y - cy;
      return { x: cx + dx * Math.cos(angle) - dy * Math.sin(angle), y: cy + dx * Math.sin(angle) + dy * Math.cos(angle) };
    });
    return {
      maxX: Math.max(...corners.map(c => c.x)),
      maxY: Math.max(...corners.map(c => c.y)),
    };
  })() : undefined;
  const width = overlayBounds ? overlayBounds.maxX : Math.max(venue.width, ...vertices.map(point => point.x));
  const height = overlayBounds ? overlayBounds.maxY : Math.max(venue.depth, ...vertices.map(point => point.y));
  const hasMeasureSegment = Math.hypot(calibration.pointB.x - calibration.pointA.x, calibration.pointB.y - calibration.pointA.y) > 0;
  const measureA = overlay && hasMeasureSegment ? underlaySourceToPlan(calibration.pointA, overlay, unit, rotationDeg) : undefined;
  const measureB = overlay && hasMeasureSegment ? underlaySourceToPlan(calibration.pointB, overlay, unit, rotationDeg) : undefined;
  const planLeft = Math.min(0, ...vertices.map(p => p.x)) - 400;
  const planTop = -Math.max(height, ...vertices.map(p => p.y)) - 400;
  const planWidth = Math.max(width, ...vertices.map(p => p.x)) - planLeft + 400;
  const planHeight = Math.max(height, ...vertices.map(p => p.y)) + 1200;
  const candidate = venueGeometrySchema.safeParse({ ...venue, lighting, outline: vertices, walls, platforms, stairs, placeholders, overheadBoxes, trusses, curtains,
    ceilingHeight: ceilingHeight === '' ? undefined : ceilingHeight, keepClearZones: zones, connectionPoints: pins, cableRoutingCorridors: corridors, stageCentreline: centreline });
  const previewVenue = candidate.success ? reassignVenueSupports(candidate.data) : venue;
  // Placeholders stay on the venue only; putting them on the layout too duplicates chairs in 3D.
  const liveLayout: Layout = { schemaVersion: 1, walls: [], braces: [] };
  const pivot = venueSelectionPivot(previewVenue, selectedIds);
  function sourceFromDraft(start: VenueDraft): VenueGeometry {
    return {
      ...previewVenue, walls: start.walls, platforms: start.platforms, stairs: start.stairs, placeholders: start.placeholders,
      overheadBoxes: start.overheadBoxes, trusses: start.trusses, curtains: start.curtains, connectionPoints: start.pins,
      cableRoutingCorridors: start.corridors, keepClearZones: start.zones, stageCentreline: start.centreline,
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
      if (turning.ids.includes(CENTRELINE_SELECTION)) {
        draft.preview({ ...turning.start, centreline: { ...turning.start.centreline, rotation: turning.startRotation + delta } });
        setGuides([]); setSnapStatus(undefined);
        return;
      }
      const moved = transformVenueGesture(sourceFromDraft(turning.start), turning.ids, { x: 0, y: 0, rotation: delta }, 'rotate', bypass);
      draft.preview(draftFromVenue(moved.venue, turning.start));
      setGuides(moved.guides); setSnapStatus(undefined);
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
      const moved = transformVenueGesture(sourceFromDraft(dragging.start), dragging.ids, { x: point.x - dragging.x, y: point.y - dragging.y, rotation: 0 }, 'translate', bypass);
      draft.preview(draftFromVenue(moved.venue, dragging.start));
      setGuides(moved.guides);
      setSnapStatus(snapStatusText({ guides: moved.guides }));
      return;
    }
    const zoneVert = zoneVertexDrag.current;
    if (zoneVert) {
      setZones(current => current.map(zone => zone.id === zoneVert.zoneId
        ? { ...zone, polygon: zone.polygon.map((entry, i) => i === zoneVert.index ? point : entry) } : zone));
      return;
    }
    const corridorVert = corridorVertexDrag.current;
    if (corridorVert) {
      setCorridors(current => current.map(corridor => corridor.id === corridorVert.corridorId
        ? { ...corridor, path: corridor.path.map((entry, i) => i === corridorVert.index ? point : entry) } : corridor));
      return;
    }
    const centreDrag = centrelineDrag.current;
    if (centreDrag) {
      setCentreline({ ...centreDrag.start, x: centreDrag.start.x + (point.x - centreDrag.x), y: centreDrag.start.y + (point.y - centreDrag.y) });
      return;
    }
    if (click === 'draw-truss' && trussDrawStart) setTrussDrawHover(point);
    if (click === 'draw-curtain' && curtainDrawStart) setCurtainDrawHover(point);
    if (vertexDrag.current === undefined) return;
    setVertices(current => current.map((v, i) => i === vertexDrag.current ? point : v));
  }
  function endPlanGesture(cancel = false) {
    if (cancel) setSelectedIds(gestureSelection.current);
    if (panDrag.current) {
      panDrag.current = undefined;
      if (svg.current) svg.current.style.cursor = '';
      return;
    }
    const marquee = marqueeDrag.current;
    marqueeDrag.current = undefined;
    if (marquee) {
      const ids = venueObjectsInBounds(previewVenue, normalizeBounds(marquee, { x: marquee.endX, y: marquee.endY }));
      if (!cancel) setSelectedIds(current => marquee.additive ? [...new Set([...current, ...ids])] : ids);
      setMarqueeBox(undefined);
      return;
    }
    if (objectRotate.current) { objectRotate.current = undefined; draft.finish(cancel); setGuides([]); setSnapStatus(undefined); return; }
    if (objectDrag.current) { objectDrag.current = undefined; draft.finish(cancel); setGuides([]); setSnapStatus(undefined); return; }
    if (centrelineDrag.current) { centrelineDrag.current = undefined; draft.finish(cancel); return; }
    if (zoneVertexDrag.current) { zoneVertexDrag.current = undefined; draft.finish(cancel); return; }
    if (corridorVertexDrag.current) { corridorVertexDrag.current = undefined; draft.finish(cancel); return; }
    if (vertexDrag.current !== undefined) { vertexDrag.current = undefined; draft.finish(cancel); }
  }
  function copy() {
    if (busyGesture()) return;
    const taken = copyVenueSelection(previewVenue, selectedIds);
    if (taken) setClipboard(taken);
  }
  function cut() {
    if (busyGesture()) return;
    const result = cutVenueSelection(previewVenue, selectedIds);
    if (result.blocked) { setError('Abhängige Podestbezüge müssen mitgelöscht werden.'); return; }
    if (!result.clipboard) return;
    setClipboard(result.clipboard);
    draft.commit(draftFromVenue(result.venue, draft.value));
    setSelectedIds([]);
  }
  function paste() {
    if (busyGesture()) return;
    if (!clipboard) return;
    const result = pasteVenueSelection(previewVenue, clipboard, () => crypto.randomUUID());
    if (!result.ids.length) return;
    draft.commit(draftFromVenue(result.venue, draft.value));
    setSelectedIds(result.ids);
    if (clipboard.cut) setClipboard(undefined);
    else setClipboard(copyVenueSelection(result.venue, result.ids));
  }
  pasteObjectsRef.current = paste;
  function remove() {
    if (busyGesture()) return;
    const ids = selectedIds.filter(id => id !== CENTRELINE_SELECTION);
    if (!ids.length) { setSelectedIds([]); return; }
    const result = removeVenueSelection(previewVenue, ids);
    if (result.blocked) { setError('Abhängige Podestbezüge müssen mitgelöscht werden.'); return; }
    draft.commit(draftFromVenue(result.venue, draft.value));
    setSelectedIds([]);
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (draft.dirty) { event.preventDefault(); event.returnValue = ''; } };
    const key = (event: KeyboardEvent) => {
      const command = editorCommand(event);
      if (!command) return;
      // Ctrl+V must not be cancelled here — the paste event carries Spectacle/PNG clipboard images.
      if (command === 'paste') return;
      event.preventDefault();
      if (command === 'cancel') {
        if (objectDrag.current || objectRotate.current || vertexDrag.current !== undefined || zoneVertexDrag.current || corridorVertexDrag.current || centrelineDrag.current || marqueeDrag.current || panDrag.current) endPlanGesture(true);
        else if (drawingZone.length || trussDrawStart || curtainDrawStart) {
          setDrawingZone([]); setTrussDrawStart(undefined); setTrussDrawHover(undefined);
          setCurtainDrawStart(undefined); setCurtainDrawHover(undefined);
        }
        else if (!transformStart.current) { setSelectedIds([]); setClick('select'); }
        return;
      }
      if (event.key === 'Enter' && click === 'draw-zone' && drawingZone.length >= 3) {
        const zone = commitDrawnKeepClear(crypto.randomUUID(), drawingZone);
        if (zone) { setZones(zones => [...zones, zone]); setSelectedIds([zone.id]); }
        setDrawingZone([]); setClick('select'); return;
      }
      if (readOnly || busyGesture()) return;
      if (command === 'undo') draft.undo();
      else if (command === 'redo') draft.redo();
      else if (command === 'copy') copy();
      else if (command === 'cut') cut();
      else if (command === 'delete') remove();
    };
    window.addEventListener('beforeunload', warn); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('keydown', key); };
  });
  const transform: StageEditing['onTransform'] = (phase, delta, bypass, operation = 'translate') => {
    if (readOnly) return;
    if (phase === 'begin') { if (!busyGesture()) { transformStart.current = { draft: draft.value, ids: selectedIds }; draft.begin(); } return; }
    if (phase === 'cancel') { draft.finish(true); transformStart.current = undefined; setGuides([]); return; }
    const start = transformStart.current;
    if (!start) return;
    const moved = transformVenueGesture(sourceFromDraft(start.draft), start.ids, delta, operation, bypass);
    draft.preview(draftFromVenue(moved.venue, start.draft)); setGuides(moved.guides);
    if (phase === 'commit') { draft.finish(); transformStart.current = undefined; setGuides([]); }
  };
  const pushPull: StageEditing['onPushPull'] = (phase, next) => {
    if (readOnly) return;
    if (phase === 'begin') { if (!busyGesture()) { transformStart.current = { draft: draft.value, ids: selectedIds }; draft.begin(); } return; }
    if (phase === 'cancel') { draft.finish(true); transformStart.current = undefined; return; }
    const start = transformStart.current;
    if (!start) return;
    draft.preview(draftFromVenue(next, start.draft));
    if (phase === 'commit') { draft.finish(); transformStart.current = undefined; }
  };
  useViewportWheel(svg, event => {
    if (busyGesture()) return;
    const next = navigatePlan(event, { zoom, pan, centre: { x: planLeft + planWidth / 2, y: -(planTop + planHeight / 2) } }, planPoint(event));
    if (next) { event.preventDefault(); setZoom(next.zoom); setPan(next.pan); }
  });
  const selectedWall = walls.find(wall => wall.id === selected);
  const selectedWallIndex = selectedWall ? walls.findIndex(wall => wall.id === selectedWall.id) : -1;
  const selectedObject = venueObjects(previewVenue).find(item => item.id === selected);
  return <section className="venue-editor" aria-label="Spielstätte">
    <div className="workspace-commandbar">
      <div className="editor-toolbar">
        {!readOnly && <>
          <button type="button" className="quiet" disabled={!draft.canUndo || busy || busyGesture()} onClick={draft.undo} title="Spielstätte rückgängig" aria-label="Spielstätte rückgängig"><ToolIcon name="undo" /></button>
          <button type="button" className="quiet" disabled={!draft.canRedo || busy || busyGesture()} onClick={draft.redo} title="Spielstätte wiederholen" aria-label="Spielstätte wiederholen"><ToolIcon name="redo" /></button>
          <button type="button" disabled={!draft.dirty || busy} onClick={() => void save()}>Spielstätte speichern</button>
        </>}
        {(!readOnly || draft.dirty) && <>
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
    {!readOnly && <div className="tool-rail" role="toolbar" aria-label="Spielstättenwerkzeuge" inert={busyGesture()}>
      <button type="button" className="quiet" aria-pressed={click === 'select'} onClick={() => { setClick('select'); setDrawingZone([]); setTrussDrawStart(undefined); setCurtainDrawStart(undefined); }} title="Auswählen" aria-label="Auswählen"><ToolIcon name="settings" /><span>Auswahl</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'vertex'} onClick={() => setClick('vertex')} title="Eckpunkt auf eine Umrisskante setzen" aria-label="Eckpunkt hinzufügen"><ToolIcon name="plus" /><span>Eckpunkt</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'place' && placeKind === 'wall'} disabled={walls.length >= 250} onClick={() => { setPlaceKind('wall'); setClick('place'); }} title="Feste Wand setzen" aria-label="Feste Wand setzen"><ToolIcon name="wall" /><span>Wand</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'place' && placeKind === 'platform'} disabled={platforms.length >= 250} onClick={() => { setPlaceKind('platform'); setClick('place'); }} title="Podest setzen" aria-label="Podest setzen"><ToolIcon name="platform" /><span>Podest</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'place' && placeKind === 'stair'} disabled={!platforms[0] || stairs.length >= 250} onClick={() => { setPlaceKind('stair'); setClick('place'); }} title="Treppe setzen" aria-label="Treppe setzen"><ToolIcon name="stairs" /><span>Treppe</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'place' && placeKind === 'chair'} disabled={placeholders.length >= 250} onClick={() => { setPlaceKind('chair'); setClick('place'); }} title="Stuhl setzen" aria-label="Stuhl setzen"><ToolIcon name="library" /><span>Stuhl</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'place' && placeKind === 'table'} disabled={placeholders.length >= 250} onClick={() => { setPlaceKind('table'); setClick('place'); }} title="Tisch setzen" aria-label="Tisch setzen"><ToolIcon name="library" /><span>Tisch</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'place' && placeKind === 'person'} disabled={placeholders.length >= 250} onClick={() => { setPlaceKind('person'); setClick('place'); }} title="Person setzen" aria-label="Person setzen"><ToolIcon name="library" /><span>Person</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'place' && placeKind === 'speaker'} disabled={placeholders.length >= 250} onClick={() => { setPlaceKind('speaker'); setClick('place'); }} title="Lautsprecher setzen" aria-label="Lautsprecher setzen"><ToolIcon name="library" /><span>Box</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'place' && placeKind === 'power'} disabled={pins.length >= 250} onClick={() => { setPlaceKind('power'); setPinKind('power'); setClick('place'); }} title="Strom setzen" aria-label="Strom setzen"><ToolIcon name="plus" /><span>Strom</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'place' && placeKind === 'audio'} disabled={pins.length >= 250} onClick={() => { setPlaceKind('audio'); setPinKind('audio'); setClick('place'); }} title="Audio setzen" aria-label="Audio setzen"><ToolIcon name="plus" /><span>Audio</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'corridor'} disabled={corridors.length >= 250} onClick={() => setClick('corridor')} title="Kabelweg zeichnen" aria-label="Kabelweg zeichnen"><ToolIcon name="expand" /><span>Kabel</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'draw-zone'} disabled={zones.length >= 250} onClick={() => { setDrawingZone([]); setClick('draw-zone'); }} title="Freihaltezone zeichnen" aria-label="Freihaltezone zeichnen"><ToolIcon name="expand" /><span>Notausgang</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'place' && placeKind === 'overhead'} disabled={overheadBoxes.length >= 250} onClick={() => { setPlaceKind('overhead'); setClick('place'); }} title="Lüftungskanal setzen" aria-label="Lüftungskanal setzen"><ToolIcon name="expand" /><span>Lüftung</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'draw-truss'} disabled={trusses.length >= 250} onClick={() => { setTrussDrawStart(undefined); setTrussDrawHover(undefined); setCurtainDrawStart(undefined); setClick('draw-truss'); }} title="Traverse zeichnen (Start und Ende)" aria-label="Traverse zeichnen"><ToolIcon name="expand" /><span>Traverse</span></button>
      <button type="button" className="quiet" aria-pressed={click === 'draw-curtain'} disabled={curtains.length >= 250} onClick={() => { setCurtainDrawStart(undefined); setCurtainDrawHover(undefined); setTrussDrawStart(undefined); setClick('draw-curtain'); }} title="Molton zeichnen (Start und Ende)" aria-label="Molton zeichnen"><ToolIcon name="wall" /><span>Molton</span></button>
      <button type="button" className="quiet" aria-pressed={selectedIds.includes(CENTRELINE_SELECTION)} onClick={() => setSelectedIds([CENTRELINE_SELECTION])} title="Mittellinie wählen" aria-label="Mittellinie wählen"><ToolIcon name="settings" /><span>Mitte</span></button>
    </div>}
    <div className="editor-grid" data-inspector-open={inspectorOpen}>
      <div className="editor-views venue-editor-views" data-mode={viewMode} style={viewMode === 'split' ? { gridTemplateColumns: `minmax(0, ${viewShare}fr) minmax(0, ${100 - viewShare}fr)` } : { gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <div className="plan-canvas venue-plan" hidden={viewMode === 'stage'}
          data-underlay-drag={underlayDrag || undefined}
          onDragEnter={underlayDragOver} onDragOver={underlayDragOver} onDragLeave={underlayDragLeave}
          onDrop={event => { event.preventDefault(); setUnderlayDrag(false); void acceptUnderlayTransfer(event.dataTransfer); }}>
          <div className="plan-viewbar"><h3>Spielstättengrundriss <span>2D</span></h3>
            <PlanDisplayToggles value={planDisplay} onChange={setPlanDisplay} includeUnderlay={!!overlay || !!fileId} />
            <div className="plan-zoom">
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
            onLostPointerCapture={() => { if (panDrag.current || objectDrag.current || objectRotate.current || vertexDrag.current !== undefined || zoneVertexDrag.current || corridorVertexDrag.current || centrelineDrag.current || marqueeDrag.current) endPlanGesture(true); }}
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
            {planDisplay.showUnderlay && overlay && <g data-testid="venue-underlay" opacity="0.55"
              transform={`rotate(${rotationDeg} ${overlayW / 2} ${-overlayH / 2})`}>
              <image href={overlay.href} x="0" y={-overlayH} width={overlayW} height={overlayH} />
            </g>}
            {(measureA || measureB) && <g data-testid="underlay-measure-line" pointerEvents="none">
              {measureA && measureB && <line x1={measureA.x} y1={-measureA.y} x2={measureB.x} y2={-measureB.y}
                stroke="#b67c35" strokeWidth="4" strokeDasharray="60 40" vectorEffect="non-scaling-stroke" />}
              {measureA && <circle cx={measureA.x} cy={-measureA.y} r="70" fill="#b67c35" />}
              {measureB && <circle cx={measureB.x} cy={-measureB.y} r="70" fill="#b67c35" />}
            </g>}
            <path data-testid="venue-outline" d={`${vertices.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
              fill="url(#venue-metre-grid)" stroke="#718469" strokeWidth="2" vectorEffect="non-scaling-stroke"
              onPointerDown={startMarquee} />
            {vertices.map((point, index) => <circle key={index} data-testid={`venue-vertex-${index}`} cx={point.x} cy={-point.y} r="65" fill="#b67c35" onPointerDown={event => { if (readOnly || busyGesture() || event.button !== 0) return; gestureSelection.current = selectedIds; event.stopPropagation(); vertexDrag.current = index; draft.begin(); svg.current?.setPointerCapture(event.pointerId); }} />)}
            {platforms.map(platform => {
              const chosen = selectedIds.includes(platform.id);
              const style = platform.style ?? 'floating';
              const fill = style === 'solid'
                ? (chosen ? 'rgba(113,132,105,0.55)' : 'rgba(113,132,105,0.4)')
                : style === 'stageDeck'
                  ? (chosen ? 'rgba(182,124,53,0.35)' : 'rgba(197,208,184,0.55)')
                  : (chosen ? 'rgba(182,124,53,0.35)' : 'rgba(113,132,105,0.25)');
              const centre = platformCentroid(platform.outline);
              const rotation = outlineRotation(platform.outline);
              const bounds = platformBounds(platform.outline);
              const modules = style === 'stageDeck' ? layoutStageDeckModules(bounds.width, bounds.depth) : [];
              return <g key={platform.id}>
                <path data-testid={`venue-platform-${platform.id}`}
                  d={`${platform.outline.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
                  fill={fill} stroke="#718469" strokeWidth="2" vectorEffect="non-scaling-stroke"
                  onPointerDown={event => beginObjectDrag(event, platform.id)} />
                {modules.map((module, index) => <rect key={index} pointerEvents="none"
                  transform={`translate(${centre.x} ${-centre.y}) rotate(${-rotation})`}
                  x={module.x - module.width / 2} y={-(module.y + module.depth / 2)}
                  width={module.width} height={module.depth}
                  fill="none" stroke="#5a6e52" strokeWidth="1.5" strokeDasharray="40 30" vectorEffect="non-scaling-stroke" />)}
              </g>;
            })}
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
              groupedIds={new Set(selectedIds.map(id => `placeholder:${id}`))} display={planDisplay}
              onPointerDown={(event, item) => beginObjectDrag(event, item.id)} />
            <InfrastructureMarks pins={pins} corridors={corridors} selectedIds={selectedIds} display={planDisplay} onPointerDown={beginObjectDrag}
              onVertexPointerDown={(event, corridorId, index) => {
                if (readOnly || busyGesture() || event.button !== 0) return;
                event.stopPropagation(); gestureSelection.current = selectedIds; setSelectedIds([corridorId]);
                corridorVertexDrag.current = { corridorId, index }; draft.begin(); svg.current?.setPointerCapture(event.pointerId);
              }} />
            <OverheadMarks boxes={overheadBoxes} selectedIds={selectedIds} display={planDisplay} onPointerDown={beginObjectDrag} />
            <TrussMarks trusses={trusses} selectedIds={selectedIds} display={planDisplay} onPointerDown={beginObjectDrag}
              drawing={trussDrawStart ? { start: trussDrawStart, end: trussDrawHover } : undefined} />
            <CurtainMarks curtains={curtains} selectedIds={selectedIds} display={planDisplay} onPointerDown={beginObjectDrag}
              drawing={curtainDrawStart ? { start: curtainDrawStart, end: curtainDrawHover } : undefined} />
            <KeepClearMarks zones={zones} selectedIds={selectedIds} drawing={drawingZone} display={planDisplay} onPointerDown={beginObjectDrag}
              onVertexPointerDown={(event, zoneId, index) => {
                if (readOnly || busyGesture() || event.button !== 0) return;
                event.stopPropagation(); gestureSelection.current = selectedIds; setSelectedIds([zoneId]);
                zoneVertexDrag.current = { zoneId, index }; draft.begin(); svg.current?.setPointerCapture(event.pointerId);
              }} />
            <CentrelineMark centreline={centreline} selected={selectedIds.includes(CENTRELINE_SELECTION)} showLabel={planDisplay.showTexts}
              onPointerDown={readOnly ? undefined : event => {
                if (busyGesture() || event.button !== 0) return;
                event.stopPropagation(); gestureSelection.current = selectedIds; setSelectedIds([CENTRELINE_SELECTION]); setClick('select');
                const point = planPoint(event);
                centrelineDrag.current = { x: point.x, y: point.y, start: centreline }; draft.begin();
                svg.current?.setPointerCapture(event.pointerId);
              }} />
            <AlignmentGuides guides={guides} />
            {!readOnly && pivot && (selectedIds.length > 1 || ['zone', 'corridor', 'truss', 'curtain'].includes(selectedObject?.kind ?? '')) &&
              <RotationHandle centre={pivot} rotation={0} width={1200} testId="rotate-venue-selection" label="Auswahl drehen"
                onPointerDown={event => beginObjectRotate(event, selected!, pivot, 0)} />}
            {selectedIds.includes(CENTRELINE_SELECTION) && !readOnly &&
              <RotationHandle centre={centreline} rotation={centreline.rotation} width={1200} testId="rotate-venue-centreline" label="Mittellinie drehen"
                onPointerDown={event => {
                  event.stopPropagation();
                  if (event.button !== 0 || busyGesture()) return;
                  gestureSelection.current = selectedIds;
                  const point = planPoint(event);
                  objectRotate.current = {
                    ids: [CENTRELINE_SELECTION], hinge: centreline, startAngle: planRotationAt(centreline, point),
                    startRotation: centreline.rotation, start: draft.value,
                  };
                  draft.begin(); setGuides([]); svg.current?.setPointerCapture(event.pointerId);
                }} />}
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
            {selectedIds.length === 1 && !readOnly && (() => {
              const box = overheadBoxes.find(item => item.id === selected);
              if (!box) return null;
              return <RotationHandle centre={box} rotation={box.rotation} width={box.length}
                testId={`rotate-venue-overhead-${box.id}`} label="Überbauung drehen"
                onPointerDown={event => beginObjectRotate(event, box.id, box, box.rotation)} />;
            })()}
            {selectedIds.length === 1 && !readOnly && (() => {
              const truss = trusses.find(item => item.id === selected);
              if (!truss) return null;
              return <RotationHandle centre={truss} rotation={truss.rotation} width={truss.length}
                testId={`rotate-venue-truss-${truss.id}`} label="Traverse drehen"
                onPointerDown={event => beginObjectRotate(event, truss.id, truss, truss.rotation)} />;
            })()}
            {selectedIds.length === 1 && !readOnly && (() => {
              const curtain = curtains.find(item => item.id === selected);
              if (!curtain) return null;
              return <RotationHandle centre={curtain} rotation={curtain.rotation} width={curtain.length}
                testId={`rotate-venue-curtain-${curtain.id}`} label="Molton drehen"
                onPointerDown={event => beginObjectRotate(event, curtain.id, curtain, curtain.rotation)} />;
            })()}
            {marqueeBox && <rect data-testid="venue-selection-marquee" className="selection-marquee"
              x={marqueeBox.minX} y={-marqueeBox.maxY} width={marqueeBox.maxX - marqueeBox.minX} height={marqueeBox.maxY - marqueeBox.minY} />}
          </svg>
          {objectOverlapWarnings({ schemaVersion: 1, walls: previewVenue.walls ?? [], braces: [], platforms: previewVenue.platforms, stairs: previewVenue.stairs, placeholders: previewVenue.placeholders }).map(item =>
            <p className="warning" role="status" data-testid="object-overlap" key={`${item.aId}-${item.bId}`}>{item.message}</p>)}
        </div>
        {viewMode !== 'plan' && <StageView onLightingChange={readOnly ? undefined : setLighting} layout={liveLayout} venue={previewVenue} venueEditable workspaceId={workspaceId} selectedIds={selectedIds} pivot={pivot} onSelect={(id, additive) => { if (!busyGesture()) setSelectedIds(ids => additive ? ids.includes(id) ? ids.filter(value => value !== id) : [id, ...ids] : [id]); }} onClearSelection={() => { if (!busyGesture()) setSelectedIds([]); }} onTransform={readOnly ? undefined : transform} onPushPull={readOnly ? undefined : pushPull} snapEnabled={snapEnabled} />}
      </div>
      <aside className="wall-inspector" inert={busyGesture()}>
        <div className="inspector-title"><ToolIcon name="settings" /><h3>Eigenschaften</h3><span>mm</span></div>
        <div className="selection-properties">
          <h3>{selectedWall ? `Feste Wand ${selectedWallIndex + 1}` : selectedIds.includes(CENTRELINE_SELECTION) ? 'Bühnenmittellinie' : selectedObject?.label ?? 'Keine Auswahl'}</h3>
          <label htmlFor="venue-selection">Spielstättenobjekt auswählen</label>
          <select id="venue-selection" value={selected ?? ''} onChange={event => setSelectedIds(event.target.value ? [event.target.value] : [])}>
            <option value="">Objekt auswählen</option>
            {walls.map((wall, index) => <option key={wall.id} value={wall.id}>Feste Wand {index + 1}</option>)}
            {venueObjects(previewVenue).filter(item => !walls.some(wall => wall.id === item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          {selectedWall && selectedWallIndex >= 0 ? <fieldset disabled={readOnly || busy || busyGesture()}>
            <label>Bezeichnung<input value={selectedWall.label} onChange={event => setWalls(items => items.map(item => item.id === selectedWall.id ? { ...item, label: event.target.value } : item))} /></label>
            <div className="numeric-fields">{(['x', 'y', 'rotation', 'width', 'height', 'thickness'] as const).map(key => <label key={key}>{key}<input aria-label={`Feste Wand ${selectedWallIndex + 1} ${key}`} type="number" value={selectedWall[key]} onChange={event => setWalls(items => items.map(item => item.id === selectedWall.id ? { ...item, [key]: Number(event.target.value) } : item))} /></label>)}</div>
            <Suspense fallback={<p>Materialbibliothek wird geladen …</p>}>
              <MaterialPicker id="venue-wall-finish" value={selectedWall.finish} onChange={value => {
                const finish = value || undefined;
                const targets = selectedIds.filter(id => walls.some(wall => wall.id === id));
                const ids = targets.length > 1 ? targets : [selectedWall.id];
                setWalls(items => items.map(item => {
                  if (!ids.includes(item.id)) return item;
                  if (finish) return { ...item, finish };
                  const { finish: _removed, ...rest } = item;
                  return rest;
                }));
              }} />
            </Suspense>
            {selectedIds.filter(id => walls.some(wall => wall.id === id)).length > 1 && <p className="muted">Oberfläche gilt für alle ausgewählten festen Wände.</p>}
            <div className="form-actions">
              <button type="button" className="quiet" onClick={() => { setWalls(items => items.filter(item => item.id !== selectedWall.id)); setSelectedIds([]); }}>Feste Wand entfernen</button>
              <button type="button" className="quiet" onClick={() => remove()}>Löschen</button>
            </div>
          </fieldset> : selectedIds.length ? <fieldset disabled={readOnly || busy || busyGesture()}>
            <p className="muted">{selectedIds.length} Objekt{selectedIds.length === 1 ? '' : 'e'} ausgewählt. Ziehen zum Verschieben · Orange ↻ dreht · Entf löscht.</p>
            {selectedObject?.kind === 'platform' && (() => {
              const platform = platforms.find(item => item.id === selected)!;
              const centre = platformCentroid(platform.outline);
              const a = platform.outline[0], b = platform.outline[1], c = platform.outline[2];
              const width = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : platformBounds(platform.outline).width;
              const depth = b && c ? Math.hypot(c.x - b.x, c.y - b.y) : platformBounds(platform.outline).depth;
              const rotation = outlineRotation(platform.outline);
              function updatePlatform(patch: {
                label?: string; elevation?: number; width?: number; depth?: number; x?: number; y?: number; rotation?: number;
                finish?: string | null; style?: PlatformStyle;
              }) {
                setPlatforms(items => items.map(item => {
                  if (item.id !== platform.id) return item;
                  const style = patch.style ?? item.style ?? 'floating';
                  let nextWidth = patch.width ?? width;
                  let nextDepth = patch.depth ?? depth;
                  let nextElevation = patch.elevation ?? item.elevation;
                  if (style === 'stageDeck') {
                    const snapped = snapStageDeckSize(nextWidth, nextDepth);
                    nextWidth = snapped.width; nextDepth = snapped.depth;
                    nextElevation = snapStageDeckElevation(nextElevation);
                  }
                  const next = {
                    label: patch.label ?? item.label,
                    elevation: nextElevation,
                    width: nextWidth,
                    depth: nextDepth,
                    x: patch.x ?? centre.x,
                    y: patch.y ?? centre.y,
                    rotation: patch.rotation ?? rotation,
                  };
                  const finish = patch.finish === null ? undefined : patch.finish === undefined ? item.finish : patch.finish || undefined;
                  let base: Platform = {
                    ...item, label: next.label, elevation: next.elevation, style,
                    outline: axisAlignedPlatformOutline(next.x, next.y, next.width, next.depth, next.rotation),
                  };
                  if (style === 'stageDeck') base = clipPlatformToStageDeck(base);
                  if (finish) return { ...base, finish };
                  const { finish: _removed, ...rest } = base;
                  return rest;
                }));
              }
              return <>
                <label>Bauweise<select aria-label={`${platform.label} Bauweise`} value={platform.style ?? 'floating'}
                  onChange={event => updatePlatform({ style: event.target.value as PlatformStyle })}>
                  {(Object.keys(PLATFORM_STYLE_LABELS) as PlatformStyle[]).map(key =>
                    <option key={key} value={key}>{PLATFORM_STYLE_LABELS[key]}</option>)}
                </select></label>
                <p className="muted">Bühnenelement: 2×1 / 2×0,5 / 1×1 / 1×0,5&nbsp;m mit Beinen. Massiv bis Boden. Schwebend wie bisher.</p>
                <div className="numeric-fields">
                  <label>Bezeichnung<input value={platform.label} onChange={event => updatePlatform({ label: event.target.value })} /></label>
                  {([
                    ['elevation', 'Höhe über Fußboden', platform.elevation],
                    ['width', 'Breite', width], ['depth', 'Tiefe', depth],
                    ['x', 'X', centre.x], ['y', 'Y', centre.y], ['rotation', 'Drehung', rotation],
                  ] as const).map(([key, label, value]) =>
                    <label key={key}>{label}<input aria-label={`${platform.label} ${label}`} type="number" value={value}
                      onChange={event => updatePlatform({ [key]: Number(event.target.value) })} /></label>)}
                </div>
                <Suspense fallback={<p>Materialbibliothek wird geladen …</p>}>
                  <MaterialPicker id="venue-platform-finish" value={platform.finish} onChange={value => updatePlatform({ finish: value || null })} />
                </Suspense>
              </>;
            })()}
            {selectedObject?.kind === 'stair' && (() => {
              const stair = stairs.find(item => item.id === selected)!;
              return <div className="numeric-fields">
                <label>Bezeichnung<input value={stair.label} onChange={event => setStairs(items => items.map(item => item.id === stair.id ? { ...item, label: event.target.value } : item))} /></label>
                {([['width', 'Breite'], ['run', 'Lauflänge'], ['riserHeight', 'Steigung'], ['x', 'X'], ['y', 'Y'], ['rotation', 'Drehung']] as const).map(([key, label]) =>
                  <label key={key}>{label}<input aria-label={`${stair.label} ${label}`} type="number" value={stair[key]}
                    onChange={event => setStairs(items => items.map(item => item.id === stair.id ? { ...item, [key]: Number(event.target.value) } : item))} /></label>)}
              </div>;
            })()}
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
                  {([['x', 'X'], ['y', 'Y'], ['rotation', 'Drehung'], ['bottomHeight', 'Unterkante'], ['thickness', 'Dicke'], ['length', 'Länge'], ['width', 'Breite']] as const).map(([key, label]) =>
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
                {([['x', 'X'], ['y', 'Y'], ['rotation', 'Drehung'], ['width', 'Breite'], ['depth', 'Tiefe'], ['height', 'Höhe']] as const).map(([key, label]) =>
                  <label key={key}>{label}<input aria-label={`${item.label} ${label}`} type="number" value={item[key]}
                    onChange={event => setPlaceholders(items => items.map(entry => entry.id === item.id ? { ...entry, [key]: Number(event.target.value) } : entry))} /></label>)}
                {item.kind === 'chair' && <label><input type="checkbox" checked={!!item.seatedFigure}
                  onChange={event => setPlaceholders(items => items.map(entry => entry.id === item.id ? { ...entry, seatedFigure: event.target.checked || undefined } : entry))} /> Sitzfigur</label>}
              </div>;
            })()}
            {selectedObject?.kind === 'truss' && (() => {
              const truss = trusses.find(item => item.id === selected)!;
              return <div className="numeric-fields">
                <label>Bezeichnung<input value={truss.label} onChange={event => setTrusses(items => items.map(item => item.id === truss.id ? { ...item, label: event.target.value } : item))} /></label>
                {([['x', 'X'], ['y', 'Y'], ['rotation', 'Drehung'], ['length', 'Länge'], ['sectionWidth', 'Querschnitt'], ['bottomHeight', 'Unterkante'], ['thickness', 'Höhe']] as const).map(([key, label]) =>
                  <label key={key}>{label}<input aria-label={`${truss.label} ${label}`} type="number" value={truss[key]}
                    onChange={event => setTrusses(items => items.map(item => item.id === truss.id ? { ...item, [key]: Number(event.target.value) } : item))} /></label>)}
                <p className="muted">Aufhängepunkte sind vorbereitet für spätere Leuchtenplanung.</p>
              </div>;
            })()}
            {selectedObject?.kind === 'curtain' && (() => {
              const curtain = curtains.find(item => item.id === selected)!;
              return <div className="numeric-fields">
                <label>Bezeichnung<input value={curtain.label} onChange={event => setCurtains(items => items.map(item => item.id === curtain.id ? { ...item, label: event.target.value } : item))} /></label>
                {([['x', 'X'], ['y', 'Y'], ['rotation', 'Drehung'], ['length', 'Länge'], ['height', 'Fallhöhe'], ['bottomClearance', 'Bodenfreiheit']] as const).map(([key, label]) =>
                  <label key={key}>{label}<input aria-label={`${curtain.label} ${label}`} type="number" value={curtain[key]}
                    onChange={event => setCurtains(items => items.map(item => item.id === curtain.id ? { ...item, [key]: Number(event.target.value) } : item))} /></label>)}
                <label>Öffnung %
                  <input aria-label={`${curtain.label} Öffnung`} type="number" min={0} max={100} value={curtain.openPercent}
                    onChange={event => setCurtains(items => items.map(item => item.id === curtain.id ? { ...item, openPercent: Number(event.target.value) } : item))} />
                </label>
                <label>Öffnungsart
                  <select aria-label={`${curtain.label} Öffnungsart`} value={curtain.opening}
                    onChange={event => setCurtains(items => items.map(item => item.id === curtain.id ? { ...item, opening: event.target.value as Curtain['opening'] } : item))}>
                    <option value="traveler">Traveler (Mitte)</option>
                    <option value="stackLeft">Stapel links</option>
                    <option value="stackRight">Stapel rechts</option>
                  </select>
                </label>
              </div>;
            })()}
            {selectedIds.includes(CENTRELINE_SELECTION) && <CentrelineFields centreline={centreline} onChange={setCentreline} />}
            <div className="form-actions"><button type="button" className="quiet" onClick={() => remove()}>Auswahl löschen</button></div>
          </fieldset> : <p className="muted">Objekt im Grundriss wählen oder links Wand, Podest, Stuhl, Strom, Notausgang oder Lüftung hinzufügen.</p>}
        </div>
        <details className="inspector-section" open><summary>Zwischenablage</summary><div className="inspector-section-body">
          <ClipboardPanel selection={selectedIds.map(id => ({ kind: 'wall', id }))} canPaste={!!clipboard} busy={busy} readOnly={readOnly}
            onCopy={copy} onCut={cut} onPaste={paste} />
        </div></details>
        <details className="inspector-section"><summary>Umriss</summary><div className="inspector-section-body">
          <fieldset disabled={readOnly || busy || busyGesture()}>
            {vertices.map((point, index) => <div className="numeric-fields" key={index}>
              <div><label htmlFor={`vertex-x-${index}`}>Eckpunkt {index + 1} X (mm)</label>
                <input id={`vertex-x-${index}`} type="number" step="any" value={point.x} onChange={event => setVertices(current => current.map((item, i) => i === index ? { ...item, x: Number(event.target.value) } : item))} /></div>
              <div><label htmlFor={`vertex-y-${index}`}>Eckpunkt {index + 1} Y (mm)</label>
                <input id={`vertex-y-${index}`} type="number" step="any" value={point.y} onChange={event => setVertices(current => current.map((item, i) => i === index ? { ...item, y: Number(event.target.value) } : item))} /></div>
            </div>)}
            <div className="form-actions">
              <button type="button" className="quiet" aria-pressed={click === 'vertex'} onClick={() => setClick('vertex')}>Eckpunkt auf Kante setzen</button>
              <button type="button" className="quiet" disabled={vertices.length <= 3} onClick={() => setVertices(current => current.slice(0, -1))}>Letzten Eckpunkt entfernen</button>
            </div>
          </fieldset>
        </div></details>
        <details className="inspector-section" open={!!fileId || underlayDialogOpen}><summary>Vorlage & Maßstab</summary><div className="inspector-section-body">
          <fieldset disabled={readOnly || busy || busyGesture()}>
            <div className={`underlay-dropzone${underlayDrag ? ' underlay-dropzone--active' : ''}`}
              data-testid="underlay-dropzone"
              onDragEnter={underlayDragOver} onDragOver={underlayDragOver} onDragLeave={underlayDragLeave}
              onDrop={event => { event.preventDefault(); setUnderlayDrag(false); void acceptUnderlayTransfer(event.dataTransfer); }}>
              <p className="muted">Screenshot (z.&nbsp;B. Spectacle → In Zwischenablage) hierher ziehen oder Strg+V. WebP/GIF werden als PNG übernommen.</p>
              <div className="form-actions">
                <button type="button" className="quiet" disabled={readOnly || busy} onClick={() => void pasteUnderlayFromSystemClipboard()}>
                  Aus Zwischenablage
                </button>
              </div>
              <label htmlFor="venue-file">Oder Datei wählen</label>
              <input id="venue-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                onChange={event => void chooseFile(event.currentTarget.files?.[0])} />
            </div>
            <div className="form-actions">
              <button type="button" disabled={!fileId} onClick={() => setUnderlayDialogOpen(true)}>Vorlage einrichten …</button>
            </div>
            {fileId && <p className="muted">
              {rotationDeg ? `Drehung ${Math.round(rotationDeg)}° · ` : ''}
              {parsed.success ? `Maßstab ${millimetresPerUnit(parsed.data).toFixed(3)} mm/Einheit` : 'Maßstab noch nicht gesetzt'}
            </p>}
            {fileId && <div className="numeric-fields">
              {([['pointA', 'Punkt A'], ['pointB', 'Punkt B']] as const).flatMap(([key, label]) => (
                [['x', `${label} X`], ['y', `${label} Y`]] as const).map(([axis, name]) => <div key={name}>
                  <label htmlFor={`cal-${key}-${axis}`}>{name}</label>
                  <input id={`cal-${key}-${axis}`} type="number" step="any" value={calibration[key][axis]}
                    onChange={event => setCalibration(current => ({ ...current, [key]: { ...current[key], [axis]: Number(event.target.value) } }))} />
                </div>))}
              <div><label htmlFor="cal-distance">Bekannte Strecke (mm)</label>
                <input id="cal-distance" type="number" min={1} step="any" value={calibration.distanceMm}
                  onChange={event => setCalibration(current => ({ ...current, distanceMm: Number(event.target.value) }))} /></div>
            </div>}
            {parsed.success && <p className="muted">Maßstab: {millimetresPerUnit(parsed.data)} mm je Vorlagen-Einheit</p>}
          </fieldset>
        </div></details>
        <details className="inspector-section"><summary>Anschlüsse & Kabelwege</summary><div className="inspector-section-body">
          <fieldset disabled={readOnly || busy || busyGesture()}>
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
          <fieldset disabled={readOnly || busy || busyGesture()}><CentrelineFields centreline={centreline} onChange={setCentreline} /></fieldset>
        </div></details>
      </aside>
    </div>
    <VenueUnderlayDialog
      open={underlayDialogOpen} overlay={overlay} page={page} pageCount={meta?.pageCount ?? null}
      rotationDeg={rotationDeg} calibration={calibration} busy={busy}
      onClose={() => setUnderlayDialogOpen(false)}
      onRotation={setRotationDeg} onPage={setPage} onCalibration={setCalibration}
      onConfirm={() => { setUnderlayDialogOpen(false); setZoom(1); setPan({ x: 0, y: 0 }); }}
    />
    {error && <p className="error" role="alert">{error}</p>}
    <div className="workspace-statusbar">
      <span><span className="status-dot" />Spielstättenentwurf · {walls.length} feste Wände</span>
      <span className="status-hint">Ziehen zum Verschieben · Orange ↻ dreht · Entf löscht · {SNAP_NOTICE}</span>
      <button type="button" className="quiet" aria-expanded={helpOpen} onClick={() => setHelpOpen(open => !open)}><ToolIcon name="help" /> Bedienung</button>
      <span>Maße in mm</span>
    </div>
    {helpOpen && <div className="workspace-help"><h3>Spielstätte gestalten</h3>
      <p className="muted">Werkzeuge links setzen Objekte per Klick. Freihaltezonen und Traversen werden gezeichnet (Eckpunkte bzw. Start/Ende). Zoneneckpunkte ziehen. Einrasten wie im Bühnenbild (Alt umgeht).</p>
      <p>Entf entfernt die Auswahl. Traversen modellieren Hängehöhen für spätere Lichtplanung. Speichern schreibt eine neue Spielstättenfassung.</p>
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

export function InfrastructureMarks({ pins, corridors, selectedIds = [], display = defaultPlanDisplay, onPointerDown, onVertexPointerDown }: {
  pins: ConnectionPoint[]; corridors: CableRoutingCorridor[]; selectedIds?: readonly string[];
  display?: PlanDisplayOptions;
  onPointerDown?: (event: PointerEvent, id: string) => void;
  onVertexPointerDown?: (event: PointerEvent<SVGCircleElement>, corridorId: string, index: number) => void;
}) {
  return <g>
    {corridors.map(corridor => <g key={corridor.id} data-testid={`cable-corridor-${corridor.id}`} className={onPointerDown ? 'draggable-wall' : undefined}
      onPointerDown={onPointerDown ? event => onPointerDown(event, corridor.id) : undefined}>
      <path d={corridor.path.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')}
        fill="none" stroke={selectedIds.includes(corridor.id) ? '#b67c35' : '#5a6e8a'} strokeWidth="3" strokeDasharray="80 50" vectorEffect="non-scaling-stroke" />
      {corridor.path.map((point, index) => <circle key={index} data-testid={`cable-corridor-vertex-${corridor.id}-${index}`}
        cx={point.x} cy={-point.y} r="55" fill="#5a6e8a"
        pointerEvents={onVertexPointerDown ? undefined : 'none'}
        onPointerDown={onVertexPointerDown ? event => onVertexPointerDown(event, corridor.id, index) : undefined} />)}
      {display.showObjectNames && <text x={corridor.path[0]?.x} y={-(corridor.path[0]?.y ?? 0) - 80} fontSize="140" pointerEvents="none">{corridor.label}</text>}
    </g>)}
    {pins.map(pin => <g key={pin.id} data-testid={`connection-point-${pin.id}`} data-kind={pin.kind} className={onPointerDown ? 'draggable-wall' : undefined}
      onPointerDown={onPointerDown ? event => onPointerDown(event, pin.id) : undefined}>
      <circle cx={pin.x} cy={-pin.y} r="90" fill="transparent" />
      <circle cx={pin.x} cy={-pin.y} r="55" fill={selectedIds.includes(pin.id) ? '#b67c35' : '#d9c6a1'} stroke="#986122" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {display.showObjectNames && <text x={pin.x} y={-pin.y - 80} textAnchor="middle" fontSize="140" pointerEvents="none">{pin.label}</text>}
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
