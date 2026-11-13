import type { ConstructionSnapshot } from '../../shared/export.js';
import { resolveExportLayers } from '../../shared/exportLayers.js';
import { stairCorners } from '../../shared/levels.js';

const mm = (value: number) => value * 72 / 25.4;

export function strokeLevelFeatures(
  doc: PDFKit.PDFDocument,
  snapshot: ConstructionSnapshot,
  toPage: (x: number, y: number) => { x: number; y: number },
) {
  const layers = resolveExportLayers(snapshot.layers);
  const platforms = snapshot.venue.platforms ?? [];
  const stairs = snapshot.venue.stairs ?? [];
  for (const platform of platforms) {
    const start = toPage(platform.outline[0]!.x, platform.outline[0]!.y);
    doc.moveTo(start.x, start.y);
    for (const point of platform.outline.slice(1)) {
      const mapped = toPage(point.x, point.y);
      doc.lineTo(mapped.x, mapped.y);
    }
    doc.closePath().lineWidth(0.8).fillAndStroke('#d5decc', '#5a6e52');
    if (layers.labels || layers.dimensions) {
      const label = toPage(
        platform.outline.reduce((sum, point) => sum + point.x, 0) / platform.outline.length,
        platform.outline.reduce((sum, point) => sum + point.y, 0) / platform.outline.length,
      );
      const text = layers.dimensions ? `${platform.label} ${platform.elevation} mm` : platform.label;
      doc.fontSize(7).fillColor('#395640')
        .text(text, label.x - mm(12), label.y - mm(2), { lineBreak: false });
    }
  }
  for (const stair of stairs) {
    const [a, b, c, d] = stairCorners(stair).map(point => toPage(point.x, point.y));
    if (!a || !b || !c || !d) continue;
    doc.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(c.x, c.y).lineTo(d.x, d.y).closePath()
      .lineWidth(0.8).fillAndStroke('#e8efe3', '#718469');
    if (layers.labels) {
      doc.fontSize(7).fillColor('#395640').text(stair.label, (a.x + c.x) / 2 - mm(8), (a.y + c.y) / 2 - mm(2), { lineBreak: false });
    }
  }
}
