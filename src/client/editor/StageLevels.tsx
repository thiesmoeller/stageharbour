import { useLayoutEffect, useMemo } from 'react';
import { ExtrudeGeometry, Shape } from 'three';
import type { StageModel } from '../../shared/transforms.js';
import { platformCentroid, type Platform } from '../../shared/levels.js';

function outlinePlanRotation(outline: Platform['outline']) {
  const a = outline[0], b = outline[1];
  if (!a || !b) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function PlatformMesh({ platform, lit }: { platform: Platform; lit: boolean }) {
  const Surface = lit ? 'meshStandardMaterial' : 'meshBasicMaterial';
  const centre = platformCentroid(platform.outline);
  const rotation = outlinePlanRotation(platform.outline);
  const geometry = useMemo(() => {
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const shape = new Shape();
    platform.outline.forEach((point, index) => {
      const dx = point.x - centre.x, dy = point.y - centre.y;
      // Un-rotate into the podium's local plan axes (width along +X, depth along +Y).
      const x = dx * cos + dy * sin;
      const y = -dx * sin + dy * cos;
      if (index === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    const extruded = new ExtrudeGeometry(shape, { depth: 40, bevelEnabled: false, steps: 1 });
    extruded.rotateX(Math.PI / 2);
    return extruded;
  }, [platform, centre.x, centre.y, rotation]);
  useLayoutEffect(() => () => { geometry?.dispose(); }, [geometry]);
  if (!geometry) return null;
  // Match wallSolid: rotationY = -planRotation so local +X follows the first outline edge.
  return <group position={[centre.x, 0, centre.y]} rotation={[0, -rotation, 0]}>
    <mesh castShadow={lit} receiveShadow={lit} position={[0, platform.elevation, 0]} geometry={geometry}>
      <Surface color="#c5d0b8" />
    </mesh>
  </group>;
}

export function StageLevels({ model, lit = false }: { model: StageModel; lit?: boolean }) {
  const Surface = lit ? 'meshStandardMaterial' : 'meshBasicMaterial';
  return <>
    {model.platforms.map(platform => <PlatformMesh key={platform.id} platform={platform} lit={lit} />)}
    {model.stairs.flatMap(stair => stair.steps.map((step, index) =>
      <mesh castShadow={lit} receiveShadow={lit} key={`${stair.id}-${index}`} position={[step.x, step.y, step.z]} rotation={[0, step.rotationY, 0]}>
        <boxGeometry args={[step.width, step.height, step.depth]} />
        <Surface color="#d5decc" />
      </mesh>))}
  </>;
}

export function StageLevelList({ model }: { model: StageModel }) {
  if (!model.platforms.length && !model.stairs.length) return null;
  return <ul aria-label="Ebenen in der Raumsicht">
    {model.platforms.map(platform => <li key={platform.id} data-testid={`stage-platform-${platform.id}`} data-elevation={platform.elevation}>
      {platform.label}: {platform.elevation} mm über Fußboden</li>)}
    {model.stairs.map(stair => <li key={stair.id} data-testid={`stage-stair-${stair.id}`} data-rise={stair.rise}>
      {stair.label}: {stair.rise} mm Steigung</li>)}
  </ul>;
}
