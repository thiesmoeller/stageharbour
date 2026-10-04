import { useLayoutEffect, useMemo } from 'react';
import { Object3D } from 'three';
import type { HangPlan, LightLook } from '../../shared/hangPlan.js';
import { clippedBeamDegrees, planMmToViewMetres } from '../../shared/hangPlan.js';
import type { Truss } from '../../shared/truss.js';
import { fixtureHangPose, lookLevelForFixture, type FixturePreviewMode } from './StageOverhead.js';

const MAX_FIXTURE_SPOTS = 8;

/**
 * SpotLights for Scheinwerfer — beams light objects and cast shadows between them.
 * Keep castShadow stably true while enabled (Pascal/WebGPU dislikes toggling maps).
 */
export function FixtureSpotLights({ hangPlan, trusses = [], stageWidth, stageDepth, activeLook, blackoutLevel = 1, previewMode = 'look', liveOn, enabled }: {
  hangPlan?: HangPlan;
  trusses?: readonly Truss[];
  stageWidth: number;
  stageDepth: number;
  activeLook?: LightLook;
  blackoutLevel?: number;
  previewMode?: FixturePreviewMode;
  liveOn?: (fixtureId: string) => boolean;
  enabled?: boolean;
}) {
  const fixtures = hangPlan?.fixtures ?? [];
  if (!enabled || !fixtures.length) return null;
  const lit = fixtures.filter(fixture => {
    const level = lookLevelForFixture(activeLook, fixture.id, {
      blackoutLevel, mode: previewMode, liveOn: liveOn?.(fixture.id) ?? true,
    });
    return level.intensity > 2;
  }).slice(0, MAX_FIXTURE_SPOTS);

  return <>
    {lit.map(fixture => {
      const pose = fixtureHangPose(fixture, trusses, stageWidth, stageDepth);
      if (!pose) return null;
      const level = lookLevelForFixture(activeLook, fixture.id, {
        blackoutLevel, mode: previewMode, liveOn: liveOn?.(fixture.id) ?? true,
      });
      const beam = clippedBeamDegrees(
        fixture.focus?.beam ?? 40,
        fixture.barnDoorsAttached ? fixture.focus?.barnDoors : undefined,
      );
      const hang = planMmToViewMetres(pose.hang.x, pose.hang.y, pose.hang.z, stageWidth);
      const aim = planMmToViewMetres(pose.aim.x, pose.aim.y, pose.aim.z, stageWidth);
      return <FixtureSpot key={fixture.id} id={fixture.id} hang={hang} aim={aim}
        intensity={level.intensity} color={level.color} beamDeg={beam} />;
    })}
  </>;
}

function FixtureSpot({ id, hang, aim, intensity, color, beamDeg }: {
  id: string;
  hang: { x: number; y: number; z: number };
  aim: { x: number; y: number; z: number };
  intensity: number;
  color: string;
  beamDeg: number;
}) {
  const target = useMemo(() => new Object3D(), []);
  useLayoutEffect(() => {
    target.position.set(aim.x, aim.y, aim.z);
  }, [aim.x, aim.y, aim.z, target]);
  const dist = Math.hypot(aim.x - hang.x, aim.y - hang.y, aim.z - hang.z) || 1;
  return <>
    <primitive object={target} />
    <spotLight name={`fixture-spot-${id}`}
      position={[hang.x, hang.y, hang.z]}
      target={target}
      color={color}
      intensity={(intensity / 100) * 3.4}
      distance={Math.max(8, dist * 2.5)}
      angle={(beamDeg * Math.PI) / 360}
      penumbra={0.4}
      decay={1.1}
      castShadow
      shadow-mapSize={[1024, 1024]}
      shadow-bias={-0.00015}
      shadow-normalBias={0.025}
      shadow-camera-near={0.15}
      shadow-camera-far={Math.max(10, dist * 2.8)}
    />
  </>;
}
