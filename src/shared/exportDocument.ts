import { ballastLabel, sceneMaterials } from './ballast.js';
import { z } from 'zod';
import { CONNECTION_COMPATIBILITY_NOTICE } from './assembly.js';
import { dimensionFigure, resolveDimension } from './dimensions.js';
import { elevationFaces, type ElevationFace } from './elevations.js';
import { openingOutlinePoints } from './wall-types.js';
import {
  DRAWING_SCALE, drawingScaleSchema, paperSizeSchema, type ConstructionSnapshot,
} from './export.js';
import { exportLayersSchema, resolveExportLayers, type ExportLayers } from './exportLayers.js';
import type { ConstructionPackage } from './package.js';

type PackageStock = ConstructionPackage['stock'];
import {
  PAGE_OVERLAP_MM, PAPER_SIZE_MM, type DrawingScale, type PaperSize,
} from './tiling.js';
import { measuredOutline, type AudienceViewpoint } from './venue.js';
import { planFeatures } from './planFeatures.js';
import { layoutStageDeckModules, stageDeckLegPositions } from './stageDeck.js';
import { orientedPlatformBox, stairSteps } from './levels.js';
import { trussHangWorld } from './truss.js';
import { centrelineSpan } from './snapping.js';
import { doorOpenAngleDegrees } from './wall-types.js';
import { CABLE_PURPOSE_LABELS, requiredCableLengthMm, type CableRun } from './infrastructure.js';

const name = z.string().trim().min(1).max(120);
const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
const point3 = z.strictObject({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });

export const sheetOrientationSchema = z.enum(['portrait', 'landscape']);
export type SheetOrientation = z.infer<typeof sheetOrientationSchema>;
export const frameKindSchema = z.enum(['plan', 'elevation', 'view3d', 'notes', 'schedule']);
export type FrameKind = z.infer<typeof frameKindSchema>;
export const cameraPresetSchema = z.enum(['orbit', 'audience', 'top', 'front', 'side']);
export type CameraPreset = z.infer<typeof cameraPresetSchema>;
export const documentPurposeSchema = z.enum(['rehearsal', 'performers', 'technical']);
export type DocumentPurpose = z.infer<typeof documentPurposeSchema>;
export const documentSectionSchema = z.enum([
  'cover', 'overviewPlan', 'roomViews', 'notes',
  'dimensionedPlan', 'elevations', 'wallSchedule', 'materialSchedule', 'warnings',
  'cablePlan', 'cableSchedule',
]);
export type DocumentSection = z.infer<typeof documentSectionSchema>;

export const DOCUMENT_PURPOSES: Record<DocumentPurpose, {
  label: string; description: string; sections: DocumentSection[];
}> = {
  rehearsal: {
    label: 'Regie / Probe',
    description: 'Übersichtliche Pläne und Raumsichten für Absprachen und Proben.',
    sections: ['cover', 'overviewPlan', 'roomViews', 'notes'],
  },
  performers: {
    label: 'Darstellende',
    description: 'Ein reduziertes Orientierungsblatt ohne technische Aufbauinformationen.',
    sections: ['cover', 'overviewPlan', 'roomViews'],
  },
  technical: {
    label: 'Aufbau / Technik',
    description: 'Bemaßte Aufbaupläne, Listen, Warnungen und Kabelplanung.',
    sections: ['cover', 'dimensionedPlan', 'elevations', 'wallSchedule', 'materialSchedule', 'warnings', 'cablePlan', 'cableSchedule'],
  },
};

export const DOCUMENT_SECTION_LABELS: Record<DocumentSection, string> = {
  cover: 'Deckblatt',
  overviewPlan: 'Orientierungsplan',
  roomViews: 'Raumsichten',
  notes: 'Kurze Hinweise',
  dimensionedPlan: 'Bemaßter Grundriss',
  elevations: 'Frontansichten',
  wallSchedule: 'Wand- und Plattenliste',
  materialSchedule: 'Materialliste',
  warnings: 'Aufbauhinweise und offene Punkte',
  cablePlan: 'Kabelplan',
  cableSchedule: 'Kabelliste',
};

export function sectionsForPurpose(purpose: DocumentPurpose): DocumentSection[] {
  return [...DOCUMENT_PURPOSES[purpose].sections];
}

export function layersForPurpose(purpose: DocumentPurpose): ExportLayers {
  if (purpose === 'technical') return resolveExportLayers();
  if (purpose === 'performers') return resolveExportLayers({
    audience: true, softGoods: true, constraints: false, infrastructure: false, cables: false,
    dimensions: false, warnings: false,
  });
  return resolveExportLayers({
    audience: true, constraints: false, infrastructure: false, cables: false,
    dimensions: false, warnings: false,
  });
}

export const savedCameraSchema = z.strictObject({
  projection: z.enum(['perspective', 'orthographic']),
  position: point3,
  target: point3,
  preset: cameraPresetSchema.optional(),
});
export type SavedCamera = z.infer<typeof savedCameraSchema>;

export const frameCropSchema = z.strictObject({
  minX: z.number().finite(), minY: z.number().finite(), maxX: z.number().finite(), maxY: z.number().finite(),
});
export type FrameCrop = z.infer<typeof frameCropSchema>;

/** Generic selectors. Concrete scene and group ids are filled when a document is prepared. */
export const frameSourceSchema = z.strictObject({
  role: z.enum(['primary', 'each']).default('primary'),
  sceneId: z.uuid().optional(),
  groupIndex: z.number().int().min(0).max(40).optional(),
  groupId: z.uuid().optional(),
  facingDegrees: z.number().finite().optional(),
});
export type FrameSource = z.infer<typeof frameSourceSchema>;

export const documentFrameSchema = z.strictObject({
  id: z.uuid(),
  kind: frameKindSchema,
  x: z.number().finite().min(0).max(2000),
  y: z.number().finite().min(0).max(2000),
  width: z.number().finite().min(10).max(2000),
  height: z.number().finite().min(10).max(2000),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  scale: drawingScaleSchema.optional(),
  crop: frameCropSchema.optional(),
  source: frameSourceSchema.default({ role: 'primary' }),
  camera: savedCameraSchema.optional(),
  label: z.string().trim().max(80).optional(),
  text: z.string().max(4000).optional(),
  layers: exportLayersSchema.partial().optional(),
});
export type DocumentFrame = z.infer<typeof documentFrameSchema>;

export const documentPageSchema = z.strictObject({
  id: z.uuid(),
  name: name,
  paper: paperSizeSchema,
  orientation: sheetOrientationSchema,
  frames: z.array(documentFrameSchema).max(40),
  /** Keep a generated cover/list/tiled sheet live when arranging an automatic report. */
  automaticKey: z.string().min(1).max(500).optional(),
});
export type DocumentPage = z.infer<typeof documentPageSchema>;

export const exportDocumentSpecSchema = z.strictObject({
  schemaVersion: z.literal(1),
  preset: z.enum(['construction', 'presentation']).default('construction'),
  purpose: documentPurposeSchema.optional(),
  sections: z.array(documentSectionSchema).max(20).optional(),
  introduction: z.string().trim().max(2000).optional(),
  contact: z.string().trim().max(500).optional(),
  revisionName: name,
  paper: paperSizeSchema.default('A4'),
  orientation: z.enum(['portrait', 'landscape', 'auto']).default('auto'),
  scale: drawingScaleSchema.default(DRAWING_SCALE),
  layers: z.record(z.string(), z.boolean()).optional(),
  kind: z.enum(['scene', 'package']).default('scene'),
  scenes: z.array(z.strictObject({
    sceneId: z.uuid(),
    elevationGroupIds: z.array(z.uuid()).max(250).default([]),
  })).min(1).max(250),
  templateId: z.uuid().optional(),
  /** Model millimetres shown in the ground plan. Omitted means the whole drawing. */
  planCrop: frameCropSchema.optional(),
  planScope: z.enum(['scenery', 'venue']).optional(),
  /** One sheet per saved camera. Empty keeps the automatic construction set without 3D pages. */
  viewCameras: z.array(z.strictObject({
    id: z.uuid(),
    label: z.string().trim().min(1).max(80),
    camera: savedCameraSchema,
  })).max(12).optional(),
  /** Set only after the user edits the layout. Automatic documents ignore this. */
  customPages: z.array(documentPageSchema).max(80).optional(),
});
export type ExportDocumentSpec = z.infer<typeof exportDocumentSpecSchema>;

export const documentDraftSchema = z.strictObject({
  spec: exportDocumentSpecSchema,
  viewImages: z.record(z.string().min(1).max(160), z.string().min(8).max(12_000_000)).optional(),
});
export type DocumentDraft = z.infer<typeof documentDraftSchema>;

export function documentReadiness(spec: Pick<ExportDocumentSpec, 'purpose' | 'sections'>, scenes: readonly {
  layout: { cableRuns?: readonly unknown[] };
}[]): { code: string; message: string; action?: 'cables' | 'views' }[] {
  const sections = new Set(spec.sections ?? (spec.purpose ? sectionsForPurpose(spec.purpose) : []));
  const issues: { code: string; message: string; action?: 'cables' | 'views' }[] = [];
  if ((sections.has('cablePlan') || sections.has('cableSchedule')) && !scenes.some(scene => scene.layout.cableRuns?.length)) {
    issues.push({ code: 'no-cable-runs', message: 'Noch keine tatsächlichen Kabelwege geplant.', action: 'cables' });
  }
  return issues;
}

export function cableScheduleRows(runs: readonly CableRun[]): string[][] {
  const groups = new Map<string, { purpose: CableRun['purpose']; cableType: string; length: number; quantity: number; endpoints: Set<string>; slack: number }>();
  for (const run of runs) {
    const length = requiredCableLengthMm(run);
    const key = `${run.purpose}\u0000${run.cableType}\u0000${length}`;
    const group = groups.get(key) ?? {
      purpose: run.purpose, cableType: run.cableType, length, quantity: 0, endpoints: new Set<string>(), slack: run.slackMm,
    };
    group.quantity += run.quantity;
    group.slack = Math.max(group.slack, run.slackMm);
    group.endpoints.add(`${run.start.label} → ${run.end.label}`);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => [
    `${CABLE_PURPOSE_LABELS[group.purpose]} · ${group.cableType}`,
    [...group.endpoints].join(', '),
    String(group.quantity),
    `${(group.length / 1000).toFixed(1)} m (${(group.slack / 1000).toFixed(1)} m Zugabe)`,
  ]);
}

/** Base64 PNG (optionally data-URL) keyed by compose frame id (`view-${sceneId}-${viewId}`). */
export const viewImagesSchema = z.record(
  z.string().min(1).max(160),
  // ~12 MiB chars ≈ 9 MiB binary after base64; POST bodyLimit is 24 MiB.
  z.string().min(8).max(12_000_000),
).refine(value => Object.keys(value).length <= 12, 'Too many Raumsicht images');

/** POST /documents body: document spec plus optional client-captured Raumsicht frames. */
export const prepareDocumentBodySchema = exportDocumentSpecSchema.extend({
  viewImages: viewImagesSchema.optional(),
});
export type PrepareDocumentBody = z.infer<typeof prepareDocumentBodySchema>;

export function viewFrameId(sceneId: string, viewId?: string) {
  return viewId ? `view-${sceneId}-${viewId}` : `view-${sceneId}`;
}

/** Decode client PNG payloads for PDFKit. Strips a data-URL prefix when present. */
export function decodeViewImages(images?: Record<string, string>): Map<string, Buffer> {
  const map = new Map<string, Buffer>();
  if (!images) return map;
  for (const [frameId, payload] of Object.entries(images)) {
    const base64 = payload.includes(',') ? payload.slice(payload.indexOf(',') + 1) : payload;
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) map.set(frameId, buffer);
  }
  return map;
}

export const SHEET_MARGIN_MM = 12;
export const TITLE_BAND_MM = 20;
export const FOOTER_BAND_MM = 12;
export const PREVIEW_TTL_MS = 30 * 60 * 1000;

export type Box = { minX: number; minY: number; maxX: number; maxY: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type Paint =
  | { op: 'poly'; points: { x: number; y: number }[]; fill?: string; stroke?: string; line?: number; dash?: [number, number] }
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; line?: number; dash?: [number, number] }
  | { op: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; line?: number; dash?: [number, number] }
  | { op: 'arc'; cx: number; cy: number; r: number; startAngleDeg: number; endAngleDeg: number; stroke: string; line?: number; dash?: [number, number] }
  | { op: 'text'; x: number; y: number; text: string; size: number; color: string; bold?: boolean; width?: number; height: number }
  | { op: 'link'; x: number; y: number; width: number; height: number; sheet: number }
  | { op: 'image'; frameId: string; x: number; y: number; width: number; height: number };

export type DrawnFrame = {
  id: string; kind: FrameKind; clip: Rect; scale: number | null; scaleLabel: string;
  sourceLabel: string; paint: Paint[]; window?: Box; detail: boolean;
};
export type DrawnSheet = {
  index: number; code: string; title: string; sceneName?: string;
  paper: PaperSize; orientation: SheetOrientation; widthMm: number; heightMm: number;
  scale: number | null; scaleLabel: string; destination: string; bookmark: string;
  paint: Paint[]; frames: DrawnFrame[]; diagnostics: string[];
  neighbors: { right?: number; below?: number };
  sourceKey?: string;
  pageId?: string;
};
export type DocumentLayout = {
  schemaVersion: 1;
  pageCount: number;
  sheets: DrawnSheet[];
  diagnostics: string[];
  issuedAt: string;
  revisionName: string;
};

export type FrozenScene = {
  sceneId: string; sceneName: string; venueName: string; snapshot: ConstructionSnapshot;
};
export type TextMeasure = (text: string, fontSizePt: number, bold?: boolean) => number;

/** Continuations of one generated drawing/list stay together when source content grows. */
export function automaticSheetFamily(sheet: DrawnSheet): string {
  const frame = sheet.frames[0];
  const key = sheet.sourceKey ?? frame?.id ?? '';
  if (frame?.id.startsWith('plan-') || frame?.id.startsWith('elev-')) return key.replace(/-\d+-\d+$/, '');
  if (frame && (frame.kind === 'schedule' || frame.kind === 'notes') && frame.id !== 'index') return key.replace(/-\d+$/, '');
  return key;
}

export function sheetSizeMm(paper: PaperSize, orientation: SheetOrientation) {
  const size = PAPER_SIZE_MM[paper];
  return orientation === 'landscape' ? { width: size.height, height: size.width } : { ...size };
}

export function bodyRect(paper: PaperSize, orientation: SheetOrientation): Rect {
  const size = sheetSizeMm(paper, orientation);
  return {
    x: SHEET_MARGIN_MM,
    y: SHEET_MARGIN_MM + TITLE_BAND_MM,
    width: size.width - 2 * SHEET_MARGIN_MM,
    height: size.height - 2 * SHEET_MARGIN_MM - TITLE_BAND_MM - FOOTER_BAND_MM,
  };
}

export function approximateMeasure(text: string, fontSizePt: number): number {
  return text.length * fontSizePt * 0.5 * 25.4 / 72;
}

function boxOf(points: readonly { x: number; y: number }[]): Box | undefined {
  if (!points.length) return undefined;
  return {
    minX: Math.min(...points.map(point => point.x)),
    minY: Math.min(...points.map(point => point.y)),
    maxX: Math.max(...points.map(point => point.x)),
    maxY: Math.max(...points.map(point => point.y)),
  };
}

function union(boxes: Box[]): Box | undefined {
  return boxOf(boxes.flatMap(box => [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY }]));
}

function expand(box: Box, pad: number): Box {
  return { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
}

export function contentBounds(snapshot: ConstructionSnapshot, partial: Partial<ExportLayers>, scope: 'scenery' | 'venue' = 'scenery'): Box {
  const layers = resolveExportLayers(partial);
  const points: { x: number; y: number }[] = [];
  if (scope === 'venue') points.push(...measuredOutline(snapshot.venue));
  if (layers.scenery) {
    for (const wall of snapshot.resolvedWalls) points.push(...wall.corners);
    for (const brace of snapshot.resolvedBraces ?? []) points.push(...brace.corners);
    for (const item of snapshot.resolvedPlaceholders ?? []) {
      if (item.kind === 'chair' && !layers.audience) continue;
      points.push(...item.corners);
    }
  }
  if (layers.audience) {
    for (const item of snapshot.resolvedPlaceholders ?? []) {
      if (item.kind !== 'chair') continue;
      points.push(...item.corners);
    }
  }
  for (const feature of planFeatures(snapshot, layers)) points.push(...feature.points);
  if (layers.dimensions) for (const item of snapshot.layout.dimensions ?? []) {
    const dimension = resolveDimension(item, snapshot.venue, snapshot.layout);
    if (!dimension) continue;
    const figure = dimensionFigure(dimension);
    for (const segment of [...figure.extensions, figure.line, ...figure.ticks]) points.push({ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 });
    points.push(figure.label);
  }
  const box = boxOf(points);
  if (box && box.maxX > box.minX && box.maxY > box.minY) return box;
  return { minX: 0, minY: 0, maxX: Math.max(snapshot.venue.width, 1), maxY: Math.max(snapshot.venue.depth, 1) };
}

function orderedCrop(crop: Box): Box {
  return {
    minX: Math.min(crop.minX, crop.maxX), maxX: Math.max(crop.minX, crop.maxX),
    minY: Math.min(crop.minY, crop.maxY), maxY: Math.max(crop.minY, crop.maxY),
  };
}

/** Whole drawing on one locator sheet, never larger than the construction scale. */
function fittedWindow(bounds: Box, frame: Rect, constructionScale: number) {
  const contentW = Math.max(bounds.maxX - bounds.minX, 1);
  const contentH = Math.max(bounds.maxY - bounds.minY, 1);
  const needed = Math.max(contentW / frame.width, contentH / frame.height);
  const scale = Math.max(constructionScale, Math.ceil(needed));
  const viewW = frame.width * scale;
  const viewH = frame.height * scale;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    window: { minX: cx - viewW / 2, maxX: cx + viewW / 2, minY: cy - viewH / 2, maxY: cy + viewH / 2 },
  };
}

function tileCount(drawnMm: number, availableMm: number) {
  if (drawnMm <= availableMm + 0.01) return 1;
  const step = availableMm - PAGE_OVERLAP_MM;
  return Math.max(1, Math.ceil((drawnMm - PAGE_OVERLAP_MM) / step));
}

type WindowTile = { window: Box; column: number; row: number; columns: number; rows: number; centered: boolean };

function tilesFor(bounds: Box, frame: Rect, scale: DrawingScale): WindowTile[] {
  const contentW = (bounds.maxX - bounds.minX) / scale;
  const contentH = (bounds.maxY - bounds.minY) / scale;
  const columns = tileCount(contentW, frame.width);
  const rows = tileCount(contentH, frame.height);
  const viewW = frame.width * scale;
  const viewH = frame.height * scale;
  if (columns === 1 && rows === 1) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    return [{
      column: 0, row: 0, columns, rows, centered: true,
      window: { minX: cx - viewW / 2, maxX: cx + viewW / 2, minY: cy - viewH / 2, maxY: cy + viewH / 2 },
    }];
  }
  const stepX = (frame.width - PAGE_OVERLAP_MM) * scale;
  const stepY = (frame.height - PAGE_OVERLAP_MM) * scale;
  const tiles: WindowTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const maxY = bounds.maxY - row * stepY;
      const minX = bounds.minX + column * stepX;
      tiles.push({
        column, row, columns, rows, centered: false,
        window: { minX, maxX: minX + viewW, minY: maxY - viewH, maxY },
      });
    }
  }
  return tiles;
}

function orientationSheetCount(snapshot: ConstructionSnapshot, paper: PaperSize, scale: DrawingScale, layers: ExportLayers, faces: ElevationFace[], planBounds?: Box) {
  return (orientation: SheetOrientation) => {
    const body = bodyRect(paper, orientation);
    const plan = tilesFor(planBounds ?? contentBounds(snapshot, layers), body, scale).length;
    const elevation = faces.reduce((sum, face) => sum + tilesFor(
      { minX: 0, minY: 0, maxX: face.width, maxY: face.height }, body, scale,
    ).length, 0);
    return plan + elevation;
  };
}

export function chooseOrientation(
  snapshot: ConstructionSnapshot, paper: PaperSize, scale: DrawingScale, layers: ExportLayers, faces: ElevationFace[], planBounds?: Box,
): SheetOrientation {
  const count = orientationSheetCount(snapshot, paper, scale, layers, faces, planBounds);
  const portrait = count('portrait');
  const landscape = count('landscape');
  return landscape < portrait ? 'landscape' : 'portrait';
}

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function inside(a: Rect, b: Rect) {
  return a.x >= b.x - 0.01 && a.y >= b.y - 0.01 && a.x + a.width <= b.x + b.width + 0.01 && a.y + a.height <= b.y + b.height + 0.01;
}

type Label = { text: string; x: number; y: number; width: number; height: number; size: number; color: string; bold?: boolean };

function placeLabel(text: string, anchor: { x: number; y: number }, size: number, color: string, clip: Rect, occupied: Rect[], measure: TextMeasure, bold = false): Label | undefined {
  const width = Math.max(4, measure(text, size, bold) + 1.2);
  const height = size * 25.4 / 72 + 1.2;
  const shifts = [0, 4, -4, 8, -8, 12, 16, -12];
  for (const dx of shifts) {
    for (const dy of shifts) {
      const rect = { x: anchor.x + dx, y: anchor.y + dy, width, height };
      if (!inside(rect, clip)) continue;
      if (occupied.some(box => overlaps(box, rect))) continue;
      occupied.push(rect);
      return { text, ...rect, size, color, bold };
    }
  }
  return undefined;
}

function toPage(modelX: number, modelY: number, frame: Rect, view: Box) {
  const scaleX = frame.width / (view.maxX - view.minX);
  const scaleY = frame.height / (view.maxY - view.minY);
  return {
    x: frame.x + (modelX - view.minX) * scaleX,
    y: frame.y + (view.maxY - modelY) * scaleY,
  };
}

function poly(points: { x: number; y: number }[], frame: Rect, view: Box, fill?: string, stroke?: string, line = 0.6): Paint {
  return { op: 'poly', points: points.map(point => toPage(point.x, point.y, frame, view)), fill, stroke, line };
}

function texts(labels: Label[]): Paint[] {
  return labels.map(label => ({
    op: 'text' as const, x: label.x, y: label.y, text: label.text, size: label.size,
    color: label.color, bold: label.bold, width: label.width, height: label.height,
  }));
}

function scaleLabel(scale: number | null, perspective = false) {
  if (perspective) return 'ohne Maßstab';
  if (scale == null) return 'Maßstab gemischt';
  return `1:${scale}`;
}

type Keyed = { key: string; label: string; detail: string };

function planPaint(
  snapshot: ConstructionSnapshot, layers: ExportLayers, frame: Rect, view: Box, measure: TextMeasure, _keys: Map<string, string>,
): { paint: Paint[]; overflow: string[] } {
  const paint: Paint[] = [];
  const overflow: string[] = [];

  // 1. Metric Floor Grid (500 mm minor, 1000 mm major)
  if (layers.venueContext) {
    const subStep = 500;
    const startX = Math.floor(view.minX / subStep) * subStep;
    const endX = Math.ceil(view.maxX / subStep) * subStep;
    const startY = Math.floor(view.minY / subStep) * subStep;
    const endY = Math.ceil(view.maxY / subStep) * subStep;
    for (let x = startX; x <= endX; x += subStep) {
      if (x < 0 || x > snapshot.venue.width) continue;
      const major = x % 1000 === 0;
      const p1 = toPage(x, Math.max(0, view.minY), frame, view);
      const p2 = toPage(x, Math.min(snapshot.venue.depth, view.maxY), frame, view);
      paint.push({ op: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: major ? '#d0d8cb' : '#e8ede3', line: major ? 0.25 : 0.15 });
    }
    for (let y = startY; y <= endY; y += subStep) {
      if (y < 0 || y > snapshot.venue.depth) continue;
      const major = y % 1000 === 0;
      const p1 = toPage(Math.max(0, view.minX), y, frame, view);
      const p2 = toPage(Math.min(snapshot.venue.width, view.maxX), y, frame, view);
      paint.push({ op: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: major ? '#d0d8cb' : '#e8ede3', line: major ? 0.25 : 0.15 });
    }
  }

  // 2. Measured Venue Outline
  if (layers.venueContext) {
    const outline = measuredOutline(snapshot.venue);
    paint.push(poly(outline, frame, view, undefined, '#718469', 0.8));
  }

  // 3. Plan Features: Platforms, Stairs, Curtains, Trusses, Keep Clear, Corridors, Pins
  for (const feature of planFeatures(snapshot, layers)) {
    if (feature.closed) paint.push(poly(feature.points, frame, view, feature.fill, feature.stroke, 0.5));
    else for (let i = 1; i < feature.points.length; i++) {
      const a = toPage(feature.points[i - 1]!.x, feature.points[i - 1]!.y, frame, view);
      const b = toPage(feature.points[i]!.x, feature.points[i]!.y, frame, view);
      paint.push({ op: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: feature.stroke, line: 0.5 });
    }
    if (feature.label && feature.points.length) {
      const centre = feature.points.reduce((sum, point) => ({ x: sum.x + point.x / feature.points.length, y: sum.y + point.y / feature.points.length }), { x: 0, y: 0 });
      const at = toPage(centre.x, centre.y, frame, view);
      const width = measure(feature.label, 7);
      paint.push({ op: 'text', x: at.x - width / 2, y: at.y - 2, text: feature.label, size: 7, color: feature.stroke, height: 4, width });
    }
  }

  // 4. Bühnenelemente & Platform Deck Modules + Steckfüße
  for (const source of [layers.venueContext ? snapshot.venue : undefined]) {
    if (!source) continue;
    for (const platform of source.platforms ?? []) {
      const box = orientedPlatformBox(platform.outline);
      if (box.width >= 500 && box.depth >= 500 && Math.abs(box.rotation % 90) < 0.1) {
        const modules = layoutStageDeckModules(box.width, box.depth, platform.deckGrain);
        const angleRad = box.rotation * Math.PI / 180;
        const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
        for (const mod of modules) {
          const halfW = mod.width / 2, halfD = mod.depth / 2;
          const localCorners = [
            { x: mod.x - halfW, y: mod.y - halfD },
            { x: mod.x + halfW, y: mod.y - halfD },
            { x: mod.x + halfW, y: mod.y + halfD },
            { x: mod.x - halfW, y: mod.y + halfD },
          ];
          const worldCorners = localCorners.map(lc => ({
            x: box.x + lc.x * cosA - lc.y * sinA,
            y: box.y + lc.x * sinA + lc.y * cosA,
          }));
          paint.push(poly(worldCorners, frame, view, undefined, '#485c42', 0.25));
        }
        const legs = stageDeckLegPositions(box.width, box.depth, platform.deckGrain);
        for (const leg of legs) {
          const wx = box.x + leg.x * cosA - leg.y * sinA;
          const wy = box.y + leg.x * sinA + leg.y * cosA;
          const lp = toPage(wx, wy, frame, view);
          paint.push({ op: 'circle', cx: lp.x, cy: lp.y, r: 0.6, fill: '#334430' });
        }
        if (layers.labels && platform.elevation > 0) {
          const elev = `+${Math.round(platform.elevation)} mm`;
          const at = toPage(box.x, box.y, frame, view);
          const lw = measure(elev, 6, true);
          paint.push({ op: 'text', x: at.x - lw / 2, y: at.y + 2, text: elev, size: 6, color: '#334430', bold: true, height: 3, width: lw });
        }
      }
    }
    for (const stair of source.stairs ?? []) {
      const steps = stairSteps(stair, []);
      const angleRad = (stair.rotation ?? 0) * Math.PI / 180;
      const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
      for (let i = 1; i < steps.length; i++) {
        const stepY = -stair.run / 2 + i * (stair.run / steps.length);
        const wL = { x: stair.x + (-stair.width / 2) * cosA - stepY * sinA, y: stair.y + (-stair.width / 2) * sinA + stepY * cosA };
        const wR = { x: stair.x + (stair.width / 2) * cosA - stepY * sinA, y: stair.y + (stair.width / 2) * sinA + stepY * cosA };
        const pL = toPage(wL.x, wL.y, frame, view);
        const pR = toPage(wR.x, wR.y, frame, view);
        paint.push({ op: 'line', x1: pL.x, y1: pL.y, x2: pR.x, y2: pR.y, stroke: '#5a6e52', line: 0.3 });
      }
    }
  }

  // 5. Scenery Walls with Doors, Swings & Assembly Badges
  if (layers.scenery) {
    for (const wall of snapshot.resolvedWalls) {
      paint.push(poly([...wall.corners], frame, view, '#315d49', '#243f34', 0.5));
      for (const opening of wall.openings ?? []) {
        paint.push(poly([...opening.corners], frame, view, '#ffffff', '#315d49', 0.4));
        const [oa, ob] = opening.corners;
        if (!oa || !ob) continue;
        const openingWidth = Math.hypot(ob.x - oa.x, ob.y - oa.y);
        if (openingWidth < 1) continue;
        if (opening.height > 1800 || openingWidth >= 600) {
          const ux = (ob.x - oa.x) / openingWidth;
          const uy = (ob.y - oa.y) / openingWidth;
          const nx = uy, ny = -ux;
          const norm = ny < 0 ? { x: nx, y: ny } : { x: -nx, y: -ny };
          const hinge = oa;
          const openRad = doorOpenAngleDegrees(100) * Math.PI / 180;
          if (openRad > 0.01) {
            const leafEnd = {
              x: hinge.x + openingWidth * (Math.cos(openRad) * ux + Math.sin(openRad) * norm.x),
              y: hinge.y + openingWidth * (Math.cos(openRad) * uy + Math.sin(openRad) * norm.y),
            };
            const hP = toPage(hinge.x, hinge.y, frame, view);
            const lP = toPage(leafEnd.x, leafEnd.y, frame, view);
            paint.push({ op: 'line', x1: hP.x, y1: hP.y, x2: lP.x, y2: lP.y, stroke: '#243f34', line: 0.6 });
            paint.push({ op: 'circle', cx: hP.x, cy: hP.y, r: 0.7, fill: '#986122' });
            const arcPts: { x: number; y: number }[] = [];
            for (let step = 0; step <= 8; step++) {
              const t = (step / 8) * openRad;
              arcPts.push({
                x: hinge.x + openingWidth * (Math.cos(t) * ux + Math.sin(t) * norm.x),
                y: hinge.y + openingWidth * (Math.cos(t) * uy + Math.sin(t) * norm.y),
              });
            }
            paint.push({ op: 'poly', points: arcPts.map(p => toPage(p.x, p.y, frame, view)), stroke: '#718469', line: 0.25, dash: [1, 1] });
          }
        }
      }
      const box = boxOf(wall.corners);
      if (box && layers.labels) identityMarks(wallIdentityLines(wall.assemblyNumber, wall.panelLabel), (box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, frame, view, measure, paint);
    }
    for (const brace of snapshot.resolvedBraces ?? []) {
      for (const slab of brace.slabs ?? []) paint.push(poly([...slab], frame, view, '#999b96', '#666666', 0.4));
      paint.push(poly([...(brace.timberCorners ?? brace.corners)], frame, view, undefined, '#5c6b52', 0.5));
      if (brace.slabs?.length && layers.labels) {
        const slabCount = brace.slabs.length;
        const label = `${slabCount}× Platte (${slabCount * 25} kg)`;
        const cx = (brace.corners[0]!.x + brace.corners[2]!.x) / 2;
        const cy = (brace.corners[0]!.y + brace.corners[2]!.y) / 2;
        const at = toPage(cx, cy, frame, view);
        const lw = measure(label, 6);
        paint.push({ op: 'text', x: at.x - lw / 2, y: at.y - 1.5, text: label, size: 6, color: '#444444', bold: true, height: 3, width: lw });
      }
    }
    for (const item of snapshot.resolvedPlaceholders ?? []) {
      if (item.kind === 'chair') continue;
      paint.push(poly([...item.corners], frame, view, undefined, '#8b8478', 0.4));
    }
  }

  // 6. Lighting Fixtures on Hang Points (Hängeplan)
  if (layers.softGoods && snapshot.venue.hangPlan?.fixtures?.length) {
    for (const fixture of snapshot.venue.hangPlan.fixtures) {
      const truss = (snapshot.venue.trusses ?? []).find(t => t.id === fixture.trussId);
      const hang = truss?.hangPoints.find(p => p.id === fixture.hangPointId);
      if (!truss || !hang) continue;
      const pos = trussHangWorld(truss, hang);
      const at = toPage(pos.x, pos.y, frame, view);
      paint.push({ op: 'circle', cx: at.x, cy: at.y, r: 1.8, fill: '#f0f5fa', stroke: '#1e3a5f', line: 0.4 });
      const labelChar = fixture.typeId === 'fresnel' ? 'F' : fixture.typeId === 'flood' ? 'FL' : 'W';
      paint.push({ op: 'text', x: at.x - 1.2, y: at.y - 1.2, text: labelChar, size: 5, color: '#1e3a5f', bold: true, height: 2.5, width: 3 });
      if (fixture.label) {
        const flw = measure(fixture.label, 6);
        paint.push({ op: 'text', x: at.x - flw / 2, y: at.y + 2.2, text: fixture.label, size: 6, color: '#1e3a5f', height: 3, width: flw });
      }
      const panDeg = fixture.focus?.pan ?? 0;
      const angleRad = ((truss.rotation ?? 0) + 90 - panDeg) * Math.PI / 180;
      const arrowLen = 300;
      const arrowEnd = toPage(pos.x + arrowLen * Math.cos(angleRad), pos.y + arrowLen * Math.sin(angleRad), frame, view);
      paint.push({ op: 'line', x1: at.x, y1: at.y, x2: arrowEnd.x, y2: arrowEnd.y, stroke: '#d97706', line: 0.35 });
    }
  }

  // 7. Audience Chairs
  if (layers.audience) {
    for (const item of snapshot.resolvedPlaceholders ?? []) {
      if (item.kind !== 'chair') continue;
      paint.push(poly([...item.corners], frame, view, undefined, '#8b8478', 0.4));
    }
  }

  // 8. Stage Centreline & Orientation Indicator
  if (layers.orientation) {
    if (snapshot.venue.stageCentreline) {
      const span = centrelineSpan(snapshot.venue.stageCentreline, Math.hypot(snapshot.venue.width, snapshot.venue.depth));
      const p1 = toPage(span.a.x, span.a.y, frame, view);
      const p2 = toPage(span.b.x, span.b.y, frame, view);
      paint.push({ op: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: '#986122', line: 0.35, dash: [3, 2] });
    }
    const audienceCenter = toPage(snapshot.venue.width / 2, 200, frame, view);
    paint.push({ op: 'text', x: audienceCenter.x - 35, y: audienceCenter.y + 4, text: '↑ Blick zur Bühne (Zuschauerraum)', size: 7, color: '#536950', bold: true, height: 3, width: 70 });
  }

  // 9. Dimensions
  if (layers.dimensions) for (const item of snapshot.layout.dimensions ?? []) {
    const dimension = resolveDimension(item, snapshot.venue, snapshot.layout);
    if (!dimension) continue;
    const figure = dimensionFigure(dimension);
    for (const segment of [...figure.extensions, figure.line, ...figure.ticks]) {
      const from = toPage(segment.x1, segment.y1, frame, view);
      const to = toPage(segment.x2, segment.y2, frame, view);
      paint.push({ op: 'line', x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: '#173c36', line: segment === figure.line ? 0.35 : 0.25 });
    }
    const caption = `${Math.round(figure.valueMm)} mm`;
    const label = toPage(figure.label.x, figure.label.y, frame, view);
    const width = measure(caption, 11, true);
    paint.push({ op: 'text', x: label.x - width / 2, y: label.y - 4, text: caption, size: 11, color: '#173c36', bold: true, height: 4, width });
  }
  return { paint, overflow };
}

function identityMarks(lines: string[], modelX: number, modelY: number, frame: Rect, view: Box, measure: TextMeasure, paint: Paint[]) {
  if (!lines.length) return;
  const centre = toPage(modelX, modelY, frame, view);
  lines.forEach((text, index) => {
    const size = index === 0 ? 14 : 9;
    const width = Math.max(8, measure(text, size, true));
    if (index === 0) {
      paint.push({ op: 'circle', cx: centre.x, cy: centre.y - 1, r: Math.max(3.5, width / 2 + 1), fill: '#ffffff', stroke: '#173c36', line: 0.5 });
      paint.push({
        op: 'text', x: centre.x - width / 2, y: centre.y - 3,
        text, size, color: '#173c36', bold: true, height: 5, width,
      });
    } else {
      paint.push({
        op: 'text', x: centre.x - width / 2, y: centre.y + 4 + (index - 1) * 4.5,
        text, size, color: '#6a4e16', bold: true, height: 4, width,
      });
    }
  });
}

function wallIdentityLines(assemblyNumber?: number, panelLabel?: string) {
  const lines: string[] = [];
  if (assemblyNumber != null) lines.push(String(assemblyNumber));
  if (panelLabel?.trim()) lines.push(panelLabel.trim());
  return lines;
}

function tileMap(frame: Rect, tile: WindowTile): Paint[] {
  if (tile.columns * tile.rows < 2) return [];
  const cell = 3.2;
  const originX = frame.x + frame.width - tile.columns * cell - 1;
  const originY = frame.y + 1;
  const paint: Paint[] = [];
  for (let row = 0; row < tile.rows; row++) {
    for (let column = 0; column < tile.columns; column++) {
      const current = row === tile.row && column === tile.column;
      paint.push({
        op: 'poly',
        points: [
          { x: originX + column * cell, y: originY + row * cell },
          { x: originX + (column + 1) * cell, y: originY + row * cell },
          { x: originX + (column + 1) * cell, y: originY + (row + 1) * cell },
          { x: originX + column * cell, y: originY + (row + 1) * cell },
        ],
        fill: current ? '#315d49' : '#ffffff',
        stroke: '#203c36',
        line: 0.3,
      });
    }
  }
  return paint;
}

function overlapMarks(frame: Rect, tile: WindowTile): Paint[] {
  const paint: Paint[] = [];
  if (tile.column < tile.columns - 1) {
    const x = frame.x + frame.width - PAGE_OVERLAP_MM;
    paint.push({ op: 'line', x1: x, y1: frame.y, x2: x, y2: frame.y + frame.height, stroke: '#718469', line: 0.35, dash: [2, 2] });
  }
  if (tile.row < tile.rows - 1) {
    const y = frame.y + frame.height - PAGE_OVERLAP_MM;
    paint.push({ op: 'line', x1: frame.x, y1: y, x2: frame.x + frame.width, y2: y, stroke: '#718469', line: 0.35, dash: [2, 2] });
  }
  return paint;
}

function elevationPaint(face: ElevationFace, frame: Rect, view: Box, measure: TextMeasure): { paint: Paint[]; overflow: string[] } {
  const paint: Paint[] = [];
  const occupied: Rect[] = [];
  const overflow: string[] = [];
  for (const panel of face.panels) {
    const corners = [
      { x: panel.left, y: 0 }, { x: panel.left + panel.width, y: 0 },
      { x: panel.left + panel.width, y: panel.height }, { x: panel.left, y: panel.height },
    ];
    paint.push(poly(corners, frame, view, '#e7efe4', '#315d49', 0.5));
    for (const opening of panel.openings) {
      paint.push(poly(
        openingOutlinePoints(opening).map(point => ({ x: panel.left + point.x, y: point.y })),
        frame, view, '#ffffff', '#315d49', 0.4,
      ));
    }
    const anchor = toPage(panel.left + panel.width, panel.height, frame, view);
    const placed = placeLabel(String(Math.round(panel.width)), { x: anchor.x + 1, y: anchor.y }, 7, '#395640', frame, occupied, measure);
    if (placed) paint.push(...texts([placed]));
    else overflow.push(panel.label);
    identityMarks(wallIdentityLines(panel.assemblyNumber, panel.panelLabel), panel.left + panel.width / 2, panel.height / 2, frame, view, measure, paint);
  }
  return { paint, overflow };
}

function wrapLines(text: string, widthMm: number, size: number, measure: TextMeasure) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (measure(next, size) <= widthMm) { current = next; continue; }
    if (current) lines.push(current);
    current = '';
    // A label or identifier can be longer than the whole column with no spaces.
    for (const character of word) {
      if (current && measure(current + character, size) > widthMm) {
        lines.push(current);
        current = '';
      }
      current += character;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function chrome(
  sheet: { title: string; sceneName?: string; productionName: string; venueName: string; revisionName: string; issuedAt: string; code: string; pageCount: number; scaleLabel: string; paper: PaperSize },
  size: { width: number; height: number },
  measure: TextMeasure,
): Paint[] {
  const paint: Paint[] = [];
  const left = SHEET_MARGIN_MM;
  const width = size.width - left * 2;
  const fitted = (text: string, sizePt: number, max: number, bold = false) => {
    if (measure(text, sizePt, bold) <= max) return text;
    let result = text;
    while (result.length && measure(`${result}…`, sizePt, bold) > max) result = result.slice(0, -1);
    return `${result}…`;
  };
  paint.push({ op: 'text', x: left, y: 7, text: fitted(sheet.productionName.toLocaleUpperCase('de-DE'), 7, width, true), size: 7, color: '#788676', bold: true, height: 3, width });
  paint.push({ op: 'text', x: left, y: 12, text: fitted(sheet.title, 16, width, true), size: 16, color: '#273d34', bold: true, height: 7, width });
  const subtitle = [sheet.sceneName, sheet.venueName].filter(Boolean).join(' · ');
  paint.push({ op: 'text', x: left, y: 20, text: fitted(subtitle, 8, width), size: 8, color: '#687762', height: 4, width });
  const suffix = ` · ${sheet.issuedAt} · ${sheet.paper}`;
  const revisionWidth = width - 38 - measure(`Fassung ${suffix}`, 6.5);
  const meta = `Fassung ${fitted(sheet.revisionName, 6.5, revisionWidth)}${suffix}`;
  paint.push({ op: 'text', x: left, y: 25, text: meta, size: 6.5, color: '#85907c', height: 3, width: width - 35 });
  paint.push({ op: 'text', x: size.width - left - 30, y: 25, text: `Blatt ${sheet.code}`, size: 6.5, color: '#617558', height: 3, width: 30 });
  paint.push({ op: 'line', x1: left, y1: 30, x2: size.width - left, y2: 30, stroke: '#cad3c2', line: 0.25 });
  const bar = 1000 / (sheet.scaleLabel.startsWith('1:') ? Number(sheet.scaleLabel.slice(2)) : 50);
  const showBar = sheet.scaleLabel.startsWith('1:');
  const footY = size.height - FOOTER_BAND_MM + 2;
  paint.push({ op: 'line', x1: left, y1: footY - 3, x2: size.width - left, y2: footY - 3, stroke: '#cad3c2', line: 0.25 });
  const scaleLine = sheet.scaleLabel.startsWith('1:') ? `Maßstab ${sheet.scaleLabel}` : sheet.scaleLabel;
  paint.push({ op: 'text', x: left, y: footY, text: `${scaleLine} · 100 % drucken, nicht an Seite anpassen`, size: 7, color: '#203c36', height: 3.5, width: 140 });
  if (showBar) {
    const x = size.width - SHEET_MARGIN_MM - bar;
    paint.push({ op: 'line', x1: x, y1: footY + 1.5, x2: x + bar, y2: footY + 1.5, stroke: '#203c36', line: 0.6 });
    paint.push({ op: 'text', x, y: footY + 2.2, text: '1000 mm', size: 6, color: '#536950', height: 3, width: bar });
  }
  return paint;
}

function pushSheet(sheets: DrawnSheet[], partial: Omit<DrawnSheet, 'index' | 'code' | 'destination' | 'bookmark'> & { bookmarkTitle: string }) {
  const index = sheets.length + 1;
  const code = String(index);
  sheets.push({
    ...partial,
    index, code, destination: `blatt-${index}`, bookmark: `${code} ${partial.bookmarkTitle}`,
  });
  return sheets[sheets.length - 1]!;
}

function keysFor(snapshot: ConstructionSnapshot): { map: Map<string, string>; rows: Keyed[] } {
  const map = new Map<string, string>();
  const rows: Keyed[] = [];
  let n = 1;
  for (const object of snapshot.resolvedObjects) {
    const key = String(n++);
    map.set(object.id, key);
    rows.push({
      key, label: object.stockItemLabel ?? object.label,
      detail: `${Math.round(object.width)} × ${Math.round(object.height)} mm${object.assemblyNumber ? ` · Position ${object.assemblyNumber}` : ''}`,
    });
  }
  const materials = sceneMaterials(snapshot.layout);
  if (materials.slabs) rows.push({ key: '—', label: 'Gehwegplatten', detail: `${materials.slabs} Stück · 400 × 400 × 50 mm` });
  if (materials.straps) rows.push({ key: '—', label: 'Spanngurte', detail: `${materials.straps} Stück` });
  return { map, rows };
}

function tableSheets(
  title: string, headers: string[], rows: string[][], body: Rect, paper: PaperSize, orientation: SheetOrientation,
  measure: TextMeasure, sceneName: string | undefined, meta: Parameters<typeof chrome>[0],
  sheets: DrawnSheet[],
) {
  const size = sheetSizeMm(paper, orientation);
  const lineH = 4.2;
  const cols = headers.length;
  const weights = title === 'Stückliste' && cols === 3 ? [0.1, 0.4, 0.5] : Array.from({ length: cols }, () => 1 / cols);
  const widths = weights.map(weight => body.width * weight);
  const columnX = (column: number) => body.x + widths.slice(0, column).reduce((sum, width) => sum + width, 0);
  const wrappedRows = rows.map(row => row.map((cell, column) => wrapLines(cell, widths[column]! - 4, 8, measure)));
  const wrappedHeaders = headers.map((header, column) => wrapLines(header, widths[column]! - 4, 8, (text, size) => measure(text, size, true)));
  const headerHeight = Math.max(...wrappedHeaders.map(lines => lines.length)) * lineH;
  let rowIndex = 0;
  let lineOffset = 0;
  let part = 1;
  while (rowIndex < rows.length || part === 1) {
    const paint: Paint[] = [];
    let y = body.y;
    paint.push({ op: 'poly', points: [{ x: body.x, y: y - 2 }, { x: body.x + body.width, y: y - 2 }, { x: body.x + body.width, y: y + headerHeight + 1 }, { x: body.x, y: y + headerHeight + 1 }], fill: '#edf1e7' });
    wrappedHeaders.forEach((lines, column) => {
      lines.forEach((text, line) => paint.push({ op: 'text', x: columnX(column), y: y + line * lineH,
        text, size: 8, color: '#203c36', bold: true, height: lineH, width: widths[column]! - 4 }));
    });
    y += headerHeight + 1;
    paint.push({ op: 'line', x1: body.x, y1: y, x2: body.x + body.width, y2: y, stroke: '#c5cbbd', line: 0.4 });
    y += 1.5;
    const pageCapacity = Math.floor((body.y + body.height - y) / lineH);
    while (rowIndex < rows.length) {
      const cells = wrappedRows[rowIndex]!;
      const rowLines = Math.max(1, ...cells.map(lines => lines.length));
      const available = Math.floor((body.y + body.height - y + 1e-8) / lineH);
      if (available <= 0) break;
      // Keep ordinary rows together. Only rows taller than a page are split.
      if (lineOffset === 0 && rowLines > available && rowLines <= pageCapacity) break;
      const count = Math.min(rowLines - lineOffset, available);
      cells.forEach((lines, column) => {
        lines.slice(lineOffset, lineOffset + count).forEach((text, line) => paint.push({ op: 'text',
          x: columnX(column), y: y + line * lineH, text, size: 8, color: '#203c36', height: lineH, width: widths[column]! - 4 }));
      });
      y += count * lineH;
      paint.push({ op: 'line', x1: body.x, y1: y - 0.3, x2: body.x + body.width, y2: y - 0.3, stroke: '#e2e7dc', line: 0.2 });
      lineOffset += count;
      if (lineOffset === rowLines) { rowIndex += 1; lineOffset = 0; }
    }
    const continued = rowIndex < rows.length;
    pushSheet(sheets, {
      title: part > 1 ? `${title} (Fortsetzung)` : title,
      sceneName, paper, orientation, widthMm: size.width, heightMm: size.height,
      scale: null, scaleLabel: '—',
      paint: chrome({ ...meta, title: part > 1 ? `${title} (Fortsetzung)` : title, sceneName }, size, measure),
      frames: [{
        id: `${title}-${part}`, kind: 'schedule', clip: body, scale: null, scaleLabel: '—',
        sourceLabel: sceneName ?? title, paint, detail: false,
      }],
      diagnostics: [], neighbors: {}, bookmarkTitle: title,
    });
    part += 1;
    if (!continued) break;
  }
}

function notesSheets(notes: string[], body: Rect, paper: PaperSize, orientation: SheetOrientation, measure: TextMeasure, meta: Parameters<typeof chrome>[0], sheets: DrawnSheet[]) {
  const size = sheetSizeMm(paper, orientation);
  const sizePt = 8;
  const lineH = sizePt * 25.4 / 72 + 1.4;
  const lines = notes.flatMap(note => wrapLines(note, body.width, sizePt, measure));
  let index = 0;
  let part = 1;
  if (!lines.length) return;
  while (index < lines.length) {
    const paint: Paint[] = [];
    let y = body.y;
    const heading = part > 1 ? 'Hinweise (Fortsetzung)' : 'Hinweise';
    paint.push({ op: 'text', x: body.x, y, text: heading, size: 9, color: '#203c36', bold: true, height: 4, width: body.width });
    y += 6;
    while (index < lines.length && y + lineH <= body.y + body.height) {
      paint.push({ op: 'text', x: body.x, y, text: lines[index]!, size: sizePt, color: '#6a4e16', height: lineH, width: body.width });
      y += lineH;
      index += 1;
    }
    pushSheet(sheets, {
      title: heading, sceneName: meta.sceneName, paper, orientation,
      widthMm: size.width, heightMm: size.height, scale: null, scaleLabel: '—',
      paint: chrome({ ...meta, title: heading }, size, measure),
      frames: [{ id: `notes-${part}`, kind: 'notes', clip: body, scale: null, scaleLabel: '—', sourceLabel: 'Hinweise', paint, detail: false }],
      diagnostics: [], neighbors: {}, bookmarkTitle: heading,
    });
    part += 1;
  }
}

function collectNotes(snapshot: ConstructionSnapshot, layers: ExportLayers) {
  if (!layers.warnings) return [];
  const notes = [...(snapshot.warnings ?? []).map(warning => warning.message), ...(snapshot.unresolvedWarnings ?? []).map(warning => warning.message)];
  if (snapshot.layout.riggingNotes?.trim()) notes.unshift(snapshot.layout.riggingNotes.trim());
  notes.push(CONNECTION_COMPATIBILITY_NOTICE);
  return notes;
}

export function composeDocument(input: {
  spec: ExportDocumentSpec;
  scenes: FrozenScene[];
  productionName: string;
  issuedAtLabel: string;
  stock?: PackageStock;
  measure?: TextMeasure;
}): DocumentLayout {
  const measure = input.measure ?? approximateMeasure;
  const spec = input.spec;
  const sheets: DrawnSheet[] = [];
  const diagnostics: string[] = [];
  const layers = resolveExportLayers(spec.layers as Partial<ExportLayers> | undefined);
  const sections = spec.sections ? new Set(spec.sections) : undefined;
  const ordered = spec.scenes.map(entry => {
    const scene = input.scenes.find(item => item.sceneId === entry.sceneId);
    if (!scene) throw new Error('Bühnenbild für den Export fehlt.');
    return { entry, scene };
  });

  if (spec.customPages?.length) {
    const automatic = spec.customPages.some(page => page.automaticKey)
      ? composeDocument({ ...input, spec: { ...spec, customPages: undefined } }) : undefined;
    composeCustom(spec, ordered, input, layers, measure, sheets, diagnostics, automatic);
  } else {
    if (sections?.has('cover') || (!sections && (spec.kind === 'package' || ordered.length > 1 || input.stock))) {
      composeIndex(spec, ordered, input, measure, sheets);
    }
    for (const { entry, scene } of ordered) {
      const start = sheets.length;
      composeScene(spec, entry.elevationGroupIds, scene, input, layers, measure, sheets, diagnostics);
      for (const sheet of sheets.slice(start)) sheet.sourceKey = `${scene.sceneId}:${sheet.frames[0]?.id}`;
    }
    if (spec.kind === 'package' && input.stock && (!sections || sections.has('materialSchedule'))) composeStock(input.stock, spec, input, measure, sheets);
    const cameras = spec.viewCameras ?? [];
    if ((!sections || sections.has('roomViews')) && cameras.length) {
      for (const { scene } of ordered) {
        for (const view of cameras) composeView(scene, spec, input, measure, sheets, view);
      }
    } else if ((!sections || sections.has('roomViews')) && spec.preset === 'presentation') {
      for (const { scene } of ordered) composeView(scene, spec, input, measure, sheets);
    }
  }

  for (const sheet of sheets) sheet.sourceKey ??= `${sheet.sceneName ?? 'document'}:${sheet.frames[0]?.id}`;
  const pageCount = sheets.length;
  for (const sheet of sheets) {
    for (const item of sheet.paint) {
      if (item.op === 'text' && item.text.startsWith('Blatt ')) item.text = `Blatt ${sheet.code} von ${pageCount}`;
    }
  }
  linkNeighbors(sheets, measure);
  return { schemaVersion: 1, pageCount, sheets, diagnostics, issuedAt: input.issuedAtLabel, revisionName: spec.revisionName };
}

function metaFor(input: { productionName: string; issuedAtLabel: string; spec: ExportDocumentSpec }, scene: FrozenScene | undefined, title: string, scaleLabelText: string) {
  return {
    title, sceneName: scene?.sceneName, productionName: input.productionName,
    venueName: scene?.venueName ?? '', revisionName: input.spec.revisionName,
    issuedAt: input.issuedAtLabel, code: '', pageCount: 0, scaleLabel: scaleLabelText,
    paper: input.spec.paper,
  };
}

function composeScene(
  spec: ExportDocumentSpec, elevationGroupIds: string[], scene: FrozenScene,
  input: { productionName: string; issuedAtLabel: string; spec: ExportDocumentSpec },
  layers: ExportLayers, measure: TextMeasure, sheets: DrawnSheet[], diagnostics: string[],
) {
  const snapshot = { ...scene.snapshot, elevationGroupIds };
  const paper = spec.paper;
  const scale = spec.scale;
  const faces = elevationFaces(snapshot);
  const planCrop = spec.planCrop ? orderedCrop(spec.planCrop) : undefined;
  const fullBounds = contentBounds(snapshot, layers, spec.planScope);
  const orientation = spec.orientation === 'auto' ? chooseOrientation(snapshot, paper, scale, layers, faces, planCrop ?? fullBounds) : spec.orientation;
  const body = bodyRect(paper, orientation);
  const size = sheetSizeMm(paper, orientation);
  const bounds = planCrop ?? fullBounds;
  const cropped = Boolean(planCrop);
  const { map, rows } = keysFor(snapshot);
  const sections = spec.sections ? new Set(spec.sections) : undefined;
  const includeDimensionedPlan = !sections || sections.has('dimensionedPlan');
  const includeOverview = !!sections?.has('overviewPlan');
  const includeCablePlan = !!sections?.has('cablePlan');
  const planTiles = tilesFor(bounds, body, scale);
  const planIds: number[] = [];
  for (const tile of includeDimensionedPlan ? planTiles : []) {
    const drawn = planPaint(snapshot, layers, body, tile.window, measure, map);
    if (drawn.overflow.length) diagnostics.push(`Beschriftung auf Folgeblatt: ${drawn.overflow.join(', ')}`);
    const sheet = pushSheet(sheets, {
      title: 'Grundriss', sceneName: scene.sceneName, paper, orientation,
      widthMm: size.width, heightMm: size.height, scale, scaleLabel: scaleLabel(scale),
      paint: [
        ...chrome(metaFor(input, scene, 'Grundriss', scaleLabel(scale)), size, measure),
        ...tileMap(body, tile),
      ],
      frames: [{
        id: `plan-${scene.sceneId}-${tile.row}-${tile.column}`, kind: 'plan', clip: body, scale,
        scaleLabel: scaleLabel(scale), sourceLabel: scene.sceneName, window: tile.window, detail: cropped,
        paint: [...drawn.paint, ...overlapMarks(body, tile)],
      }],
      diagnostics: drawn.overflow.length ? ['Einige Positionsnummern stehen auf der Stückliste.'] : [],
      neighbors: {}, bookmarkTitle: `Grundriss ${scene.sceneName}`,
    });
    planIds.push(sheet.index);
      sheet.neighbors = {
      right: tile.column < tile.columns - 1 ? sheet.index + 1 : undefined,
      below: tile.row < tile.rows - 1 ? sheet.index + tile.columns : undefined,
    };
  }
  if (planCrop || includeOverview) {
    const overview = fittedWindow(fullBounds, body, scale);
    pushSheet(sheets, {
      title: 'Übersicht', sceneName: scene.sceneName, paper, orientation,
      widthMm: size.width, heightMm: size.height, scale: overview.scale, scaleLabel: scaleLabel(overview.scale),
      paint: chrome(metaFor(input, scene, 'Übersicht', scaleLabel(overview.scale)), size, measure),
      frames: [{
        id: `overview-${scene.sceneId}`, kind: 'plan', clip: body, scale: overview.scale, scaleLabel: scaleLabel(overview.scale),
        sourceLabel: 'Übersicht', window: overview.window, detail: false,
        paint: [
          ...planPaint(snapshot, layers, body, overview.window, measure, map).paint,
          ...(planCrop ? [poly([
            { x: planCrop.minX, y: planCrop.minY }, { x: planCrop.maxX, y: planCrop.minY },
            { x: planCrop.maxX, y: planCrop.maxY }, { x: planCrop.minX, y: planCrop.maxY },
          ], body, overview.window, undefined, '#986122', 0.7)] : []),
        ],
      }],
      diagnostics: [], neighbors: {}, bookmarkTitle: `Übersicht ${scene.sceneName}`,
    });
  }
  if (includeCablePlan) {
    const cableBounds = contentBounds(snapshot, { ...layers, dimensions: false, cables: true }, 'venue');
    const overview = fittedWindow(cableBounds, body, scale);
    const cableLayers = {
      ...layers, dimensions: false, warnings: false, cables: true, infrastructure: true,
    };
    pushSheet(sheets, {
      title: 'Kabelplan', sceneName: scene.sceneName, paper, orientation,
      widthMm: size.width, heightMm: size.height, scale: overview.scale, scaleLabel: scaleLabel(overview.scale),
      paint: chrome(metaFor(input, scene, 'Kabelplan', scaleLabel(overview.scale)), size, measure),
      frames: [{
        id: `cables-${scene.sceneId}`, kind: 'plan', clip: body, scale: overview.scale,
        scaleLabel: scaleLabel(overview.scale), sourceLabel: 'Kabelplan', window: overview.window, detail: false,
        paint: planPaint(snapshot, cableLayers, body, overview.window, measure, map).paint,
      }],
      diagnostics: [], neighbors: {}, bookmarkTitle: `Kabelplan ${scene.sceneName}`,
    });
  }
  for (const face of !sections || sections.has('elevations') ? faces : []) {
    const faceTiles = tilesFor({ minX: 0, minY: 0, maxX: Math.max(face.width, 1), maxY: Math.max(face.height, 1) }, body, scale);
    for (const tile of faceTiles) {
      const drawn = elevationPaint(face, body, tile.window, measure);
      pushSheet(sheets, {
        title: 'Frontansicht', sceneName: scene.sceneName, paper, orientation,
        widthMm: size.width, heightMm: size.height, scale, scaleLabel: scaleLabel(scale),
        paint: chrome(metaFor(input, scene, 'Frontansicht', scaleLabel(scale)), size, measure),
        frames: [{
          id: `elev-${scene.sceneId}-${face.facingDegrees}-${tile.row}-${tile.column}`, kind: 'elevation', clip: body,
          scale, scaleLabel: scaleLabel(scale), sourceLabel: face.label, window: tile.window, detail: false,
          paint: [
            { op: 'text', x: body.x, y: body.y, text: face.label, size: 8, color: '#203c36', bold: true, height: 4, width: body.width },
            ...drawn.paint, ...overlapMarks(body, tile),
          ],
        }],
        diagnostics: [], neighbors: {}, bookmarkTitle: face.label,
      });
    }
  }
  if (rows.length && (!sections || sections.has('wallSchedule'))) {
    tableSheets('Stückliste', ['Nr.', 'Bezeichnung', 'Maß'], rows.map(row => [row.key, row.label, row.detail]), body, paper, orientation, measure, scene.sceneName, metaFor(input, scene, 'Stückliste', '—'), sheets);
  }
  if (sections?.has('cableSchedule') && (snapshot.layout.cableRuns?.length ?? 0) > 0) {
    tableSheets('Kabelliste', ['Zweck / Typ', 'Von → Nach', 'Anzahl', 'Länge je Kabel'], cableScheduleRows(snapshot.layout.cableRuns ?? []),
      body, paper, orientation, measure, scene.sceneName, metaFor(input, scene, 'Kabelliste', '—'), sheets);
  }
  const notes = (!sections || sections.has('warnings') || sections.has('notes')) ? collectNotes(snapshot, layers) : [];
  if (notes.length) notesSheets(notes, body, paper, orientation, measure, metaFor(input, scene, 'Hinweise', '—'), sheets);
  if (planIds.length > 1) diagnostics.push(`Grundriss auf ${planIds.length} Blätter aufgeteilt.`);
}

function composeIndex(
  spec: ExportDocumentSpec,
  ordered: { scene: FrozenScene }[],
  input: { productionName: string; issuedAtLabel: string; spec: ExportDocumentSpec },
  measure: TextMeasure, sheets: DrawnSheet[],
) {
  const orientation: SheetOrientation = spec.orientation === 'landscape' ? 'landscape' : 'portrait';
  const body = bodyRect(spec.paper, orientation);
  const size = sheetSizeMm(spec.paper, orientation);
  const purpose = spec.purpose ? DOCUMENT_PURPOSES[spec.purpose].label : spec.kind === 'package' ? 'Konstruktionspaket' : 'Inhalt';
  const paint: Paint[] = [];
  let y = body.y + 14;
  paint.push({ op: 'text', x: body.x, y, text: purpose.toLocaleUpperCase('de-DE'), size: 8, color: '#718264', bold: true, height: 4, width: body.width });
  y += 9;
  for (const line of wrapLines(input.productionName, body.width, 26, (text, size) => measure(text, size, true))) {
    paint.push({ op: 'text', x: body.x, y, text: line, size: 26, color: '#273d34', bold: true, height: 12, width: body.width });
    y += 12;
  }
  const venueNames = [...new Set(ordered.map(item => item.scene.venueName))].join(' · ');
  for (const line of wrapLines(venueNames, body.width, 11, measure)) {
    paint.push({ op: 'text', x: body.x, y, text: line, size: 11, color: '#77876a', height: 5, width: body.width });
    y += 5;
  }
  y += 12;
  for (const paragraph of [spec.introduction, spec.contact].filter((value): value is string => !!value)) {
    for (const line of wrapLines(paragraph, body.width, 9, measure)) {
      paint.push({ op: 'text', x: body.x, y, text: line, size: 9, color: '#395640', height: 4.5, width: body.width });
      y += 4.5;
    }
    y += 3;
  }
  paint.push({ op: 'line', x1: body.x, y1: y, x2: body.x + Math.min(75, body.width), y2: y, stroke: '#cad3c2', line: 0.3 });
  y += 7;
  paint.push({ op: 'text', x: body.x, y, text: 'BÜHNENBILDER IN DIESEM DOKUMENT', size: 7, color: '#87927d', bold: true, height: 4, width: body.width });
  y += 7;
  ordered.forEach((item, index) => {
    paint.push({ op: 'text', x: body.x, y: y + index * 6, text: item.scene.sceneName, size: 9, color: '#203c36', height: 4, width: body.width });
  });
  const coverScene = ordered[0]?.scene;
  const artTop = Math.max(y + ordered.length * 6 + 14, body.y + body.height * 0.4);
  if (coverScene && body.y + body.height - artTop > 35) {
    const art = { x: body.x, y: artTop, width: body.width, height: body.y + body.height - artTop - 8 };
    const coverLayers = resolveExportLayers({ ...spec.layers, dimensions: false, labels: false, warnings: false, constraints: false, infrastructure: false, cables: false });
    const extent = contentBounds(coverScene.snapshot, coverLayers, 'venue');
    const overview = fittedWindow(extent, art, spec.scale);
    paint.push({ op: 'text', x: art.x, y: art.y - 6, text: 'BLICK AUF DIE BÜHNE', size: 7, color: '#87927d', bold: true, height: 4, width: art.width });
    paint.push(...planPaint(coverScene.snapshot, coverLayers, art, overview.window, measure, new Map()).paint);
    paint.push({ op: 'text', x: art.x, y: art.y + art.height + 3, text: 'Orientierung · ohne Maßstab', size: 7, color: '#87927d', height: 4, width: art.width });
  }
  pushSheet(sheets, {
    title: purpose, paper: spec.paper, orientation, widthMm: size.width, heightMm: size.height,
    scale: null, scaleLabel: '—',
    paint: chrome(metaFor(input, ordered[0]?.scene, purpose, '—'), size, measure),
    frames: [{ id: 'index', kind: 'notes', clip: body, scale: null, scaleLabel: '—', sourceLabel: purpose, paint, detail: false }],
    diagnostics: [], neighbors: {}, bookmarkTitle: purpose,
  });
}

function composeStock(stock: PackageStock, spec: ExportDocumentSpec, input: { productionName: string; issuedAtLabel: string; spec: ExportDocumentSpec }, measure: TextMeasure, sheets: DrawnSheet[]) {
  const orientation: SheetOrientation = spec.orientation === 'landscape' ? 'landscape' : 'portrait';
  const body = bodyRect(spec.paper, orientation);
  const rows = [
    ['Physische Platten', String(stock.physicalPanels), 'Bestand'],
    ['Einsätze in Bühnenbildern', String(stock.appearances), 'Auftritte'],
    ...stock.panels.map(panel => [panel.label, String(panel.appearances), panel.sceneNames.join(', ')]),
  ];
  tableSheets('Bestand', ['Platte', 'Anzahl', 'Bühnenbilder'], rows, body, spec.paper, orientation, measure, undefined, metaFor(input, undefined, 'Bestand', '—'), sheets);
  for (const venue of stock.venueMaterials ?? []) {
    tableSheets('Materialbedarf · enthaltene Bühnenbilder', ['Artikel', 'Benötigt', 'Verfügbar / Fehlend'], [
      ['Stützen', String(venue.required.braces), '—'],
      ['Gehwegplatten · 400 × 400 × 50 mm', String(venue.required.slabs), `${venue.available.slabs} / ${venue.shortage.slabs}`],
      ['Spanngurte', String(venue.required.straps), `${venue.available.straps} / ${venue.shortage.straps}`],
    ], body, spec.paper, orientation, measure, venue.venueName, metaFor(input, undefined, `Materialbedarf · ${venue.venueName}`, '—'), sheets);
  }
}

function composeView(
  scene: FrozenScene, spec: ExportDocumentSpec, input: { productionName: string; issuedAtLabel: string; spec: ExportDocumentSpec },
  measure: TextMeasure, sheets: DrawnSheet[], view?: { id: string; label: string },
) {
  // Raumsicht fills like a photo — landscape by default (auto), portrait only when forced.
  const orientation: SheetOrientation = spec.orientation === 'portrait' ? 'portrait' : 'landscape';
  const body = bodyRect(spec.paper, orientation);
  const size = sheetSizeMm(spec.paper, orientation);
  const frameId = view ? viewFrameId(scene.sceneId, view.id) : viewFrameId(scene.sceneId);
  const title = view ? `Raumsicht · ${view.label}` : 'Raumsicht';
  pushSheet(sheets, {
    title, sceneName: scene.sceneName, paper: spec.paper, orientation, sourceKey: `${scene.sceneId}:${frameId}`,
    widthMm: size.width, heightMm: size.height, scale: null, scaleLabel: 'ohne Maßstab',
    paint: chrome(metaFor(input, scene, title, 'ohne Maßstab'), size, measure),
    frames: [{
      id: frameId, kind: 'view3d', clip: body, scale: null, scaleLabel: 'ohne Maßstab',
      sourceLabel: scene.sceneName, detail: false,
      paint: [{ op: 'image', frameId, x: body.x, y: body.y, width: body.width, height: body.height }],
    }],
    diagnostics: [], neighbors: {}, bookmarkTitle: `${title} ${scene.sceneName}`,
  });
}

function composeCustom(
  spec: ExportDocumentSpec,
  ordered: { entry: ExportDocumentSpec['scenes'][number]; scene: FrozenScene }[],
  input: { productionName: string; issuedAtLabel: string; spec: ExportDocumentSpec },
  layers: ExportLayers, measure: TextMeasure, sheets: DrawnSheet[], diagnostics: string[], automatic?: DocumentLayout,
) {
  const primary = ordered[0]!.scene;
  let overviewNeeded = false;
  const references = new Set(spec.customPages?.map(page => page.automaticKey));
  const appended = new Set<string>();
  for (const page of spec.customPages ?? []) {
    if (page.automaticKey) {
      const source = automatic?.sheets.find(sheet => sheet.sourceKey === page.automaticKey);
      if (!source) {
        throw new Error(`Das automatische Blatt „${page.name}“ ist nicht mehr verfügbar. Bitte den Seitenaufbau aktualisieren.`);
      }
      // Generated schedules remain measured and complete. Page ordering never freezes
      // their paint or substitutes a different scene when the underlying design changes.
      pushSheet(sheets, {
        ...source, title: page.name, pageId: page.id, neighbors: {},
        paint: source.paint.map(item => item.op === 'text' && item.text === source.title ? { ...item, text: page.name } : { ...item }),
        frames: source.frames.map(frame => ({ ...frame, paint: frame.paint.filter(item => item.op !== 'link') })),
        bookmarkTitle: page.name,
      });
      const family = automaticSheetFamily(source);
      const laterPages = spec.customPages!.slice(spec.customPages!.indexOf(page) + 1);
      const laterReference = laterPages.some(later => {
        const target = automatic?.sheets.find(sheet => sheet.sourceKey === later.automaticKey);
        return target && automaticSheetFamily(target) === family;
      });
      if (!laterReference) for (const extra of automatic?.sheets ?? []) {
        if (automaticSheetFamily(extra) !== family || references.has(extra.sourceKey) || appended.has(extra.sourceKey!)) continue;
        appended.add(extra.sourceKey!);
        pushSheet(sheets, { ...extra, neighbors: {}, frames: extra.frames.map(frame => ({ ...frame, paint: frame.paint.filter(item => item.op !== 'link') })), bookmarkTitle: extra.title });
      }
      continue;
    }
    const size = sheetSizeMm(page.paper, page.orientation);
    const pageInput = { ...input, spec: { ...input.spec, paper: page.paper } };
    const frames: DrawnFrame[] = [];
    const pageDiagnostics: string[] = [];
    const scales = new Set<number>();
    let perspective = false;
    const continuations: Parameters<typeof pushSheet>[1][] = [];
    function appendText(frame: DocumentFrame, lines: string[], lineHeight: number, color: string, scene: FrozenScene) {
      const clip = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
      const capacity = Math.max(1, Math.floor(clip.height / lineHeight));
      for (let offset = 0; offset < Math.max(1, lines.length); offset += capacity) {
        const drawn: DrawnFrame = {
          id: offset ? `${frame.id}-continuation-${offset}` : frame.id,
          kind: frame.kind, clip, scale: null, scaleLabel: '—', sourceLabel: scene.sceneName, detail: false,
          paint: lines.slice(offset, offset + capacity).map((text, index) => ({
            op: 'text', x: clip.x, y: clip.y + index * lineHeight, text, size: 8, color,
            height: lineHeight, width: clip.width,
          })),
        };
        if (!offset) frames.push(drawn);
        else continuations.push({
          title: `${frame.label || page.name} (Fortsetzung)`, sceneName: scene.sceneName,
          paper: page.paper, orientation: page.orientation, widthMm: size.width, heightMm: size.height,
          scale: null, scaleLabel: '—',
          paint: chrome(metaFor(pageInput, scene, `${frame.label || page.name} (Fortsetzung)`, '—'), size, measure),
          frames: [drawn], diagnostics: [], neighbors: {}, bookmarkTitle: `${page.name} (Fortsetzung)`,
        });
      }
    }
    for (const frame of page.frames) {
      const scene = frame.source.sceneId ? ordered.find(item => item.scene.sceneId === frame.source.sceneId)?.scene : primary;
      if (!scene) throw new Error('Das Bühnenbild eines Rahmens ist nicht mehr im Dokument enthalten.');
      const frameLayers = resolveExportLayers({ ...layers, ...frame.layers });
      const clip = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
      if (frame.kind === 'view3d') {
        perspective = true;
        frames.push({
          id: frame.id, kind: frame.kind, clip, scale: null, scaleLabel: 'ohne Maßstab', sourceLabel: scene.sceneName, detail: false,
          paint: [{ op: 'image', frameId: frame.id, x: clip.x, y: clip.y, width: clip.width, height: clip.height }],
        });
        continue;
      }
      if (frame.kind === 'notes') {
        const notes = frame.text != null ? frame.text.split('\n') : collectNotes(scene.snapshot, frameLayers);
        const lines = notes.flatMap(note => wrapLines(note, clip.width, 8, measure));
        if (lines.length > Math.floor(clip.height / 4)) {
          const message = 'Der Text passt nicht vollständig in den Rahmen. Folgeblätter wurden ergänzt.';
          pageDiagnostics.push(message); diagnostics.push(message);
        }
        appendText(frame, lines, 4, '#52644a', scene);
        continue;
      }
      if (frame.kind === 'schedule') {
        const rows = keysFor(scene.snapshot).rows;
        const lines = rows.flatMap(row => wrapLines(`${row.key}  ${row.label}  ${row.detail}`, clip.width, 8, measure));
        const capacity = Math.floor(clip.height / 4.2);
        if (lines.length > capacity) {
          const message = 'Die Stückliste passt nicht vollständig in den Rahmen. Folgeblätter wurden ergänzt.';
          pageDiagnostics.push(message);
          diagnostics.push(message);
        }
        appendText(frame, lines, 4.2, '#203c36', scene);
        continue;
      }
      const scale = frame.scale ?? spec.scale;
      scales.add(scale);
      const snapshot = scene.snapshot;
      const bounds = frame.kind === 'elevation'
        ? elevationBounds(snapshot, frame)
        : (frame.crop ? orderedCrop(frame.crop) : contentBounds(snapshot, frameLayers, spec.planScope));
      if (frame.crop) overviewNeeded = true;
      const tiles = tilesFor(bounds, clip, scale);
      const tile = tiles[0]!;
      if (tiles.length > 1) {
        const message = `Rahmen ${frame.label ?? frame.kind} braucht ${tiles.length} Blätter; Folgeblätter wurden ergänzt.`;
        pageDiagnostics.push(message);
        diagnostics.push(message);
      }
      const drawn = frame.kind === 'elevation'
        ? elevationFrame(snapshot, frame, clip, tile.window, measure)
        : planPaint(snapshot, frameLayers, clip, tile.window, measure, keysFor(snapshot).map);
      frames.push({
        id: frame.id, kind: frame.kind, clip, scale, scaleLabel: scaleLabel(scale), sourceLabel: frame.label ?? scene.sceneName,
        window: tile.window, detail: Boolean(frame.crop), paint: drawn.paint,
      });
      for (const extra of tiles.slice(1)) {
        const extraDrawn = frame.kind === 'elevation'
          ? elevationFrame(snapshot, frame, clip, extra.window, measure)
          : planPaint(snapshot, frameLayers, clip, extra.window, measure, keysFor(snapshot).map);
        const extraBody = clip;
        continuations.push({
          title: frame.kind === 'elevation' ? 'Frontansicht' : 'Grundriss', sceneName: scene.sceneName,
          paper: page.paper, orientation: page.orientation, widthMm: size.width, heightMm: size.height,
          scale, scaleLabel: scaleLabel(scale),
          paint: chrome(metaFor(pageInput, scene, 'Folgeblatt', scaleLabel(scale)), size, measure),
          frames: [{
            id: `${frame.id}-tile-${extra.row}-${extra.column}`, kind: frame.kind, clip: extraBody, scale,
            scaleLabel: scaleLabel(scale), sourceLabel: scene.sceneName, window: extra.window, detail: false, paint: extraDrawn.paint,
          }],
          diagnostics: [], neighbors: {}, bookmarkTitle: 'Folgeblatt',
        });
      }
    }
    const shared = !perspective && scales.size === 1 ? [...scales][0]! : null;
    pushSheet(sheets, {
      title: page.name, sceneName: primary.sceneName, paper: page.paper, orientation: page.orientation,
      widthMm: size.width, heightMm: size.height, scale: shared, scaleLabel: scaleLabel(shared, perspective && scales.size === 0),
      paint: chrome(metaFor(pageInput, primary, page.name, scaleLabel(shared, perspective && scales.size === 0)), size, measure),
      frames, diagnostics: pageDiagnostics, neighbors: {}, bookmarkTitle: page.name, pageId: page.id,
    });
    for (const continuation of continuations) pushSheet(sheets, continuation);
  }
  if (overviewNeeded) {
    const scene = primary;
    const paper = spec.paper;
    const orientation: SheetOrientation = spec.orientation === 'landscape' ? 'landscape' : 'portrait';
    const body = bodyRect(paper, orientation);
    const size = sheetSizeMm(paper, orientation);
    const bounds = contentBounds(scene.snapshot, layers);
    const tile = tilesFor(bounds, body, spec.scale)[0]!;
    const crops = (spec.customPages ?? []).flatMap(page => page.frames.filter(frame => frame.crop).map(frame => frame.crop!));
    pushSheet(sheets, {
      title: 'Übersicht', sceneName: scene.sceneName, paper, orientation, widthMm: size.width, heightMm: size.height,
      scale: spec.scale, scaleLabel: scaleLabel(spec.scale),
      paint: chrome(metaFor(input, scene, 'Übersicht', scaleLabel(spec.scale)), size, measure),
      frames: [{
        id: 'overview', kind: 'plan', clip: body, scale: spec.scale, scaleLabel: scaleLabel(spec.scale),
        sourceLabel: 'Übersicht', window: tile.window, detail: false,
        paint: [
          ...planPaint(scene.snapshot, layers, body, tile.window, measure, keysFor(scene.snapshot).map).paint,
          ...crops.map(crop => poly([
            { x: crop.minX, y: crop.minY }, { x: crop.maxX, y: crop.minY }, { x: crop.maxX, y: crop.maxY }, { x: crop.minX, y: crop.maxY },
          ], body, tile.window, undefined, '#986122', 0.6)),
        ],
      }],
      diagnostics: [], neighbors: {}, bookmarkTitle: 'Übersicht',
    });
  }
}

function frameElevationFaces(snapshot: ConstructionSnapshot, frame: DocumentFrame) {
  const index = frame.source.groupIndex ?? 0;
  const groupId = frame.source.groupId ?? snapshot.elevationGroupIds[index] ?? snapshot.layout.groups?.[index]?.id ?? snapshot.layout.groups?.[0]?.id;
  return elevationFaces({ ...snapshot, elevationGroupIds: groupId ? [groupId] : [] });
}

function elevationBounds(snapshot: ConstructionSnapshot, frame: DocumentFrame): Box {
  const faces = frameElevationFaces(snapshot, frame);
  const face = faces.find(item => frame.source.facingDegrees == null || item.facingDegrees === frame.source.facingDegrees) ?? faces[0];
  if (!face) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX: 0, minY: 0, maxX: Math.max(face.width, 1), maxY: Math.max(face.height, 1) };
}

function elevationFrame(snapshot: ConstructionSnapshot, frame: DocumentFrame, clip: Rect, view: Box, measure: TextMeasure) {
  const faces = frameElevationFaces(snapshot, frame);
  const face = faces.find(item => frame.source.facingDegrees == null || item.facingDegrees === frame.source.facingDegrees) ?? faces[0];
  if (!face) return { paint: [] as Paint[], overflow: [] as string[] };
  return elevationPaint(face, clip, view, measure);
}

function linkNeighbors(sheets: DrawnSheet[], measure: TextMeasure) {
  for (const sheet of sheets) {
    const bits: { label: string; sheet: number }[] = [];
    if (sheet.neighbors.right) bits.push({ label: `rechts Blatt ${sheet.neighbors.right}`, sheet: sheet.neighbors.right });
    if (sheet.neighbors.below) bits.push({ label: `unten Blatt ${sheet.neighbors.below}`, sheet: sheet.neighbors.below });
    let x = SHEET_MARGIN_MM + 90;
    for (const bit of bits) {
      const width = measure(bit.label, 7) + 2;
      const y = sheet.heightMm - FOOTER_BAND_MM + 2;
      sheet.paint.push({ op: 'text', x, y, text: bit.label, size: 7, color: '#315d49', height: 3.5, width });
      sheet.paint.push({ op: 'link', x, y, width, height: 4, sheet: bit.sheet });
      x += width + 3;
    }
  }
  for (const index of sheets.filter(sheet => sheet.frames.some(frame => frame.id === 'index'))) {
    const frame = index.frames[0]!;
    frame.paint = frame.paint.filter(item => item.op !== 'link');
    for (const item of [...frame.paint]) {
      if (item.op !== 'text') continue;
      const target = sheets.find(sheet => sheet.index !== index.index && sheet.sceneName === item.text && sheet.frames.some(frame => frame.kind === 'plan'));
      if (target) frame.paint.push({ op: 'link', x: item.x, y: item.y, width: item.width ?? frame.clip.width, height: item.height, sheet: target.index });
    }
  }
}

export function layoutManifest(layout: DocumentLayout) {
  return {
    schemaVersion: 1 as const,
    pageCount: layout.pageCount,
    revisionName: layout.revisionName,
    issuedAt: layout.issuedAt,
    diagnostics: layout.diagnostics,
    sheets: layout.sheets.map(sheet => ({
      index: sheet.index, code: sheet.code, title: sheet.title, sceneName: sheet.sceneName ?? null,
      paper: sheet.paper, orientation: sheet.orientation, widthMm: sheet.widthMm, heightMm: sheet.heightMm,
      scale: sheet.scale, scaleLabel: sheet.scaleLabel, bookmark: sheet.bookmark,
      diagnostics: sheet.diagnostics, sourceKey: sheet.sourceKey ?? null, pageId: sheet.pageId ?? null,
      frames: sheet.frames.map(frame => ({
        id: frame.id, kind: frame.kind, x: frame.clip.x, y: frame.clip.y, width: frame.clip.width, height: frame.clip.height,
        scale: frame.scale, scaleLabel: frame.scaleLabel, sourceLabel: frame.sourceLabel, detail: frame.detail,
      })),
    })),
  };
}

export function coversPoint(layout: DocumentLayout, x: number, y: number) {
  return layout.sheets.some(sheet => sheet.frames.some(frame => frame.window && !frame.detail
    && x >= frame.window.minX - 0.5 && x <= frame.window.maxX + 0.5
    && y >= frame.window.minY - 0.5 && y <= frame.window.maxY + 0.5));
}

export function textBoxes(layout: DocumentLayout): Rect[] {
  const boxes: Rect[] = [];
  for (const sheet of layout.sheets) {
    for (const item of [...sheet.paint, ...sheet.frames.flatMap(frame => frame.paint)]) {
      if (item.op === 'text') boxes.push({ x: item.x, y: item.y, width: item.width ?? 10, height: item.height });
    }
  }
  return boxes;
}

export function pageEdgeMm(modelMm: number, scale: DrawingScale) {
  return modelMm / scale;
}

export function defaultCamera(bounds: Box, preset: CameraPreset = 'orbit', audienceViewpoint?: AudienceViewpoint): SavedCamera {
  if (preset === 'audience' && audienceViewpoint) {
    return {
      projection: 'perspective',
      position: { x: audienceViewpoint.x, y: audienceViewpoint.heightMm, z: audienceViewpoint.y },
      target: { x: audienceViewpoint.targetX, y: audienceViewpoint.targetHeightMm, z: audienceViewpoint.targetY },
      preset,
    };
  }
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1000);
  if (preset === 'top') return { projection: 'orthographic', position: { x: cx, y: span, z: cy }, target: { x: cx, y: 0, z: cy }, preset };
  if (preset === 'front') return { projection: 'orthographic', position: { x: cx, y: 1600, z: cy - span }, target: { x: cx, y: 1200, z: cy }, preset };
  if (preset === 'side') return { projection: 'orthographic', position: { x: cx - span, y: 1600, z: cy }, target: { x: cx, y: 1200, z: cy }, preset };
  if (preset === 'audience') return { projection: 'perspective', position: { x: cx, y: 1600, z: bounds.minY - span * 0.4 }, target: { x: cx, y: 1200, z: cy }, preset };
  return { projection: 'perspective', position: { x: cx + span * 0.6, y: 2200, z: cy - span * 0.8 }, target: { x: cx, y: 1000, z: cy }, preset };
}

export type LegacyRepair = { frameId: string; message: string };

/** Seed editable custom pages from the current automatic export settings (F04). */
export function editablePagesFromSettings(input: {
  paper: PaperSize;
  orientation: 'auto' | SheetOrientation;
  scale: DrawingScale;
  sceneId?: string;
  planCrop?: FrameCrop;
  name?: string;
}): DocumentPage[] {
  const orientation: SheetOrientation = input.orientation === 'auto' ? 'portrait' : input.orientation;
  const body = bodyRect(input.paper, orientation);
  return [{
    id: crypto.randomUUID(),
    name: input.name?.trim() || 'Grundriss',
    paper: input.paper,
    orientation,
    frames: [{
      id: crypto.randomUUID(),
      kind: 'plan',
      x: body.x,
      y: body.y,
      width: body.width,
      height: body.height,
      rotation: 0,
      scale: input.scale,
      crop: input.planCrop,
      source: { role: 'primary', ...(input.sceneId ? { sceneId: input.sceneId } : {}) },
    }],
  }];
}

/** Map a venue report template into document pages. Does not apply the template by itself. */
export function documentPagesFromTemplate(template: {
  pages: { id: string; name: string; paper: 'a4' | 'a3'; orientation?: 'portrait' | 'landscape'; frames: {
    id: string; kind: string; x: number; y: number; width: number; height: number; rotation?: number;
    scale?: number; crop?: FrameCrop; view?: string; planScope?: string; label?: string;
    sourceRole?: 'primary' | 'each'; groupIndex?: number; camera?: SavedCamera;
  }[] }[];
}, sceneId?: string): { pages: DocumentPage[]; repairs: LegacyRepair[] } {
  const repairs: LegacyRepair[] = [];
  const pages: DocumentPage[] = [];
  for (const page of template.pages) {
    const paper: PaperSize = page.paper === 'a3' ? 'A3' : 'A4';
    const orientation = page.orientation ?? 'portrait';
    const size = sheetSizeMm(paper, orientation);
    const frames: DocumentFrame[] = [];
    for (const frame of page.frames) {
      const kind = frame.kind === 'plan' || frame.kind === 'elevation' || frame.kind === 'view3d' || frame.kind === 'notes' || frame.kind === 'schedule'
        ? frame.kind : undefined;
      if (!kind) {
        repairs.push({ frameId: frame.id, message: 'Unbekannte Rahmenart. Bitte ersetzen.' });
        continue;
      }
      if (frame.x + frame.width > size.width + 0.5 || frame.y + frame.height > size.height + 0.5) {
        repairs.push({ frameId: frame.id, message: 'Rahmen liegt außerhalb des Blatts.' });
      }
      const scale = frame.scale === 25 || frame.scale === 50 || frame.scale === 100 ? frame.scale : undefined;
      frames.push({
        id: frame.id, kind, x: frame.x, y: frame.y, width: frame.width, height: frame.height,
        rotation: frame.rotation === 90 || frame.rotation === 180 || frame.rotation === 270 ? frame.rotation : 0,
        scale, crop: frame.crop, label: frame.label,
        source: { role: frame.sourceRole ?? (frame.kind === 'plan' ? 'primary' : 'primary'), sceneId, groupIndex: frame.groupIndex },
        camera: frame.camera ?? (frame.view ? defaultCamera({ minX: 0, minY: 0, maxX: 4000, maxY: 3000 }, frame.view as CameraPreset) : undefined),
      });
    }
    pages.push({ id: page.id, name: page.name, paper, orientation, frames });
  }
  return { pages, repairs };
}
