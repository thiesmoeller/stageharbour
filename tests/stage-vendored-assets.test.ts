import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { MATERIAL_ASSET_BASE_URL, MODEL_ASSET_BASE_URL, materialAssetUrl, modelAssetUrl } from '../src/shared/assetHosts.js';
import {
  LIBRARY_REF_PREFIX, MATERIAL_LIBRARY, libraryIdFromRef, libraryMaterial, libraryMaterialById, libraryTextureUrl, libraryThumbnailUrl,
  toLibraryRef,
} from '../src/client/stage/materialLibrary.js';
import { MODEL_CATALOG, catalogModelById, catalogModelUrl, catalogThumbnailUrl, searchCatalogModels } from '../src/client/stage/modelCatalog.js';
import { modelSourceSchema } from '../src/shared/assets.js';

const hex = /^#[0-9a-f]{6}$/i;
const idDigest = (ids: readonly string[]) => createHash('sha256').update(ids.join('\n')).digest('hex');

/** Ids of @pascal-app/core 1.0.6 MATERIAL_CATALOG and @pascal-app/editor 1.0.6 CATALOG_ITEMS, in published order. */
const VENDORED = {
  materials: { count: 129, digest: '454f10f14fba9d43124ba57aa79aa675572fb73b119ea5ba47614516efd337f0' },
  models: { count: 111, digest: 'a06fe6754148bc7d10aaff4048ca98bf192007a2625da39557b4f2ad370d33fe' },
};

test('the material library keeps every id that was published when it was vendored', () => {
  const ids = MATERIAL_LIBRARY.map(item => item.id);
  assert.equal(ids.length, VENDORED.materials.count);
  assert.equal(new Set(ids).size, ids.length, 'material ids are unique');
  assert.equal(idDigest(ids), VENDORED.materials.digest);
});

test('the model catalogue keeps every id that was published when it was vendored', () => {
  const ids = MODEL_CATALOG.map(item => item.id);
  assert.equal(ids.length, VENDORED.models.count);
  assert.equal(new Set(ids).size, ids.length, 'catalogue ids are unique');
  assert.equal(idDigest(ids), VENDORED.models.digest);
});

test('every library material is complete and its reference resolves to itself', () => {
  for (const item of MATERIAL_LIBRARY) {
    assert.match(item.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, item.id);
    assert.ok(item.label.length > 0 && item.category.length > 0, item.id);
    assert.match(item.previewColor, hex, item.id);
    assert.match(item.color, hex, item.id);
    assert.ok(item.roughness >= 0 && item.roughness <= 1 && item.metalness >= 0 && item.metalness <= 1, item.id);
    assert.ok(item.repeat[0] > 0 && item.repeat[1] > 0, item.id);
    if (item.opacity !== undefined) assert.ok(item.opacity > 0 && item.opacity < 1, item.id);
    const ref = toLibraryRef(item.id);
    assert.ok(ref.startsWith(LIBRARY_REF_PREFIX));
    assert.equal(libraryIdFromRef(ref), item.id);
    assert.equal(libraryMaterial(ref), item);
    assert.equal(libraryMaterialById(item.id), item);
  }
});

test('unknown and malformed material references resolve to nothing', () => {
  assert.equal(libraryMaterial(undefined), undefined);
  assert.equal(libraryMaterial('library:does-not-exist'), undefined);
  assert.equal(libraryMaterial('wood-finewood27'), undefined);
  assert.equal(libraryIdFromRef('ral:9010'), undefined);
  assert.equal(libraryMaterialById(undefined), undefined);
});

test('the library finish the surface tests and seeds use is still there', () => {
  const finish = libraryMaterial('library:wood-finewood27');
  assert.equal(finish?.id, 'wood-finewood27');
  assert.ok(finish?.maps.albedo);
});

test('material textures and thumbnails are addressed below the one material asset host', () => {
  let textures = 0, thumbnails = 0;
  for (const item of MATERIAL_LIBRARY) {
    for (const slot of ['albedo', 'normal', 'roughness', 'metalness', 'ao'] as const) {
      const path = item.maps[slot];
      const url = libraryTextureUrl(item, slot);
      assert.equal(url === undefined, path === undefined);
      if (!path || !url) continue;
      textures++;
      assert.doesNotMatch(path, /^(https?:)?\/\//, `${item.id}: ${slot} is stored relative to the host`);
      assert.equal(url, `${MATERIAL_ASSET_BASE_URL}/${path}`);
    }
    const thumbnail = libraryThumbnailUrl(item);
    if (thumbnail) {
      thumbnails++;
      assert.equal(thumbnail, `${MATERIAL_ASSET_BASE_URL}/${item.thumbnail}`);
    }
  }
  assert.ok(textures > 200 && thumbnails > 50);
  assert.equal(materialAssetUrl('/material/x.webp'), `${MATERIAL_ASSET_BASE_URL}/material/x.webp`);
});

test('catalogue models are complete and addressed below the one model asset host', () => {
  for (const item of MODEL_CATALOG) {
    assert.ok(item.name.length > 0 && item.category.length > 0, item.id);
    assert.equal(catalogModelById(item.id), item);
    for (const vector of [item.dimensions, item.offset, item.rotation, item.scale]) {
      assert.equal(vector.length, 3, item.id);
      assert.ok(vector.every(Number.isFinite), item.id);
    }
    assert.ok(item.dimensions.every(value => value > 0), item.id);
    const url = catalogModelUrl(item);
    if (item.model) {
      assert.doesNotMatch(item.model, /^(https?:)?\/\//, item.id);
      assert.equal(url, `${MODEL_ASSET_BASE_URL}/${item.model}`);
    } else assert.equal(url, undefined);
    const thumbnail = catalogThumbnailUrl(item);
    if (item.thumbnail) assert.equal(thumbnail, `${MODEL_ASSET_BASE_URL}/${item.thumbnail}`);
  }
  assert.equal(modelAssetUrl('system/cactus/model.glb'), `${MODEL_ASSET_BASE_URL}/system/cactus/model.glb`);
});

test('catalogue search offers placeable models only and matches names and tags', () => {
  const all = searchCatalogModels('');
  assert.ok(all.length > 100);
  assert.ok(all.every(item => item.model && !item.tool));
  assert.equal(all.length, MODEL_CATALOG.filter(item => item.model && !item.tool).length);
  assert.ok(searchCatalogModels('  CACTUS ').some(item => item.id === 'cactus'));
  assert.deepEqual(searchCatalogModels('no such thing at all'), []);
});

test('the model source schema accepts the catalogue\'s system models on the model asset host only', () => {
  const source = (url: string | undefined) => ({ kind: 'catalog', catalogId: 'x', url, offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  let accepted = 0;
  for (const item of searchCatalogModels('')) {
    const expected = /^system\/[^/]+\/model\.glb$/.test(item.model!);
    assert.equal(modelSourceSchema.safeParse(source(catalogModelUrl(item))).success, expected, item.id);
    if (expected) accepted++;
  }
  assert.ok(accepted >= 90, `${accepted} catalogue models can be adopted`);
  assert.equal(modelSourceSchema.safeParse(source('https://example.test/system/cactus/model.glb')).success, false);
  assert.equal(modelSourceSchema.safeParse(source(`${MODEL_ASSET_BASE_URL}/system/cactus/model.glb?x=1`)).success, false);
});

const pascalCore = new URL('../node_modules/@pascal-app/core/package.json', import.meta.url);
const pascalEditor = new URL('../node_modules/@pascal-app/editor/package.json', import.meta.url);

test('the vendored ids equal the installed Pascal packages while those are present', { skip: !existsSync(pascalCore) || !existsSync(pascalEditor) }, async () => {
  // Specifiers are computed so the type checker does not need the packages once they are removed.
  const scope = '@pascal-app';
  const core = await import(`${scope}/core`) as { MATERIAL_CATALOG: { id: string }[] };
  const editor = await import(`${scope}/editor/catalog`) as { CATALOG_ITEMS: { id: string }[] };
  assert.deepEqual(MATERIAL_LIBRARY.map(item => item.id), core.MATERIAL_CATALOG.map(item => item.id));
  assert.deepEqual(MODEL_CATALOG.map(item => item.id), editor.CATALOG_ITEMS.map(item => item.id));
});
