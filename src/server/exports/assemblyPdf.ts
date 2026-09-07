import { assemblyCaption, CONNECTION_COMPATIBILITY_NOTICE } from '../../shared/assembly.js';
import type { ConstructionSnapshot } from '../../shared/export.js';

const mm = (value: number) => value * 72 / 25.4;

export function strokeAssemblyLabels(
  doc: PDFKit.PDFDocument,
  snapshot: ConstructionSnapshot,
  toPage: (x: number, y: number) => { x: number; y: number },
) {
  for (const wall of snapshot.resolvedWalls) {
    const [a, b, c, d] = wall.corners.map(point => toPage(point.x, point.y));
    if (!a || !b || !c || !d) continue;
    const front = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const back = { x: (d.x + c.x) / 2, y: (d.y + c.y) / 2 };
    doc.fontSize(7).fillColor('#395640').text('V', front.x - mm(1.2), front.y - mm(1.5), { lineBreak: false });
    doc.text('R', back.x - mm(1.2), back.y - mm(1.5), { lineBreak: false });
    if (wall.assemblyNumber) {
      doc.fontSize(8).text(assemblyCaption(wall.assemblyNumber, wall.panelLabel), back.x - mm(16), back.y - mm(7), { lineBreak: false });
    }
  }
  doc.fontSize(8).fillColor('#395640').text('V Vorderseite · R Rückseite', mm(15), mm(268), { lineBreak: false });
  if (snapshot.layout.riggingNotes) {
    doc.text(snapshot.layout.riggingNotes, mm(15), mm(274), { lineBreak: false });
  }
  doc.fontSize(7).text(CONNECTION_COMPATIBILITY_NOTICE, mm(15), mm(280), { lineBreak: false });
}
