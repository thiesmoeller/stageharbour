import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Color, NoColorSpace, Object3D, type SpotLight } from 'three';
import type { BarnDoorFlaps, HangPlan } from '../../shared/hangPlan.js';
import { barnDoorCookieMask, openBarnDoors, planMmToViewMetres } from '../../shared/hangPlan.js';
import { resolveFixtureOutput } from '../../shared/lightBoard.js';
import type { Truss } from '../../shared/truss.js';
import { fixtureHangPose } from './StageOverhead.js';
import type { LightBoardLive } from './lightBoardLive.js';

const MAX_FIXTURE_SPOTS = 8;
/** Three.js SpotLight scale at 100% board level — theatrical wash, not desk lamp. */
const SPOT_AT_FULL = 10;

/**
 * SpotLights for Scheinwerfer. Levels come from `lightBoardLive` in useFrame
 * so fader moves do not re-render the scene tree.
 */
export function FixtureSpotLights({ hangPlan, trusses = [], stageWidth, stageDepth, lightBoardLive, enabled }: {
  hangPlan?: HangPlan;
  trusses?: readonly Truss[];
  stageWidth: number;
  stageDepth: number;
  lightBoardLive?: LightBoardLive;
  enabled?: boolean;
}) {
  const fixtures = hangPlan?.fixtures ?? [];
  if (!enabled || !fixtures.length || !lightBoardLive) return null;
  // Mount a stable set (up to cap); intensity including 0 is applied every frame.
  const mounted = fixtures.slice(0, MAX_FIXTURE_SPOTS);

  return <>
    {mounted.map(fixture => {
      const pose = fixtureHangPose(fixture, trusses, stageWidth, stageDepth);
      if (!pose) return null;
      const beam = fixture.focus?.beam ?? 40;
      const hang = planMmToViewMetres(pose.hang.x, pose.hang.y, pose.hang.z, stageWidth);
      const aim = planMmToViewMetres(pose.aim.x, pose.aim.y, pose.aim.z, stageWidth);
      const barnDoors = fixture.barnDoorsAttached ? fixture.focus?.barnDoors ?? openBarnDoors : undefined;
      return <FixtureSpot key={fixture.id} id={fixture.id} hang={hang} aim={aim}
        beamDeg={beam} barnDoors={barnDoors} live={lightBoardLive} />;
    })}
  </>;
}

/** Soft rectangular cookie in the unclipped cone. Rebuilt when the flaps or the beam change. */
function useBarnDoorCookie(flaps: BarnDoorFlaps | undefined, beamDeg: number) {
  const cookie = useMemo(() => {
    if (!flaps) return null;
    // Mask is normalized to the cone, so a beam edit rebinds the same crop to the new angle.
    void beamDeg;
    const mask = barnDoorCookieMask(flaps, 128);
    const canvas = document.createElement('canvas');
    canvas.width = mask.size;
    canvas.height = mask.size;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const image = context.createImageData(mask.size, mask.size);
    for (let i = 0; i < mask.pixels.length; i++) {
      const value = mask.pixels[i]!;
      const offset = i * 4;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [flaps, beamDeg]);
  useEffect(() => () => cookie?.dispose(), [cookie]);
  return cookie;
}

function FixtureSpot({ id, hang, aim, beamDeg, barnDoors, live }: {
  id: string;
  hang: { x: number; y: number; z: number };
  aim: { x: number; y: number; z: number };
  beamDeg: number;
  barnDoors?: BarnDoorFlaps;
  live: LightBoardLive;
}) {
  const cookie = useBarnDoorCookie(barnDoors, beamDeg);
  const target = useMemo(() => new Object3D(), []);
  const lightRef = useRef<SpotLight>(null);
  const color = useMemo(() => new Color(), []);
  useLayoutEffect(() => {
    target.position.set(aim.x, aim.y, aim.z);
  }, [aim.x, aim.y, aim.z, target]);
  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    const level = resolveFixtureOutput(live.get(), id);
    light.intensity = (level.intensity / 100) * SPOT_AT_FULL;
    light.color.copy(color.set(level.color));
    light.visible = level.intensity > 2;
  });
  const dist = Math.hypot(aim.x - hang.x, aim.y - hang.y, aim.z - hang.z) || 1;
  return <>
    <primitive object={target} />
    <spotLight ref={lightRef} name={`fixture-spot-${id}`}
      position={[hang.x, hang.y, hang.z]}
      target={target}
      map={cookie}
      intensity={0}
      distance={Math.max(12, dist * 3.2)}
      angle={(beamDeg * Math.PI) / 360}
      penumbra={0.35}
      decay={0.85}
      castShadow
      shadow-mapSize={[1024, 1024]}
      shadow-bias={-0.00015}
      shadow-normalBias={0.025}
      shadow-camera-near={0.15}
      shadow-camera-far={Math.max(12, dist * 3.5)}
    />
  </>;
}
