/** ISO 216 millimetre paper sizes used for construction-plan PDFs. */
export const PAPER_SIZE_MM = { A4: { width: 210, height: 297 }, A3: { width: 297, height: 420 } } as const;
export type PaperSize = keyof typeof PAPER_SIZE_MM;
/** 1:25 detail, 1:50 default construction (1200 mm → 24 mm on A4), 1:100 overview. */
export const DRAWING_SCALES = [25, 50, 100] as const;
export type DrawingScale = (typeof DRAWING_SCALES)[number];
export const PAGE_MARGIN_MM = 15;
/** Drawing origin matches the original A4 1:50 header band. */
export const PAGE_HEADER_MM = 42;
/** Reserved band below the drawing for legends and warnings (outside the clip). */
export const PAGE_NOTES_MM = 38;
export const PAGE_FOOTER_MM = 14;
/** Shared printed band between adjacent tiles, in page millimetres. */
export const PAGE_OVERLAP_MM = 20;
export const REGISTRATION_MARK_MM = 5;

export function drawingAreaMm(paper: PaperSize) {
  const size = PAPER_SIZE_MM[paper];
  return {
    width: size.width - 2 * PAGE_MARGIN_MM,
    height: size.height - PAGE_HEADER_MM - PAGE_NOTES_MM - PAGE_FOOTER_MM,
  };
}

export type PlanTile = {
  index: number; column: number; row: number; columns: number; rows: number;
  modelX: number; modelYTop: number; modelWidth: number; modelHeight: number;
};

function tileCount(drawnMm: number, availableMm: number) {
  if (drawnMm <= availableMm) return 1;
  return Math.ceil((drawnMm - PAGE_OVERLAP_MM) / (availableMm - PAGE_OVERLAP_MM));
}

export function planTiles(venue: { width: number; depth: number }, paper: PaperSize, scale: DrawingScale): PlanTile[] {
  const area = drawingAreaMm(paper);
  const columns = tileCount(venue.width / scale, area.width);
  const rows = tileCount(venue.depth / scale, area.height);
  const stepX = (area.width - (columns > 1 ? PAGE_OVERLAP_MM : 0)) * scale;
  const stepY = (area.height - (rows > 1 ? PAGE_OVERLAP_MM : 0)) * scale;
  const modelWidth = area.width * scale, modelHeight = area.height * scale;
  const tiles: PlanTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      tiles.push({
        index: tiles.length + 1, column, row, columns, rows,
        modelX: column * stepX, modelYTop: venue.depth - row * stepY, modelWidth, modelHeight,
      });
    }
  }
  return tiles;
}

export function boundsOverlapTile(
  minX: number, minY: number, maxX: number, maxY: number, tile: PlanTile,
) {
  return minX < tile.modelX + tile.modelWidth && maxX > tile.modelX
    && minY < tile.modelYTop && maxY > tile.modelYTop - tile.modelHeight;
}
