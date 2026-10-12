import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { DocumentLayout, Paint, TextMeasure } from '../../shared/exportDocument.js';

const regularFont = fileURLToPath(new URL('../../../assets/fonts/SourceSans3-Regular.ttf', import.meta.url));
const boldFont = fileURLToPath(new URL('../../../assets/fonts/SourceSans3-Bold.ttf', import.meta.url));

const mm = (value: number) => value * 72 / 25.4;

export function createFontMeasure(): TextMeasure {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.registerFont('SourceSans', regularFont);
  doc.registerFont('SourceSans-Bold', boldFont);
  return (text, fontSizePt, bold) => {
    doc.font(bold ? 'SourceSans-Bold' : 'SourceSans').fontSize(fontSizePt);
    return doc.widthOfString(text) * 25.4 / 72;
  };
}

function draw(doc: PDFKit.PDFDocument, item: Paint, images: ReadonlyMap<string, Buffer>) {
  if (item.op === 'poly') {
    const [first, ...rest] = item.points;
    if (!first) return;
    doc.moveTo(mm(first.x), mm(first.y));
    for (const point of rest) doc.lineTo(mm(point.x), mm(point.y));
    doc.closePath();
    doc.lineWidth(item.line ?? 0.6);
    if (item.dash) doc.dash(item.dash[0], { space: item.dash[1] });
    if (item.fill && item.stroke) doc.fillAndStroke(item.fill, item.stroke);
    else if (item.fill) doc.fill(item.fill);
    else if (item.stroke) doc.stroke(item.stroke);
    doc.undash();
    return;
  }
  if (item.op === 'line') {
    doc.lineWidth(item.line ?? 0.6);
    if (item.dash) doc.dash(item.dash[0], { space: item.dash[1] });
    doc.moveTo(mm(item.x1), mm(item.y1)).lineTo(mm(item.x2), mm(item.y2)).stroke(item.stroke);
    doc.undash();
    return;
  }
  if (item.op === 'circle') {
    doc.lineWidth(item.line ?? 0.6);
    if (item.dash) doc.dash(item.dash[0], { space: item.dash[1] });
    doc.circle(mm(item.cx), mm(item.cy), mm(item.r));
    if (item.fill && item.stroke) doc.fillAndStroke(item.fill, item.stroke);
    else if (item.fill) doc.fill(item.fill);
    else if (item.stroke) doc.stroke(item.stroke);
    doc.undash();
    return;
  }
  if (item.op === 'arc') {
    doc.lineWidth(item.line ?? 0.6);
    if (item.dash) doc.dash(item.dash[0], { space: item.dash[1] });
    const rad = Math.PI / 180;
    const steps = 16;
    const start = item.startAngleDeg * rad;
    const end = item.endAngleDeg * rad;
    const delta = (end - start) / steps;
    doc.moveTo(mm(item.cx + item.r * Math.cos(start)), mm(item.cy + item.r * Math.sin(start)));
    for (let i = 1; i <= steps; i++) {
      const angle = start + delta * i;
      doc.lineTo(mm(item.cx + item.r * Math.cos(angle)), mm(item.cy + item.r * Math.sin(angle)));
    }
    doc.stroke(item.stroke);
    doc.undash();
    return;
  }
  if (item.op === 'text') {
    doc.font(item.bold ? 'SourceSans-Bold' : 'SourceSans').fontSize(item.size).fillColor(item.color)
      .text(item.text, mm(item.x), mm(item.y), {
        width: item.width ? mm(item.width) : undefined,
        // Geometry text is already laid out. A finite height prevents PDFKit from
        // creating pages for labels outside a clipped drawing frame.
        height: mm(item.height), lineBreak: false,
      });
    return;
  }
  if (item.op === 'link') {
    doc.goTo(mm(item.x), mm(item.y), mm(item.width), mm(item.height), `blatt-${item.sheet}`);
    return;
  }
  const image = images.get(item.frameId);
  if (image) {
    // Fit inside the frame — never stretch. Raumsicht captures keep their camera aspect.
    doc.image(image, mm(item.x), mm(item.y), {
      fit: [mm(item.width), mm(item.height)],
      align: 'center',
      valign: 'center',
    });
    return;
  }
  doc.rect(mm(item.x), mm(item.y), mm(item.width), mm(item.height)).lineWidth(0.4).stroke('#8b8478');
  doc.font('SourceSans').fontSize(9).fillColor('#6a4e16')
    .text('3D-Ansicht konnte nicht gerendert werden.', mm(item.x + 4), mm(item.y + 4), { lineBreak: false });
}

export function renderDocument(layout: DocumentLayout, images: ReadonlyMap<string, Buffer> = new Map()) {
  return new Promise<Buffer>((resolve, reject) => {
    const first = layout.sheets[0];
    const doc = new PDFDocument({
      size: first ? [mm(first.widthMm), mm(first.heightMm)] : 'A4',
      compress: false, margin: 0, autoFirstPage: false,
      info: { Title: layout.revisionName, Author: 'Bühnenplaner' },
    });
    doc.registerFont('SourceSans', regularFont);
    doc.registerFont('SourceSans-Bold', boldFont);
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    if (!layout.sheets.length) {
      doc.addPage({ size: 'A4', margin: 0 });
      doc.font('SourceSans').fontSize(12).text('Leeres Dokument', mm(12), mm(12));
    }
    for (const sheet of layout.sheets) {
      doc.addPage({ size: [mm(sheet.widthMm), mm(sheet.heightMm)], margin: 0 });
      doc.addNamedDestination(sheet.destination);
      doc.outline.addItem(sheet.bookmark);
      for (const item of sheet.paint) draw(doc, item, images);
      for (const frame of sheet.frames) {
        doc.save();
        doc.rect(mm(frame.clip.x), mm(frame.clip.y), mm(frame.clip.width), mm(frame.clip.height)).clip();
        for (const item of frame.paint) draw(doc, item, images);
        doc.restore();
        doc.font('SourceSans').fontSize(7).fillColor('#536950')
          .text(frame.scaleLabel, mm(frame.clip.x + 1), mm(frame.clip.y + frame.clip.height - 4), { lineBreak: false });
      }
    }
    doc.end();
  });
}

export function fontBytes() {
  return { regular: readFileSync(regularFont), bold: readFileSync(boldFont) };
}
