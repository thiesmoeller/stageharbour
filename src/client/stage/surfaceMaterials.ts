/**
 * The material seam: every material the stage draws is built here, on standard three.js materials.
 * Together with renderer.ts this is the only module to change for a different renderer.
 *
 * Nothing here reads global state. Shading and textures ("Darstellung") are parameters, the texture
 * source is the cache the factory was created with, and tiling is computed by the pure functions
 * below from millimetre sizes.
 */
import {
  DoubleSide, FrontSide, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, NoColorSpace, RepeatWrapping,
  SRGBColorSpace, type ColorSpace, type Material, type Texture,
} from 'three';
import { ralHex, WALL_PAINT_METALNESS, WALL_PAINT_ROUGHNESS } from '../../shared/ral.js';
import type { SurfaceFinish } from '../../shared/surfaces.js';
import { surfaceTextureUrl, type SurfaceDefinition, type SurfaceRecord } from '../../shared/surfaceRegistry.js';
import { libraryMaterial, libraryTextureUrl, type LibraryMaterial } from './materialLibrary.js';
import type { TextureCache } from './textureCache.js';

/** `rendered` is physically based; `solid` is plain diffuse shading without texture detail maps. */
export type SurfaceShading = 'rendered' | 'solid';
export type SurfaceDisplay = { shading: SurfaceShading; textures: boolean };
export const DEFAULT_SURFACE_DISPLAY: Readonly<SurfaceDisplay> = { shading: 'rendered', textures: true };

/** A face whose texture coordinates run 0..1 across `faceWidthMm` (u) and `faceHeightMm` (v). */
export type SurfaceFace = { faceWidthMm: number; faceHeightMm: number };

export type SurfaceMaterialOptions = SurfaceFace & Partial<SurfaceDisplay> & {
  registry?: { workspaceId: string; surface?: SurfaceRecord };
};

/** Texture repeats across the face and the grain rotation in radians. */
export type SurfaceTiling = { repeatX: number; repeatY: number; rotation: number };

const MIN_REPEAT = 0.05;

function isQuarterTurn(rotationDeg: number | undefined) {
  return rotationDeg === 90 || rotationDeg === 270;
}

function radians(rotationDeg: number | undefined) {
  return ((rotationDeg ?? 0) * Math.PI) / 180;
}

/**
 * Tiling of a library finish. With a pattern size (`scaleMm`) one tile covers that many
 * millimetres; a quarter turn swaps the texture axes, so the face dimensions swap with it and a
 * tile keeps its size. Without a pattern size the finish repeats as often as the library says
 * across the whole face.
 */
export function librarySurfaceTiling(
  material: Pick<LibraryMaterial, 'repeat'>,
  finish: { scaleMm?: number; rotationDeg?: number },
  face: SurfaceFace,
): SurfaceTiling {
  const rotation = radians(finish.rotationDeg);
  if (finish.scaleMm == null) return { repeatX: material.repeat[0], repeatY: material.repeat[1], rotation };
  const quarterTurn = isQuarterTurn(finish.rotationDeg);
  const textureWidthMm = quarterTurn ? face.faceHeightMm : face.faceWidthMm;
  const textureHeightMm = quarterTurn ? face.faceWidthMm : face.faceHeightMm;
  return {
    repeatX: Math.max(MIN_REPEAT, textureWidthMm / finish.scaleMm),
    repeatY: Math.max(MIN_REPEAT, textureHeightMm / finish.scaleMm),
    rotation,
  };
}

/** Tiling of a workspace surface: its tile size in millimetres, or `scaleMm` wide at the same aspect. */
export function registrySurfaceTiling(
  definition: Pick<SurfaceDefinition, 'tileWidthMm' | 'tileHeightMm'>,
  finish: { scaleMm?: number; rotationDeg?: number },
  face: SurfaceFace,
): SurfaceTiling {
  const tileWidthMm = finish.scaleMm ?? definition.tileWidthMm;
  const tileHeightMm = definition.tileHeightMm * (tileWidthMm / definition.tileWidthMm);
  const quarterTurn = isQuarterTurn(finish.rotationDeg);
  return {
    repeatX: Math.max(MIN_REPEAT, (quarterTurn ? face.faceHeightMm : face.faceWidthMm) / tileWidthMm),
    repeatY: Math.max(MIN_REPEAT, (quarterTurn ? face.faceWidthMm : face.faceHeightMm) / tileHeightMm),
    rotation: radians(finish.rotationDeg),
  };
}

/** Tiling for floors: the library's repeat counts are per metre. */
export function libraryFloorTiling(material: Pick<LibraryMaterial, 'repeat'>, face: SurfaceFace): SurfaceTiling {
  return {
    repeatX: Math.max(MIN_REPEAT, material.repeat[0] * face.faceWidthMm / 1000),
    repeatY: Math.max(MIN_REPEAT, material.repeat[1] * face.faceHeightMm / 1000),
    rotation: 0,
  };
}

/** A single-colour material. Equal specs share one material, which doubles as an instancing key. */
export type FlatMaterialSpec = {
  color: string;
  roughness?: number;
  metalness?: number;
  /** Below 1 the material is transparent. */
  opacity?: number;
  doubleSided?: boolean;
  /** Ignores lights: for markers and guides. */
  unlit?: boolean;
  depthWrite?: boolean;
};

export function flatMaterialKey(spec: FlatMaterialSpec, display: SurfaceDisplay = DEFAULT_SURFACE_DISPLAY) {
  const kind = spec.unlit ? 'unlit' : display.shading;
  return [
    kind, spec.color.toLowerCase(), kind === 'rendered' ? spec.roughness ?? 1 : '', kind === 'rendered' ? spec.metalness ?? 0 : '',
    spec.opacity ?? 1, spec.doubleSided ? 'double' : 'front', spec.depthWrite === false ? 'nodepth' : '',
  ].join('|');
}

export type SurfaceMaterialFactory = {
  /**
   * A material for a finish, or null when the finish is missing or unknown and the caller should
   * use its default colour. The material is usable at once: it shows a fallback colour until its
   * textures arrive and keeps it when a texture cannot be loaded. Pass it to
   * `disposeSurfaceMaterial` when done.
   */
  createSurfaceMaterial(finish: SurfaceFinish | undefined, options: SurfaceMaterialOptions): Material | null;
  createLibraryMaterial(material: LibraryMaterial, tiling: SurfaceTiling, display?: Partial<SurfaceDisplay>): Material;
  /** Shared and cached by `flatMaterialKey`; never dispose it. */
  flatMaterial(spec: FlatMaterialSpec, display?: SurfaceDisplay): Material;
  /** Releases the material and its texture references. Shared flat materials are left alone. */
  disposeSurfaceMaterial(material: Material | null | undefined): void;
};

type MapSlot = 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'displacementMap' | 'alphaMap' | 'emissiveMap';
type TextureRequest = { url: string; slots: MapSlot[] };
type LitMaterial = MeshStandardMaterial | MeshLambertMaterial;

const TEXTURE_ANISOTROPY = 4;

function colorSpaceFor(slots: readonly MapSlot[]): ColorSpace {
  return slots.includes('map') || slots.includes('emissiveMap') ? SRGBColorSpace : NoColorSpace;
}

export function createSurfaceMaterialFactory(textures: TextureCache): SurfaceMaterialFactory {
  const flat = new Map<string, Material>();
  const cleanups = new WeakMap<Material, () => void>();
  const shared = new WeakSet<Material>();

  function litMaterial(display: SurfaceDisplay, parameters: { color: string; roughness: number; metalness: number; opacity?: number }): LitMaterial {
    const transparent = parameters.opacity !== undefined && parameters.opacity < 1;
    const common = { color: parameters.color, side: DoubleSide, transparent, opacity: parameters.opacity ?? 1 };
    return display.shading === 'solid'
      ? new MeshLambertMaterial(common)
      : new MeshStandardMaterial({ ...common, roughness: parameters.roughness, metalness: parameters.metalness });
  }

  /**
   * Requests each texture once from the cache and assigns a clone with this material's own tiling.
   * Clones share the uploaded image with every other user of the same URL.
   */
  function attachTextures(material: LitMaterial, requests: readonly TextureRequest[], tiling: SurfaceTiling, flipY: boolean | undefined, onAlbedo: () => void) {
    const owned: Texture[] = [];
    const releases = requests.map(request => textures.acquire(request.url, source => {
      const texture = source.clone();
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.repeat.set(tiling.repeatX, tiling.repeatY);
      texture.rotation = tiling.rotation;
      texture.colorSpace = colorSpaceFor(request.slots);
      texture.anisotropy = TEXTURE_ANISOTROPY;
      // Compressed images cannot be flipped at upload; they are stored the way they are sampled.
      const compressed = (source as Texture & { isCompressedTexture?: boolean }).isCompressedTexture === true;
      if (compressed) texture.flipY = false;
      else if (flipY !== undefined) texture.flipY = flipY;
      texture.needsUpdate = true;
      owned.push(texture);
      const slots = material as unknown as Partial<Record<MapSlot, Texture | null>>;
      for (const slot of request.slots) if (slot in material) slots[slot] = texture;
      if (request.slots.includes('map')) onAlbedo();
      material.needsUpdate = true;
    }));
    cleanups.set(material, () => {
      for (const release of releases) release();
      for (const texture of owned) texture.dispose();
    });
  }

  function createLibraryMaterial(source: LibraryMaterial, tiling: SurfaceTiling, displayInput: Partial<SurfaceDisplay> = {}): Material {
    const display = { ...DEFAULT_SURFACE_DISPLAY, ...displayInput };
    const albedo = display.textures ? libraryTextureUrl(source, 'albedo') : undefined;
    // The base colour of a textured finish is a multiplier (usually white); until the texture is
    // there, and when textures are off, the finish shows its representative flat colour instead.
    const hasPattern = source.maps.albedo !== undefined;
    const material = litMaterial(display, {
      color: hasPattern ? source.previewColor : source.color, roughness: source.roughness, metalness: source.metalness, opacity: source.opacity,
    });
    if (!display.textures) return material;
    const requests: TextureRequest[] = [];
    if (albedo) requests.push({ url: albedo, slots: ['map'] });
    if (display.shading === 'rendered') {
      for (const [slot, target] of [['normal', 'normalMap'], ['roughness', 'roughnessMap'], ['metalness', 'metalnessMap'], ['ao', 'aoMap']] as const) {
        const url = libraryTextureUrl(source, slot);
        if (url) requests.push({ url, slots: [target] });
      }
    }
    if (requests.length) attachTextures(material, requests, tiling, source.flipY, () => { material.color.set(source.color); });
    return material;
  }

  function createRegistryMaterial(finish: Extract<SurfaceFinish, { kind: 'registry' }>, options: SurfaceMaterialOptions, display: SurfaceDisplay): Material | null {
    const surface = options.registry?.surface;
    if (!surface || surface.id !== finish.surfaceId) return null;
    const definition = surface.definition, maps = definition.maps;
    const material = litMaterial(display, { color: definition.baseColorFactor, roughness: definition.roughnessFactor, metalness: definition.metallicFactor });
    if (!display.textures) return material;
    const url = (fileId: string) => surfaceTextureUrl(options.registry!.workspaceId, fileId);
    const requests: TextureRequest[] = [{ url: url(maps.baseColor), slots: ['map'] }];
    if (maps.alpha) {
      requests.push({ url: url(maps.alpha), slots: ['alphaMap'] });
      material.transparent = true;
    }
    if (display.shading === 'rendered' && material instanceof MeshStandardMaterial) {
      if (maps.normal) {
        requests.push({ url: url(maps.normal), slots: ['normalMap'] });
        material.normalScale.set(definition.normalScale, definition.normalScale);
      }
      if (maps.orm) requests.push({ url: url(maps.orm), slots: ['aoMap', 'roughnessMap', 'metalnessMap'] });
      if (maps.roughness) requests.push({ url: url(maps.roughness), slots: ['roughnessMap'] });
      if (maps.metalness) requests.push({ url: url(maps.metalness), slots: ['metalnessMap'] });
      if (maps.occlusion) requests.push({ url: url(maps.occlusion), slots: ['aoMap'] });
      if (maps.displacement && definition.displacementScaleMm > 0) {
        requests.push({ url: url(maps.displacement), slots: ['displacementMap'] });
        material.displacementScale = definition.displacementScaleMm;
      }
      if (maps.emissive) {
        requests.push({ url: url(maps.emissive), slots: ['emissiveMap'] });
        material.emissive.set('#ffffff');
      }
    }
    attachTextures(material, requests, registrySurfaceTiling(definition, finish, options), undefined, () => {});
    return material;
  }

  return {
    createSurfaceMaterial(finish, options) {
      if (!finish) return null;
      const display = { shading: options.shading ?? DEFAULT_SURFACE_DISPLAY.shading, textures: options.textures ?? DEFAULT_SURFACE_DISPLAY.textures };
      if (finish.kind === 'paint') {
        const hex = ralHex(finish.ral);
        return hex ? litMaterial(display, { color: hex, roughness: WALL_PAINT_ROUGHNESS, metalness: WALL_PAINT_METALNESS }) : null;
      }
      if (finish.kind === 'registry') return createRegistryMaterial(finish, options, display);
      const source = libraryMaterial(finish.ref);
      return source ? createLibraryMaterial(source, librarySurfaceTiling(source, finish, options), display) : null;
    },
    createLibraryMaterial,
    flatMaterial(spec, display = DEFAULT_SURFACE_DISPLAY) {
      const key = flatMaterialKey(spec, display);
      let material = flat.get(key);
      if (!material) {
        const transparent = spec.opacity !== undefined && spec.opacity < 1;
        const common = {
          color: spec.color, side: spec.doubleSided ? DoubleSide : FrontSide, transparent, opacity: spec.opacity ?? 1,
          depthWrite: spec.depthWrite ?? true,
        };
        material = spec.unlit ? new MeshBasicMaterial(common)
          : display.shading === 'solid' ? new MeshLambertMaterial(common)
            : new MeshStandardMaterial({ ...common, roughness: spec.roughness ?? 1, metalness: spec.metalness ?? 0 });
        material.name = key;
        shared.add(material);
        flat.set(key, material);
      }
      return material;
    },
    disposeSurfaceMaterial(material) {
      if (!material || shared.has(material)) return;
      cleanups.get(material)?.();
      cleanups.delete(material);
      material.dispose();
    },
  };
}
