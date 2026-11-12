import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Group, type DirectionalLight, type Light, Object3D } from 'three';
import type { StageLightingSettings } from '../../shared/lighting.js';
import { planMmToViewMetres } from '../../shared/hangPlan.js';
import { resolveHouseScale } from '../../shared/lightBoard.js';
import type { StageBounds, Vec3 } from '../stage/cameraFraming.js';
import { toneMapStageColor } from '../stage/renderer.js';
import type { ShadowSpec } from '../stage/lightThemes.js';
import { fitDirectionalShadow, withShadowFootprint } from '../stage/shadowFit.js';
import type { LightBoardLive } from './lightBoardLive.js';

/** Soft shadow of the key light, for "Hohe Renderqualität". */
const KEY_SHADOW: ShadowSpec = { intensity: 0.75, bias: -0.0005, normalBias: 0.08, radius: 3, mapSize: 2048 };

/**
 * The Raumsicht's light rig: construction light when Bühnenlicht is off, Grundlicht (theatre mood)
 * when it is on. It is the only source of general light in the Raumsicht; Scheinwerfer come from
 * FixtureSpotLights. House scale is read from `lightBoardLive` each frame (no React re-render on
 * a fader move).
 */
export function StageLighting({ settings, width, depth, units = 1, lightBoardLive, keyShadows = false, bounds, backdrop }: {
  settings: StageLightingSettings; width: number; depth: number; units?: number;
  lightBoardLive?: LightBoardLive;
  /** Backdrop colour while Bühnenlicht is off (the theme's); drawn tone mapped like the scene. */
  backdrop: string;
  /** The key light casts a soft shadow fitted to `bounds` (view-space metres). */
  keyShadows?: boolean;
  bounds?: StageBounds;
}) {
  const root = useRef<Group>(null);
  const key = useRef<DirectionalLight>(null);
  const scene = useThree(state => state.scene);
  const invalidate = useThree(state => state.invalidate);
  const target = useMemo(() => new Object3D(), []);
  const shadowTarget = useMemo(() => new Object3D(), []);
  const house = useRef(new Color());
  const theatre = settings.enabled;
  const bases = useRef(new Map<Light, number>());

  useLayoutEffect(() => {
    const previous = scene.background;
    bases.current.clear();
    return () => { scene.background = previous; };
  }, [scene, settings]);
  useEffect(() => lightBoardLive?.subscribe(() => invalidate()), [lightBoardLive, invalidate]);

  useFrame(({ gl }) => {
    if (!root.current) return;
    const dim = lightBoardLive ? resolveHouseScale(lightBoardLive.get()) : 1;
    if (theatre) {
      // A dark house: the backdrop follows the Grundlicht level instead of the theme colour.
      const glow = settings.ambient / 100 * dim * 0.07;
      house.current.setRGB(0.004 + glow, 0.004 + glow * 1.05, 0.006 + glow * 1.1);
    } else {
      house.current.set(backdrop);
    }
    scene.background = toneMapStageColor(house.current, gl.toneMappingExposure);
    root.current.traverse(object => {
      if (!object.type.endsWith('Light')) return;
      const light = object as Light;
      if (!bases.current.has(light)) bases.current.set(light, light.intensity);
      light.intensity = (bases.current.get(light) ?? light.intensity) * dim;
    });
    target.updateMatrixWorld();
  }, -1);

  const w = width / 1000 * units, d = depth / 1000 * units, h = (theatre ? settings.height : 4500) / 1000 * units;
  const frontZ = -Math.max(d * 0.45, 2 * units);
  const backZ = d + Math.max(d * 0.2, 1 * units);
  const front = theatre ? settings.front : 90;
  const back = theatre ? settings.back : 25;
  const ambient = theatre ? settings.ambient : 35;
  const frontColor = theatre ? settings.frontColor : '#ffffff';
  const backColor = theatre ? settings.backColor : '#d0d8e8';
  const ambientIntensity = ambient / 40;
  const keyTarget = planMmToViewMetres(width / 2, 800, depth * 0.45, width, units);
  const keyPosition: Vec3 = [w / 2, h, frontZ];

  const boundsKey = bounds ? JSON.stringify(bounds) : '';
  const direction: Vec3 = [keyPosition[0] - keyTarget.x, keyPosition[1] - keyTarget.y, keyPosition[2] - keyTarget.z];
  const directionKey = direction.join(',');
  // A directional light shines along (position − target) only, so the fit may move it freely
  // along that line to cover the stage without changing the lighting.
  const fit = useMemo(() => keyShadows && bounds
    ? fitDirectionalShadow(withShadowFootprint(bounds, direction, bounds.min[1]), direction, KEY_SHADOW)
    : undefined, [keyShadows, boundsKey, directionKey]);
  useLayoutEffect(() => {
    const light = key.current;
    if (!light || !fit) return;
    Object.assign(light.shadow.camera, fit.camera);
    light.shadow.camera.updateProjectionMatrix();
    if (light.shadow.mapSize.x !== fit.mapSize) {
      light.shadow.mapSize.setScalar(fit.mapSize);
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
    light.shadow.needsUpdate = true;
    invalidate();
  }, [fit, invalidate]);

  return <group ref={root} name="theatre-lighting">
    <primitive object={target} position={[keyTarget.x, keyTarget.y, keyTarget.z]} />
    {fit && <primitive object={shadowTarget} position={fit.target} />}
    {ambientIntensity > 0 && <>
      <ambientLight intensity={ambientIntensity} />
      <hemisphereLight args={['#f2f5f8', '#4a5248', ambientIntensity * 0.55]} />
    </>}
    <directionalLight ref={key} name="theatre-key" position={fit ? fit.position : keyPosition} target={fit ? shadowTarget : target}
      color={frontColor} intensity={front / 55} castShadow={!!fit}
      shadow-bias={KEY_SHADOW.bias} shadow-normalBias={fit?.normalBias ?? KEY_SHADOW.normalBias}
      shadow-radius={KEY_SHADOW.radius} shadow-intensity={KEY_SHADOW.intensity} />
    {[.2, .8].map(frac => {
      const pos = planMmToViewMetres(width * frac, (theatre ? settings.height : 4500), 0, width, units);
      return <spotLight key={frac} name="theatre-front" position={[pos.x, h, frontZ]} target={target}
        color={frontColor} intensity={front / 55} angle={(theatre ? settings.beam : 80) * Math.PI / 360} penumbra={.45} decay={0} castShadow={false} />;
    })}
    <spotLight name="theatre-back" position={[w / 2, h, backZ]} target={target} color={backColor}
      intensity={back / 70} angle={(theatre ? settings.beam : 80) * Math.PI / 360} penumbra={.65} decay={0} castShadow={false} />
  </group>;
}
