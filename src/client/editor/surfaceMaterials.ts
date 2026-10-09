import { getMaterialPresetByRef, MaterialPresetPayloadSchema, type MaterialPresetPayload } from '@pascal-app/core';
import {
  applyMaterialPresetToMaterials,
  createDefaultMaterial,
  createMaterialFromPresetRef,
  disposeMaterial,
} from '@pascal-app/viewer';
import type { Material } from 'three';
import { DoubleSide } from 'three';
import { ralHex, WALL_PAINT_METALNESS, WALL_PAINT_ROUGHNESS } from '../../shared/ral.js';
import { type SurfaceFinish } from '../../shared/surfaces.js';
import type { SurfaceRecord } from '../../shared/surfaceRegistry.js';
import { surfaceTextureUrl } from './SurfaceRegistryContext.js';

export type SurfaceMaterialOptions = {
  /** Face width in millimetres (for library scale → texture repeat). */
  faceWidthMm: number;
  /** Face height in millimetres. */
  faceHeightMm: number;
  shading?: 'rendered' | 'solid';
  registry?: { workspaceId: string; surface?: SurfaceRecord };
};

/** Clone a Pascal preset and apply grain rotation + optional physical scale (mm per tile). */
export function libraryPresetWithSurface(
  finish: Extract<SurfaceFinish, { kind: 'library' }>,
  options: SurfaceMaterialOptions,
): MaterialPresetPayload | null {
  const base = getMaterialPresetByRef(finish.ref);
  if (!base) return null;
  const mapProperties = { ...base.mapProperties };
  if (finish.scaleMm != null) {
    // A quarter turn swaps the texture axes. Swap the physical face dimensions
    // as well so one texture tile remains the same size instead of stretching.
    const quarterTurn = finish.rotationDeg === 90 || finish.rotationDeg === 270;
    const textureWidthMm = quarterTurn ? options.faceHeightMm : options.faceWidthMm;
    const textureHeightMm = quarterTurn ? options.faceWidthMm : options.faceHeightMm;
    mapProperties.repeatX = Math.max(0.05, textureWidthMm / finish.scaleMm);
    mapProperties.repeatY = Math.max(0.05, textureHeightMm / finish.scaleMm);
  }
  if (finish.rotationDeg != null) {
    mapProperties.rotation = (finish.rotationDeg * Math.PI) / 180;
  }
  return {
    maps: { ...base.maps },
    mapProperties,
  };
}

/** Build a Three.js material for a surface finish, or null to use the mesh default. */
export function createSurfaceMaterial(
  finish: SurfaceFinish | undefined,
  options: SurfaceMaterialOptions,
): Material | null {
  if (!finish) return null;
  if (finish.kind === 'paint') {
    const hex = ralHex(finish.ral);
    if (!hex) return null;
    const material = createDefaultMaterial(hex, WALL_PAINT_ROUGHNESS, options.shading ?? 'rendered', DoubleSide);
    if ('metalness' in material) (material as Material & { metalness: number }).metalness = WALL_PAINT_METALNESS;
    return material;
  }
  if (finish.kind === 'registry') {
    const surface = options.registry?.surface;
    if (!surface || surface.id !== finish.surfaceId) return null;
    const definition = surface.definition;
    const tileWidthMm = finish.scaleMm ?? definition.tileWidthMm;
    const tileHeightMm = definition.tileHeightMm * (tileWidthMm / definition.tileWidthMm);
    const quarterTurn = finish.rotationDeg === 90 || finish.rotationDeg === 270;
    const maps = definition.maps;
    const url = (fileId: string | undefined) => fileId && surfaceTextureUrl(options.registry!.workspaceId, fileId);
    const orm = url(maps.orm);
    const preset = MaterialPresetPayloadSchema.parse({
      maps: {
        albedoMap: url(maps.baseColor),
        normalMap: url(maps.normal),
        roughnessMap: orm ?? url(maps.roughness),
        metalnessMap: orm ?? url(maps.metalness),
        aoMap: orm ?? url(maps.occlusion),
        displacementMap: url(maps.displacement),
        alphaMap: url(maps.alpha),
        emissiveMap: url(maps.emissive),
      },
      mapProperties: {
        color: definition.baseColorFactor,
        roughness: definition.roughnessFactor,
        metalness: definition.metallicFactor,
        repeatX: Math.max(0.05, (quarterTurn ? options.faceHeightMm : options.faceWidthMm) / tileWidthMm),
        repeatY: Math.max(0.05, (quarterTurn ? options.faceWidthMm : options.faceHeightMm) / tileHeightMm),
        rotation: ((finish.rotationDeg ?? 0) * Math.PI) / 180,
        normalScaleX: definition.normalScale,
        normalScaleY: definition.normalScale,
        displacementScale: definition.displacementScaleMm,
        transparent: !!maps.alpha,
        side: DoubleSide,
      },
    });
    const material = createDefaultMaterial(
      definition.baseColorFactor, definition.roughnessFactor, options.shading ?? 'rendered', DoubleSide,
    );
    if ('metalness' in material) (material as Material & { metalness: number }).metalness = definition.metallicFactor;
    applyMaterialPresetToMaterials(material, preset);
    material.side = DoubleSide;
    return material;
  }
  const preset = libraryPresetWithSurface(finish, options);
  if (!preset) return null;
  const shading = options.shading ?? 'rendered';
  // Public API only exposes createMaterialFromPresetRef (cached). Clone so scale/rotation
  // overrides and dispose stay local to this wall slot.
  const catalog = createMaterialFromPresetRef(finish.ref, shading);
  if (!catalog) return null;
  const material = catalog.clone();
  delete material.userData.__pascalCachedMaterial;
  applyMaterialPresetToMaterials(material, preset);
  material.side = DoubleSide;
  return material;
}

export function disposeSurfaceMaterial(material: Material | null | undefined) {
  if (material) disposeMaterial(material);
}
