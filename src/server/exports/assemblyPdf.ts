import type { ConstructionSnapshot } from '../../shared/export.js';
import { resolveExportLayers } from '../../shared/exportLayers.js';
import { assemblyCaption } from '../../shared/assembly.js';

const mm = (value: number) => value * 72 / 25.4;

/** Geometry-only assembly marks; notes live in the page notes band. */
export function strokeAssemblyLabels(
  doc: PDFKit.PDFDocument,
  snapshot: ConstructionSnapshot,
  toPage: (x: number, y: number) => { x: number; y: number },
) {
  const layers = resolveExportLayers(snapshot.layers);
  for (const wall of snapshot.resolvedWalls) {
    const [a, b, c, d] = wall.corners.map(point => toPage(point.x, point.y));
    if (!a || !b || !c || !d) continue;
    const front = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const back = { x: (d.x + c.x) / 2, y: (d.y + c.y) / 2 };
    if (layers.orientation) {
      doc.fontSize(6).fillColor('#395640').text('V', front.x - mm(1), front.y - mm(1.2), { lineBreak: false });
      doc.text('R', back.x - mm(1), back.y - mm(1.2), { lineBreak: false });
    }
    if (layers.labels && wall.assemblyNumber) {
      doc.fontSize(7).fillColor('#203c36')
        .text(assemblyCaption(wall.assemblyNumber, wall.panelLabel), back.x - mm(16), back.y - mm(5), { lineBreak: false });
    }
  }
}
