import { materialAssetUrl } from '../../shared/assetHosts.js';
import { MATERIAL_LIBRARY_DATA } from './materialLibrary.data.js';

export const LIBRARY_REF_PREFIX = 'library:';

export type LibraryTextureSlot = 'albedo' | 'normal' | 'roughness' | 'metalness' | 'ao';

/** One finish of the vendored material library. Paths are relative to the material asset host. */
export type LibraryMaterial = {
  id: string;
  label: string;
  category: string;
  surfaces?: readonly string[];
  description?: string;
  /** Flat colour that stands in for the finish in pickers and while its textures load. */
  previewColor: string;
  thumbnail?: string;
  /** Base colour factor; multiplies the albedo texture when there is one. */
  color: string;
  roughness: number;
  metalness: number;
  /** Present on see-through finishes only. */
  opacity?: number;
  /** Texture repeats across one metre (or across the whole face when a finish has no pattern size). */
  repeat: readonly [number, number];
  flipY: boolean;
  maps: Partial<Record<LibraryTextureSlot, string>>;
};

export const MATERIAL_LIBRARY: readonly LibraryMaterial[] = MATERIAL_LIBRARY_DATA;

const byId = new Map(MATERIAL_LIBRARY.map(item => [item.id, item]));

export function toLibraryRef(id: string) {
  return `${LIBRARY_REF_PREFIX}${id}`;
}

export function libraryIdFromRef(ref: string | undefined) {
  return ref?.startsWith(LIBRARY_REF_PREFIX) ? ref.slice(LIBRARY_REF_PREFIX.length) : undefined;
}

export function libraryMaterialById(id: string | undefined) {
  return id === undefined ? undefined : byId.get(id);
}

/** Resolves a stored `library:<id>` reference; unknown and malformed references give undefined. */
export function libraryMaterial(ref: string | undefined) {
  return libraryMaterialById(libraryIdFromRef(ref));
}

export function libraryTextureUrl(material: LibraryMaterial, slot: LibraryTextureSlot) {
  const path = material.maps[slot];
  return path ? materialAssetUrl(path) : undefined;
}

/** A browser-displayable preview image, or undefined when the finish is a flat colour. */
export function libraryThumbnailUrl(material: LibraryMaterial) {
  return material.thumbnail ? materialAssetUrl(material.thumbnail) : undefined;
}
