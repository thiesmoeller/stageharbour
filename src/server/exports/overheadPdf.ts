import type { ConstructionSnapshot } from '../../shared/export.js';
import { overheadBoxCorners } from '../../shared/overhead.js';
import { trussCorners } from '../../shared/truss.js';
import { curtainEndTicks, curtainWavyPoints } from '../../shared/curtains.js';

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
  for (const truss of snapshot.venue.trusses ?? []) {
    const [a, b, c, d] = trussCorners(truss).map(point => toPage(point.x, point.y));
    if (!a || !b || !c || !d) continue;
    doc.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(c.x, c.y).lineTo(d.x, d.y).closePath()
      .lineWidth(0.9).dash(2, { space: 2 }).stroke('#4f86ba');
    doc.undash();
    const label = toPage(truss.x, truss.y);
    doc.fontSize(8).fillColor('#2f5f8a')
      .text(`${truss.label} ${truss.bottomHeight} mm`, label.x - mm(14), label.y - mm(2), { lineBreak: false });
  }
  for (const curtain of snapshot.venue.curtains ?? []) {
    for (const wave of curtainWavyPoints(curtain)) {
      const points = wave.map(point => toPage(point.x, point.y));
      const first = points[0];
      if (!first) continue;
      doc.moveTo(first.x, first.y);
      for (const point of points.slice(1)) doc.lineTo(point.x, point.y);
      doc.lineWidth(1.1).undash().stroke('#1a1a1a');
    }
    for (const tick of curtainEndTicks(curtain)) {
      const a = toPage(tick.a.x, tick.a.y), b = toPage(tick.b.x, tick.b.y);
      doc.moveTo(a.x, a.y).lineTo(b.x, b.y).lineWidth(0.9).stroke('#1a1a1a');
    }
    const label = toPage(curtain.x, curtain.y);
    doc.fontSize(8).fillColor('#1a1a1a')
      .text(`${curtain.label} ${curtain.height} mm`, label.x - mm(14), label.y - mm(3), { lineBreak: false });
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
