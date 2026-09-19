import {
  dataTransferHasUnderlay, underlayFileName, underlayNeedsRasterConversion, underlayUploadsDirectly,
  normalizeUnderlayMediaType,
} from '../../shared/underlayImport.js';

async function rasterBlobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('png')), 'image/png');
    });
    return png;
  } finally {
    bitmap.close();
  }
}

/**
 * Turn a dropped/pasted blob into a File the venue-reference upload accepts.
 * Direct PNG/JPEG/PDF pass through; other rasters (incl. typeless clipboard images) become PNG.
 */
export async function prepareUnderlayFile(blob: Blob, suggestedName?: string): Promise<File> {
  const rawType = blob.type || (suggestedName?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
  const type = normalizeUnderlayMediaType(rawType);
  if (underlayUploadsDirectly(type)) {
    const media = type === 'image/jpg' ? 'image/jpeg' : type;
    return new File([blob], underlayFileName(media, suggestedName), { type: media });
  }
  if (!underlayNeedsRasterConversion(type)) {
    throw new Error('unsupported-underlay');
  }
  const png = await rasterBlobToPng(blob);
  return new File([png], underlayFileName('image/png', suggestedName), { type: 'image/png' });
}

function rankUnderlayType(type: string) {
  const normalized = normalizeUnderlayMediaType(type);
  if (normalized === 'image/png') return 0;
  if (normalized === 'image/jpeg') return 1;
  if (normalized === 'application/pdf') return 2;
  if (normalized.startsWith('image/')) return 3;
  if (normalized === 'application/x-qt-image' || normalized === '') return 4;
  return 99;
}

/** Prefer an explicit file list, then DataTransferItem file entries (clipboard paste). */
export async function prepareUnderlayFromDataTransfer(transfer: DataTransfer): Promise<File | undefined> {
  const files = [...transfer.files].sort((a, b) => rankUnderlayType(a.type) - rankUnderlayType(b.type));
  for (const file of files) {
    try { return await prepareUnderlayFile(file, file.name); }
    catch { /* try next */ }
  }
  const items = [...transfer.items]
    .filter(item => item.kind === 'file')
    .sort((a, b) => rankUnderlayType(a.type) - rankUnderlayType(b.type));
  for (const item of items) {
    const file = item.getAsFile();
    if (!file) continue;
    try { return await prepareUnderlayFile(file, file.name || undefined); }
    catch { /* try next */ }
  }
  return undefined;
}

/** Async clipboard read (button / fallback). Needs a user gesture and secure context. */
export async function prepareUnderlayFromClipboardRead(): Promise<File | undefined> {
  if (!navigator.clipboard?.read) return undefined;
  const items = await navigator.clipboard.read();
  const typesPreferred = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'application/x-qt-image'];
  for (const item of items) {
    const available = typesPreferred.filter(type => item.types.includes(type));
    const fallback = item.types.filter(type => type.startsWith('image/'));
    for (const type of [...available, ...fallback]) {
      try {
        const blob = await item.getType(type);
        return await prepareUnderlayFile(blob, underlayFileName(type));
      } catch { /* try next type */ }
    }
  }
  return undefined;
}

export { dataTransferHasUnderlay };
