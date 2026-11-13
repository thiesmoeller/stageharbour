import { useMemo } from 'react';
import { MeshBasicMaterial, type Material } from 'three';
import type { WallSolid } from '../../shared/transforms.js';
import {
  buildWallPanelGeometry, openingFlushSides, wallShadowVolumes,
  WALL_MAT_BACK_LOWER, WALL_MAT_BACK_UPPER, WALL_MAT_EDGE,
  WALL_MAT_FRONT_LOWER, WALL_MAT_FRONT_UPPER,
} from '../../shared/wallMeshGeometry.js';
import {
  DOOR_FRAME, DOOR_FRAME_COLOR, DOOR_LEAF, DOOR_LEAF_COLOR, doorOpenAngleDegrees, isDoorOpening,
} from '../../shared/wall-types.js';
import { faceSplitMm, resolveFaceBand, type WallSurfaces } from '../../shared/surfaces.js';
import { WALL_PAINT_METALNESS, WALL_PAINT_ROUGHNESS } from '../../shared/ral.js';
import { UNIT_BOX, geometryKey } from '../stage/geometryCache.js';
import { placeMatrix, primitiveInstance, type StageInstance } from '../stage/instancing.js';
import { useCachedGeometry } from '../stage/StageInstances.js';
import type { FlatMaterialSpec } from '../stage/surfaceMaterials.js';
import { useElementInstances, useFlatMaterials, useSurfaceMaterial } from './stageMaterialHooks.js';

export type OpeningEdge = 'left' | 'right' | 'top' | 'bottom';

const PAINT = { roughness: WALL_PAINT_ROUGHNESS, metalness: WALL_PAINT_METALNESS, doubleSided: true };
const MATERIALS = {
  plywood: { color: '#315d49', ...PAINT },
  timber: { color: '#d9c6a1', ...PAINT },
  edge: { color: '#5a6e52', ...PAINT },
  doorFrame: { color: DOOR_FRAME_COLOR },
  doorLeaf: { color: DOOR_LEAF_COLOR },
} as const satisfies Record<string, FlatMaterialSpec>;

/** Invisible but raycast: pick targets and shadow casters draw no colour. */
const PICK_MATERIAL = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
const SHADOW_ONLY_MATERIAL = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const SOLID = { cast: true, receive: true };

function doorFittingInstances(wall: WallSolid, base: StageInstance['matrix'], frame: Material, leaf: Material): StageInstance[] {
  const hw = wall.size.x / 2, hh = wall.size.y / 2;
  const front = -wall.size.z / 2;
  const angle = doorOpenAngleDegrees(wall.doorOpenPercent) * Math.PI / 180;
  return wall.openings.filter(isDoorOpening).flatMap(opening => {
    const x0 = -hw + opening.left, y0 = -hh + opening.sill;
    const x1 = x0 + opening.width, y1 = y0 + opening.height;
    const face = DOOR_FRAME.face, depth = DOOR_FRAME.depth;
    const frameZ = front - depth / 2;
    const hingeX = opening.hinge === 'left' ? x0 : x1;
    const leafSign = opening.hinge === 'left' ? 1 : -1;
    const hinge = placeMatrix(base, [hingeX, (y0 + y1) / 2, front - DOOR_LEAF.thickness / 2], [1, 1, 1], [0, opening.hinge === 'left' ? angle : -angle, 0]);
    return [
      primitiveInstance(UNIT_BOX, placeMatrix(base, [(x0 + x1) / 2, y0 - face / 2, frameZ], [opening.width + face * 2, face, depth]), frame, SOLID),
      primitiveInstance(UNIT_BOX, placeMatrix(base, [(x0 + x1) / 2, y1 + face / 2, frameZ], [opening.width + face * 2, face, depth]), frame, SOLID),
      primitiveInstance(UNIT_BOX, placeMatrix(base, [x0 - face / 2, (y0 + y1) / 2, frameZ], [face, opening.height, depth]), frame, SOLID),
      primitiveInstance(UNIT_BOX, placeMatrix(base, [x1 + face / 2, (y0 + y1) / 2, frameZ], [face, opening.height, depth]), frame, SOLID),
      primitiveInstance(UNIT_BOX, placeMatrix(hinge, [leafSign * DOOR_LEAF.width / 2, 0, 0], [DOOR_LEAF.width, DOOR_LEAF.height, DOOR_LEAF.thickness]), leaf, SOLID),
    ];
  });
}

/** Invisible pick targets: solid jambs for select/resize, and opening edges for cutout push-pull. */
function OpeningInteractionHandles({ wall, wallId, scope }: {
  wall: WallSolid; wallId: string; scope: 'venue' | 'scene';
}) {
  const box = useCachedGeometry(UNIT_BOX.key, UNIT_BOX.build);
  const hw = wall.size.x / 2, hh = wall.size.y / 2;
  const solids: { key: string; position: [number, number, number]; size: [number, number, number] }[] = [];
  for (const opening of wall.openings) {
    const flush = openingFlushSides(opening, wall.size);
    const x0 = -hw + opening.left, y0 = -hh + opening.sill;
    const x1 = x0 + opening.width, y1 = y0 + opening.height;
    if (!flush.left && opening.left > 1) {
      solids.push({ key: `${opening.id}-L`, position: [(-hw + x0) / 2, 0, 0], size: [opening.left, wall.size.y, wall.size.z] });
    }
    if (!flush.right && wall.size.x - opening.left - opening.width > 1) {
      solids.push({ key: `${opening.id}-R`, position: [(x1 + hw) / 2, 0, 0], size: [wall.size.x - opening.left - opening.width, wall.size.y, wall.size.z] });
    }
    if (!flush.bottom && opening.sill > 1) {
      solids.push({ key: `${opening.id}-B`, position: [(x0 + x1) / 2, (-hh + y0) / 2, 0], size: [opening.width, opening.sill, wall.size.z] });
    }
    if (!flush.top && wall.size.y - opening.sill - opening.height > 1) {
      solids.push({ key: `${opening.id}-T`, position: [(x0 + x1) / 2, (y1 + hh) / 2, 0], size: [opening.width, wall.size.y - opening.sill - opening.height, wall.size.z] });
    }
  }
  return <>
    {solids.map(solid => <mesh key={solid.key} position={solid.position} scale={solid.size} geometry={box} material={PICK_MATERIAL} dispose={null} />)}
    {wall.openings.map(opening => {
      const x0 = -hw + opening.left, y0 = -hh + opening.sill;
      const x1 = x0 + opening.width, y1 = y0 + opening.height;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const edges: { edge: OpeningEdge; position: [number, number, number]; size: [number, number, number] }[] = [
        { edge: 'left', position: [x0, cy, 0], size: [48, opening.height, wall.size.z + 16] },
        { edge: 'right', position: [x1, cy, 0], size: [48, opening.height, wall.size.z + 16] },
        { edge: 'bottom', position: [cx, y0, 0], size: [opening.width, 48, wall.size.z + 16] },
        { edge: 'top', position: [cx, y1, 0], size: [opening.width, 48, wall.size.z + 16] },
      ];
      return <group key={opening.id}>
        {edges.map(({ edge, position, size }) => <mesh key={edge} position={position} scale={size} geometry={box} material={PICK_MATERIAL} dispose={null}
          userData={{ pushPull: { id: wallId, kind: 'wallOpening', openingId: opening.id, edge, scope } }} />)}
      </group>;
    })}
  </>;
}

/**
 * One wall panel in millimetres. Panels with the same size, cut-outs and band split share one
 * geometry; each face band takes its finish from `surfaces` or the plywood/timber default.
 */
export function WallMesh({ wall, surfaces, interactionScope = 'venue' }: {
  wall: WallSolid; surfaces?: WallSurfaces;
  interactionScope?: 'venue' | 'scene';
}) {
  const flat = useFlatMaterials(MATERIALS);
  const frontSplit = faceSplitMm(surfaces?.front, wall.size.y);
  const backSplit = faceSplitMm(surfaces?.back, wall.size.y);
  const size = { x: wall.size.x, y: wall.size.y, z: wall.size.z };
  // The cut-out ids do not shape the panel; leaving them out lets equal panels share a geometry.
  const cutouts = wall.openings.map(({ id: _id, ...shape }) => shape);
  const geometry = useCachedGeometry(
    geometryKey('wall-panel', size, cutouts, frontSplit, backSplit),
    () => buildWallPanelGeometry(wall.size, wall.openings, { frontMm: frontSplit, backMm: backSplit }),
  );
  const openingsKey = JSON.stringify(wall.openings);
  const shadowVolumes = useMemo(
    () => (wall.openings.length ? wallShadowVolumes(wall.size, wall.openings) : []),
    [wall.size.x, wall.size.y, wall.size.z, openingsKey],
  );
  const box = useCachedGeometry(UNIT_BOX.key, UNIT_BOX.build);

  // Texture coordinates run 0..1 across the whole panel face, so every band tiles against the full height.
  const edge = useSurfaceMaterial(surfaces?.edge, wall.size.z, wall.size.y);
  const frontLower = useSurfaceMaterial(resolveFaceBand(surfaces?.front, frontSplit !== undefined ? 'lower' : 'full'), wall.size.x, wall.size.y);
  const frontUpper = useSurfaceMaterial(resolveFaceBand(surfaces?.front, frontSplit !== undefined ? 'upper' : 'full'), wall.size.x, wall.size.y);
  const backLower = useSurfaceMaterial(resolveFaceBand(surfaces?.back, backSplit !== undefined ? 'lower' : 'full'), wall.size.x, wall.size.y);
  const backUpper = useSurfaceMaterial(resolveFaceBand(surfaces?.back, backSplit !== undefined ? 'upper' : 'full'), wall.size.x, wall.size.y);
  const materials = useMemo(() => {
    const slots = [];
    slots[WALL_MAT_EDGE] = edge ?? flat.edge;
    slots[WALL_MAT_FRONT_LOWER] = frontLower ?? flat.plywood;
    slots[WALL_MAT_FRONT_UPPER] = frontUpper ?? flat.plywood;
    slots[WALL_MAT_BACK_LOWER] = backLower ?? flat.timber;
    slots[WALL_MAT_BACK_UPPER] = backUpper ?? flat.timber;
    return slots;
  }, [edge, frontLower, frontUpper, backLower, backUpper, flat]);

  const fittings = useMemo(() => {
    if (!wall.openings.some(isDoorOpening)) return [];
    const base = placeMatrix(undefined, [wall.center.x, wall.center.y, wall.center.z], [1, 1, 1], [0, wall.rotationY, 0]);
    return doorFittingInstances(wall, base, flat.doorFrame, flat.doorLeaf);
  }, [wall, flat]);
  useElementInstances(fittings);

  return <group position={[wall.center.x, wall.center.y, wall.center.z]} rotation={[0, wall.rotationY, 0]}>
    {shadowVolumes.map((volume, index) => <mesh key={`shadow-${index}`} castShadow receiveShadow={false}
      position={volume.position} scale={volume.size} frustumCulled={false} raycast={() => {}}
      geometry={box} material={SHADOW_ONLY_MATERIAL} dispose={null} />)}
    <mesh castShadow={shadowVolumes.length === 0} receiveShadow geometry={geometry} material={materials} dispose={null}
      userData={{ wallMaterialSlots: true }} />
    {wall.openings.length > 0 && <OpeningInteractionHandles wall={wall} wallId={wall.id} scope={interactionScope} />}
  </group>;
}
