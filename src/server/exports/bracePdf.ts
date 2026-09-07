import type { ConstructionSnapshot } from '../../shared/export.js';

const mm = (value: number) => value * 72 / 25.4;

export function strokeBraceFootprints(
  doc: PDFKit.PDFDocument,
  snapshot: ConstructionSnapshot,
  toPage: (x: number, y: number) => { x: number; y: number },
) {
  for (const brace of snapshot.resolvedBraces ?? []) {
    const [a, b, c, d] = brace.corners.map(point => toPage(point.x, point.y));
    if (!a || !b || !c || !d) continue;
    doc.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(c.x, c.y).lineTo(d.x, d.y).closePath()
      .lineWidth(0.8).fillAndStroke('#e4d3b0', '#8a6a3a');
    const apex = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
    doc.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(apex.x, apex.y).closePath().stroke('#8a6a3a');
    const widthMm = Math.hypot(brace.corners[1]!.x - brace.corners[0]!.x, brace.corners[1]!.y - brace.corners[0]!.y);
    const depthMm = Math.hypot(brace.corners[3]!.x - brace.corners[0]!.x, brace.corners[3]!.y - brace.corners[0]!.y);
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    doc.fontSize(8).fillColor('#395640')
      .text(`${Math.round(widthMm)} x ${Math.round(depthMm)} mm`, mid.x - mm(12), mid.y - mm(3), { lineBreak: false });
    doc.text(`${Math.round(brace.height)} mm`, mid.x - mm(8), mid.y + mm(2), { lineBreak: false });
  }
}
