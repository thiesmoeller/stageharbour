import { useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Object3D, type DirectionalLight } from 'three';
import { vector, type StageBounds } from './cameraFraming.js';
import { keyLightDirection, lightTheme, type LightTheme, type LightThemeId } from './lightThemes.js';
import { STAGE_QUALITY, type StageQuality } from './renderer.js';
import { fitDirectionalShadow, withShadowFootprint } from './shadowFit.js';

/**
 * Renders one light theme: ambient, hemisphere, a shadow-casting key light whose shadow camera is
 * fitted to `bounds`, and a fill light. Shadows follow the quality unless `castShadow` is false.
 * With `shadowGroundY` the fit also covers the shadow that `bounds` casts on that ground plane.
 */
export function StageLights({ theme, quality = 'enhanced', bounds, castShadow = true, shadowGroundY }: {
  theme: LightThemeId | LightTheme;
  quality?: StageQuality;
  bounds?: StageBounds;
  castShadow?: boolean;
  shadowGroundY?: number;
}) {
  const spec = typeof theme === 'string' ? lightTheme(theme) : theme;
  const shadows = castShadow && STAGE_QUALITY[quality].shadows;
  const boundsKey = bounds ? JSON.stringify(bounds) : '';
  const fit = useMemo(() => {
    const direction = keyLightDirection(spec);
    const covered = bounds && shadowGroundY !== undefined ? withShadowFootprint(bounds, direction, shadowGroundY) : bounds;
    return fitDirectionalShadow(covered, direction, spec.shadow);
  }, [boundsKey, spec, shadowGroundY]);
  const keyTarget = useMemo(() => new Object3D(), []);
  const fillTarget = useMemo(() => new Object3D(), []);
  const key = useRef<DirectionalLight>(null);
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => {
    const light = key.current;
    if (!light) return;
    const camera = light.shadow.camera;
    Object.assign(camera, fit.camera);
    camera.updateProjectionMatrix();
    if (light.shadow.mapSize.x !== fit.mapSize) {
      light.shadow.mapSize.setScalar(fit.mapSize);
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
    light.shadow.needsUpdate = true;
    invalidate();
  }, [fit, shadows, invalidate]);
  return <group name="stage-theme-lights">
    <ambientLight color={spec.ambient.color} intensity={spec.ambient.intensity} />
    <hemisphereLight color={spec.hemisphere.sky} groundColor={spec.hemisphere.ground} intensity={spec.hemisphere.intensity} />
    <primitive object={keyTarget} position={vector(fit.target)} />
    <directionalLight ref={key} name="stage-key-light" position={vector(fit.position)} target={keyTarget}
      color={spec.key.color} intensity={spec.key.intensity} castShadow={shadows}
      shadow-bias={spec.shadow.bias} shadow-normalBias={fit.normalBias} shadow-radius={spec.shadow.radius} shadow-intensity={spec.shadow.intensity} />
    <primitive object={fillTarget} position={vector(spec.fill.target)} />
    <directionalLight name="stage-fill-light" position={vector(spec.fill.position)} target={fillTarget}
      color={spec.fill.color} intensity={spec.fill.intensity} />
  </group>;
}
