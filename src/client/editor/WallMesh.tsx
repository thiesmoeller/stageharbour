import { useMemo, useLayoutEffect } from 'react';
import { BoxGeometry, ExtrudeGeometry, Path, Shape, type Material } from 'three';
import type { WallSolid } from '../../shared/transforms.js';
import {
  DOOR_FRAME, DOOR_FRAME_COLOR, DOOR_LEAF, DOOR_LEAF_COLOR, doorOpenAngleDegrees, isDoorOpening,
} from '../../shared/wall-types.js';

const plywood = '#315d49', timber = '#d9c6a1', edge = '#5a6e52';
function wallGeometry(wall: WallSolid) {
  if (!wall.openings.length) return new BoxGeometry(wall.size.x, wall.size.y, wall.size.z);
  const shape = new Shape();
  const hw = wall.size.x / 2, hh = wall.size.y / 2;
  shape.moveTo(-hw, -hh); shape.lineTo(hw, -hh); shape.lineTo(hw, hh); shape.lineTo(-hw, hh); shape.closePath();
  for (const opening of wall.openings) {
    const hole = new Path();
    const x0 = -hw + opening.left, y0 = -hh + opening.sill;
    hole.moveTo(x0, y0); hole.lineTo(x0, y0 + opening.height); hole.lineTo(x0 + opening.width, y0 + opening.height); hole.lineTo(x0 + opening.width, y0); hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new ExtrudeGeometry(shape, { depth: wall.size.z, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -wall.size.z / 2);
  // Extrusion caps share material 0 by default; split by their actual face normal.
  const normal = geometry.getAttribute('normal');
  geometry.clearGroups();
  for (let start = 0; start < normal.count; start += 3) {
    const z = normal.getZ(start);
    geometry.addGroup(start, 3, z < -0.5 ? 1 : z > 0.5 ? 2 : 0);
  }
  return geometry;
}

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

export function WallMesh({ wall, lit = false, frontMaterial, frontColor, backColor }: {
  wall: WallSolid; lit?: boolean; frontMaterial?: Material; frontColor?: string; backColor?: string;
}) {
  const Surface = lit ? 'meshStandardMaterial' : 'meshBasicMaterial';
  const paintProps = lit ? { roughness: 0.72, metalness: 0.02 } : {};
  const front = frontColor
    ? <Surface attach="material-5" color={frontColor} {...paintProps} />
    : frontMaterial
      ? <primitive object={frontMaterial} attach="material-5" dispose={null} />
      : <Surface attach="material-5" color={plywood} {...(lit ? paintProps : {})} />;
  const frontExtrude = frontColor
    ? <Surface attach="material-1" color={frontColor} {...paintProps} />
    : frontMaterial
      ? <primitive object={frontMaterial} attach="material-1" dispose={null} />
      : <Surface attach="material-1" color={plywood} {...(lit ? paintProps : {})} />;
  const back = backColor
    ? <Surface attach="material-4" color={backColor} {...paintProps} />
    : <Surface attach="material-4" color={timber} />;
  const backExtrude = backColor
    ? <Surface attach="material-2" color={backColor} {...paintProps} />
    : <Surface attach="material-2" color={timber} />;
  const geometry = useMemo(() => wall.openings.length ? wallGeometry(wall) : null, [wall.size.x, wall.size.y, wall.size.z, JSON.stringify(wall.openings)]);
  useLayoutEffect(() => () => { geometry?.dispose(); }, [geometry]);
  const body = !geometry
    ? <mesh castShadow={lit} receiveShadow={lit} position={[wall.center.x, wall.center.y, wall.center.z]} rotation={[0, wall.rotationY, 0]}>
      <boxGeometry args={[wall.size.x, wall.size.y, wall.size.z]} />
      <Surface attach="material-0" color={edge} />
      <Surface attach="material-1" color={edge} />
      <Surface attach="material-2" color={edge} />
      <Surface attach="material-3" color={edge} />
      {back}
      {front}
    </mesh>
    : <mesh castShadow={lit} receiveShadow={lit} geometry={geometry} position={[wall.center.x, wall.center.y, wall.center.z]} rotation={[0, wall.rotationY, 0]}>
      <Surface attach="material-0" color={edge} />
      {frontExtrude}
      {backExtrude}
    </mesh>;
  return <group>
    {body}
    <group position={[wall.center.x, wall.center.y, wall.center.z]} rotation={[0, wall.rotationY, 0]}>
      <DoorFittings wall={wall} lit={lit} />
    </group>
  </group>;
}
