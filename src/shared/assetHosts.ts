/**
 * The two remote hosts the app still loads third-party assets from at runtime. Everything else is
 * served by the app itself. Changing a host means changing it here only.
 */

/** Textures and thumbnails of the material library (`library:<id>` finishes). */
export const MATERIAL_ASSET_BASE_URL = 'https://editor.pascal.app';

/** Models and thumbnails of the model catalogue. */
export const MODEL_ASSET_BASE_URL = 'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items';

function join(base: string, path: string) {
  return `${base}/${path.replace(/^\/+/, '')}`;
}

export function materialAssetUrl(path: string) {
  return join(MATERIAL_ASSET_BASE_URL, path);
}

export function modelAssetUrl(path: string) {
  return join(MODEL_ASSET_BASE_URL, path);
}
