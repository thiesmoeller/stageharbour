import { CONNECTION_COMPATIBILITY_NOTICE } from '../../shared/assembly.js';
import { germanDate, type ConstructionSnapshot } from '../../shared/export.js';
import { resolveExportLayers, type ExportLayers } from '../../shared/exportLayers.js';
import {
  PAGE_FOOTER_MM, PAGE_HEADER_MM, PAGE_MARGIN_MM, PAGE_NOTES_MM, PAPER_SIZE_MM, type PaperSize,
} from '../../shared/tiling.js';

const mm = (value: number) => value * 72 / 25.4;

export type PageRegions = {
  title: { x: number; y: number; width: number; height: number };
  drawing: { x: number; y: number; width: number; height: number };
  notes: { x: number; y: number; width: number; height: number };
  footer: { x: number; y: number; width: number; height: number };
};

export function pageRegions(paper: PaperSize): PageRegions {
  const size = PAPER_SIZE_MM[paper];
  const width = size.width - 2 * PAGE_MARGIN_MM;
  return {
    title: { x: PAGE_MARGIN_MM, y: 10, width, height: PAGE_HEADER_MM - 14 },
    drawing: {
      x: PAGE_MARGIN_MM, y: PAGE_HEADER_MM, width,
      height: size.height - PAGE_HEADER_MM - PAGE_NOTES_MM - PAGE_FOOTER_MM,
    },
    notes: { x: PAGE_MARGIN_MM, y: size.height - PAGE_FOOTER_MM - PAGE_NOTES_MM, width, height: PAGE_NOTES_MM },
    footer: { x: PAGE_MARGIN_MM, y: size.height - PAGE_FOOTER_MM + 4, width, height: PAGE_FOOTER_MM - 4 },
  };
}

export function collectPlanNotes(
  snapshot: ConstructionSnapshot,
  layers: ExportLayers = resolveExportLayers(snapshot.layers),
): string[] {
  if (!layers.warnings) return [];
  const notes: string[] = [];
  if (layers.orientation) notes.push('V Vorderseite · R Rückseite');
  if (snapshot.layout.riggingNotes?.trim()) notes.push(snapshot.layout.riggingNotes.trim());
  if ((snapshot.warnings ?? []).length) {
    notes.push('Geometrische Hinweise ersetzen keine statische Prüfung oder Freigabe.');
  }
  for (const warning of snapshot.warnings ?? []) notes.push(warning.message);
  for (const warning of snapshot.unresolvedWarnings ?? []) notes.push(warning.message);
  notes.push(CONNECTION_COMPATIBILITY_NOTICE);
  return notes;
}

export function strokeTitleBlock(
  doc: PDFKit.PDFDocument,
  snapshot: ConstructionSnapshot,
  opts: { drawingType: string; blatt: string; extra?: string },
) {
  const paper = snapshot.paper ?? 'A4';
  const regions = pageRegions(paper);
  doc.font('Helvetica-Bold').fillColor('#203c36').fontSize(12)
    .text(opts.drawingType, mm(regions.title.x), mm(regions.title.y), {
      width: mm(regions.title.width), lineBreak: false,
    });
  doc.font('Helvetica').fontSize(9)
    .text(`${snapshot.productionName} · ${snapshot.sceneName} · ${snapshot.venueName}`,
      mm(regions.title.x), mm(regions.title.y + 7), {
        width: mm(regions.title.width - 50), lineBreak: false,
      });
  doc.fontSize(8).fillColor('#536950')
    .text(`Fassung ${snapshot.revisionName} · ${germanDate(snapshot.issuedAt)} · Maßstab 1:${snapshot.scale}`,
      mm(regions.title.x), mm(regions.title.y + 14), {
        width: mm(regions.title.width - 50), lineBreak: false,
      });
  doc.fontSize(7).fillColor('#758170')
    .text(`${opts.blatt} · ${paper}${opts.extra ?? ''}`, mm(regions.title.x), mm(regions.title.y + 20), {
      width: mm(regions.title.width), lineBreak: false,
    });
  doc.fontSize(6).fillColor('#9aa396')
    .text(snapshot.revisionId, mm(regions.title.x), mm(regions.title.y + 26), {
      width: mm(regions.title.width), lineBreak: false,
    });
}

export function strokeNotesBand(
  doc: PDFKit.PDFDocument,
  paper: PaperSize,
  notes: string[],
  opts?: { continuation?: boolean },
) {
  const regions = pageRegions(paper);
  let y = regions.notes.y + 2;
  const maxY = regions.notes.y + regions.notes.height - 2;
  const lineHeight = 3.6;
  doc.font('Helvetica').fontSize(7).fillColor('#536950');
  if (opts?.continuation) {
    doc.text('Hinweise (Fortsetzung)', mm(regions.notes.x), mm(y), { lineBreak: false });
    y += lineHeight + 0.5;
  } else {
    doc.font('Helvetica-Bold').text('Hinweise', mm(regions.notes.x), mm(y), { lineBreak: false });
    y += lineHeight + 0.5;
    doc.font('Helvetica');
  }
  const remaining: string[] = [];
  for (const note of notes) {
    if (y + lineHeight > maxY) { remaining.push(note); continue; }
    // Draw without a tight height clamp so long German lines still embed the full string.
    doc.fillColor('#6a4e16').text(note, mm(regions.notes.x), mm(y), {
      width: mm(regions.notes.width), lineBreak: false,
    });
    y += lineHeight;
  }
  return remaining;
}

export function strokeFooter(doc: PDFKit.PDFDocument, paper: PaperSize, blatt: string, scale: number) {
  const regions = pageRegions(paper);
  const barX = regions.footer.x + regions.footer.width - 55;
  const barY = regions.footer.y + 2;
  const modelMm = 1000;
  const barLen = modelMm / scale;
  doc.lineWidth(0.7).strokeColor('#203c36')
    .moveTo(mm(barX), mm(barY)).lineTo(mm(barX + barLen), mm(barY)).stroke();
  doc.moveTo(mm(barX), mm(barY - 1.2)).lineTo(mm(barX), mm(barY + 1.2)).stroke();
  doc.moveTo(mm(barX + barLen), mm(barY - 1.2)).lineTo(mm(barX + barLen), mm(barY + 1.2)).stroke();
  doc.font('Helvetica').fontSize(6).fillColor('#536950')
    .text(`${modelMm} mm`, mm(barX), mm(barY + 1.5), { width: mm(barLen), align: 'center', lineBreak: false });
  doc.fontSize(7).fillColor('#203c36')
    .text(`${blatt} · 100 % drucken`, mm(regions.footer.x), mm(regions.footer.y), { lineBreak: false });
}

export function strokeNotesPages(
  doc: PDFKit.PDFDocument,
  snapshot: ConstructionSnapshot,
  leftover: string[],
  startBlatt: number,
  totalPages: number,
) {
  let notes = leftover;
  let blatt = startBlatt;
  const paper = snapshot.paper ?? 'A4';
  while (notes.length) {
    doc.addPage({ size: paper, margin: 0 });
    strokeTitleBlock(doc, snapshot, {
      drawingType: 'Hinweise',
      blatt: `Blatt ${blatt} von ${totalPages}`,
    });
    notes = strokeNotesBand(doc, paper, notes, { continuation: true });
    strokeFooter(doc, paper, `Blatt ${blatt} von ${totalPages}`, snapshot.scale);
    blatt += 1;
  }
  return blatt;
}

export function notesLinesPerPage(paper: PaperSize) {
  const regions = pageRegions(paper);
  const usable = regions.notes.height - 6;
  return Math.max(1, Math.floor(usable / 3.6));
}

export function estimateNotesPages(notes: string[], paper: PaperSize) {
  if (!notes.length) return 0;
  const linesPerPage = notesLinesPerPage(paper);
  if (notes.length <= linesPerPage) return 0;
  return Math.ceil((notes.length - linesPerPage) / Math.max(1, linesPerPage - 1));
}
