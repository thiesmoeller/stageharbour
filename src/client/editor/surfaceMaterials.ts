import { getMaterialPresetByRef, type MaterialPresetPayload } from '@pascal-app/core';
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

export type SurfaceMaterialOptions = {
  /** Face width in millimetres (for library scale → texture repeat). */
  faceWidthMm: number;
  /** Face height in millimetres. */
  faceHeightMm: number;
  shading?: 'rendered' | 'solid';
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
    mapProperties.repeatX = Math.max(0.05, options.faceWidthMm / finish.scaleMm);
    mapProperties.repeatY = Math.max(0.05, options.faceHeightMm / finish.scaleMm);
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
