/** Venue underlay import: which payloads upload as-is vs need raster→PNG conversion. */

const DIRECT = new Set(['image/png', 'image/jpeg', 'image/jpg', 'application/pdf']);

export function normalizeUnderlayMediaType(mediaType: string) {
  const type = mediaType.split(';')[0]!.trim().toLowerCase();
  return type === 'image/jpg' ? 'image/jpeg' : type;
}

/** True when the payload can be POSTed without client-side raster conversion. */
export function underlayUploadsDirectly(mediaType: string) {
  return DIRECT.has(normalizeUnderlayMediaType(mediaType));
}

function isRasterClipboardType(type: string) {
  return type.startsWith('image/') || type === '' || type === 'application/x-qt-image';
}

/**
 * True when we should decode the blob via canvas and re-encode as PNG
 * (clipboard screenshots, WebP, GIF, BMP, Qt clipboard images, or typeless blobs).
 */
export function underlayNeedsRasterConversion(mediaType: string) {
  const type = normalizeUnderlayMediaType(mediaType);
  if (DIRECT.has(type)) return false;
  return isRasterClipboardType(type);
}

/** Sync check for paste/drop: does this DataTransfer offer an underlay image or PDF? */
export function dataTransferHasUnderlay(transfer: DataTransfer) {
  if ([...transfer.files].some(file => underlayUploadsDirectly(file.type) || underlayNeedsRasterConversion(file.type))) {
    return true;
  }
  return [...transfer.items].some(item => {
    if (item.kind !== 'file') return false;
    const type = normalizeUnderlayMediaType(item.type);
    return underlayUploadsDirectly(type) || isRasterClipboardType(type);
  });
}

export function underlayFileName(mediaType: string, suggested?: string) {
  const type = normalizeUnderlayMediaType(mediaType);
  const base = suggested?.trim() || '';
  if (type === 'application/pdf') return base && /\.pdf$/i.test(base) ? base : 'vorlage.pdf';
  if (type === 'image/jpeg') return base && /\.jpe?g$/i.test(base) ? base : 'screenshot.jpg';
  if (type === 'image/png') return base && /\.png$/i.test(base) ? base : 'screenshot.png';
  if (base) return base.replace(/\.[^.]+$/, '') + '.png';
  return 'screenshot.png';
}
