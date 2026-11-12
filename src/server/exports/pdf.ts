import PDFDocument from 'pdfkit';
import { type ConstructionSnapshot } from '../../shared/export.js';
import { elevationFaces } from '../../shared/elevations.js';
import { resolveExportLayers } from '../../shared/exportLayers.js';
import {
  boundsOverlapTile, drawingAreaMm, PAGE_HEADER_MM, PAGE_MARGIN_MM, PAGE_OVERLAP_MM,
  planTiles, REGISTRATION_MARK_MM, type PlanTile,
} from '../../shared/tiling.js';
import { strokeKeepClearZones } from './keepClearPdf.js';
import { strokeLevelFeatures } from './levelPdf.js';
import { strokePartSymbols } from './partPdf.js';
import { packElevationPages, strokeElevations } from './elevationPdf.js';
import { strokeOverheadFeatures } from './overheadPdf.js';
import { strokePlaceholders } from './placeholderPdf.js';
import {
  collectPlanNotes, estimateNotesPages, strokeFooter, strokeNotesBand, strokeNotesPages, strokeTitleBlock,
} from './pageLayout.js';
import { measuredOutline } from '../../shared/venue.js';
import { centrelineSpan } from '../../shared/snapping.js';
import { wallCorners } from '../../shared/layout.js';
import { resolveWall } from '../../shared/wall-types.js';

const mm = (value: number) => value * 72 / 25.4;

function cornerBounds(corners: readonly { x: number; y: number }[]) {
  return {
    minX: Math.min(...corners.map(point => point.x)), maxX: Math.max(...corners.map(point => point.x)),
    minY: Math.min(...corners.map(point => point.y)), maxY: Math.max(...corners.map(point => point.y)),
  };
}

function forTile(snapshot: ConstructionSnapshot, tile: PlanTile): ConstructionSnapshot {
  const hit = (corners: readonly { x: number; y: number }[]) => {
    const box = cornerBounds(corners);
    return boundsOverlapTile(box.minX, box.minY, box.maxX, box.maxY, tile);
  };
  return {
    ...snapshot,
    resolvedPlaceholders: (snapshot.resolvedPlaceholders ?? []).filter(item => hit(item.corners)),
  };
}

function strokeRegistration(doc: PDFKit.PDFDocument, tile: PlanTile, area: { width: number; height: number }) {
  const arm = mm(REGISTRATION_MARK_MM);
  const corners = [
    [PAGE_MARGIN_MM, PAGE_HEADER_MM, -1, -1],
    [PAGE_MARGIN_MM + area.width, PAGE_HEADER_MM, 1, -1],
    [PAGE_MARGIN_MM, PAGE_HEADER_MM + area.height, -1, 1],
    [PAGE_MARGIN_MM + area.width, PAGE_HEADER_MM + area.height, 1, 1],
  ] as const;
  doc.lineWidth(0.6).strokeColor('#203c36');
  for (const [xMm, yMm, dx, dy] of corners) {
    const x = mm(xMm), y = mm(yMm);
    doc.moveTo(x, y).lineTo(x + dx * arm, y).stroke();
    doc.moveTo(x, y).lineTo(x, y + dy * arm).stroke();
  }
  if (tile.column < tile.columns - 1) {
    const x = mm(PAGE_MARGIN_MM + area.width - PAGE_OVERLAP_MM);
    doc.moveTo(x, mm(PAGE_HEADER_MM)).lineTo(x, mm(PAGE_HEADER_MM + area.height)).lineWidth(0.4).dash(2, { space: 2 }).stroke('#718469');
    doc.undash();
  }
  if (tile.row < tile.rows - 1) {
    const y = mm(PAGE_HEADER_MM + area.height - PAGE_OVERLAP_MM);
    doc.moveTo(mm(PAGE_MARGIN_MM), y).lineTo(mm(PAGE_MARGIN_MM + area.width), y).lineWidth(0.4).dash(2, { space: 2 }).stroke('#718469');
    doc.undash();
  }
}

function strokePlan(
  doc: PDFKit.PDFDocument, snapshot: ConstructionSnapshot, toPage: (x: number, y: number) => { x: number; y: number },
) {
  const layers = resolveExportLayers(snapshot.layers);
  if (layers.venueContext) strokeLevelFeatures(doc, snapshot, toPage);
  if (layers.venueContext) {
    for (const wall of snapshot.venue.walls ?? []) {
      const [first, ...rest] = wallCorners(resolveWall(wall, snapshot.venue.wallTypes ?? [])).map(p => toPage(p.x, p.y));
      if (!first) continue;
      doc.moveTo(first.x, first.y);
      for (const point of rest) doc.lineTo(point.x, point.y);
      doc.closePath().fillAndStroke('#8b8478', '#625b50');
    }
  }
  if (layers.scenery) {
    strokePartSymbols(doc, snapshot, toPage);
    strokePlaceholders(doc, snapshot, toPage);
  }
  strokeOverheadFeatures(doc, snapshot, toPage);
  strokeKeepClearZones(doc, snapshot, toPage);
  if (layers.venueContext) {
    const outline = measuredOutline(snapshot.venue);
    const start = toPage(outline[0]!.x, outline[0]!.y);
    doc.moveTo(start.x, start.y);
    for (const point of outline.slice(1)) {
      const mapped = toPage(point.x, point.y);
      doc.lineTo(mapped.x, mapped.y);
    }
    doc.closePath().lineWidth(0.8).stroke('#718469');
  }
  if (layers.infrastructure) {
    for (const corridor of snapshot.venue.cableRoutingCorridors ?? []) {
      const corridorStart = toPage(corridor.path[0]!.x, corridor.path[0]!.y);
      doc.moveTo(corridorStart.x, corridorStart.y);
      for (const point of corridor.path.slice(1)) {
        const mapped = toPage(point.x, point.y);
        doc.lineTo(mapped.x, mapped.y);
      }
      doc.lineWidth(0.6).dash(2, { space: 2 }).stroke('#5a6e8a');
      doc.undash();
      if (layers.labels) {
        const mid = corridor.path[Math.floor(corridor.path.length / 2)] ?? corridor.path[0]!;
        const label = toPage(mid.x, mid.y);
        doc.fontSize(7).fillColor('#395640').text(corridor.label, label.x + mm(2), label.y - mm(2), { lineBreak: false });
      }
    }
    for (const pin of snapshot.venue.connectionPoints ?? []) {
      const at = toPage(pin.x, pin.y);
      doc.circle(at.x, at.y, mm(1.5)).lineWidth(0.6).fillAndStroke('#d9c6a1', '#986122');
      if (layers.labels) {
        doc.fontSize(7).fillColor('#395640').text(pin.label, at.x + mm(2), at.y - mm(2), { lineBreak: false });
      }
    }
  }
  if (layers.cables) {
    for (const run of snapshot.layout.cableRuns ?? []) {
      const start = toPage(run.path[0]!.x, run.path[0]!.y);
      doc.moveTo(start.x, start.y);
      for (const point of run.path.slice(1)) {
        const mapped = toPage(point.x, point.y);
        doc.lineTo(mapped.x, mapped.y);
      }
      doc.lineWidth(1).undash().stroke('#9b3f64');
      if (layers.labels) {
        const mid = run.path[Math.floor(run.path.length / 2)] ?? run.path[0]!;
        const label = toPage(mid.x, mid.y);
        doc.fontSize(7).fillColor('#9b3f64').text(`${run.label} · ${run.quantity}x ${run.cableType}`, label.x + mm(2), label.y - mm(2), { lineBreak: false });
      }
    }
  }
  if (layers.orientation && snapshot.venue.stageCentreline) {
    const span = centrelineSpan(snapshot.venue.stageCentreline, Math.hypot(snapshot.venue.width, snapshot.venue.depth));
    const centreStart = toPage(span.a.x, span.a.y), end = toPage(span.b.x, span.b.y);
    doc.moveTo(centreStart.x, centreStart.y).lineTo(end.x, end.y).lineWidth(0.6).dash(3, { space: 2 }).stroke('#986122');
    doc.undash();
    if (layers.labels) {
      const label = toPage(snapshot.venue.stageCentreline.x, snapshot.venue.stageCentreline.y);
      doc.fontSize(7).fillColor('#395640').text('Mittellinie', label.x + mm(2), label.y - mm(2), { lineBreak: false });
    }
  }
  if (layers.orientation) {
    const front = toPage(snapshot.venue.width / 2, 0);
    doc.fontSize(8).fillColor('#395640')
      .text('Publikum (Blick zur Buehne)', front.x - mm(28), front.y + mm(4), { lineBreak: false });
    // Simple vector arrow toward +y (upstage) from audience
    doc.moveTo(front.x, front.y + mm(2)).lineTo(front.x, front.y - mm(4))
      .lineTo(front.x - mm(1.5), front.y - mm(2)).moveTo(front.x, front.y - mm(4))
      .lineTo(front.x + mm(1.5), front.y - mm(2)).lineWidth(0.7).stroke('#395640');
  }
  if (layers.dimensions && layers.venueContext) {
    const front = toPage(snapshot.venue.width / 2, 0);
    doc.fontSize(7).fillColor('#395640')
      .text(`${snapshot.venue.width} mm`, front.x - mm(8), front.y + mm(10), { lineBreak: false });
    const left = toPage(0, snapshot.venue.depth / 2);
    doc.save().rotate(-90, { origin: [left.x - mm(6), left.y] });
    doc.text(`${snapshot.venue.depth} mm`, left.x - mm(14), left.y - mm(3), { lineBreak: false });
    doc.restore();
  }
}

export function constructionPageBreakdown(snapshot: ConstructionSnapshot) {
  const paper = snapshot.paper ?? 'A4';
  const scale = snapshot.scale;
  const tiles = planTiles(snapshot.venue, paper, scale);
  const faces = elevationFaces(snapshot);
  const elevationPages = packElevationPages(faces, scale, paper);
  const notes = collectPlanNotes(snapshot);
  const notesPages = estimateNotesPages(notes, paper);
  const planPages = tiles.length;
  const elevationCount = elevationPages.length;
  return {
    pageCount: Math.max(1, planPages + elevationCount + notesPages),
    planPages,
    elevationPages: elevationCount,
    notesPages,
    tiles: tiles.length,
  };
}

export function renderConstructionPlan(snapshot: ConstructionSnapshot) {
  return new Promise<Buffer>((resolve, reject) => {
    const paper = snapshot.paper ?? 'A4';
    const scale = snapshot.scale;
    const tiles = planTiles(snapshot.venue, paper, scale);
    const faces = elevationFaces(snapshot);
    const elevationPages = packElevationPages(faces, scale, paper);
    const notes = collectPlanNotes(snapshot);
    const notesExtra = estimateNotesPages(notes, paper);
    const totalPages = tiles.length + elevationPages.length + notesExtra;
    const area = drawingAreaMm(paper);
    const issuedAt = new Date(snapshot.issuedAt);
    const doc = new PDFDocument({
      size: paper, compress: false, margin: 0,
      info: { Title: 'Konstruktionsplan', CreationDate: issuedAt, ModDate: issuedAt },
    });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    let leftoverNotes = notes;
    for (const [offset, tile] of tiles.entries()) {
      if (offset > 0) doc.addPage({ size: paper, margin: 0 });
      const tiled = tiles.length > 1;
      const overlap = tiled ? ` · Überlappung ${PAGE_OVERLAP_MM} mm` : '';
      const blatt = `Blatt ${tile.index} von ${totalPages}`;
      strokeTitleBlock(doc, snapshot, {
        drawingType: 'Konstruktionsplan',
        blatt,
        extra: ` · Publikum unten${overlap}`,
      });
      const toPage = (x: number, y: number) => ({
        x: mm(PAGE_MARGIN_MM + (x - tile.modelX) / scale),
        y: mm(PAGE_HEADER_MM + (tile.modelYTop - y) / scale),
      });
      doc.save();
      doc.rect(mm(PAGE_MARGIN_MM), mm(PAGE_HEADER_MM), mm(area.width), mm(area.height)).clip();
      strokePlan(doc, forTile(snapshot, tile), toPage);
      doc.restore();
      strokeRegistration(doc, tile, area);
      if (offset === 0) leftoverNotes = strokeNotesBand(doc, paper, leftoverNotes);
      else strokeNotesBand(doc, paper, []);
      strokeFooter(doc, paper, blatt, scale);
    }
    for (const [offset, groupFaces] of elevationPages.entries()) {
      doc.addPage({ size: paper, margin: 0 });
      const index = tiles.length + offset + 1;
      const blatt = `Blatt ${index} von ${totalPages}`;
      strokeTitleBlock(doc, snapshot, { drawingType: 'Frontansicht', blatt });
      strokeElevations(doc, groupFaces, scale, paper);
      strokeNotesBand(doc, paper, []);
      strokeFooter(doc, paper, blatt, scale);
    }
    strokeNotesPages(doc, snapshot, leftoverNotes, tiles.length + elevationPages.length + 1, totalPages);
    doc.end();
  });
}
