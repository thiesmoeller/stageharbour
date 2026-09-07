import PDFDocument from 'pdfkit';
import { germanDate, type ConstructionSnapshot } from '../../shared/export.js';
import { elevationFaces } from '../../shared/elevations.js';
import {
  boundsOverlapTile, drawingAreaMm, PAGE_FOOTER_MM, PAGE_HEADER_MM, PAGE_MARGIN_MM, PAGE_OVERLAP_MM,
  PAPER_SIZE_MM, planTiles, REGISTRATION_MARK_MM, type PlanTile,
} from '../../shared/tiling.js';
import { strokeBraceFootprints } from './bracePdf.js';
import { strokeKeepClearZones } from './keepClearPdf.js';
import { strokeLevelFeatures } from './levelPdf.js';
import { strokeAssemblyLabels } from './assemblyPdf.js';
import { strokeElevations } from './elevationPdf.js';
import { strokeOverheadFeatures } from './overheadPdf.js';
import { strokePlaceholders } from './placeholderPdf.js';
import { measuredOutline } from '../../shared/venue.js';
import { centrelineSpan } from '../../shared/snapping.js';

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
    resolvedWalls: snapshot.resolvedWalls.filter(wall => hit(wall.corners)),
    resolvedBraces: (snapshot.resolvedBraces ?? []).filter(brace => hit(brace.corners)),
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
  strokeLevelFeatures(doc, snapshot, toPage);
  for (const wall of snapshot.resolvedWalls) {
    const [a, b, c, d] = wall.corners.map(point => toPage(point.x, point.y));
    if (!a || !b || !c || !d) continue;
    doc.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(c.x, c.y).lineTo(d.x, d.y).closePath().fillAndStroke('#315d49', '#315d49');
    for (const opening of wall.openings ?? []) {
      const [oa, ob, oc, od] = opening.corners.map(point => toPage(point.x, point.y));
      if (!oa || !ob || !oc || !od) continue;
      doc.moveTo(oa.x, oa.y).lineTo(ob.x, ob.y).lineTo(oc.x, oc.y).lineTo(od.x, od.y).closePath().fillAndStroke('#ffffff', '#315d49');
    }
    const widthMm = Math.hypot(wall.corners[1]!.x - wall.corners[0]!.x, wall.corners[1]!.y - wall.corners[0]!.y);
    doc.fontSize(8).fillColor('#395640').text(`${Math.round(widthMm)} mm`, (a.x + b.x) / 2 - mm(8), (a.y + b.y) / 2 - mm(4), { lineBreak: false });
  }
  strokeBraceFootprints(doc, snapshot, toPage);
  strokePlaceholders(doc, snapshot, toPage);
  strokeAssemblyLabels(doc, snapshot, toPage);
  strokeOverheadFeatures(doc, snapshot, toPage);
  strokeKeepClearZones(doc, snapshot, toPage);
  const outline = measuredOutline(snapshot.venue);
  const start = toPage(outline[0]!.x, outline[0]!.y);
  doc.moveTo(start.x, start.y);
  for (const point of outline.slice(1)) {
    const mapped = toPage(point.x, point.y);
    doc.lineTo(mapped.x, mapped.y);
  }
  doc.closePath().lineWidth(0.8).stroke('#718469');
  for (const corridor of snapshot.venue.cableRoutingCorridors ?? []) {
    const corridorStart = toPage(corridor.path[0]!.x, corridor.path[0]!.y);
    doc.moveTo(corridorStart.x, corridorStart.y);
    for (const point of corridor.path.slice(1)) {
      const mapped = toPage(point.x, point.y);
      doc.lineTo(mapped.x, mapped.y);
    }
    doc.lineWidth(0.6).dash(2, { space: 2 }).stroke('#5a6e8a');
    doc.undash();
    const mid = corridor.path[Math.floor(corridor.path.length / 2)] ?? corridor.path[0]!;
    const label = toPage(mid.x, mid.y);
    doc.fontSize(7).fillColor('#395640').text(corridor.label, label.x + mm(2), label.y - mm(2), { lineBreak: false });
  }
  for (const pin of snapshot.venue.connectionPoints ?? []) {
    const at = toPage(pin.x, pin.y);
    doc.circle(at.x, at.y, mm(1.5)).lineWidth(0.6).fillAndStroke('#d9c6a1', '#986122');
    doc.fontSize(7).fillColor('#395640').text(pin.label, at.x + mm(2), at.y - mm(2), { lineBreak: false });
  }
  if (snapshot.venue.stageCentreline) {
    const span = centrelineSpan(snapshot.venue.stageCentreline, Math.hypot(snapshot.venue.width, snapshot.venue.depth));
    const centreStart = toPage(span.a.x, span.a.y), end = toPage(span.b.x, span.b.y);
    doc.moveTo(centreStart.x, centreStart.y).lineTo(end.x, end.y).lineWidth(0.6).dash(3, { space: 2 }).stroke('#986122');
    doc.undash();
    const label = toPage(snapshot.venue.stageCentreline.x, snapshot.venue.stageCentreline.y);
    doc.fontSize(7).fillColor('#395640').text('Mittellinie', label.x + mm(2), label.y - mm(2), { lineBreak: false });
  }
  const front = toPage(snapshot.venue.width / 2, 0);
  doc.fontSize(9).fillColor('#395640').text('↑ Publikum · Blick zur Bühne', front.x - mm(30), front.y + mm(6), { lineBreak: false });
  doc.fontSize(8).text(`${snapshot.venue.width} mm`, front.x - mm(10), front.y + mm(12), { lineBreak: false });
  const left = toPage(0, snapshot.venue.depth / 2);
  doc.save().rotate(-90, { origin: [left.x - mm(6), left.y] });
  doc.text(`${snapshot.venue.depth} mm`, left.x - mm(16), left.y - mm(3), { lineBreak: false });
  doc.restore();
}

export function renderConstructionPlan(snapshot: ConstructionSnapshot) {
  return new Promise<Buffer>((resolve, reject) => {
    const paper = snapshot.paper ?? 'A4';
    const scale = snapshot.scale;
    const tiles = planTiles(snapshot.venue, paper, scale);
    const faces = elevationFaces(snapshot);
    const elevationByGroup = [...new Set(faces.map(face => face.groupId))]
      .map(groupId => faces.filter(face => face.groupId === groupId));
    const totalPages = tiles.length + elevationByGroup.length;
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
    function header(title: string, blatt: string, extra = '') {
      doc.font('Helvetica').fillColor('#203c36').fontSize(11)
        .text(title, mm(15), mm(12), { lineBreak: false });
      doc.fontSize(9).text(`${snapshot.productionName} · ${snapshot.sceneName} · ${snapshot.venueName}`, mm(15), mm(18), { lineBreak: false });
      doc.text(`Fassung ${snapshot.revisionName} · ${snapshot.revisionId} · ${germanDate(snapshot.issuedAt)} · Maßstab 1:${scale}`, mm(15), mm(24), { lineBreak: false });
      doc.fontSize(8).text(`${blatt} · ${paper}${extra}`, mm(15), mm(30), { lineBreak: false });
    }
    for (const [offset, tile] of tiles.entries()) {
      if (offset > 0) doc.addPage({ size: paper, margin: 0 });
      const tiled = tiles.length > 1;
      const overlap = tiled ? ` · Überlappung ${PAGE_OVERLAP_MM} mm` : '';
      header('Konstruktionsplan', `Blatt ${tile.index} von ${totalPages}`, ` · ↑ Publikum${overlap}`);
      const toPage = (x: number, y: number) => ({
        x: mm(PAGE_MARGIN_MM + (x - tile.modelX) / scale),
        y: mm(PAGE_HEADER_MM + (tile.modelYTop - y) / scale),
      });
      doc.save();
      doc.rect(mm(PAGE_MARGIN_MM), mm(PAGE_HEADER_MM), mm(area.width), mm(area.height)).clip();
      strokePlan(doc, forTile(snapshot, tile), toPage);
      doc.restore();
      strokeRegistration(doc, tile, area);
      doc.fontSize(8).fillColor('#203c36')
        .text(`Blatt ${tile.index} von ${totalPages}`, mm(PAGE_MARGIN_MM), mm(PAPER_SIZE_MM[paper].height - PAGE_FOOTER_MM + 4), { lineBreak: false });
    }
    for (const [offset, groupFaces] of elevationByGroup.entries()) {
      doc.addPage({ size: paper, margin: 0 });
      const index = tiles.length + offset + 1;
      header('Frontansicht', `Blatt ${index} von ${totalPages}`);
      strokeElevations(doc, groupFaces, scale);
      doc.fontSize(8).fillColor('#203c36')
        .text(`Blatt ${index} von ${totalPages}`, mm(PAGE_MARGIN_MM), mm(PAPER_SIZE_MM[paper].height - PAGE_FOOTER_MM + 4), { lineBreak: false });
    }
    doc.end();
  });
}
