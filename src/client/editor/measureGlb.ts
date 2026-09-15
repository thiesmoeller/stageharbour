import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Load a local GLB and return its axis-aligned size in metres. */
export async function measureGlbFile(file: File): Promise<{ x: number; y: number; z: number }> {
  const buffer = await file.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const size = new Box3().setFromObject(gltf.scene).getSize(new Vector3());
  if (Math.min(size.x, size.y, size.z) <= 0 || !Number.isFinite(size.length())) {
    throw new Error('Model has no usable bounds');
  }
  return { x: size.x, y: size.y, z: size.z };
}
