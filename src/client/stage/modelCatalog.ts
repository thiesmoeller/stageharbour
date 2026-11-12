import { modelAssetUrl } from '../../shared/assetHosts.js';
import { MODEL_CATALOG_DATA } from './modelCatalog.data.js';

type Vector = readonly [number, number, number];

/** One entry of the vendored model catalogue. Paths are relative to the model asset host. */
export type CatalogModel = {
  id: string;
  name: string;
  category: string;
  tags: readonly string[];
  thumbnail?: string;
  model?: string;
  /** Width, height and depth in metres. */
  dimensions: Vector;
  offset: Vector;
  rotation: Vector;
  scale: Vector;
  /** Set on entries the source catalogue draws with a dedicated tool; they cannot be placed as models. */
  tool?: string;
};

export const MODEL_CATALOG: readonly CatalogModel[] = MODEL_CATALOG_DATA;

const byId = new Map(MODEL_CATALOG.map(item => [item.id, item]));

export function catalogModelById(id: string) {
  return byId.get(id);
}

export function catalogModelUrl(item: CatalogModel) {
  return item.model ? modelAssetUrl(item.model) : undefined;
}

export function catalogThumbnailUrl(item: CatalogModel) {
  return item.thumbnail ? modelAssetUrl(item.thumbnail) : undefined;
}

/** Entries that can be placed as a model, filtered by a free-text search over name and tags. */
export function searchCatalogModels(search: string) {
  const needle = search.trim().toLowerCase();
  return MODEL_CATALOG.filter(item => !item.tool && item.model && `${item.name} ${item.tags.join(' ')}`.toLowerCase().includes(needle));
}
