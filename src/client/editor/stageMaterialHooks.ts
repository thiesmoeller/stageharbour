import { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react';
import type { Material } from 'three';
import type { SurfaceFinish } from '../../shared/surfaces.js';
import type { StageInstance } from '../stage/instancing.js';
import { useStageInstances, type StageInstanceOwner } from '../stage/StageInstances.js';
import { stageMaterials } from '../stage/stageAssets.js';
import { DEFAULT_SURFACE_DISPLAY, flatMaterialKey, type FlatMaterialSpec, type SurfaceDisplay } from '../stage/surfaceMaterials.js';
import { useSurfaceRegistry } from './SurfaceRegistryContext.js';

/** The Raumsicht's "Darstellung": shading and textures for everything drawn below the provider. */
export const StageDisplay = createContext<SurfaceDisplay>(DEFAULT_SURFACE_DISPLAY);

export function useStageDisplay() {
  return useContext(StageDisplay);
}

/** The element whose parts are being drawn: receives the clicks on its instanced parts. */
export const ElementOwner = createContext<StageInstanceOwner | undefined>(undefined);

export function useElementInstances(instances: readonly StageInstance[]) {
  useStageInstances(instances, useContext(ElementOwner));
}

/** Shared single-colour materials for the current display, by name. `specs` must be a constant. */
export function useFlatMaterials<Name extends string>(specs: Readonly<Record<Name, FlatMaterialSpec>>): Record<Name, Material> {
  const display = useStageDisplay();
  return useMemo(() => {
    const result = {} as Record<Name, Material>;
    for (const name of Object.keys(specs) as Name[]) result[name] = stageMaterials.flatMaterial(specs[name], display);
    return result;
  }, [specs, display]);
}

export function useFlatMaterial(spec: FlatMaterialSpec): Material {
  const display = useStageDisplay();
  const key = flatMaterialKey(spec, display);
  return useMemo(() => stageMaterials.flatMaterial(spec, display), [key]);
}

/**
 * The material of a finish on a face of the given size, or null while there is none (no finish,
 * unknown reference). Created and released with the component.
 */
export function useSurfaceMaterial(finish: SurfaceFinish | undefined, faceWidthMm: number, faceHeightMm: number): Material | null {
  const registry = useSurfaceRegistry();
  const display = useStageDisplay();
  const key = JSON.stringify(finish ?? null);
  const surface = finish?.kind === 'registry' ? registry.surfaces.find(item => item.id === finish.surfaceId) : undefined;
  const [material, setMaterial] = useState<Material | null>(null);
  // Created in an effect, not while rendering: the material holds texture references that only a
  // committed component can give back.
  useLayoutEffect(() => {
    const created = stageMaterials.createSurfaceMaterial(finish, {
      faceWidthMm, faceHeightMm, shading: display.shading, textures: display.textures,
      registry: { workspaceId: registry.workspaceId, surface },
    });
    setMaterial(created);
    return () => stageMaterials.disposeSurfaceMaterial(created);
  }, [key, faceWidthMm, faceHeightMm, display.shading, display.textures, registry.workspaceId, surface]);
  return finish ? material : null;
}
