import { z } from 'zod';
import { CONNECTION_COMPATIBILITY_NOTICE } from './assembly.js';
import { dimensionFigure, resolveDimension } from './dimensions.js';
import { elevationFaces, type ElevationFace } from './elevations.js';
import {
  DRAWING_SCALE, drawingScaleSchema, paperSizeSchema, type ConstructionSnapshot,
} from './export.js';
import { resolveExportLayers, type ExportLayers } from './exportLayers.js';
import type { ConstructionPackage } from './package.js';

type PackageStock = ConstructionPackage['stock'];
import {
  PAGE_OVERLAP_MM, PAPER_SIZE_MM, type DrawingScale, type PaperSize,
} from './tiling.js';
import { measuredOutline } from './venue.js';

const name = z.string().trim().min(1).max(120);
const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
const point3 = z.strictObject({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });

export const sheetOrientationSchema = z.enum(['portrait', 'landscape']);
export type SheetOrientation = z.infer<typeof sheetOrientationSchema>;
export const frameKindSchema = z.enum(['plan', 'elevation', 'view3d', 'notes', 'schedule']);
export type FrameKind = z.infer<typeof frameKindSchema>;
export const cameraPresetSchema = z.enum(['orbit', 'audience', 'top', 'front', 'side']);
export type CameraPreset = z.infer<typeof cameraPresetSchema>;

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
});
export type DocumentFrame = z.infer<typeof documentFrameSchema>;

export const documentPageSchema = z.strictObject({
  id: z.uuid(),
  name: name,
  paper: paperSizeSchema,
  orientation: sheetOrientationSchema,
  frames: z.array(documentFrameSchema).max(40),
});
export type DocumentPage = z.infer<typeof documentPageSchema>;

export const exportDocumentSpecSchema = z.strictObject({
  schemaVersion: z.literal(1),
  preset: z.enum(['construction', 'presentation']).default('construction'),
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

export function contentBounds(snapshot: ConstructionSnapshot, layers: ExportLayers): Box {
  const points: { x: number; y: number }[] = [];
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
  // Venue outline is drawn as context when enabled, but does not enlarge the crop — construction
  // sheets default to scenery (no empty audience hall). Keep-clear polygons still influence crop.
  if (layers.venueContext) {
    for (const zone of snapshot.venue.keepClearZones ?? []) points.push(...zone.polygon);
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
  if (layers.venueContext) {
    const outline = measuredOutline(snapshot.venue);
    paint.push(poly(outline, frame, view, undefined, '#718469', 0.7));
    for (const zone of snapshot.venue.keepClearZones ?? []) {
      paint.push(poly(zone.polygon, frame, view, undefined, '#986122', 0.6));
    }
  }
  if (layers.scenery) {
    for (const wall of snapshot.resolvedWalls) {
      paint.push(poly([...wall.corners], frame, view, '#315d49', '#243f34', 0.5));
      for (const opening of wall.openings ?? []) paint.push(poly([...opening.corners], frame, view, '#ffffff', '#315d49', 0.4));
      const box = boxOf(wall.corners);
      if (box) identityMarks(wallIdentityLines(wall.assemblyNumber, wall.panelLabel), (box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, frame, view, measure, paint);
    }
    for (const brace of snapshot.resolvedBraces ?? []) paint.push(poly([...brace.corners], frame, view, undefined, '#5c6b52', 0.5));
    for (const item of snapshot.resolvedPlaceholders ?? []) {
      if (item.kind === 'chair') continue;
      paint.push(poly([...item.corners], frame, view, undefined, '#8b8478', 0.4));
    }
  }
  if (layers.audience) {
    for (const item of snapshot.resolvedPlaceholders ?? []) {
      if (item.kind !== 'chair') continue;
      paint.push(poly([...item.corners], frame, view, undefined, '#8b8478', 0.4));
    }
  }
  for (const item of snapshot.layout.dimensions ?? []) {
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
    const size = index === 0 ? 18 : 13;
    const width = Math.max(8, measure(text, size, true));
    paint.push({
      op: 'text', x: centre.x - width / 2, y: centre.y - 3 + index * 6.2,
      text, size, color: index === 0 ? '#173c36' : '#6a4e16', bold: true, height: 6, width,
    });
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
      paint.push(poly([
        { x: panel.left + opening.left, y: opening.sill },
        { x: panel.left + opening.left + opening.width, y: opening.sill },
        { x: panel.left + opening.left + opening.width, y: opening.sill + opening.height },
        { x: panel.left + opening.left, y: opening.sill + opening.height },
      ], frame, view, '#ffffff', '#315d49', 0.4));
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
    if (measure(next, size) <= widthMm) current = next;
    else {
      if (current) lines.push(current);
      current = word;
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
  paint.push({ op: 'text', x: left, y: 8, text: sheet.title, size: 12, color: '#203c36', bold: true, height: 5, width: measure(sheet.title, 12, true) });
  const subtitle = [sheet.productionName, sheet.sceneName, sheet.venueName].filter(Boolean).join(' · ');
  paint.push({ op: 'text', x: left, y: 14, text: subtitle, size: 8, color: '#395640', height: 4, width: size.width - 40 });
  const meta = `Fassung ${sheet.revisionName} · ${sheet.issuedAt} · ${sheet.paper} · Blatt ${sheet.code}`;
  paint.push({ op: 'text', x: left, y: 19, text: meta, size: 7, color: '#536950', height: 3.5, width: size.width - 40 });
  const bar = 1000 / (sheet.scaleLabel.startsWith('1:') ? Number(sheet.scaleLabel.slice(2)) : 50);
  const showBar = sheet.scaleLabel.startsWith('1:');
  const footY = size.height - FOOTER_BAND_MM + 2;
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
  for (const wall of snapshot.resolvedWalls) {
    const key = String(n++);
    map.set(wall.id, key);
    const width = Math.hypot(wall.corners[1]!.x - wall.corners[0]!.x, wall.corners[1]!.y - wall.corners[0]!.y);
    rows.push({
      key, label: wall.panelLabel ?? wall.label,
      detail: `${Math.round(width)} mm${wall.assemblyNumber ? ` · Position ${wall.assemblyNumber}` : ''}`,
    });
  }
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
  const colW = body.width / cols;
  let rowIndex = 0;
  let part = 1;
  while (rowIndex < rows.length || part === 1) {
    const paint: Paint[] = [];
    let y = body.y;
    headers.forEach((header, column) => {
      paint.push({ op: 'text', x: body.x + column * colW, y, text: header, size: 8, color: '#203c36', bold: true, height: lineH, width: colW - 1 });
    });
    y += lineH + 1;
    paint.push({ op: 'line', x1: body.x, y1: y, x2: body.x + body.width, y2: y, stroke: '#c5cbbd', line: 0.4 });
    y += 1.5;
    while (rowIndex < rows.length && y + lineH <= body.y + body.height) {
      rows[rowIndex]!.forEach((cell, column) => {
        paint.push({ op: 'text', x: body.x + column * colW, y, text: cell, size: 8, color: '#203c36', height: lineH, width: colW - 1 });
      });
      y += lineH;
      rowIndex += 1;
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
  const ordered = spec.scenes.map(entry => {
    const scene = input.scenes.find(item => item.sceneId === entry.sceneId);
    if (!scene) throw new Error('Szene für den Export fehlt.');
    return { entry, scene };
  });

  if (spec.customPages?.length) {
    composeCustom(spec, ordered, input, layers, measure, sheets, diagnostics);
  } else {
    if (spec.kind === 'package' || ordered.length > 1 || input.stock) composeIndex(spec, ordered, input, measure, sheets);
    for (const { entry, scene } of ordered) {
      composeScene(spec, entry.elevationGroupIds, scene, input, layers, measure, sheets, diagnostics);
    }
    if (spec.kind === 'package' && input.stock) composeStock(input.stock, spec, input, measure, sheets);
    const cameras = spec.viewCameras ?? [];
    if (cameras.length) {
      for (const { scene } of ordered) {
        for (const view of cameras) composeView(scene, spec, input, measure, sheets, view);
      }
    } else if (spec.preset === 'presentation') {
      for (const { scene } of ordered) composeView(scene, spec, input, measure, sheets);
    }
  }

  const pageCount = sheets.length;
  for (const sheet of sheets) {
    const label = sheet.paint.find(item => item.op === 'text' && item.text.startsWith('Fassung '));
    if (label && label.op === 'text') label.text = label.text.replace(/Blatt .*/, `Blatt ${sheet.code} von ${pageCount}`);
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
  const orientation = spec.orientation === 'auto' ? chooseOrientation(snapshot, paper, scale, layers, faces, planCrop) : spec.orientation;
  const body = bodyRect(paper, orientation);
  const size = sheetSizeMm(paper, orientation);
  const fullBounds = contentBounds(snapshot, layers);
  const bounds = planCrop ?? fullBounds;
  const cropped = Boolean(planCrop);
  const { map, rows } = keysFor(snapshot);
  const planTiles = tilesFor(bounds, body, scale);
  const planIds: number[] = [];
  for (const tile of planTiles) {
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
  if (planCrop) {
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
          poly([
            { x: planCrop.minX, y: planCrop.minY }, { x: planCrop.maxX, y: planCrop.minY },
            { x: planCrop.maxX, y: planCrop.maxY }, { x: planCrop.minX, y: planCrop.maxY },
          ], body, overview.window, undefined, '#986122', 0.7),
        ],
      }],
      diagnostics: [], neighbors: {}, bookmarkTitle: `Übersicht ${scene.sceneName}`,
    });
  }
  for (const face of faces) {
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
  if (rows.length) {
    tableSheets('Stückliste', ['Nr.', 'Bezeichnung', 'Maß'], rows.map(row => [row.key, row.label, row.detail]), body, paper, orientation, measure, scene.sceneName, metaFor(input, scene, 'Stückliste', '—'), sheets);
  }
  const notes = collectNotes(snapshot, layers);
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
  const paint: Paint[] = [{ op: 'text', x: body.x, y: body.y, text: spec.kind === 'package' ? 'Konstruktionspaket' : 'Inhalt', size: 11, color: '#203c36', bold: true, height: 5, width: body.width }];
  ordered.forEach((item, index) => {
    paint.push({ op: 'text', x: body.x, y: body.y + 10 + index * 6, text: item.scene.sceneName, size: 9, color: '#203c36', height: 4, width: body.width });
  });
  pushSheet(sheets, {
    title: 'Inhalt', paper: spec.paper, orientation, widthMm: size.width, heightMm: size.height,
    scale: null, scaleLabel: '—',
    paint: chrome(metaFor(input, ordered[0]?.scene, 'Inhalt', '—'), size, measure),
    frames: [{ id: 'index', kind: 'notes', clip: body, scale: null, scaleLabel: '—', sourceLabel: 'Inhalt', paint, detail: false }],
    diagnostics: [], neighbors: {}, bookmarkTitle: 'Inhalt',
  });
}

function composeStock(stock: PackageStock, spec: ExportDocumentSpec, input: { productionName: string; issuedAtLabel: string; spec: ExportDocumentSpec }, measure: TextMeasure, sheets: DrawnSheet[]) {
  const orientation: SheetOrientation = spec.orientation === 'landscape' ? 'landscape' : 'portrait';
  const body = bodyRect(spec.paper, orientation);
  const rows = [
    ['Physische Platten', String(stock.physicalPanels), 'Bestand'],
    ['Einsätze in Szenen', String(stock.appearances), 'Auftritte'],
    ...stock.panels.map(panel => [panel.label, String(panel.appearances), panel.sceneNames.join(', ')]),
  ];
  tableSheets('Bestand', ['Platte', 'Anzahl', 'Szenen'], rows, body, spec.paper, orientation, measure, undefined, metaFor(input, undefined, 'Bestand', '—'), sheets);
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
    title, sceneName: scene.sceneName, paper: spec.paper, orientation,
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
  layers: ExportLayers, measure: TextMeasure, sheets: DrawnSheet[], diagnostics: string[],
) {
  const primary = ordered[0]!.scene;
  let overviewNeeded = false;
  for (const page of spec.customPages ?? []) {
    const size = sheetSizeMm(page.paper, page.orientation);
    const frames: DrawnFrame[] = [];
    const scales = new Set<number>();
    let perspective = false;
    for (const frame of page.frames) {
      const scene = ordered.find(item => item.scene.sceneId === (frame.source.sceneId ?? item.entry.sceneId))?.scene ?? primary;
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
        const notes = collectNotes(scene.snapshot, layers);
        const lines = notes.flatMap(note => wrapLines(note, clip.width, 8, measure));
        frames.push({
          id: frame.id, kind: 'notes', clip, scale: null, scaleLabel: '—', sourceLabel: 'Hinweise', detail: false,
          paint: lines.slice(0, Math.floor(clip.height / 4)).map((line, index) => ({
            op: 'text' as const, x: clip.x, y: clip.y + index * 4, text: line, size: 8, color: '#6a4e16', height: 4, width: clip.width,
          })),
        });
        continue;
      }
      if (frame.kind === 'schedule') {
        const rows = keysFor(scene.snapshot).rows;
        frames.push({
          id: frame.id, kind: 'schedule', clip, scale: null, scaleLabel: '—', sourceLabel: scene.sceneName, detail: false,
          paint: rows.slice(0, Math.floor(clip.height / 4)).map((row, index) => ({
            op: 'text' as const, x: clip.x, y: clip.y + index * 4, text: `${row.key}  ${row.label}  ${row.detail}`, size: 8, color: '#203c36', height: 4, width: clip.width,
          })),
        });
        continue;
      }
      const scale = frame.scale ?? spec.scale;
      scales.add(scale);
      const snapshot = scene.snapshot;
      const bounds = frame.kind === 'elevation'
        ? elevationBounds(snapshot, frame)
        : (frame.crop ?? contentBounds(snapshot, layers));
      if (frame.crop) overviewNeeded = true;
      const tiles = tilesFor(bounds, clip, scale);
      const tile = tiles[0]!;
      if (tiles.length > 1) diagnostics.push(`Rahmen ${frame.label ?? frame.kind} braucht ${tiles.length} Blätter; Folgeblätter wurden ergänzt.`);
      const drawn = frame.kind === 'elevation'
        ? elevationFrame(snapshot, frame, clip, tile.window, measure)
        : planPaint(snapshot, layers, clip, tile.window, measure, keysFor(snapshot).map);
      frames.push({
        id: frame.id, kind: frame.kind, clip, scale, scaleLabel: scaleLabel(scale), sourceLabel: frame.label ?? scene.sceneName,
        window: tile.window, detail: Boolean(frame.crop), paint: drawn.paint,
      });
      for (const extra of tiles.slice(1)) {
        const extraDrawn = frame.kind === 'elevation'
          ? elevationFrame(snapshot, frame, clip, extra.window, measure)
          : planPaint(snapshot, layers, bodyRect(page.paper, page.orientation), extra.window, measure, keysFor(snapshot).map);
        const extraBody = bodyRect(page.paper, page.orientation);
        pushSheet(sheets, {
          title: frame.kind === 'elevation' ? 'Frontansicht' : 'Grundriss', sceneName: scene.sceneName,
          paper: page.paper, orientation: page.orientation, widthMm: size.width, heightMm: size.height,
          scale, scaleLabel: scaleLabel(scale),
          paint: chrome(metaFor(input, scene, 'Folgeblatt', scaleLabel(scale)), size, measure),
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
      paint: chrome(metaFor(input, primary, page.name, scaleLabel(shared, perspective && scales.size === 0)), size, measure),
      frames, diagnostics: [], neighbors: {}, bookmarkTitle: page.name,
    });
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

function elevationBounds(snapshot: ConstructionSnapshot, frame: DocumentFrame): Box {
  const faces = elevationFaces({ ...snapshot, elevationGroupIds: frame.source.groupId ? [frame.source.groupId] : snapshot.elevationGroupIds });
  const face = faces.find(item => frame.source.facingDegrees == null || item.facingDegrees === frame.source.facingDegrees) ?? faces[0];
  if (!face) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX: 0, minY: 0, maxX: Math.max(face.width, 1), maxY: Math.max(face.height, 1) };
}

function elevationFrame(snapshot: ConstructionSnapshot, frame: DocumentFrame, clip: Rect, view: Box, measure: TextMeasure) {
  const faces = elevationFaces({ ...snapshot, elevationGroupIds: frame.source.groupId ? [frame.source.groupId] : snapshot.elevationGroupIds });
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
  const index = sheets.find(sheet => sheet.frames.some(frame => frame.id === 'index'));
  if (!index) return;
  const frame = index.frames[0]!;
  sheets.forEach((sheet, offset) => {
    if (sheet.index === index.index) return;
    const y = frame.clip.y + 8 + offset * 5;
    if (y > frame.clip.y + frame.clip.height) return;
    frame.paint.push({ op: 'link', x: frame.clip.x, y, width: frame.clip.width, height: 4.5, sheet: sheet.index });
  });
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
      diagnostics: sheet.diagnostics,
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

export function defaultCamera(bounds: Box, preset: CameraPreset = 'orbit'): SavedCamera {
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
