import { useLayoutEffect, useMemo } from 'react';
import { ExtrudeGeometry, Shape } from 'three';
import { createMaterialFromPresetRef } from '@pascal-app/viewer';
import type { StageModel } from '../../shared/transforms.js';
import { platformBounds, platformCentroid, type Platform } from '../../shared/levels.js';
import {
  STAGE_DECK_LEG_SECTION_MM, STAGE_DECK_TOP_THICKNESS_MM, layoutStageDeckModules, stageDeckLegPositions,
} from '../../shared/stageDeck.js';

function outlinePlanRotation(outline: Platform['outline']) {
  const a = outline[0], b = outline[1];
  if (!a || !b) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function PlatformMesh({ platform, lit }: { platform: Platform; lit: boolean }) {
  const Surface = lit ? 'meshStandardMaterial' : 'meshBasicMaterial';
  const centre = platformCentroid(platform.outline);
  const rotation = outlinePlanRotation(platform.outline);
  const style = platform.style ?? 'floating';
  const bounds = platformBounds(platform.outline);
  const finishMaterial = useMemo(() => createMaterialFromPresetRef(platform.finish), [platform.finish]);
  useLayoutEffect(() => () => { finishMaterial?.dispose(); }, [finishMaterial]);
  const deckThickness = style === 'solid' ? platform.elevation : style === 'stageDeck' ? STAGE_DECK_TOP_THICKNESS_MM : 40;
  const geometry = useMemo(() => {
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const shape = new Shape();
    platform.outline.forEach((point, index) => {
      const dx = point.x - centre.x, dy = point.y - centre.y;
      const x = dx * cos + dy * sin;
      const y = -dx * sin + dy * cos;
      if (index === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    const extruded = new ExtrudeGeometry(shape, { depth: deckThickness, bevelEnabled: false, steps: 1 });
    extruded.rotateX(Math.PI / 2);
    return extruded;
  }, [platform, centre.x, centre.y, rotation, deckThickness]);
  useLayoutEffect(() => () => { geometry?.dispose(); }, [geometry]);
  if (!geometry) return null;
  // ExtrudeGeometry is rotated so the top face sits at local y=0 and depth goes downward.
  // Place the mesh at the walking surface so Massiv fills floor→elevation, not straddling mid-height.
  const deckY = platform.elevation;
  const legs = style === 'stageDeck' ? stageDeckLegPositions(bounds.width, bounds.depth) : [];
  const modules = style === 'stageDeck' ? layoutStageDeckModules(bounds.width, bounds.depth) : [];
  const legHeight = Math.max(1, platform.elevation - STAGE_DECK_TOP_THICKNESS_MM / 2);
  return <group position={[centre.x, 0, centre.y]} rotation={[0, -rotation, 0]}>
    <mesh castShadow={lit} receiveShadow={lit} position={[0, deckY, 0]} geometry={geometry}>
      {finishMaterial ? <primitive object={finishMaterial} attach="material" dispose={null} /> : <Surface color="#c5d0b8" />}
    </mesh>
    {style === 'stageDeck' && legs.map((leg, index) =>
      <mesh key={`leg-${index}`} castShadow={lit} position={[leg.x, legHeight / 2, leg.y]}>
        <boxGeometry args={[STAGE_DECK_LEG_SECTION_MM, legHeight, STAGE_DECK_LEG_SECTION_MM]} />
        <Surface color="#8a9080" />
      </mesh>)}
    {style === 'stageDeck' && modules.map((module, index) =>
      <mesh key={`seam-${index}`} position={[module.x, platform.elevation + 1, module.y]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[module.width - 20, module.depth - 20]} />
        <meshBasicMaterial color="#9aa890" transparent opacity={0.35} />
      </mesh>)}
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
