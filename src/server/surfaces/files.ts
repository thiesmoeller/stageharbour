export const MAX_SURFACE_TEXTURE_BYTES = 16 * 1024 * 1024;

export type InspectedSurfaceTexture = {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  pixelWidth: number;
  pixelHeight: number;
};

export function inspectSurfaceTexture(bytes: Buffer, mediaType: string): InspectedSurfaceTexture {
  if (!bytes.length || bytes.length > MAX_SURFACE_TEXTURE_BYTES) throw new Error('invalid texture');
  const type = mediaType.split(';')[0]!.trim().toLowerCase();
  if (type === 'image/png') return inspectPng(bytes);
  if (type === 'image/jpeg' || type === 'image/jpg') return inspectJpeg(bytes);
  if (type === 'image/webp') return inspectWebp(bytes);
  throw new Error('invalid texture');
}

function dimensions(mediaType: InspectedSurfaceTexture['mediaType'], pixelWidth: number, pixelHeight: number) {
  if (!(pixelWidth > 0 && pixelHeight > 0) || pixelWidth > 16384 || pixelHeight > 16384) {
    throw new Error('invalid texture dimensions');
  }
  return { mediaType, pixelWidth, pixelHeight };
}

function inspectPng(bytes: Buffer): InspectedSurfaceTexture {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('invalid png');
  return dimensions('image/png', bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

function inspectJpeg(bytes: Buffer): InspectedSurfaceTexture {
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('invalid jpeg');
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('invalid jpeg');
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) throw new Error('invalid jpeg');
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return dimensions('image/jpeg', bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5));
    }
    offset += 2 + length;
  }
  throw new Error('invalid jpeg');
}

function readUint24LE(bytes: Buffer, offset: number) {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function inspectWebp(bytes: Buffer): InspectedSurfaceTexture {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('invalid webp');
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8X') return dimensions('image/webp', readUint24LE(bytes, 24) + 1, readUint24LE(bytes, 27) + 1);
  if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return dimensions('image/webp', bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
  }
  if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return dimensions('image/webp', (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  throw new Error('invalid webp');
}
