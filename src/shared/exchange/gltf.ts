import type { Object3D } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { ensureFileReader } from './fileReaderShim.js';
import { sceneMeshToObject3D, type SceneMesh } from './sceneMesh.js';

export type GltfExportOptions = {
  /** Name of the root node; defaults to the scene name. */
  name?: string;
  /** Written to the scene's `extras`. */
  extras?: Record<string, unknown>;
};

/** Binary glTF 2.0 (.glb) of an Object3D tree. */
export async function exportObject3DGlb(root: Object3D, extras?: Record<string, unknown>): Promise<ArrayBuffer> {
  ensureFileReader();
  if (extras) root.userData = { ...root.userData, ...extras };
  const result = await new GLTFExporter().parseAsync(root, { binary: true, trs: true, onlyVisible: false, includeCustomExtensions: false });
  if (!(result instanceof ArrayBuffer)) throw new Error('glTF-Export lieferte kein Binärformat.');
  return result;
}

/**
 * The whole Bühnenbild as one .glb: metres, +Y up, the audience on the +Z side, one node per
 * placed part and venue element, identical parts sharing one mesh.
 */
export function exportGltf(scene: SceneMesh, options: GltfExportOptions = {}): Promise<ArrayBuffer> {
  return exportObject3DGlb(sceneMeshToObject3D(scene, options.name), {
    generator: 'StageHarbour',
    unit: 'metre',
    skipped: scene.skipped,
    ...options.extras,
  });
}
