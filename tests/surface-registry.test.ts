import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSurfaceSchema, surfaceDefinitionSchema } from '../src/shared/surfaceRegistry.js';
import { inspectSurfaceTexture } from '../src/server/surfaces/files.js';
import { createPolyHavenClient } from '../src/server/surfaces/polyHaven.js';

test('glTF metallic-roughness registry accepts packed ORM and measured tile size', () => {
  const baseColor = randomUUID(), orm = randomUUID();
  const definition = surfaceDefinitionSchema.parse({
    workflow: 'metallic-roughness',
    tileWidthMm: 1200,
    tileHeightMm: 600,
    maps: { baseColor, orm },
  });
  assert.equal(definition.maps.orm, orm);
  assert.equal(definition.normalConvention, 'opengl');
  assert.equal(definition.roughnessFactor, 1);
  assert.throws(() => surfaceDefinitionSchema.parse({
    ...definition,
    maps: { baseColor, orm, roughness: randomUUID() },
  }));
});

test('production scope requires a production while workspace scope rejects one', () => {
  const definition = {
    workflow: 'metallic-roughness' as const,
    tileWidthMm: 1000,
    tileHeightMm: 1000,
    maps: { baseColor: randomUUID() },
  };
  assert.equal(createSurfaceSchema.parse({
    scope: 'production', productionId: randomUUID(), name: 'Show floor', definition,
  }).scope, 'production');
  assert.throws(() => createSurfaceSchema.parse({
    scope: 'production', name: 'Unscoped', definition,
  }));
  assert.throws(() => createSurfaceSchema.parse({
    scope: 'workspace', productionId: randomUUID(), name: 'Wrong scope', definition,
  }));
});

test('surface texture inspection validates real PNG dimensions', () => {
  const pngHeader = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(pngHeader, 0);
  pngHeader.write('IHDR', 12, 'ascii');
  pngHeader.writeUInt32BE(2048, 16);
  pngHeader.writeUInt32BE(1024, 20);
  assert.deepEqual(inspectSurfaceTexture(pngHeader, 'image/png'), {
    mediaType: 'image/png', pixelWidth: 2048, pixelHeight: 1024,
  });
  assert.throws(() => inspectSurfaceTexture(Buffer.from('fake'), 'image/png'));
});

test('Poly Haven catalog maps physical dimensions and glTF-compatible channels', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 2, 0, 3, 0]);
  const asset = {
    name: 'Stage Wood',
    description: 'Scanned boards',
    categories: ['wood'],
    tags: ['floor'],
    dimensions: [2000, 1000],
    thumbnail_url: 'https://cdn.polyhaven.com/asset_img/thumbs/stage_wood.png',
  };
  const source = (name: string) => ({
    '1k': { jpg: { size: jpeg.length, url: `https://dl.polyhaven.org/${name}.jpg` } },
  });
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/assets?')) return new Response(JSON.stringify({ stage_wood: asset }));
    if (url.includes('/files/')) return new Response(JSON.stringify({
      Diffuse: source('diffuse'), nor_gl: source('normal'), arm: source('arm'),
    }));
    return new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg' } });
  };
  const client = createPolyHavenClient(fetcher as typeof fetch);
  assert.deepEqual((await client.search('wood')).map(item => item.id), ['stage_wood']);
  const imported = await client.download('stage_wood', '1k');
  assert.equal(imported.item.tileWidthMm, 2000);
  assert.deepEqual(Object.keys(imported.maps), ['baseColor', 'normal', 'orm']);
  assert.equal(imported.maps.baseColor?.pixelWidth, 3);
  assert.equal(imported.maps.baseColor?.pixelHeight, 2);
});
