import { crc32 } from 'node:zlib';
import PDFDocument from 'pdfkit';

/** 8×4 PNG so upload tests can assert decoded pixel dimensions independently of the parser. */
export function pngBytes(width = 8, height = 4) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const idat = Buffer.from('789c63600000020001', 'hex');
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type: string, data: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4);
  const body = Buffer.concat([header.subarray(4, 8), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([header.subarray(0, 4), body, crc]);
}

export function twoPagePdf() {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ compress: false, size: [200, 100], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.text('Seite 1');
    doc.addPage();
    doc.text('Seite 2');
    doc.end();
  });
}
