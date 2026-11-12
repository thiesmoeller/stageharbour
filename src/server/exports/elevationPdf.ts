import { ELEVATION_PROJECTION_NOTICE, type ElevationFace } from '../../shared/elevations.js';
import { PAGE_HEADER_MM, PAGE_MARGIN_MM, PAGE_NOTES_MM, PAGE_FOOTER_MM, PAPER_SIZE_MM, type DrawingScale, type PaperSize } from '../../shared/tiling.js';

const mm = (value: number) => value * 72 / 25.4;

function elevationDrawingHeight(paper: PaperSize) {
  return PAPER_SIZE_MM[paper].height - PAGE_HEADER_MM - PAGE_NOTES_MM - PAGE_FOOTER_MM;
}

/** Pack faces onto pages so nothing runs past the drawing band at the chosen scale. */
export function packElevationPages(faces: ElevationFace[], scale: DrawingScale, paper: PaperSize): ElevationFace[][] {
  const maxWidth = PAPER_SIZE_MM[paper].width - 2 * PAGE_MARGIN_MM - 8;
  const maxHeight = elevationDrawingHeight(paper) - 16;
  const pages: ElevationFace[][] = [];
  let current: ElevationFace[] = [];
  let usedHeight = 0;
  for (const face of faces) {
    const faceWidthMm = face.width / scale + 30;
    const faceHeightMm = face.height / scale + 18;
    // One face that is still too wide gets its own page (drawn clipped with notice via scale fit).
    const heightNeeded = Math.min(faceHeightMm, maxHeight);
    if (faceWidthMm > maxWidth + 1) {
      if (current.length) { pages.push(current); current = []; usedHeight = 0; }
      pages.push([face]);
      continue;
    }
    if (current.length && usedHeight + heightNeeded > maxHeight) {
      pages.push(current);
      current = [];
      usedHeight = 0;
    }
    current.push(face);
    usedHeight += heightNeeded;
  }
  if (current.length) pages.push(current);
  return pages;
}

export function strokeElevations(
  doc: PDFKit.PDFDocument, faces: ElevationFace[], scale: DrawingScale, paper: PaperSize = 'A4',
) {
  const maxWidth = PAPER_SIZE_MM[paper].width - 2 * PAGE_MARGIN_MM - 8;
  doc.fontSize(7).fillColor('#395640')
    .text(ELEVATION_PROJECTION_NOTICE, mm(PAGE_MARGIN_MM), mm(PAGE_HEADER_MM - 8), {
      width: mm(maxWidth), lineBreak: false,
    });
  let top = PAGE_HEADER_MM + 4;
  const maxY = PAGE_HEADER_MM + elevationDrawingHeight(paper);
  for (const face of faces) {
    let drawScale: number = scale;
    const rawWidth = face.width / scale + 30;
    if (rawWidth > maxWidth) drawScale = Math.ceil(face.width / (maxWidth - 30));
    doc.fontSize(9).fillColor('#203c36').text(face.label, mm(PAGE_MARGIN_MM), mm(top), { lineBreak: false });
    const originX = PAGE_MARGIN_MM + 22;
    const originY = top + 10 + face.height / drawScale;
    if (originY > maxY) break;
    const toPage = (along: number, up: number) => ({
      x: mm(originX + along / drawScale), y: mm(originY - up / drawScale),
    });
    for (const panel of face.panels) {
      const path = (points: readonly { x: number; y: number }[]) => {
        const [first, ...rest] = points.map(point => toPage(point.x, point.y));
        if (!first) return false;
        doc.moveTo(first.x, first.y);
        for (const point of rest) doc.lineTo(point.x, point.y);
        doc.closePath();
        return true;
      };
      for (const polygon of panel.polygons) {
        if (path(polygon.outline)) doc.fillAndStroke('#e7efe4', '#315d49');
        for (const hole of polygon.holes) if (path(hole)) doc.fillAndStroke('#ffffff', '#315d49');
      }
      for (const opening of panel.openings) {
        const oa = toPage(panel.left + opening.left, opening.sill);
        const ob = toPage(panel.left + opening.left + opening.width, opening.sill);
        const oc = toPage(panel.left + opening.left + opening.width, opening.sill + opening.height);
        doc.fontSize(7).fillColor('#395640')
          .text(`${Math.round(opening.width)} mm`, (oa.x + ob.x) / 2 - mm(6), oa.y + mm(1), { lineBreak: false });
        doc.text(`${Math.round(opening.height)} mm`, oc.x + mm(1), (ob.y + oc.y) / 2 - mm(1.5), { lineBreak: false });
      }
      const a = toPage(panel.left, panel.bottom), b = toPage(panel.left + panel.width, panel.bottom);
      const d = toPage(panel.left, panel.height);
      doc.fontSize(8).fillColor('#395640')
        .text(`${Math.round(panel.width)} mm`, (a.x + b.x) / 2 - mm(8), a.y + mm(2), { lineBreak: false });
      doc.text(`${Math.round(panel.height - panel.bottom)} mm`, d.x - mm(16), (a.y + d.y) / 2 - mm(1.5), { lineBreak: false });
    }
    top = originY + 14;
  }
}
