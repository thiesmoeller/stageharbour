import type { ConstructionSnapshot } from '../../shared/export.js';

const mm = (value: number) => value * 72 / 25.4;

export function strokeKeepClearZones(
  doc: PDFKit.PDFDocument,
  snapshot: ConstructionSnapshot,
  toPage: (x: number, y: number) => { x: number; y: number },
) {
  for (const zone of snapshot.venue.keepClearZones ?? []) {
    const start = toPage(zone.polygon[0]!.x, zone.polygon[0]!.y);
    doc.moveTo(start.x, start.y);
    for (const point of zone.polygon.slice(1)) {
      const mapped = toPage(point.x, point.y);
      doc.lineTo(mapped.x, mapped.y);
    }
    doc.closePath().lineWidth(0.6).dash(3, { space: 2 }).stroke('#b67c35');
    doc.undash();
    const label = toPage(
      zone.polygon.reduce((sum, point) => sum + point.x, 0) / zone.polygon.length,
      zone.polygon.reduce((sum, point) => sum + point.y, 0) / zone.polygon.length,
    );
    doc.fontSize(7).fillColor('#986122').text(zone.label, label.x - mm(10), label.y - mm(2), { lineBreak: false });
  }
  for (const [index, warning] of (snapshot.unresolvedWarnings ?? []).entries()) {
    doc.fontSize(7).fillColor('#6a4e16').text(warning.message, mm(15), mm(272 + index * 4), { lineBreak: false });
  }
}
