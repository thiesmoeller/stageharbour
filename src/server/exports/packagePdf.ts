import { ballastLabel } from '../../shared/ballast.js';
import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLib } from 'pdf-lib';
import { germanDate } from '../../shared/export.js';
import type { ConstructionPackage } from '../../shared/package.js';
import { PAGE_FOOTER_MM, PAGE_HEADER_MM, PAGE_MARGIN_MM, PAPER_SIZE_MM } from '../../shared/tiling.js';
import { constructionPageBreakdown, renderConstructionPlan } from './pdf.js';

const mm = (value: number) => value * 72 / 25.4;

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderPartsList(pkg: ConstructionPackage) {
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
    const col = {
      label: PAGE_MARGIN_MM,
      apps: PAGE_MARGIN_MM + 55,
      scenes: PAGE_MARGIN_MM + 80,
      status: PAGE_MARGIN_MM + (paper === 'A3' ? 200 : 145),
    };
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
        .text(pkg.revisionId, mm(PAGE_MARGIN_MM), mm(34), {
          width: mm(contentWidth), lineBreak: false,
        });
    }
    function ensure(gap = 6) {
      if (y + gap <= pageHeight - PAGE_FOOTER_MM) return;
      footer();
      doc.addPage({ size: paper, margin: 0 });
      page += 1;
      header();
      y = PAGE_HEADER_MM + 2;
    }
    function footer() {
      doc.fontSize(7).fillColor('#203c36')
        .text(`Blatt ${page} · 100 % drucken`, mm(PAGE_MARGIN_MM), mm(pageHeight - PAGE_FOOTER_MM + 4), { lineBreak: false });
    }
    function section(title: string) {
      ensure(10);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#203c36')
        .text(title, mm(PAGE_MARGIN_MM), mm(y), { lineBreak: false });
      y += 6;
      doc.font('Helvetica');
    }
    function tableHeader() {
      ensure(8);
      doc.fontSize(7).fillColor('#536950');
      doc.text('Platte', mm(col.label), mm(y), { lineBreak: false });
      doc.text('Einsätze', mm(col.apps), mm(y), { lineBreak: false });
      doc.text('Szenen', mm(col.scenes), mm(y), { lineBreak: false });
      doc.text('Status', mm(col.status), mm(y), { lineBreak: false });
      y += 4.5;
      doc.moveTo(mm(PAGE_MARGIN_MM), mm(y)).lineTo(mm(PAGE_MARGIN_MM + contentWidth), mm(y))
        .lineWidth(0.4).stroke('#c5cbbd');
      y += 2;
      doc.fillColor('#203c36');
    }
    header();
    section('Inhaltsverzeichnis');
    doc.fontSize(8).fillColor('#203c36');
    ensure(5);
    doc.text('1. Stückliste (dieses Blatt)', mm(PAGE_MARGIN_MM), mm(y), { lineBreak: false });
    y += 5;
    let sceneIndex = 2;
    for (const list of pkg.sceneLists) {
      ensure(5);
      doc.text(`${sceneIndex}. ${list.sceneName}`, mm(PAGE_MARGIN_MM), mm(y), { lineBreak: false });
      y += 5;
      sceneIndex += 1;
    }
    y += 3;
    section('Stückliste');
    doc.fontSize(8).fillColor('#536950')
      .text(`${countLabel(pkg.stock.physicalPanels, 'physische Platte', 'physische Platten')} · ${countLabel(pkg.stock.appearances, 'Einsatz', 'Einsätze')}`,
        mm(PAGE_MARGIN_MM), mm(y), { lineBreak: false });
    y += 6;
    tableHeader();
    for (const panel of pkg.stock.panels) {
      ensure(5);
      doc.fontSize(8).fillColor('#203c36');
      doc.text(panel.label, mm(col.label), mm(y), { width: mm(50), lineBreak: false });
      doc.text(`${panel.appearances} ${panel.appearances === 1 ? 'Einsatz' : 'Einsätze'}`, mm(col.apps), mm(y), { lineBreak: false });
      doc.text(panel.sceneNames.join(', '), mm(col.scenes), mm(y), { width: mm(col.status - col.scenes - 4), lineBreak: false });
      doc.text(panel.available ? 'verfügbar' : 'nicht verfügbar', mm(col.status), mm(y), { lineBreak: false });
      y += 5;
    }
    section('Nicht zugewiesen');
    if (!pkg.stock.unassigned.length) {
      ensure(5);
      doc.fontSize(8).text('Keine.', mm(PAGE_MARGIN_MM), mm(y), { lineBreak: false });
      y += 5;
    }
    for (const item of pkg.stock.unassigned) {
      ensure(5);
      doc.fontSize(8).text(`„${item.wallLabel}“ in ${item.sceneName}`, mm(PAGE_MARGIN_MM), mm(y), {
        width: mm(contentWidth), lineBreak: false,
      });
      y += 5;
    }
    section('Nicht verfügbar');
    if (!pkg.stock.unavailable.length) {
      ensure(5);
      doc.fontSize(8).text('Keine.', mm(PAGE_MARGIN_MM), mm(y), { lineBreak: false });
      y += 5;
    }
    for (const item of pkg.stock.unavailable) {
      ensure(5);
      doc.fontSize(8).text(`Platte ${item.panelLabel} · „${item.wallLabel}“ in ${item.sceneName}`,
        mm(PAGE_MARGIN_MM), mm(y), { width: mm(contentWidth), lineBreak: false });
      y += 5;
    }
    if (pkg.stock.conflicts.length) {
      section('Konflikte');
      for (const item of pkg.stock.conflicts) {
        ensure(5);
        doc.fontSize(8).fillColor('#6a4e16')
          .text(`${item.sceneName}: ${item.message}`, mm(PAGE_MARGIN_MM), mm(y), {
            width: mm(contentWidth), lineBreak: false,
          });
        y += 5;
      }
    }
    for (const venue of pkg.stock.venueMaterials ?? []) {
      section(`Materialbedarf · ${venue.venueName} · enthaltene Szenen`);
      for (const line of [
        `Stützen: ${venue.required.braces}`,
        `Gehwegplatten 400 × 400 × 50 mm: ${venue.required.slabs} · verfügbar ${venue.available.slabs} · fehlend ${venue.shortage.slabs}`,
        `Spanngurte: ${venue.required.straps} · verfügbar ${venue.available.straps} · fehlend ${venue.shortage.straps}`,
      ]) { ensure(5); doc.fontSize(8).text(line, mm(PAGE_MARGIN_MM), mm(y), { width: mm(contentWidth), lineBreak: false }); y += 5; }
    }
    for (const list of pkg.sceneLists) {
      section(list.sceneName);
      ensure(5);
      doc.fontSize(7).fillColor('#536950');
      doc.text('Wand', mm(PAGE_MARGIN_MM), mm(y), { lineBreak: false });
      doc.text('Pos.', mm(PAGE_MARGIN_MM + 50), mm(y), { lineBreak: false });
      doc.text('Platte', mm(PAGE_MARGIN_MM + 68), mm(y), { lineBreak: false });
      doc.text('Maße (mm)', mm(PAGE_MARGIN_MM + 105), mm(y), { lineBreak: false });
      y += 4.5;
      for (const wall of list.walls) {
        ensure(5);
        doc.fontSize(8).fillColor('#203c36');
        doc.text(wall.label, mm(PAGE_MARGIN_MM), mm(y), { width: mm(48), lineBreak: false });
        doc.text(wall.assemblyNumber ? String(wall.assemblyNumber) : '—', mm(PAGE_MARGIN_MM + 50), mm(y), { lineBreak: false });
        doc.text(wall.panelLabel ?? '—', mm(PAGE_MARGIN_MM + 68), mm(y), { width: mm(34), lineBreak: false });
        doc.text(`${wall.width}×${wall.height}×${wall.thickness}`, mm(PAGE_MARGIN_MM + 105), mm(y), { lineBreak: false });
        y += 5;
      }
      for (const brace of list.braces) {
        ensure(5);
        doc.fontSize(8).text(`${brace.label} · ${brace.footprintWidth}×${brace.footprintDepth} · ${brace.height} mm · ${ballastLabel(brace.ballast)}`,
          mm(PAGE_MARGIN_MM), mm(y), { width: mm(contentWidth), lineBreak: false });
        y += 5;
      }
      if (list.materials) {
        ensure(5);
        doc.fontSize(8).text(`Gehwegplatten: ${list.materials.slabs} · Spanngurte: ${list.materials.straps}`, mm(PAGE_MARGIN_MM), mm(y));
        y += 5;
      }
      if (list.riggingNotes) {
        ensure(5);
        doc.fontSize(8).fillColor('#536950').text(list.riggingNotes, mm(PAGE_MARGIN_MM), mm(y), {
          width: mm(contentWidth), lineBreak: false,
        });
        y += 5;
      }
      for (const warning of [...list.inventoryWarnings, ...list.overheadWarnings, ...list.keepClearWarnings]) {
        ensure(5);
        doc.fontSize(7).fillColor('#6a4e16').text(warning.message, mm(PAGE_MARGIN_MM), mm(y), {
          width: mm(contentWidth), lineBreak: false,
        });
        y += 4.5;
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
