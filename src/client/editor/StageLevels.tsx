import { useLayoutEffect, useMemo } from 'react';
import { ExtrudeGeometry, Shape } from 'three';
import type { StageModel } from '../../shared/transforms.js';
import type { Platform } from '../../shared/levels.js';

function PlatformMesh({ platform }: { platform: Platform }) {
  const geometry = useMemo(() => {
    const shape = new Shape();
    const [first, ...rest] = platform.outline;
    if (!first) return null;
    shape.moveTo(first.x, first.y);
    for (const point of rest) shape.lineTo(point.x, point.y);
    shape.closePath();
    const extruded = new ExtrudeGeometry(shape, { depth: 40, bevelEnabled: false, steps: 1 });
    extruded.rotateX(Math.PI / 2);
    extruded.translate(0, platform.elevation, 0);
    return extruded;
  }, [platform]);
  useLayoutEffect(() => () => { geometry?.dispose(); }, [geometry]);
  if (!geometry) return null;
  return <mesh geometry={geometry}><meshBasicMaterial color="#c5d0b8" /></mesh>;
}

export function StageLevels({ model }: { model: StageModel }) {
  return <>
    {model.platforms.map(platform => <PlatformMesh key={platform.id} platform={platform} />)}
    {model.stairs.flatMap(stair => stair.steps.map((step, index) =>
      <mesh key={`${stair.id}-${index}`} position={[step.x, step.y, step.z]} rotation={[0, step.rotationY, 0]}>
        <boxGeometry args={[step.width, step.height, step.depth]} />
        <meshBasicMaterial color="#d5decc" />
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
