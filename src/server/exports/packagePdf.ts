import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLib } from 'pdf-lib';
import { germanDate } from '../../shared/export.js';
import type { ConstructionPackage } from '../../shared/package.js';
import { PAGE_FOOTER_MM, PAGE_HEADER_MM, PAGE_MARGIN_MM, PAPER_SIZE_MM } from '../../shared/tiling.js';
import { renderConstructionPlan } from './pdf.js';

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
    let page = 1;
    let y = PAGE_HEADER_MM + 2;
    function header() {
      doc.font('Helvetica').fillColor('#203c36').fontSize(11)
        .text('Konstruktionspaket', mm(PAGE_MARGIN_MM), mm(12), { lineBreak: false });
      doc.fontSize(9).text(`${pkg.productionName} · Stückliste`, mm(PAGE_MARGIN_MM), mm(18), { lineBreak: false });
      doc.text(`Fassung ${pkg.revisionName} · ${pkg.revisionId} · ${germanDate(pkg.issuedAt)} · Maßstab 1:${pkg.scale}`, mm(PAGE_MARGIN_MM), mm(24), { lineBreak: false });
      doc.fontSize(8).text(`Blatt ${page} · ${paper}`, mm(PAGE_MARGIN_MM), mm(30), { lineBreak: false });
    }
    function ensure(gap = 6) {
      if (y + gap <= pageHeight - PAGE_FOOTER_MM) return;
      doc.fontSize(8).fillColor('#203c36')
        .text(`Blatt ${page}`, mm(PAGE_MARGIN_MM), mm(pageHeight - PAGE_FOOTER_MM + 4), { lineBreak: false });
      doc.addPage({ size: paper, margin: 0 });
      page += 1;
      header();
      y = PAGE_HEADER_MM + 2;
    }
    function line(text: string, size = 8, gap = 5, color = '#203c36') {
      ensure(gap + 2);
      doc.fontSize(size).fillColor(color).text(text, mm(PAGE_MARGIN_MM), mm(y), { width: mm(180), lineBreak: false });
      y += gap;
    }
    header();
    line('Stückliste', 11, 8);
    line(`${countLabel(pkg.stock.physicalPanels, 'physische Platte', 'physische Platten')} · ${countLabel(pkg.stock.appearances, 'Einsatz', 'Einsätze')}`, 9, 7);
    line('Bestand unterscheidet physische Platten von wiederholten Einsätzen in mehreren Szenen.', 8, 7);
    for (const panel of pkg.stock.panels) {
      line(`${panel.label} · ${countLabel(panel.appearances, 'Einsatz', 'Einsätze')} · ${panel.sceneNames.join(', ')}${panel.available ? '' : ' · nicht verfügbar'}`);
    }
    line('Nicht zugewiesen', 9, 7);
    if (!pkg.stock.unassigned.length) line('Keine.');
    for (const item of pkg.stock.unassigned) line(`„${item.wallLabel}“ in ${item.sceneName}`);
    line('Nicht verfügbar', 9, 7);
    if (!pkg.stock.unavailable.length) line('Keine.');
    for (const item of pkg.stock.unavailable) line(`Platte ${item.panelLabel} · „${item.wallLabel}“ in ${item.sceneName}`);
    if (pkg.stock.conflicts.length) {
      line('Konflikte', 9, 7);
      for (const item of pkg.stock.conflicts) line(`${item.sceneName}: ${item.message}`);
    }
    for (const list of pkg.sceneLists) {
      line(list.sceneName, 10, 8);
      for (const wall of list.walls) {
        const assembly = wall.assemblyNumber ? `Position ${wall.assemblyNumber}` : 'ohne Position';
        const plate = wall.panelLabel ? ` · Platte ${wall.panelLabel}` : '';
        line(`${wall.label} · ${assembly}${plate} · ${wall.width} × ${wall.height} × ${wall.thickness} mm · ${wall.x}/${wall.y} mm · ${wall.rotation}°`);
      }
      for (const brace of list.braces) {
        line(`${brace.label} · ${brace.footprintWidth} × ${brace.footprintDepth} mm · ${brace.height} mm`);
      }
      if (list.riggingNotes) line(list.riggingNotes);
      for (const warning of list.inventoryWarnings) line(warning.message, 8, 5, '#6a4e16');
      for (const warning of list.overheadWarnings) line(warning.message, 8, 5, '#6a4e16');
      for (const warning of list.keepClearWarnings) line(warning.message, 8, 5, '#6a4e16');
    }
    doc.fontSize(8).fillColor('#203c36')
      .text(`Blatt ${page}`, mm(PAGE_MARGIN_MM), mm(pageHeight - PAGE_FOOTER_MM + 4), { lineBreak: false });
    doc.end();
  });
}

async function mergePdfs(parts: Buffer[]) {
  const out = await PdfLib.create();
  out.setTitle('Konstruktionspaket');
  for (const part of parts) {
    const src = await PdfLib.load(part, { ignoreEncryption: true, updateMetadata: false });
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  }
  return Buffer.from(await out.save({ useObjectStreams: false }));
}

export async function renderPackage(pkg: ConstructionPackage) {
  const parts = await renderPartsList(pkg);
  const scenes = [];
  for (const snapshot of pkg.scenes) scenes.push(await renderConstructionPlan(snapshot));
  return mergePdfs([parts, ...scenes]);
}
