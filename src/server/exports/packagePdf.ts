import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLib } from 'pdf-lib';
import { germanDate } from '../../shared/export.js';
import { listTables } from '../../shared/exportDocument.js';
import { packageLists, type ConstructionPackage } from '../../shared/package.js';
import type { BuildLists } from '../../shared/partLists.js';
import { PAGE_FOOTER_MM, PAGE_HEADER_MM, PAGE_MARGIN_MM, PAPER_SIZE_MM } from '../../shared/tiling.js';
import { constructionPageBreakdown, renderConstructionPlan } from './pdf.js';

const mm = (value: number) => value * 72 / 25.4;

type Column = { title: string; width: number };

function renderPartsList(pkg: ConstructionPackage) {
  const lists = packageLists(pkg.scenes.map((snapshot, index) => ({ sceneId: pkg.sceneIds[index] ?? snapshot.revisionId, snapshot })));
  return new Promise<Buffer>((resolve, reject) => {
    const paper = pkg.paper ?? 'A4';
    const issuedAt = new Date(pkg.issuedAt);
    const doc = new PDFDocument({
      size: paper, compress: false, margin: 0,
      info: { Title: 'Konstruktionspaket', CreationDate: issuedAt, ModDate: issuedAt },
    });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const pageHeight = PAPER_SIZE_MM[paper].height;
    let page = 1;
    let y = PAGE_HEADER_MM + 2;
    const contentWidth = PAPER_SIZE_MM[paper].width - 2 * PAGE_MARGIN_MM;
    function header() {
      doc.font('Helvetica-Bold').fillColor('#203c36').fontSize(12)
        .text('Konstruktionspaket', mm(PAGE_MARGIN_MM), mm(12), { lineBreak: false });
      doc.font('Helvetica').fontSize(9)
        .text(`${pkg.productionName} · Stückliste`, mm(PAGE_MARGIN_MM), mm(19), { lineBreak: false });
      doc.fontSize(8).fillColor('#536950')
        .text(`Fassung ${pkg.revisionName} · ${germanDate(pkg.issuedAt)} · Maßstab 1:${pkg.scale}`,
          mm(PAGE_MARGIN_MM), mm(25), { lineBreak: false });
      doc.fontSize(7).fillColor('#758170')
        .text(`Blatt ${page} · ${paper}`, mm(PAGE_MARGIN_MM), mm(30), { lineBreak: false });
      doc.fontSize(6).fillColor('#9aa396')
        .text(pkg.revisionId, mm(PAGE_MARGIN_MM), mm(34), { width: mm(contentWidth), lineBreak: false });
    }
    function footer() {
      doc.fontSize(7).fillColor('#203c36')
        .text(`Blatt ${page} · 100 % drucken`, mm(PAGE_MARGIN_MM), mm(pageHeight - PAGE_FOOTER_MM + 4), { lineBreak: false });
    }
    function ensure(gap = 6) {
      if (y + gap <= pageHeight - PAGE_FOOTER_MM) return;
      footer();
      doc.addPage({ size: paper, margin: 0 });
      page += 1;
      header();
      y = PAGE_HEADER_MM + 2;
    }
    function section(title: string) {
      ensure(12);
      y += 2;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#203c36')
        .text(title, mm(PAGE_MARGIN_MM), mm(y), { width: mm(contentWidth), lineBreak: false });
      y += 6;
      doc.font('Helvetica');
    }
    function line(text: string, color = '#203c36', size = 8) {
      ensure(5);
      doc.fontSize(size).fillColor(color).text(text, mm(PAGE_MARGIN_MM), mm(y), { width: mm(contentWidth), lineBreak: false });
      y += size < 8 ? 4.5 : 5;
    }
    function table(columns: Column[], rows: string[][]) {
      const total = columns.reduce((sum, column) => sum + column.width, 0);
      const widths = columns.map(column => column.width / total * contentWidth);
      const x = (index: number) => PAGE_MARGIN_MM + widths.slice(0, index).reduce((sum, width) => sum + width, 0);
      ensure(8);
      doc.fontSize(7).fillColor('#536950');
      columns.forEach((column, index) => doc.text(column.title, mm(x(index)), mm(y), { width: mm(widths[index]! - 2), lineBreak: false }));
      y += 4.5;
      doc.moveTo(mm(PAGE_MARGIN_MM), mm(y)).lineTo(mm(PAGE_MARGIN_MM + contentWidth), mm(y)).lineWidth(0.4).stroke('#c5cbbd');
      y += 2;
      for (const row of rows) {
        ensure(5);
        doc.fontSize(8).fillColor('#203c36');
        row.forEach((cell, index) => doc.text(cell, mm(x(index)), mm(y), { width: mm(widths[index]! - 2), lineBreak: false }));
        y += 5;
      }
    }
    function listSection(built: BuildLists) {
      for (const item of listTables(built)) {
        line(item.title, '#536950', 7);
        table(item.headers.map((title, index) => ({ title, width: index === 0 ? 3 : 1.2 })), item.rows);
        y += 2;
      }
    }
    header();
    section('Inhaltsverzeichnis');
    line('1. Stückliste und Bestandsbedarf (dieses Blatt)');
    lists.scenes.forEach((scene, index) => line(`${index + 2}. ${scene.sceneName}`));
    for (const visit of lists.visits) {
      section(`Materialbedarf · ${visit.venueName} · ${visit.sceneNames.join(', ')}`);
      listSection(visit.lists);
      for (const warning of visit.lists.stock.warnings) {
        if (warning.kind !== 'unassigned') line(warning.message, '#6a4e16', 7);
      }
    }
    if (lists.visits.length > 1) {
      section('Materialbedarf · Gesamtpaket');
      listSection(lists.total);
    }
    for (const [index, scene] of lists.scenes.entries()) {
      section(scene.sceneName);
      table([{ title: 'Pos.', width: 0.6 }, { title: 'Bezeichnung', width: 2.4 }, { title: 'Bauteil', width: 2.4 },
        { title: 'Bestandsstück', width: 1.4 }, { title: 'Maße (mm)', width: 2 }], scene.lists.objects.map(object => [
        object.assemblyNumber === null ? '—' : String(object.assemblyNumber), object.label,
        [object.partName, object.variantLabel].filter(Boolean).join(' · '), object.stockItemLabel ?? '—',
        `${object.widthMm}×${object.depthMm}×${object.heightMm}`,
      ]));
      const snapshot = pkg.scenes[index]!;
      if (snapshot.layout.riggingNotes) line(snapshot.layout.riggingNotes, '#536950');
      for (const warning of [...scene.lists.stock.warnings, ...snapshot.warnings, ...snapshot.unresolvedWarnings]) {
        line(warning.message, '#6a4e16', 7);
      }
    }
    footer();
    doc.end();
  });
}

async function mergePdfs(parts: Buffer[]) {
  const out = await PdfLib.create();
  out.setTitle('Konstruktionspaket');
  let globalBlatt = 0;
  for (const part of parts) {
    const src = await PdfLib.load(part, { ignoreEncryption: true, updateMetadata: false });
    const indices = src.getPageIndices();
    for (const page of await out.copyPages(src, indices)) {
      globalBlatt += 1;
      out.addPage(page);
    }
  }
  // Outline / bookmarks for navigation
  const outline = out.context.obj({});
  void outline;
  void globalBlatt;
  return Buffer.from(await out.save({ useObjectStreams: false }));
}

export async function renderPackage(pkg: ConstructionPackage) {
  const parts = await renderPartsList(pkg);
  const scenes = [];
  for (const snapshot of pkg.scenes) scenes.push(await renderConstructionPlan(snapshot));
  return mergePdfs([parts, ...scenes]);
}

export function packagePageEstimate(pkg: ConstructionPackage) {
  let pages = 1; // parts list at least one page (approx)
  for (const snapshot of pkg.scenes) pages += constructionPageBreakdown(snapshot).pageCount;
  return pages;
}
