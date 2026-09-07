import type { ConstructionSnapshot } from '../../shared/export.js';
import { overheadBoxCorners } from '../../shared/overhead.js';

const mm = (value: number) => value * 72 / 25.4;

export function strokeOverheadFeatures(
  doc: PDFKit.PDFDocument,
  snapshot: ConstructionSnapshot,
  toPage: (x: number, y: number) => { x: number; y: number },
) {
  for (const box of snapshot.venue.overheadBoxes ?? []) {
    const [a, b, c, d] = overheadBoxCorners(box).map(point => toPage(point.x, point.y));
    if (!a || !b || !c || !d) continue;
    doc.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(c.x, c.y).lineTo(d.x, d.y).closePath()
      .lineWidth(0.8).dash(3, { space: 2 }).stroke('#8a6a3a');
    doc.undash();
    const label = toPage(box.x, box.y);
    doc.fontSize(8).fillColor('#395640')
      .text(`${box.label} ${box.bottomHeight} mm`, label.x - mm(14), label.y - mm(2), { lineBreak: false });
  }
  const warnings = snapshot.warnings ?? [];
  if (!warnings.length) return;
  let y = mm(262);
  doc.fontSize(7).fillColor('#6a4e16')
    .text('Geometrische Hinweise ersetzen keine statische Prüfung oder Freigabe.', mm(15), y, { lineBreak: false });
  y += mm(5);
  for (const warning of warnings) {
    doc.text(warning.message, mm(15), y, { width: mm(180), lineBreak: false });
    y += mm(4);
  }
}
