/**
 * A small ZIP writer and reader (PKWARE APPNOTE 6.3.3): no encryption, no ZIP64, no folders
 * needed. Entries are STORED or DEFLATEd, the two methods an MVR archive may use. Deflate comes
 * from the platform `CompressionStream`, available in Node and every current browser; where it
 * is missing entries are stored.
 */
export type ZipEntry = { name: string; data: Uint8Array };

export type ZipWriteOptions = {
  /** File timestamp of every entry; defaults to the current time. */
  modified?: Date;
  /** Deflate entries when that makes them smaller. Default true. */
  compress?: boolean;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof CompressionStream === 'undefined') return undefined;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function writeZip(entries: readonly ZipEntry[], options: ZipWriteOptions = {}): Promise<Uint8Array> {
  if (entries.length > 0xffff) throw new Error('Zu viele Dateien für ein ZIP-Archiv.');
  const stamp = dosDateTime(options.modified ?? new Date());
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (seen.has(lower)) throw new Error(`Dateiname doppelt im Archiv: ${entry.name}`);
    seen.add(lower);
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const packed = options.compress === false || entry.data.length === 0 ? undefined : await deflateRaw(entry.data);
    const deflated = packed !== undefined && packed.length < entry.data.length;
    const body = deflated ? packed : entry.data;
    if (body.length >= 0xffffffff || offset >= 0xffffffff) throw new Error('Archiv zu groß.');
    const method = deflated ? 8 : 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, body);
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(10, method, true);
    header.setUint16(12, stamp.time, true);
    header.setUint16(14, stamp.date, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, body.length, true);
    header.setUint32(24, entry.data.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);
    central.push(new Uint8Array(header.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const directorySize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const result = new Uint8Array(all.reduce((sum, chunk) => sum + chunk.length, 0));
  let position = 0;
  for (const chunk of all) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result;
}

/** Reads the entries of an archive written by `writeZip` (or any ZIP without ZIP64). */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Kein ZIP-Archiv.');
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Beschädigtes ZIP-Archiv.');
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const packedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const packed = bytes.subarray(dataStart, dataStart + packedSize);
    if (method !== 0 && method !== 8) throw new Error(`Nicht unterstütztes Kompressionsverfahren ${method}.`);
    const data = method === 8 ? await inflateRaw(packed) : packed.slice();
    if (data.length !== size || crc32(data) !== crc) throw new Error(`Prüfsumme von ${name} stimmt nicht.`);
    entries.push({ name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
