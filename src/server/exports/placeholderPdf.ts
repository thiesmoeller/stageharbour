import type { ConstructionSnapshot } from '../../shared/export.js';
import { resolveExportLayers } from '../../shared/exportLayers.js';

const mm = (value: number) => value * 72 / 25.4;

export function strokePlaceholders(
  doc: PDFKit.PDFDocument,
  snapshot: ConstructionSnapshot,
  toPage: (x: number, y: number) => { x: number; y: number },
) {
  const layers = resolveExportLayers(snapshot.layers);
  for (const item of snapshot.resolvedPlaceholders ?? []) {
    const [a, b, c, d] = item.corners.map(point => toPage(point.x, point.y));
    if (!a || !b || !c || !d) continue;
    doc.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(c.x, c.y).lineTo(d.x, d.y).closePath()
      .lineWidth(0.6).fillAndStroke('#d5decc', '#5a6e52');
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    if (layers.labels) {
      doc.fontSize(7).fillColor('#395640').text(item.label, mid.x - mm(8), mid.y - mm(3), { lineBreak: false });
    }
    if (layers.dimensions) {
      doc.fontSize(7).fillColor('#395640')
        .text(`${Math.round(item.width)} x ${Math.round(item.depth)} mm`, mid.x - mm(12), mid.y + mm(1), { lineBreak: false });
    }
  }
}
