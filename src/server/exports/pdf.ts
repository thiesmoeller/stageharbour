import PDFDocument from 'pdfkit';
import { germanDate, type ConstructionSnapshot } from '../../shared/export.js';

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
    const origin = toPage(0, snapshot.venue.depth);
    doc.rect(origin.x, origin.y, mm(snapshot.venue.width / scale), mm(snapshot.venue.depth / scale)).lineWidth(0.8).stroke('#718469');
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
