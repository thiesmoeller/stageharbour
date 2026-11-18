import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createPolyHavenModelClient } from '../src/server/assets/polyHavenModels.js';
import { searchLocalModels } from '../src/client/local/polyHaven.js';
import { importPolyHavenModelSchema } from '../src/shared/polyHaven.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/polyhaven/models.json', import.meta.url), 'utf8'));
for (const local of [false, true]) test(`${local ? 'local' : 'hosted'} catalogue retains observed mixed-case IDs and isolates invalid entries`, async () => {
  const fetcher = (async () => Response.json({ broken: { name: 42 }, ...fixture })) as typeof fetch;
  const result = local ? await searchLocalModels('chair', fetcher) : await createPolyHavenModelClient(fetcher).search('chair');
  assert.deepEqual(result.map(item => item.id), ['ArmChair_01']);
  assert.equal(importPolyHavenModelSchema.parse({ id: result[0]!.id }).id, 'ArmChair_01');
});
for (const local of [false, true]) test(`${local ? 'local' : 'hosted'} catalogue distinguishes empty results from provider failure`, async () => {
  const empty = (async () => Response.json({})) as typeof fetch;
  assert.deepEqual(local ? await searchLocalModels('', empty) : await createPolyHavenModelClient(empty).search(''), []);
  const failed = (async () => new Response('', { status: 503 })) as typeof fetch;
  await assert.rejects(() => local ? searchLocalModels('', failed) : createPolyHavenModelClient(failed).search(''), /503/);
});

import { createPolyHavenClient } from '../src/server/surfaces/polyHaven.js';
import { searchLocalTextures } from '../src/client/local/polyHaven.js';
for (const local of [false, true]) test(`${local ? 'local' : 'hosted'} materials isolate malformed entries and preserve empty/error states`, async () => {
  const fetcher = (async () => Response.json({ bad: {}, Wood_01: { name: 'Wood', dimensions: [1000, 2000], thumbnail_url: 'https://cdn.polyhaven.com/asset_img/thumbs/Wood_01.png' } })) as typeof fetch;
  const search = (fetcher: typeof fetch) => local ? searchLocalTextures('', fetcher) : createPolyHavenClient(fetcher).search('');
  assert.deepEqual((await search(fetcher)).map(item => item.id), ['Wood_01']);
  assert.deepEqual(await search((async () => Response.json({})) as typeof fetch), []);
  await assert.rejects(() => search((async () => new Response('', { status: 503 })) as typeof fetch), /503/);
});

const searchFixture = JSON.parse(readFileSync(new URL('./fixtures/polyhaven/search.json', import.meta.url), 'utf8'));
for (const local of [false, true]) test(`${local ? 'local' : 'hosted'} resolves the observed ranked-slug search envelope`, async () => {
  const fetcher = (async (input: string | URL | Request) => String(input).includes('/search?') ? Response.json(searchFixture) : Response.json({
    wooden_floor_02: { name: 'Wooden floor', dimensions: [1000, 2000], thumbnail_url: 'https://cdn.polyhaven.com/asset_img/thumbs/wooden_floor_02.png' },
    old_wooden_floor_02: { name: 42 },
  })) as typeof fetch;
  const found = local ? await searchLocalTextures('wood', fetcher) : await createPolyHavenClient(fetcher).search('wood');
  assert.deepEqual(found.map(item => item.id), ['wooden_floor_02']);
});
