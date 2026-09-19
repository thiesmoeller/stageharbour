import { useLayoutEffect, useMemo } from 'react';
import { ExtrudeGeometry, Shape } from 'three';
import { createMaterialFromPresetRef } from '@pascal-app/viewer';
import type { StageModel } from '../../shared/transforms.js';
import { platformBounds, platformCentroid, outlineFullyOn, type Platform } from '../../shared/levels.js';
import {
  STAGE_DECK_FRAME_PROFILE_MM, STAGE_DECK_LEG_SECTION_MM, STAGE_DECK_RUBBER_HEIGHT_MM,
  STAGE_DECK_RUBBER_SECTION_MM, STAGE_DECK_TOP_THICKNESS_MM, layoutStageDeckModules, stageDeckLegPositions,
  type StageDeckModule,
} from '../../shared/stageDeck.js';

/** GUIL-style TM-440 / PTA-440: phenolic infield, aluminum frame + Steckfüße, rubber caps. */
const DECK_TOP = '#4a3426';
const ALUMINUM = '#c4c8cd';
const RUBBER = '#1a1a1a';
/** Keep phenolic and frame from sharing a face (avoids Z-fighting). */
const FIT_GAP_MM = 1;

function outlinePlanRotation(outline: Platform['outline']) {
  const a = outline[0], b = outline[1];
  if (!a || !b) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function AluminumMaterial({ lit }: { lit: boolean }) {
  return lit
    ? <meshStandardMaterial color={ALUMINUM} metalness={0.65} roughness={0.35} />
    : <meshBasicMaterial color={ALUMINUM} />;
}

/** One catalog module: aluminum rim + inset phenolic — volumes do not overlap. */
function StageDeckModuleMesh({ module, elevation, lit }: {
  module: StageDeckModule; elevation: number; lit: boolean;
}) {
  const t = STAGE_DECK_TOP_THICKNESS_MM;
  const f = STAGE_DECK_FRAME_PROFILE_MM;
  const y = elevation - t / 2;
  const { x, y: z, width, depth } = module;
  const innerW = Math.max(1, width - 2 * f - FIT_GAP_MM);
  const innerD = Math.max(1, depth - 2 * f - FIT_GAP_MM);
  const edges = [
    { pos: [x, y, z + (depth - f) / 2] as const, size: [width, t, f] as const },
    { pos: [x, y, z - (depth - f) / 2] as const, size: [width, t, f] as const },
    { pos: [x + (width - f) / 2, y, z] as const, size: [f, t, Math.max(1, depth - 2 * f)] as const },
    { pos: [x - (width - f) / 2, y, z] as const, size: [f, t, Math.max(1, depth - 2 * f)] as const },
  ];
  return <group>
    {edges.map((edge, index) =>
      <mesh key={index} castShadow={lit} receiveShadow={lit} position={[...edge.pos]}>
        <boxGeometry args={[...edge.size]} />
        <AluminumMaterial lit={lit} />
      </mesh>)}
    <mesh castShadow={lit} receiveShadow={lit} position={[x, y, z]}>
      <boxGeometry args={[innerW, t, innerD]} />
      {lit ? <meshStandardMaterial color={DECK_TOP} roughness={0.9} metalness={0} />
        : <meshBasicMaterial color={DECK_TOP} />}
    </mesh>
  </group>;
}

function supportElevationFor(platform: Platform, peers: readonly Platform[]) {
  if (platform.supportingSurfaceId) {
    const support = peers.find(item => item.id === platform.supportingSurfaceId);
    if (support) return support.elevation;
  }
  const under = peers.filter(other => other.id !== platform.id && outlineFullyOn(platform.outline, other.outline));
  return [...under].sort((a, b) => b.elevation - a.elevation)[0]?.elevation ?? 0;
}

function PlatformMesh({ platform, peers, lit }: { platform: Platform; peers: readonly Platform[]; lit: boolean }) {
  const Surface = lit ? 'meshStandardMaterial' : 'meshBasicMaterial';
  const centre = platformCentroid(platform.outline);
  const rotation = outlinePlanRotation(platform.outline);
  const style = platform.style ?? 'floating';
  const bounds = platformBounds(platform.outline);
  /** Walking height stays absolute (Höhe über Fußboden); feet only span down to the next surface. */
  const baseElevation = supportElevationFor(platform, peers);
  const rise = Math.max(1, platform.elevation - baseElevation);
  const finishMaterial = useMemo(() => createMaterialFromPresetRef(platform.finish), [platform.finish]);
  useLayoutEffect(() => () => { finishMaterial?.dispose(); }, [finishMaterial]);
  const deckThickness = style === 'solid' ? rise : style === 'stageDeck' ? STAGE_DECK_TOP_THICKNESS_MM : 40;
  const geometry = useMemo(() => {
    if (style === 'stageDeck' && !finishMaterial) return undefined;
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
  }, [platform, centre.x, centre.y, rotation, deckThickness, style, finishMaterial]);
  useLayoutEffect(() => () => { geometry?.dispose(); }, [geometry]);
  const deckY = platform.elevation;
  const legs = style === 'stageDeck' ? stageDeckLegPositions(bounds.width, bounds.depth) : [];
  const modules = style === 'stageDeck' ? layoutStageDeckModules(bounds.width, bounds.depth) : [];
  const postTop = Math.max(baseElevation + STAGE_DECK_RUBBER_HEIGHT_MM + 1, platform.elevation - STAGE_DECK_TOP_THICKNESS_MM);
  const postHeight = Math.max(1, postTop - baseElevation - STAGE_DECK_RUBBER_HEIGHT_MM);
  return <group position={[centre.x, 0, centre.y]} rotation={[0, -rotation, 0]}>
    {geometry && <mesh castShadow={lit} receiveShadow={lit} position={[0, deckY, 0]} geometry={geometry}>
      {finishMaterial ? <primitive object={finishMaterial} attach="material" dispose={null} /> : <Surface color="#c5d0b8" />}
    </mesh>}
    {style === 'stageDeck' && !finishMaterial && modules.map((module, index) =>
      <StageDeckModuleMesh key={`module-${index}`} module={module} elevation={platform.elevation} lit={lit} />)}
    {style === 'stageDeck' && finishMaterial && modules.map((module, index) =>
      <mesh key={`seam-${index}`} position={[module.x, platform.elevation + 1, module.y]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[module.width - 20, module.depth - 20]} />
        <meshBasicMaterial color="#9aa890" transparent opacity={0.35} />
      </mesh>)}
    {style === 'stageDeck' && legs.map((leg, index) =>
      <group key={`leg-${index}`} position={[leg.x, baseElevation, leg.y]}>
        <mesh castShadow={lit} position={[0, STAGE_DECK_RUBBER_HEIGHT_MM / 2, 0]}>
          <boxGeometry args={[STAGE_DECK_RUBBER_SECTION_MM, STAGE_DECK_RUBBER_HEIGHT_MM, STAGE_DECK_RUBBER_SECTION_MM]} />
          <Surface color={RUBBER} />
        </mesh>
        <mesh castShadow={lit} position={[0, STAGE_DECK_RUBBER_HEIGHT_MM + postHeight / 2, 0]}>
          <boxGeometry args={[STAGE_DECK_LEG_SECTION_MM, postHeight, STAGE_DECK_LEG_SECTION_MM]} />
          <AluminumMaterial lit={lit} />
        </mesh>
      </group>)}
  </group>;
}

export function StageLevels({ model, lit = false, peerPlatforms }: {
  model: StageModel; lit?: boolean; peerPlatforms?: readonly Platform[];
}) {
  const Surface = lit ? 'meshStandardMaterial' : 'meshBasicMaterial';
  const peers = peerPlatforms ?? model.platforms;
  return <>
    {model.platforms.map(platform => <PlatformMesh key={platform.id} platform={platform} peers={peers} lit={lit} />)}
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
