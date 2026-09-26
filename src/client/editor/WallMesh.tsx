import { useMemo, useLayoutEffect } from 'react';
import { DoubleSide, type Material } from 'three';
import type { WallSolid } from '../../shared/transforms.js';
import {
  buildWallPanelGeometry, openingFlushSides, wallShadowVolumes,
  WALL_MAT_BACK_LOWER, WALL_MAT_BACK_UPPER, WALL_MAT_EDGE,
  WALL_MAT_FRONT_LOWER, WALL_MAT_FRONT_UPPER,
} from '../../shared/wallMeshGeometry.js';
import {
  DOOR_FRAME, DOOR_FRAME_COLOR, DOOR_LEAF, DOOR_LEAF_COLOR, doorOpenAngleDegrees, isDoorOpening,
  type Opening,
} from '../../shared/wall-types.js';
import {
  faceSplitMm, resolveFaceBand, type SurfaceFinish, type WallSurfaces,
} from '../../shared/surfaces.js';
import { createSurfaceMaterial, disposeSurfaceMaterial } from './surfaceMaterials.js';

const plywood = '#315d49', timber = '#d9c6a1', edgeDefault = '#5a6e52';

export type OpeningEdge = 'left' | 'right' | 'top' | 'bottom';

function DoorFittings({ wall, lit }: { wall: WallSolid; lit: boolean }) {
  const Surface = lit ? 'meshStandardMaterial' : 'meshBasicMaterial';
  const hw = wall.size.x / 2, hh = wall.size.y / 2;
  const front = -wall.size.z / 2;
  const angle = doorOpenAngleDegrees(wall.doorOpenPercent) * Math.PI / 180;
  return <>
    {wall.openings.filter(isDoorOpening).map(opening => {
      const x0 = -hw + opening.left, y0 = -hh + opening.sill;
      const x1 = x0 + opening.width, y1 = y0 + opening.height;
      const face = DOOR_FRAME.face, depth = DOOR_FRAME.depth;
      const frameZ = front - depth / 2;
      const hingeX = opening.hinge === 'left' ? x0 : x1;
      const leafSign = opening.hinge === 'left' ? 1 : -1;
      const yaw = opening.hinge === 'left' ? angle : -angle;
      return <group key={opening.id}>
        <mesh castShadow={lit} receiveShadow={lit} position={[(x0 + x1) / 2, y0 - face / 2, frameZ]}>
          <boxGeometry args={[opening.width + face * 2, face, depth]} />
          <Surface color={DOOR_FRAME_COLOR} />
        </mesh>
        <mesh castShadow={lit} receiveShadow={lit} position={[(x0 + x1) / 2, y1 + face / 2, frameZ]}>
          <boxGeometry args={[opening.width + face * 2, face, depth]} />
          <Surface color={DOOR_FRAME_COLOR} />
        </mesh>
        <mesh castShadow={lit} receiveShadow={lit} position={[x0 - face / 2, (y0 + y1) / 2, frameZ]}>
          <boxGeometry args={[face, opening.height, depth]} />
          <Surface color={DOOR_FRAME_COLOR} />
        </mesh>
        <mesh castShadow={lit} receiveShadow={lit} position={[x1 + face / 2, (y0 + y1) / 2, frameZ]}>
          <boxGeometry args={[face, opening.height, depth]} />
          <Surface color={DOOR_FRAME_COLOR} />
        </mesh>
        <group position={[hingeX, (y0 + y1) / 2, front - DOOR_LEAF.thickness / 2]} rotation={[0, yaw, 0]}>
          <mesh castShadow={lit} receiveShadow={lit} position={[leafSign * DOOR_LEAF.width / 2, 0, 0]}>
            <boxGeometry args={[DOOR_LEAF.width, DOOR_LEAF.height, DOOR_LEAF.thickness]} />
            <Surface color={DOOR_LEAF_COLOR} />
          </mesh>
        </group>
      </group>;
    })}
  </>;
}

/** Invisible pick targets: solid jambs for select/resize, and opening edges for cutout push-pull. */
export function OpeningInteractionHandles({ wall, wallId, scope }: {
  wall: WallSolid; wallId: string; scope: 'venue' | 'scene';
}) {
  const hw = wall.size.x / 2, hh = wall.size.y / 2;
  const solids: { key: string; position: [number, number, number]; args: [number, number, number] }[] = [];
  for (const opening of wall.openings) {
    const flush = openingFlushSides(opening, wall.size);
    const x0 = -hw + opening.left, y0 = -hh + opening.sill;
    const x1 = x0 + opening.width, y1 = y0 + opening.height;
    if (!flush.left && opening.left > 1) {
      solids.push({ key: `${opening.id}-L`, position: [(-hw + x0) / 2, 0, 0], args: [opening.left, wall.size.y, wall.size.z] });
    }
    if (!flush.right && wall.size.x - opening.left - opening.width > 1) {
      solids.push({
        key: `${opening.id}-R`,
        position: [(x1 + hw) / 2, 0, 0],
        args: [wall.size.x - opening.left - opening.width, wall.size.y, wall.size.z],
      });
    }
    if (!flush.bottom && opening.sill > 1) {
      solids.push({ key: `${opening.id}-B`, position: [(x0 + x1) / 2, (-hh + y0) / 2, 0], args: [opening.width, opening.sill, wall.size.z] });
    }
    if (!flush.top && wall.size.y - opening.sill - opening.height > 1) {
      solids.push({
        key: `${opening.id}-T`,
        position: [(x0 + x1) / 2, (y1 + hh) / 2, 0],
        args: [opening.width, wall.size.y - opening.sill - opening.height, wall.size.z],
      });
    }
  }
  return <>
    {solids.map(solid => <mesh key={solid.key} position={solid.position} castShadow={false} receiveShadow={false}>
      <boxGeometry args={solid.args} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>)}
    {wall.openings.map(opening => {
      const x0 = -hw + opening.left, y0 = -hh + opening.sill;
      const x1 = x0 + opening.width, y1 = y0 + opening.height;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const edges: { edge: OpeningEdge; position: [number, number, number]; args: [number, number, number] }[] = [
        { edge: 'left', position: [x0, cy, 0], args: [48, opening.height, wall.size.z + 16] },
        { edge: 'right', position: [x1, cy, 0], args: [48, opening.height, wall.size.z + 16] },
        { edge: 'bottom', position: [cx, y0, 0], args: [opening.width, 48, wall.size.z + 16] },
        { edge: 'top', position: [cx, y1, 0], args: [opening.width, 48, wall.size.z + 16] },
      ];
      return <group key={opening.id}>
        {edges.map(({ edge, position, args }) => <mesh key={edge} position={position} castShadow={false} receiveShadow={false} userData={{
          pushPull: { id: wallId, kind: 'wallOpening', openingId: opening.id, edge, scope },
        }}>
          <boxGeometry args={args} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>)}
      </group>;
    })}
  </>;
}

function useBandMaterial(
  finish: SurfaceFinish | undefined,
  faceWidthMm: number,
  faceHeightMm: number,
  lit: boolean,
  fallback: string,
) {
  const key = JSON.stringify(finish ?? null);
  const material = useMemo(() => {
    if (!lit) return null;
    return createSurfaceMaterial(finish, { faceWidthMm, faceHeightMm, shading: 'rendered' });
  }, [key, faceWidthMm, faceHeightMm, lit]);
  useLayoutEffect(() => () => { disposeSurfaceMaterial(material); }, [material]);
  return { material, fallback };
}

function SlotMaterial({
  attach, lit, material, fallback, paintProps,
}: {
  attach: string; lit: boolean; material: Material | null; fallback: string;
  paintProps?: { roughness: number; metalness: number };
}) {
  const Surface = lit ? 'meshStandardMaterial' : 'meshBasicMaterial';
  if (material) return <primitive object={material} attach={attach} dispose={null} />;
  return <Surface attach={attach} color={fallback} side={DoubleSide} {...(paintProps ?? {})} />;
}

export function WallMesh({ wall, lit = false, surfaces, interactionScope = 'venue' }: {
  wall: WallSolid; lit?: boolean; surfaces?: WallSurfaces;
  interactionScope?: 'venue' | 'scene';
}) {
  const paintProps = lit ? { roughness: 0.72, metalness: 0.02 } as const : undefined;
  const openingsKey = JSON.stringify(wall.openings);
  const frontSplit = faceSplitMm(surfaces?.front, wall.size.y);
  const backSplit = faceSplitMm(surfaces?.back, wall.size.y);
  const geometry = useMemo(
    () => buildWallPanelGeometry(wall.size, wall.openings, {
      frontMm: frontSplit, backMm: backSplit,
    }),
    [wall.size.x, wall.size.y, wall.size.z, openingsKey, frontSplit, backSplit],
  );
  const shadowVolumes = useMemo(
    () => (lit && wall.openings.length ? wallShadowVolumes(wall.size, wall.openings) : []),
    [lit, wall.size.x, wall.size.y, wall.size.z, openingsKey],
  );
  useLayoutEffect(() => () => { geometry.dispose(); }, [geometry]);

  const frontLowerFinish = resolveFaceBand(surfaces?.front, frontSplit !== undefined ? 'lower' : 'full');
  const frontUpperFinish = resolveFaceBand(surfaces?.front, frontSplit !== undefined ? 'upper' : 'full');
  const backLowerFinish = resolveFaceBand(surfaces?.back, backSplit !== undefined ? 'lower' : 'full');
  const backUpperFinish = resolveFaceBand(surfaces?.back, backSplit !== undefined ? 'upper' : 'full');
  const edgeFinish = surfaces?.edge;

  const frontLowerH = frontSplit ?? wall.size.y;
  const frontUpperH = frontSplit !== undefined ? wall.size.y - frontSplit : wall.size.y;
  const backLowerH = backSplit ?? wall.size.y;
  const backUpperH = backSplit !== undefined ? wall.size.y - backSplit : wall.size.y;

  const edge = useBandMaterial(edgeFinish, wall.size.z, wall.size.y, lit, edgeDefault);
  const frontLower = useBandMaterial(frontLowerFinish, wall.size.x, frontLowerH, lit, plywood);
  const frontUpper = useBandMaterial(frontUpperFinish, wall.size.x, frontUpperH, lit, plywood);
  const backLower = useBandMaterial(backLowerFinish, wall.size.x, backLowerH, lit, timber);
  const backUpper = useBandMaterial(backUpperFinish, wall.size.x, backUpperH, lit, timber);

  return <group position={[wall.center.x, wall.center.y, wall.center.z]} rotation={[0, wall.rotationY, 0]}>
    {shadowVolumes.map((volume, index) => <mesh key={`shadow-${index}`} castShadow receiveShadow={false}
      position={volume.position} frustumCulled={false} raycast={() => {}}>
      <boxGeometry args={volume.size} />
      <meshBasicMaterial colorWrite={false} depthWrite={false} />
    </mesh>)}
    <mesh castShadow={lit && shadowVolumes.length === 0} receiveShadow={lit} geometry={geometry}
      userData={{ wallMaterialSlots: true }}>
      <SlotMaterial attach={`material-${WALL_MAT_EDGE}`} lit={lit} material={edge.material} fallback={edge.fallback} paintProps={paintProps} />
      <SlotMaterial attach={`material-${WALL_MAT_FRONT_LOWER}`} lit={lit} material={frontLower.material} fallback={frontLower.fallback} paintProps={paintProps} />
      <SlotMaterial attach={`material-${WALL_MAT_FRONT_UPPER}`} lit={lit} material={frontUpper.material} fallback={frontUpper.fallback} paintProps={paintProps} />
      <SlotMaterial attach={`material-${WALL_MAT_BACK_LOWER}`} lit={lit} material={backLower.material} fallback={backLower.fallback} paintProps={paintProps} />
      <SlotMaterial attach={`material-${WALL_MAT_BACK_UPPER}`} lit={lit} material={backUpper.material} fallback={backUpper.fallback} paintProps={paintProps} />
    </mesh>
    <DoorFittings wall={wall} lit={lit} />
    {wall.openings.length > 0 && <OpeningInteractionHandles wall={wall} wallId={wall.id} scope={interactionScope} />}
  </group>;
}

/** Pure helpers for Ausschnitt pick-handle geometry (unit-tested without R3F). */
export function openingJambSolids(wall: Pick<WallSolid, 'size' | 'openings'>) {
  const solids: { key: string; args: [number, number, number] }[] = [];
  for (const opening of wall.openings) {
    const flush = openingFlushSides(opening, wall.size);
    if (!flush.left && opening.left > 1) solids.push({ key: `${opening.id}-L`, args: [opening.left, wall.size.y, wall.size.z] });
    if (!flush.right && wall.size.x - opening.left - opening.width > 1) {
      solids.push({ key: `${opening.id}-R`, args: [wall.size.x - opening.left - opening.width, wall.size.y, wall.size.z] });
    }
    if (!flush.bottom && opening.sill > 1) solids.push({ key: `${opening.id}-B`, args: [opening.width, opening.sill, wall.size.z] });
    if (!flush.top && wall.size.y - opening.sill - opening.height > 1) {
      solids.push({ key: `${opening.id}-T`, args: [opening.width, wall.size.y - opening.sill - opening.height, wall.size.z] });
    }
  }
  return solids;
}

export function openingEdgeHandles(opening: Opening, wallZ: number) {
  return (['left', 'right', 'bottom', 'top'] as const).map(edge => ({
    edge,
    pushPullKind: 'wallOpening' as const,
    openingId: opening.id,
    thickness: edge === 'left' || edge === 'right' ? 48 : opening.width,
    height: edge === 'top' || edge === 'bottom' ? 48 : opening.height,
    depth: wallZ + 16,
  }));
}
