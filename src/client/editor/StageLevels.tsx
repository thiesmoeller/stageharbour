import { useMemo } from 'react';
import { ExtrudeGeometry, Shape, type Material } from 'three';
import type { StageModel } from '../../shared/transforms.js';
import { platformCentroid, platformSurfaceFinish, surfaceElevationUnderPoint, orientedPlatformBox, type Platform } from '../../shared/levels.js';
import {
  STAGE_DECK_FRAME_PROFILE_MM, STAGE_DECK_LEG_SECTION_MM, STAGE_DECK_RUBBER_HEIGHT_MM,
  STAGE_DECK_RUBBER_SECTION_MM, STAGE_DECK_TOP_THICKNESS_MM, layoutStageDeckModules, stageDeckLegPositions,
} from '../../shared/stageDeck.js';
import { UNIT_BOX, UNIT_PLANE, geometryKey } from '../stage/geometryCache.js';
import { placeMatrix, primitiveInstance, type StageInstance } from '../stage/instancing.js';
import { useCachedGeometry } from '../stage/StageInstances.js';
import type { FlatMaterialSpec } from '../stage/surfaceMaterials.js';
import { useElementInstances, useFlatMaterials, useSurfaceMaterial } from './stageMaterialHooks.js';

/** GUIL-style TM-440 / PTA-440: phenolic infield, aluminum frame + Steckfüße, rubber caps. */
const MATERIALS = {
  platform: { color: '#c5d0b8' },
  step: { color: '#d5decc' },
  deckTop: { color: '#4a3426', roughness: 0.9, metalness: 0 },
  aluminum: { color: '#c4c8cd', roughness: 0.35, metalness: 0.65 },
  rubber: { color: '#1a1a1a' },
  seam: { color: '#9aa890', opacity: 0.35, unlit: true },
} as const satisfies Record<string, FlatMaterialSpec>;

/** Keep phenolic and frame from sharing a face (avoids Z-fighting). */
const FIT_GAP_MM = 1;
const SOLID = { cast: true, receive: true }, CAST = { cast: true };
const EMPTY: StageInstance[] = [];

function outlinePlanRotation(outline: Platform['outline']) {
  const a = outline[0], b = outline[1];
  if (!a || !b) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function isRectangularOutline(outline: Platform['outline']) {
  if (outline.length !== 4) return false;
  return outline.every((point, index) => {
    const previous = outline[(index + 3) % 4]!;
    const next = outline[(index + 1) % 4]!;
    const ax = previous.x - point.x, ay = previous.y - point.y;
    const bx = next.x - point.x, by = next.y - point.y;
    const scale = Math.hypot(ax, ay) * Math.hypot(bx, by);
    return scale > 0 && Math.abs(ax * bx + ay * by) <= scale * 1e-6;
  });
}

/** Extruded deck with texture coordinates normalised like a box: 0..1 across the top, and along the walls. */
function buildPolygonDeck(points: readonly (readonly [number, number])[], thickness: number) {
  const shape = new Shape();
  points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  const extruded = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 });
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - minX), depth = Math.max(1, Math.max(...ys) - minY);
  const uv = extruded.getAttribute('uv');
  // ExtrudeGeometry writes millimetre coordinates: (x, y) on the caps (group 0), (run, 1 − z) on the walls.
  for (const group of extruded.groups) {
    for (let index = group.start; index < group.start + group.count; index++) {
      if (group.materialIndex === 0) uv.setXY(index, (uv.getX(index) - minX) / width, (uv.getY(index) - minY) / depth);
      else uv.setXY(index, uv.getX(index) / Math.max(width, depth), (uv.getY(index) - 1) / thickness);
    }
  }
  extruded.rotateX(Math.PI / 2);
  return extruded;
}

/** Deck slab with a finish, or with an outline that is not a rectangle: one mesh, materials per face. */
function DeckSlab({ localOutline, thickness, width, depth, position, rotationY, top, sides }: {
  localOutline: readonly (readonly [number, number])[] | undefined;
  thickness: number; width: number; depth: number;
  position: [number, number, number]; rotationY: number;
  top: Material; sides: Material;
}) {
  const polygon = !!localOutline;
  const geometry = useCachedGeometry(
    polygon ? geometryKey('platform-deck', localOutline, thickness) : UNIT_BOX.key,
    polygon ? () => buildPolygonDeck(localOutline, thickness) : UNIT_BOX.build,
  );
  // Box faces are +x −x +y −y +z −z; an extrusion has its caps first and its walls second.
  const materials = useMemo(() => polygon ? [top, sides] : [sides, sides, top, sides, sides, sides], [polygon, top, sides]);
  return <group position={position} rotation={[0, rotationY, 0]}>
    <mesh castShadow receiveShadow geometry={geometry} material={materials} dispose={null}
      position={[0, polygon ? 0 : -thickness / 2, 0]} scale={polygon ? 1 : [width, thickness, depth]} />
  </group>;
}

function PlatformParts({ platform, peers }: { platform: Platform; peers: readonly Platform[] }) {
  const flat = useFlatMaterials(MATERIALS);
  const centre = platformCentroid(platform.outline);
  const rotation = outlinePlanRotation(platform.outline);
  const style = platform.style ?? 'floating';
  const box = orientedPlatformBox(platform.outline);
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  /** Höhe über Fußboden stays absolute; each foot lands on the surface directly under it. */
  const solidBase = style === 'solid'
    ? surfaceElevationUnderPoint(centre, peers, platform.elevation, platform.id)
    : 0;
  const rise = Math.max(1, platform.elevation - solidBase);
  const deckThickness = style === 'solid' ? rise : style === 'stageDeck' ? STAGE_DECK_TOP_THICKNESS_MM : 40;
  const topMaterial = useSurfaceMaterial(platformSurfaceFinish(platform, 'top'), box.width, box.depth);
  const sideMaterial = useSurfaceMaterial(platformSurfaceFinish(platform, 'sides'), Math.max(box.width, box.depth), deckThickness);
  const rectangular = isRectangularOutline(platform.outline);
  const renderDeckSurface = style !== 'stageDeck' || !!topMaterial;
  const finished = !!topMaterial || !!sideMaterial;
  const localOutline = useMemo(() => rectangular ? undefined : platform.outline.map(point => {
    const dx = point.x - centre.x, dy = point.y - centre.y;
    return [dx * cos + dy * sin, -dx * sin + dy * cos] as const;
  }), [platform.outline, rectangular, centre.x, centre.y, cos, sin]);

  const instances = useMemo(() => {
    const base = placeMatrix(undefined, [centre.x, 0, centre.y], [1, 1, 1], [0, -rotation, 0]);
    const parts: StageInstance[] = [];
    if (renderDeckSurface && rectangular && !finished) {
      parts.push(primitiveInstance(UNIT_BOX, placeMatrix(base, [0, platform.elevation - deckThickness / 2, 0], [box.width, deckThickness, box.depth]), flat.platform, SOLID));
    }
    if (style !== 'stageDeck') return parts;
    const modules = layoutStageDeckModules(box.width, box.depth, platform.deckGrain);
    if (topMaterial) {
      for (const module of modules) {
        parts.push(primitiveInstance(UNIT_PLANE,
          placeMatrix(base, [module.x, platform.elevation + 1, module.y], [module.width - 20, module.depth - 20, 1], [-Math.PI / 2, 0, 0]), flat.seam));
      }
    } else {
      // One catalog module: aluminum rim + inset phenolic — volumes do not overlap.
      const t = STAGE_DECK_TOP_THICKNESS_MM, f = STAGE_DECK_FRAME_PROFILE_MM, y = platform.elevation - t / 2;
      for (const { x, y: z, width, depth } of modules) {
        const side = Math.max(1, depth - 2 * f);
        parts.push(
          primitiveInstance(UNIT_BOX, placeMatrix(base, [x, y, z + (depth - f) / 2], [width, t, f]), flat.aluminum, SOLID),
          primitiveInstance(UNIT_BOX, placeMatrix(base, [x, y, z - (depth - f) / 2], [width, t, f]), flat.aluminum, SOLID),
          primitiveInstance(UNIT_BOX, placeMatrix(base, [x + (width - f) / 2, y, z], [f, t, side]), flat.aluminum, SOLID),
          primitiveInstance(UNIT_BOX, placeMatrix(base, [x - (width - f) / 2, y, z], [f, t, side]), flat.aluminum, SOLID),
          primitiveInstance(UNIT_BOX, placeMatrix(base, [x, y, z], [Math.max(1, width - 2 * f - FIT_GAP_MM), t, Math.max(1, depth - 2 * f - FIT_GAP_MM)]), flat.deckTop, SOLID),
        );
      }
    }
    for (const leg of stageDeckLegPositions(box.width, box.depth, platform.deckGrain)) {
      const under = { x: centre.x + leg.x * cos - leg.y * sin, y: centre.y + leg.x * sin + leg.y * cos };
      const baseElevation = surfaceElevationUnderPoint(under, peers, platform.elevation, platform.id);
      const postTop = Math.max(baseElevation + STAGE_DECK_RUBBER_HEIGHT_MM + 1, platform.elevation - STAGE_DECK_TOP_THICKNESS_MM);
      const postHeight = Math.max(1, postTop - baseElevation - STAGE_DECK_RUBBER_HEIGHT_MM);
      parts.push(
        primitiveInstance(UNIT_BOX,
          placeMatrix(base, [leg.x, baseElevation + STAGE_DECK_RUBBER_HEIGHT_MM / 2, leg.y], [STAGE_DECK_RUBBER_SECTION_MM, STAGE_DECK_RUBBER_HEIGHT_MM, STAGE_DECK_RUBBER_SECTION_MM]),
          flat.rubber, CAST),
        primitiveInstance(UNIT_BOX,
          placeMatrix(base, [leg.x, baseElevation + STAGE_DECK_RUBBER_HEIGHT_MM + postHeight / 2, leg.y], [STAGE_DECK_LEG_SECTION_MM, postHeight, STAGE_DECK_LEG_SECTION_MM]),
          flat.aluminum, CAST),
      );
    }
    return parts;
  }, [platform, peers, flat, renderDeckSurface, rectangular, finished, !!topMaterial, deckThickness]);
  useElementInstances(instances);

  if (!renderDeckSurface || (rectangular && !finished)) return null;
  return <DeckSlab localOutline={localOutline} thickness={deckThickness} width={box.width} depth={box.depth}
    position={[centre.x, platform.elevation, centre.y]} rotationY={-rotation}
    top={topMaterial ?? flat.platform} sides={sideMaterial ?? flat.platform} />;
}

function StairSteps({ stair }: { stair: StageModel['stairs'][number] }) {
  const flat = useFlatMaterials(MATERIALS);
  const instances = useMemo(() => stair.steps.map(step => primitiveInstance(UNIT_BOX,
    placeMatrix(undefined, [step.x, step.y, step.z], [step.width, step.height, step.depth], [0, step.rotationY, 0]), flat.step, SOLID)), [stair, flat]);
  useElementInstances(instances.length ? instances : EMPTY);
  return null;
}

/** Podeste and Treppen in millimetres. `peerPlatforms` are the surfaces feet and solid bases can land on. */
export function StageLevels({ model, peerPlatforms }: {
  model: Pick<StageModel, 'platforms' | 'stairs'>; peerPlatforms?: readonly Platform[];
}) {
  const peers = peerPlatforms ?? model.platforms;
  return <>
    {model.platforms.map(platform => <PlatformParts key={platform.id} platform={platform} peers={peers} />)}
    {model.stairs.map(stair => <StairSteps key={stair.id} stair={stair} />)}
  </>;
}
