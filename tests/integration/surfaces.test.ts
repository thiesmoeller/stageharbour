import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';
import type { SurfaceCatalogClient } from '../../src/server/surfaces/polyHaven.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let base: string;

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const catalogJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 2, 0, 3, 0]);
const catalogItem = {
  id: 'stage_wood',
  name: 'Stage Wood',
  description: 'Scanned theatre boards',
  thumbnailUrl: 'https://cdn.polyhaven.com/asset_img/thumbs/stage_wood.png',
  categories: ['wood'],
  tileWidthMm: 2000,
  tileHeightMm: 1000,
};
const surfaceCatalog: SurfaceCatalogClient = {
  async search(query) { return query === 'wood' ? [catalogItem] : []; },
  async download() {
    return {
      item: catalogItem,
      maps: {
        baseColor: { bytes: catalogJpeg, mediaType: 'image/jpeg', pixelWidth: 3, pixelHeight: 2 },
        orm: { bytes: catalogJpeg, mediaType: 'image/jpeg', pixelWidth: 3, pixelHeight: 2 },
      },
    };
  },
};

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config, { surfaceCatalog });
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}/surfaces`;
});
after(async () => { await app?.close(); await fixture?.dispose(); });

test('workspace and production PBR surfaces share authenticated texture files with correct scope', async () => {
  const uploaded = await app.inject({
    method: 'POST', url: `${base}/files`,
    headers: { ...headers, 'content-type': 'image/png', 'x-file-name': 'oak_basecolor.png' },
    payload: onePixelPng,
  });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const fileId = uploaded.json().fileId as string;
  const common = {
    description: 'Measured oak boards',
    definition: {
      workflow: 'metallic-roughness',
      tileWidthMm: 1200,
      tileHeightMm: 600,
      maps: { baseColor: fileId },
      baseColorFactor: '#ffffff',
      roughnessFactor: 0.8,
      metallicFactor: 0,
      normalScale: 1,
      displacementScaleMm: 0,
      normalConvention: 'opengl',
    },
  };
  const shared = await app.inject({
    method: 'POST', url: base, headers,
    payload: { ...common, scope: 'workspace', name: 'Oak shared' },
  });
  assert.equal(shared.statusCode, 201, shared.body);
  assert.equal(shared.json().scope, 'workspace');

  const scene = (await app.inject({
    method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`, headers,
    payload: { productionName: 'Hamlet', venueName: 'Hall', sceneName: 'Act 1', width: 8000, depth: 6000 },
  })).json();
  const privateSurface = await app.inject({
    method: 'POST', url: base, headers,
    payload: { ...common, scope: 'production', productionId: scene.productionId, name: 'Hamlet floor' },
  });
  assert.equal(privateSurface.statusCode, 201, privateSurface.body);
  await app.inject({ method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes/${scene.id}/lease`, headers });
  const layout = {
    schemaVersion: 1, walls: [], braces: [],
    platforms: [{
      id: randomUUID(), label: 'Show floor', elevation: 400,
      outline: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 }],
      surfaces: { top: { kind: 'registry', surfaceId: privateSurface.json().id } },
    }],
  };
  assert.equal((await app.inject({
    method: 'PUT', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes/${scene.id}/layout`,
    headers, payload: { revision: 0, layout },
  })).statusCode, 200);
  const otherScene = (await app.inject({
    method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`, headers,
    payload: { productionName: 'Macbeth', venueName: 'Hall', sceneName: 'Act 2', width: 8000, depth: 6000 },
  })).json();
  await app.inject({ method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes/${otherScene.id}/lease`, headers });
  assert.equal((await app.inject({
    method: 'PUT', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes/${otherScene.id}/layout`,
    headers, payload: { revision: 0, layout },
  })).statusCode, 400);
  const workspaceOnly = (await app.inject({ url: base, headers })).json();
  assert.deepEqual(workspaceOnly.map((item: { name: string }) => item.name), ['Oak shared']);
  const withProduction = (await app.inject({ url: `${base}?productionId=${scene.productionId}`, headers })).json();
  assert.deepEqual(withProduction.map((item: { name: string }) => item.name), ['Hamlet floor', 'Oak shared']);

  const texture = await app.inject({ url: `${base}/files/${fileId}`, headers });
  assert.equal(texture.statusCode, 200);
  assert.deepEqual(texture.rawPayload, onePixelPng);
  assert.equal((await app.inject({ url: `${base}/files/${fileId}` })).statusCode, 401);
  assert.equal((await app.inject({
    method: 'DELETE', url: `${base}/${shared.json().id}`, headers,
  })).statusCode, 200);
  const archived = (await app.inject({ url: base, headers })).json();
  assert.equal(archived.length, 1);
  assert.equal(archived[0].archived, true);
});

test('surface uploads reject unsupported bytes, invalid origin, and missing texture files', async () => {
  assert.equal((await app.inject({
    method: 'POST', url: `${base}/files`,
    headers: { ...headers, 'content-type': 'image/png' }, payload: Buffer.from('not png'),
  })).statusCode, 400);
  assert.equal((await app.inject({
    method: 'POST', url: `${base}/files`,
    headers: { ...headers, origin: 'https://foreign.example', 'content-type': 'image/png' }, payload: onePixelPng,
  })).statusCode, 403);
  const missing = await app.inject({
    method: 'POST', url: base, headers,
    payload: {
      scope: 'workspace', name: 'Missing',
      definition: { workflow: 'metallic-roughness', tileWidthMm: 1000, tileHeightMm: 1000,
        maps: { baseColor: crypto.randomUUID() }, baseColorFactor: '#ffffff', roughnessFactor: 1,
        metallicFactor: 0, normalScale: 1, displacementScaleMm: 0, normalConvention: 'opengl' },
    },
  });
  assert.equal(missing.statusCode, 400);
});

test('Poly Haven catalog imports local PBR copies with workspace scope', async () => {
  const catalog = await app.inject({ url: `${base}/catalog/poly-haven?q=wood`, headers });
  assert.equal(catalog.statusCode, 200, catalog.body);
  assert.equal(catalog.json()[0].id, 'stage_wood');

  const imported = await app.inject({
    method: 'POST',
    url: `${base}/import/poly-haven`,
    headers,
    payload: {
      provider: 'poly-haven',
      assetId: 'stage_wood',
      resolution: '1k',
      scope: 'workspace',
    },
  });
  assert.equal(imported.statusCode, 201, imported.body);
  const record = imported.json();
  assert.equal(record.name, 'Stage Wood');
  assert.equal(record.definition.tileWidthMm, 2000);
  assert.ok(record.definition.maps.baseColor);
  assert.ok(record.definition.maps.orm);
  assert.equal(record.definition.metallicFactor, 1);

  const texture = await app.inject({ url: `${base}/files/${record.definition.maps.baseColor}`, headers });
  assert.equal(texture.statusCode, 200);
  assert.deepEqual(texture.rawPayload, catalogJpeg);
});
