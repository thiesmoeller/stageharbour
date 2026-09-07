import { PDFDocument } from 'pdf-lib';

export type InspectedReference = {
  kind: 'image' | 'pdf';
  mediaType: 'image/png' | 'image/jpeg' | 'application/pdf';
  pageCount: number | null;
  pixelWidth: number | null;
  pixelHeight: number | null;
};

export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

export async function inspectReference(bytes: Buffer, mediaType: string): Promise<InspectedReference> {
  if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES) throw new Error('invalid reference');
  const type = mediaType.split(';')[0]!.trim().toLowerCase();
  if (type === 'image/png') return inspectPng(bytes);
  if (type === 'image/jpeg' || type === 'image/jpg') return inspectJpeg(bytes);
  if (type === 'application/pdf') return inspectPdf(bytes);
  throw new Error('invalid reference');
}

export function originalFileName(header: string | string[] | undefined) {
  const raw = Array.isArray(header) ? header[0] : header;
  const name = (raw ?? 'vorlage').split(/[/\\]/).pop()?.trim() || 'vorlage';
  return name.slice(0, 120);
}

function inspectPng(bytes: Buffer): InspectedReference {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('invalid reference');
  const pixelWidth = bytes.readUInt32BE(16);
  const pixelHeight = bytes.readUInt32BE(20);
  if (!(pixelWidth > 0) || !(pixelHeight > 0) || pixelWidth > 100000 || pixelHeight > 100000) throw new Error('invalid reference');
  return { kind: 'image', mediaType: 'image/png', pageCount: null, pixelWidth, pixelHeight };
}

function inspectJpeg(bytes: Buffer): InspectedReference {
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('invalid reference');
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('invalid reference');
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) throw new Error('invalid reference');
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const pixelHeight = bytes.readUInt16BE(offset + 5);
      const pixelWidth = bytes.readUInt16BE(offset + 7);
      if (!(pixelWidth > 0) || !(pixelHeight > 0)) throw new Error('invalid reference');
      return { kind: 'image', mediaType: 'image/jpeg', pageCount: null, pixelWidth, pixelHeight };
    }
    offset += 2 + length;
  }
  throw new Error('invalid reference');
}

async function inspectPdf(bytes: Buffer): Promise<InspectedReference> {
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('invalid reference');
  const document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pageCount = document.getPageCount();
  if (!(pageCount > 0)) throw new Error('invalid reference');
  return { kind: 'pdf', mediaType: 'application/pdf', pageCount, pixelWidth: null, pixelHeight: null };
}
