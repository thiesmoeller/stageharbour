import PDFDocument from 'pdfkit';
import { germanDate, type ConstructionSnapshot } from '../../shared/export.js';
import { strokeBraceFootprints } from './bracePdf.js';
import { strokeKeepClearZones } from './keepClearPdf.js';
import { strokeLevelFeatures } from './levelPdf.js';
import { strokeAssemblyLabels } from './assemblyPdf.js';
import { strokeOverheadFeatures } from './overheadPdf.js';
import { measuredOutline } from '../../shared/venue.js';

const mm = (value: number) => value * 72 / 25.4;

export function renderConstructionPlan(snapshot: ConstructionSnapshot) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', compress: false, margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const scale = snapshot.scale;
    const toPage = (x: number, y: number) => ({ x: mm(15 + x / scale), y: mm(48 + (snapshot.venue.depth - y) / scale) });
    doc.font('Helvetica').fillColor('#203c36').fontSize(11)
      .text('Konstruktionsplan', mm(15), mm(12), { lineBreak: false });
    doc.fontSize(9).text(`${snapshot.productionName} · ${snapshot.sceneName} · ${snapshot.venueName}`, mm(15), mm(18), { lineBreak: false });
    doc.text(`Fassung ${snapshot.revisionName} · ${snapshot.revisionId} · ${germanDate(snapshot.issuedAt)} · Maßstab 1:${scale}`, mm(15), mm(24), { lineBreak: false });
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
      const start = toPage(corridor.path[0]!.x, corridor.path[0]!.y);
      doc.moveTo(start.x, start.y);
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
    const front = toPage(snapshot.venue.width / 2, 0);
    doc.fontSize(9).fillColor('#395640').text('↑ Publikum · Blick zur Bühne', front.x - mm(30), front.y + mm(6), { lineBreak: false });
    doc.fontSize(8).text(`${snapshot.venue.width} mm`, front.x - mm(10), front.y + mm(12), { lineBreak: false });
    const left = toPage(0, snapshot.venue.depth / 2);
    doc.save().rotate(-90, { origin: [left.x - mm(6), left.y] });
    doc.text(`${snapshot.venue.depth} mm`, left.x - mm(16), left.y - mm(3), { lineBreak: false });
    doc.restore();
    doc.end();
  });
}
