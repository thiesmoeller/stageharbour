import type { ConstructionSnapshot } from '../../shared/export.js';
import { resolveExportLayers } from '../../shared/exportLayers.js';

const mm = (value: number) => value * 72 / 25.4;

export function strokeBraceFootprints(
  doc: PDFKit.PDFDocument,
  snapshot: ConstructionSnapshot,
  toPage: (x: number, y: number) => { x: number; y: number },
) {
  const layers = resolveExportLayers(snapshot.layers);
  for (const brace of snapshot.resolvedBraces ?? []) {
    for (const slab of brace.slabs ?? []) {
      const points = slab.map(point => toPage(point.x, point.y));
      doc.moveTo(points[0]!.x, points[0]!.y);
      for (const point of points.slice(1)) doc.lineTo(point.x, point.y);
      doc.closePath().lineWidth(0.5).fillAndStroke('#999b96', '#666666');
    }
    const timberCorners = brace.timberCorners ?? brace.corners;
    const [a, b, c, d] = timberCorners.map(point => toPage(point.x, point.y));
    if (!a || !b || !c || !d) continue;
    doc.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(c.x, c.y).lineTo(d.x, d.y).closePath()
      .lineWidth(0.8).fillAndStroke('#e4d3b0', '#8a6a3a');
    const apex = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
    doc.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(apex.x, apex.y).closePath().stroke('#8a6a3a');
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    if (layers.dimensions) {
      const widthMm = Math.hypot(timberCorners[1]!.x - timberCorners[0]!.x, timberCorners[1]!.y - timberCorners[0]!.y);
      const depthMm = Math.hypot(timberCorners[3]!.x - timberCorners[0]!.x, timberCorners[3]!.y - timberCorners[0]!.y);
      doc.fontSize(7).fillColor('#395640')
        .text(`${Math.round(widthMm)} x ${Math.round(depthMm)} mm`, mid.x - mm(12), mid.y - mm(3), { lineBreak: false });
      doc.text(`${Math.round(brace.height)} mm`, mid.x - mm(8), mid.y + mm(2), { lineBreak: false });
    } else if (layers.labels) {
      doc.fontSize(7).fillColor('#395640').text(brace.label, mid.x - mm(8), mid.y - mm(2), { lineBreak: false });
    }
  }
}
