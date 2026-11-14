import type { ConstructionSnapshot } from '../../shared/export.js';
import { resolveExportLayers } from '../../shared/exportLayers.js';
import { assemblyCaption } from '../../shared/assembly.js';
import { resolveFrozen } from '../../shared/frozenParts.js';
import { planFigure, planSymbol, type PlanStrokeKind } from '../../shared/partDrawings.js';
import type { Vec2 } from '../../shared/parts/math.js';

const mm = (value: number) => value * 72 / 25.4;

const STYLES: Record<PlanStrokeKind, { stroke: string; fill?: string; width: number; dash?: boolean }> = {
  solid: { stroke: '#315d49', fill: '#c9d6c3', width: 0.5 },
  step: { stroke: '#315d49', width: 0.4 },
  opening: { stroke: '#315d49', fill: '#ffffff', width: 0.4 },
  leaf: { stroke: '#243f34', width: 0.6 },
  swing: { stroke: '#718469', width: 0.3, dash: true },
};

/** Plan symbols of the frozen parts with their assembly number and stock label. */
export function strokePartSymbols(
  doc: PDFKit.PDFDocument,
  snapshot: ConstructionSnapshot,
  toPage: (x: number, y: number) => { x: number; y: number },
) {
  const layers = resolveExportLayers(snapshot.layers);
  const resolved = resolveFrozen(snapshot);
  const stockLabels = new Map(snapshot.stock.items.map(item => [item.id, item.label]));
  const path = (points: readonly Vec2[], closed: boolean) => {
    const [first, ...rest] = points.map(point => toPage(point.x, point.y));
    if (!first) return false;
    doc.moveTo(first.x, first.y);
    for (const point of rest) doc.lineTo(point.x, point.y);
    if (closed) doc.closePath();
    return true;
  };
  const symbols = resolved.objects.map(item => ({ item, symbol: planSymbol(item) }))
    .sort((a, b) => a.symbol.elevation - b.symbol.elevation);
  for (const { item, symbol } of symbols) {
    const figure = planFigure(item);
    if (path(figure.fill, true)) doc.lineWidth(0.5).fillAndStroke('#dfe7d8', '#4b5d42');
    for (const opening of figure.openings) {
      if (!path(opening, true)) continue;
      doc.lineWidth(0.4).fillAndStroke('#ffffff', '#4b5d42');
    }
    for (const frame of figure.frames) {
      if (!path(frame, true)) continue;
      doc.lineWidth(0.4).fillAndStroke('#e7e0d2', '#6d6456');
    }
    for (const leaf of figure.leaves) {
      if (leaf.slab.length >= 3 && path(leaf.slab, true)) doc.lineWidth(0.4).fillAndStroke('#c8c4b8', '#6d6456');
      if (leaf.arc.length > 1 && path(leaf.arc, false)) doc.lineWidth(0.3).dash(1, { space: 1 }).stroke('#718469').undash();
    }
    for (const stroke of symbol.strokes) {
      if ((figure.leaves.length || figure.openings.length) && (stroke.kind === 'opening' || stroke.kind === 'leaf' || stroke.kind === 'swing')) continue;
      const style = STYLES[stroke.kind];
      if (!path(stroke.points, stroke.closed)) continue;
      doc.lineWidth(style.width);
      if (style.dash) doc.dash(1, { space: 1 });
      if (style.fill && stroke.closed) doc.fillAndStroke(style.fill, style.stroke);
      else doc.stroke(style.stroke);
      doc.undash();
    }
    const centre = toPage(symbol.centre.x, symbol.centre.y);
    const number = resolved.assembly.numbers.get(item.object.id);
    const stockLabel = item.object.stockItemId ? stockLabels.get(item.object.stockItemId) : undefined;
    if (layers.labels) {
      const caption = number !== undefined ? assemblyCaption(number, stockLabel) : stockLabel ? `${item.object.label} · ${stockLabel}` : item.object.label;
      doc.fontSize(7).fillColor('#203c36').text(caption, centre.x - mm(12), centre.y - mm(1.5), { lineBreak: false });
    }
    if (layers.dimensions) {
      const { min, max } = item.resolved.bounds;
      doc.fontSize(6).fillColor('#395640')
        .text(`${Math.round(max.x - min.x)} × ${Math.round(max.z - min.z)} mm`, centre.x - mm(10), centre.y + mm(1.5), { lineBreak: false });
    }
  }
}
