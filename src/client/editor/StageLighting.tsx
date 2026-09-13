import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Group, type Light, Object3D } from 'three';
import type { StageLightingSettings } from '../../shared/lighting.js';

function underTheatre(object: Object3D, root: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) if (node === root) return true;
  return false;
}

/**
 * Theatre lights in venue space: +Z away from the audience (upstage).
 *
 * Pascal's Viewer aims its studio key from +Z (architectural “front”), which is
 * our upstage / back of house — so shelves appear lit from behind and open away
 * from the audience. Those lights also lerp intensity every frame; zero them in
 * a useFrame that runs *after* Pascal's Lights update (priority -1).
 *
 * Even with Bühnenlicht off we keep an audience-side key so the default Raumsicht
 * matches Publikum → Bühne. Millimetre venue coordinates convert once here.
 *
 * Grundhelligkeit 0 % is a dark theatre: no ambient fill, no IBL, near-black void.
 */
export function StageLighting({ settings, width, depth, environmentKey = '', units = 1 }: {
  settings: StageLightingSettings; width: number; depth: number; environmentKey?: string; units?: number;
}) {
  const root = useRef<Group>(null);
  const scene = useThree(state => state.scene);
  const target = useMemo(() => new Object3D(), []);
  const suppressed = useRef(new Map<Light, { visible: boolean; intensity: number; castShadow: boolean }>());
  const priorBackground = useRef<typeof scene.background>(undefined);
  const house = useRef(new Color());
  const theatre = settings.enabled;

  useLayoutEffect(() => {
    priorBackground.current = scene.background;
    return () => {
      for (const [light, prior] of suppressed.current) {
        light.visible = prior.visible;
        light.intensity = prior.intensity;
        light.castShadow = prior.castShadow;
      }
      suppressed.current.clear();
      if (priorBackground.current !== undefined) scene.background = priorBackground.current;
    };
  }, [environmentKey, scene]);

  // Priority -1: run after Pascal's Lights (priority 0) lerps studio intensities back.
  useFrame(() => {
    if (!root.current) return;
    const fill = theatre ? settings.ambient / 100 : 0;
    // 0 % Grundhelligkeit = blackout fill (no IBL). Higher values restore soft fill only.
    scene.environmentIntensity = theatre ? fill * 0.55 : Math.min(scene.environmentIntensity, 0.15);
    if (theatre) {
      // Dark house: background tracks ambient so 0 % is a black void, not a lit studio wrap.
      const g = fill * 0.07;
      scene.background = house.current.setRGB(0.004 + g, 0.004 + g * 1.05, 0.006 + g * 1.1);
    } else if (priorBackground.current !== undefined) {
      scene.background = priorBackground.current;
    }
    scene.traverse(object => {
      if (!object.type.endsWith('Light')) return;
      const light = object as Light;
      if (underTheatre(light, root.current!)) return;
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
  const far = Math.max(w, d, h, Math.abs(frontZ), backZ) * 4;
  const shadowExtent = Math.max(w, d) * 1.2;
  const front = theatre ? settings.front : 90;
  const back = theatre ? settings.back : 25;
  const ambient = theatre ? settings.ambient : 35;
  const frontColor = theatre ? settings.frontColor : '#ffffff';
  const backColor = theatre ? settings.backColor : '#d0d8e8';
  const ambientIntensity = ambient / 40;
  return <group ref={root} name="theatre-lighting">
    <primitive object={target} position={[w / 2, .8 * units, d * .45]} />
    {ambientIntensity > 0 && <>
      <ambientLight intensity={ambientIntensity} />
      <hemisphereLight args={['#f2f5f8', '#4a5248', ambientIntensity * 0.55]} />
    </>}
    <directionalLight name="theatre-key" position={[w / 2, h, frontZ]} target={target}
      color={frontColor} intensity={front / 55} castShadow={front > 0}
      shadow-mapSize={[2048, 2048]} shadow-bias={-.0005} shadow-normalBias={.02 * units}>
      <orthographicCamera attach="shadow-camera" args={[-shadowExtent, shadowExtent, shadowExtent, -shadowExtent, .1 * units, far]} />
    </directionalLight>
    {[.2, .8].map(x => <spotLight key={x} name="theatre-front" position={[w * x, h, frontZ]} target={target}
      color={frontColor} intensity={front / 55} angle={(theatre ? settings.beam : 80) * Math.PI / 360} penumbra={.45} decay={0} />)}
    <spotLight name="theatre-back" position={[w / 2, h, backZ]} target={target} color={backColor}
      intensity={back / 70} angle={(theatre ? settings.beam : 80) * Math.PI / 360} penumbra={.65} decay={0} />
  </group>;
}
