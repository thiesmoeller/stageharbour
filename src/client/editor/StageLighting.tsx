import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Group, type Light, Object3D } from 'three';
import type { StageLightingSettings } from '../../shared/lighting.js';
import { planMmToViewMetres } from '../../shared/hangPlan.js';
import { resolveHouseScale } from '../../shared/lightBoard.js';
import type { LightBoardLive } from './lightBoardLive.js';

function underTheatre(object: Object3D, root: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) if (node === root) return true;
  return false;
}

function isFixtureSpot(light: Light) {
  return light.name.startsWith('fixture-spot');
}

/**
 * Theatre mood lights (Grundlicht) + studio fill when Bühnenlicht is off.
 * House scale is read from `lightBoardLive` each frame (no React remount on fader).
 */
export function StageLighting({ settings, width, depth, environmentKey = '', units = 1, lightBoardLive }: {
  settings: StageLightingSettings; width: number; depth: number; environmentKey?: string; units?: number;
  lightBoardLive?: LightBoardLive;
}) {
  const root = useRef<Group>(null);
  const scene = useThree(state => state.scene);
  const target = useMemo(() => new Object3D(), []);
  const suppressed = useRef(new Map<Light, { visible: boolean; intensity: number; castShadow: boolean }>());
  const priorBackground = useRef<typeof scene.background>(undefined);
  const house = useRef(new Color());
  const theatre = settings.enabled;
  const bases = useRef(new Map<Light, number>());

  useLayoutEffect(() => {
    priorBackground.current = scene.background;
    bases.current.clear();
    return () => {
      for (const [light, prior] of suppressed.current) {
        light.visible = prior.visible;
        light.intensity = prior.intensity;
        light.castShadow = prior.castShadow;
      }
      suppressed.current.clear();
      if (priorBackground.current !== undefined) scene.background = priorBackground.current;
    };
  }, [environmentKey, scene, settings]);

  useFrame(() => {
    if (!root.current) return;
    const dim = lightBoardLive ? resolveHouseScale(lightBoardLive.get()) : 1;
    const fill = theatre ? settings.ambient / 100 : 0;
    if (theatre) {
      scene.environmentIntensity = fill * 0.55 * dim;
      const g = fill * dim * 0.07;
      scene.background = house.current.setRGB(0.004 + g, 0.004 + g * 1.05, 0.006 + g * 1.1);
    } else {
      const studioEnv = Math.max(0.55, Math.min(scene.environmentIntensity || 0.7, 1)) * Math.max(dim, 0.55);
      scene.environmentIntensity = studioEnv;
      if (priorBackground.current !== undefined) scene.background = priorBackground.current;
    }
    root.current.traverse(object => {
      if (!object.type.endsWith('Light')) return;
      const light = object as Light;
      if (!bases.current.has(light)) bases.current.set(light, light.intensity);
      const base = bases.current.get(light) ?? light.intensity;
      light.intensity = base * dim;
    });
    scene.traverse(object => {
      if (!object.type.endsWith('Light')) return;
      const light = object as Light;
      if (underTheatre(light, root.current!)) return;
      if (isFixtureSpot(light)) return;
      if (!suppressed.current.has(light)) {
        suppressed.current.set(light, { visible: light.visible, intensity: light.intensity, castShadow: light.castShadow });
      }
      light.visible = false;
      light.intensity = 0;
      light.castShadow = false;
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

  return <group ref={root} name="theatre-lighting">
    <primitive object={target} position={[keyTarget.x, keyTarget.y, keyTarget.z]} />
    {ambientIntensity > 0 && <>
      <ambientLight intensity={ambientIntensity} />
      <hemisphereLight args={['#f2f5f8', '#4a5248', ambientIntensity * 0.55]} />
    </>}
    <directionalLight name="theatre-key" position={[w / 2, h, frontZ]} target={target}
      color={frontColor} intensity={front / 55} castShadow={false} />
    {[.2, .8].map(frac => {
      const pos = planMmToViewMetres(width * frac, (theatre ? settings.height : 4500), 0, width, units);
      return <spotLight key={frac} name="theatre-front" position={[pos.x, h, frontZ]} target={target}
        color={frontColor} intensity={front / 55} angle={(theatre ? settings.beam : 80) * Math.PI / 360} penumbra={.45} decay={0} castShadow={false} />;
    })}
    <spotLight name="theatre-back" position={[w / 2, h, backZ]} target={target} color={backColor}
      intensity={back / 70} angle={(theatre ? settings.beam : 80) * Math.PI / 360} penumbra={.65} decay={0} castShadow={false} />
  </group>;
}
