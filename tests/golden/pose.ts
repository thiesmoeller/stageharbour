import { Euler, Matrix4, Object3D, Vector3 } from 'three';
import type { NeutralBox, Vec3 } from './types.js';

export type Pose = { position?: readonly [number, number, number]; rotation?: readonly [number, number, number] };

const RAD_TO_DEG = 180 / Math.PI;

function degrees(radians: number) {
  const value = radians * RAD_TO_DEG;
  return Math.abs(Math.abs(value) - 180) < 1e-9 ? 180 : value;
}

/** Compose nested Three.js transforms (parent first) exactly as the editor's scene graph does. */
export function worldBox(part: string, chain: readonly Pose[], size: readonly [number, number, number]): NeutralBox {
  let parent: Object3D | undefined;
  for (const pose of chain) {
    const node = new Object3D();
    node.position.set(...(pose.position ?? [0, 0, 0]));
    node.rotation.set(...(pose.rotation ?? [0, 0, 0]), 'XYZ');
    parent?.add(node);
    parent = node;
  }
  if (!parent) throw new Error('A box needs at least one pose.');
  parent.updateWorldMatrix(true, false);
  const matrix: Matrix4 = parent.matrixWorld;
  const centre = new Vector3().setFromMatrixPosition(matrix);
  const euler = new Euler().setFromRotationMatrix(matrix, 'XYZ');
  const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
  return {
    part,
    center: vec(centre.x, centre.y, centre.z),
    size: vec(size[0], size[1], size[2]),
    rotation: vec(degrees(euler.x) + 0, degrees(euler.y) + 0, degrees(euler.z) + 0),
  };
}

export function worldPoint(chain: readonly Pose[], local: readonly [number, number, number]): Vec3 {
  const box = worldBox('point', [...chain, { position: local }], [0, 0, 0]);
  return box.center;
}

export function boxCorners(box: Pick<NeutralBox, 'center' | 'size' | 'rotation'>): Vec3[] {
  const euler = new Euler(
    box.rotation.x / RAD_TO_DEG, box.rotation.y / RAD_TO_DEG, box.rotation.z / RAD_TO_DEG, 'XYZ',
  );
  const matrix = new Matrix4().makeRotationFromEuler(euler);
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const point = new Vector3(sx * box.size.x / 2, sy * box.size.y / 2, sz * box.size.z / 2).applyMatrix4(matrix);
    corners.push({ x: point.x + box.center.x, y: point.y + box.center.y, z: point.z + box.center.z });
  }
  return corners;
}
