import { useMemo, useLayoutEffect } from 'react';
import { BoxGeometry, ExtrudeGeometry, Path, Shape, type Material } from 'three';
import type { WallSolid } from '../../shared/transforms.js';
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

export function WallMesh({ wall, lit = false, frontMaterial }: { wall: WallSolid; lit?: boolean; frontMaterial?: Material }) {
  const Surface = lit ? 'meshStandardMaterial' : 'meshBasicMaterial';
  const geometry = useMemo(() => wall.openings.length ? wallGeometry(wall) : null, [wall.size.x, wall.size.y, wall.size.z, JSON.stringify(wall.openings)]);
  useLayoutEffect(() => () => { geometry?.dispose(); }, [geometry]);
  if (!geometry) {
    return <mesh position={[wall.center.x, wall.center.y, wall.center.z]} rotation={[0, wall.rotationY, 0]}>
      <boxGeometry args={[wall.size.x, wall.size.y, wall.size.z]} />
      <Surface attach="material-0" color={edge} />
      <Surface attach="material-1" color={edge} />
      <Surface attach="material-2" color={edge} />
      <Surface attach="material-3" color={edge} />
      <Surface attach="material-4" color={timber} />
      {frontMaterial ? <primitive object={frontMaterial} attach="material-5" dispose={null} /> : <Surface attach="material-5" color={plywood} />}
    </mesh>;
  }
  return <mesh geometry={geometry} position={[wall.center.x, wall.center.y, wall.center.z]} rotation={[0, wall.rotationY, 0]}>
    <Surface attach="material-0" color={edge} />
    {frontMaterial ? <primitive object={frontMaterial} attach="material-1" dispose={null} /> : <Surface attach="material-1" color={plywood} />}
    <Surface attach="material-2" color={timber} />
  </mesh>;
}
