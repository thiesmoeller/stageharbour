import type { Layout, VenueGeometry } from '../layout.js';
import type { LayoutPartIndex } from '../layoutObjects.js';
import { exportGltf } from './gltf.js';
import { exportMvr } from './mvr.js';
import { EXCHANGE_FORMATS, exchangeFilename, type ExchangeFormat } from './formats.js';
import { buildSceneMesh, type SceneMesh } from './sceneMesh.js';

export * from './formats.js';
export * from './sceneMesh.js';
export { exportGltf, exportObject3DGlb } from './gltf.js';
export { MVR_ROOT_FILE, buildMvrXml, exportMvr, mvrGeometryFiles, mvrMatrix, type MvrMeta } from './mvr.js';
export { readZip, writeZip, type ZipEntry } from './zip.js';

export type ExchangeScene = {
  id: string;
  name: string;
  productionName: string;
  venueName: string;
};

export type ExchangeFile = {
  data: ArrayBuffer;
  contentType: string;
  filename: string;
  mesh: SceneMesh;
};

/** Resolve a Bühnenbild against its part catalog and write it as a glb or an MVR archive. */
export async function exportSceneFile(input: {
  format: ExchangeFormat;
  scene: ExchangeScene;
  venue: VenueGeometry;
  layout: Layout;
  catalog: LayoutPartIndex;
  providerVersion?: string;
  now?: Date;
}): Promise<ExchangeFile> {
  const mesh = buildSceneMesh({ layout: input.layout, venue: input.venue, catalog: input.catalog });
  const info = EXCHANGE_FORMATS[input.format];
  const data = input.format === 'gltf'
    ? await exportGltf(mesh, { name: input.scene.name, extras: { production: input.scene.productionName, venue: input.scene.venueName } })
    : await exportMvr(mesh, {
      providerVersion: input.providerVersion, productionName: input.scene.productionName, venueName: input.scene.venueName,
      sceneName: input.scene.name, sceneId: input.scene.id, now: input.now,
    });
  return { data, contentType: info.contentType, filename: exchangeFilename(input.scene.name, input.scene.id, input.format), mesh };
}
