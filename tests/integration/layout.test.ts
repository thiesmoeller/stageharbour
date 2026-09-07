import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { membership, scene, venueVersion, workspace } from '../../src/server/db/schema.js';
import { copySelection, pasteClipboard } from '../../src/shared/clipboard.js';
import { newBrace, newWall, type Scene } from '../../src/shared/layout.js';
import { newPlaceholder } from '../../src/shared/placeholders.js';
import { AUDIENCE_FLOOR_ID, newPlatform, newStair } from '../../src/shared/levels.js';
import { newOverheadBox } from '../../src/shared/overhead.js';
import { newKeepClearZone } from '../../src/shared/keepClear.js';
import { newWallType } from '../../src/shared/wall-types.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let base: string;
let created: Scene;
const input = { productionName: 'Beispielproduktion', venueName: 'Beispielsaal', sceneName: 'Erste Szene', width: 8000, depth: 6000 };
before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config);
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  assert.equal(login.statusCode, 200);
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
});
after(async () => { await app?.close(); await fixture?.dispose(); });

test('creates a complete production/adaptation/scene with a pinned venue version', async () => {
  const response = await app.inject({ method: 'POST', url: base, headers, payload: input });
  assert.equal(response.statusCode, 201, response.body);
  created = response.json();
  assert.equal(created.productionName, input.productionName);
  assert.deepEqual(created.venue, { schemaVersion: 1, width: 8000, depth: 6000 });
  assert.deepEqual(created.layout, { schemaVersion: 1, walls: [], braces: [] });
  assert.equal(created.revision, 0);
  assert.equal(created.lease, null);
  const listing = await app.inject({ url: base, headers });
  assert.equal(listing.statusCode, 200);
  assert.equal(listing.json()[0].id, created.id);
  assert.equal(listing.json()[0].layout, undefined);
  assert.equal(listing.json()[0].lease, null);
});
test('one competing save wins atomically; stale data cannot overwrite it', async () => {
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${created.id}/lease`, headers })).statusCode, 200);
  const wall = newWall(randomUUID(), 1200, 1800);
  const saves = await Promise.all([1000, 2000].map(x => app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 1, walls: [{ ...wall, x, rotation: 35 }] } },
  })));
  assert.deepEqual(saves.map(value => value.statusCode).sort(), [200, 409]);
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.layout.walls[0]!.x, saves[0]!.statusCode === 200 ? 1000 : 2000);
  assert.equal(loaded.venueVersionId, created.venueVersionId);
  assert.equal(loaded.layout.walls[0]!.rotation, 35);
  assert.equal(loaded.lease?.holderName, testAdministrator.name);
});
test('new venue information does not change a scene’s pinned geometry', async () => {
  const [original] = await fixture.db.select().from(venueVersion).where(eq(venueVersion.id, created.venueVersionId));
  await fixture.db.insert(venueVersion).values({ ...original!, id: randomUUID(), geometry: { schemaVersion: 1, width: 9000, depth: 7000 } });
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.deepEqual(loaded.venue, created.venue);
});
test('malformed documents and cross-origin writes leave saved data intact', async () => {
  for (const layout of [
    { schemaVersion: 2, walls: [] },
    { schemaVersion: 1, walls: [{ ...newWall(randomUUID(), 0, 0), width: -1 }] },
    { schemaVersion: 1, walls: [], braces: [{ ...newBrace(randomUUID(), 0, 0), height: 0 }] },
  ]) {
    assert.equal((await app.inject({ method: 'PUT', url: `${base}/${created.id}/layout`, headers, payload: { revision: 1, layout } })).statusCode, 400);
  }
  assert.equal((await app.inject({ method: 'POST', url: base, headers, payload: { ...input, width: 0 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: base, headers: { ...headers, origin: 'https://foreign.example' }, payload: input })).statusCode, 403);
  assert.equal((await fixture.db.select().from(scene)).length, 1);
  assert.equal((await app.inject({ url: `${base}/${created.id}`, headers })).json().revision, 1);
});
test('saves and reloads wall types with rectangular openings; rejects openings outside the panel', async () => {
  const type = { ...newWallType(randomUUID()), name: 'Türwand', openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000 }] };
  const wall = { ...newWall(randomUUID(), 2000, 3000), typeId: type.id, label: type.name };
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: 1, layout: { schemaVersion: 1, wallTypes: [type], walls: [wall] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(loaded.layout.wallTypes?.[0]?.name, 'Türwand');
  assert.deepEqual(loaded.layout.wallTypes?.[0]?.openings[0], type.openings[0]);
  assert.equal(loaded.layout.walls[0]?.typeId, type.id);
  const invalid = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision, layout: { schemaVersion: 1, wallTypes: [{ ...type, openings: [{ ...type.openings[0]!, left: 500 }] }], walls: [wall] } },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal((await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>().layout.wallTypes?.[0]?.openings[0]?.left, 200);
});
test('freeze then later opening edits do not change the stored construction snapshot', async () => {
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  const frozen = await app.inject({ method: 'POST', url: `${base}/${created.id}/exports`, headers, payload: { name: 'Türfassung' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const type = loaded.layout.wallTypes![0]!;
  const edited = { ...type, openings: [{ ...type.openings[0]!, width: 400, left: 200 }] };
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision, layout: { schemaVersion: 1, wallTypes: [edited], walls: loaded.layout.walls } },
  })).statusCode, 200);
  const again = await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers });
  assert.deepEqual(Buffer.from(again.rawPayload), original);
  const reloaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(reloaded.layout.wallTypes?.[0]?.openings[0]?.width, 400);
});
test('saves and reloads weighted rear braces with the layout', async () => {
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  const brace = newBrace(randomUUID(), 1500, 2500);
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision, layout: { ...loaded.layout, braces: [brace] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const reloaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(reloaded.layout.braces.length, 1);
  assert.deepEqual(reloaded.layout.braces[0], brace);
});
test('saves movable platforms and a wall on an explicit raised surface', async () => {
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  const platform = newPlatform(randomUUID(), 2000, 1500);
  const stair = newStair(randomUUID(), AUDIENCE_FLOOR_ID, platform.id, 2000, 400);
  const wall = { ...newWall(randomUUID(), 2000, 1500), supportingSurfaceId: platform.id };
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision, layout: { ...loaded.layout, walls: [wall], platforms: [platform], stairs: [stair] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const reloaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(reloaded.layout.platforms?.[0]?.elevation, 400);
  assert.equal(reloaded.layout.stairs?.[0]?.run, 2000);
  assert.equal(reloaded.layout.walls[0]?.supportingSurfaceId, platform.id);
  const frozen = await app.inject({ method: 'POST', url: `${base}/${created.id}/exports`, headers, payload: { name: 'Mit Podest' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: {
      revision: reloaded.revision,
      layout: { ...reloaded.layout, platforms: [{ ...platform, elevation: 900 }], stairs: [] },
    },
  })).statusCode, 200);
  const again = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
  assert.equal((await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>().layout.platforms?.[0]?.elevation, 900);
});
test('saves and reloads assembly numbers, connections and rigging notes', async () => {
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  const left = { ...newWall(randomUUID(), 1000, 2000), assemblyNumber: 1 };
  const right = { ...newWall(randomUUID(), 5000, 2000), assemblyNumber: 2 };
  const connection = { id: randomUUID(), a: left.id, b: right.id };
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: {
      revision: loaded.revision, layout: {
        ...loaded.layout, walls: [left, right], connections: [connection], riggingNotes: 'Stifte belassen.',
      },
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const reloaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(reloaded.layout.walls[0]?.assemblyNumber, 1);
  assert.equal(reloaded.layout.walls[1]?.assemblyNumber, 2);
  assert.deepEqual(reloaded.layout.connections, [connection]);
  assert.equal(reloaded.layout.riggingNotes, 'Stifte belassen.');
  assert.equal(reloaded.layout.walls[0]?.x, 1000);
  assert.equal(reloaded.layout.walls[1]?.x, 5000);
});
test('saves a ceiling and overhead boxes, PUT of a conflicting wall succeeds with warnings, freeze keeps them', async () => {
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  const platform = newPlatform(randomUUID(), 4000, 4750);
  const box = { ...newOverheadBox(randomUUID(), 4000, 4750), label: 'Lüftung' };
  const savedVenue = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/venue`, headers,
    payload: { venue: { ...loaded.venue, ceilingHeight: 2500, platforms: [platform], overheadBoxes: [box] } },
  });
  assert.equal(savedVenue.statusCode, 200, savedVenue.body);
  const pinned = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(pinned.venue.ceilingHeight, 2500);
  assert.equal(pinned.venue.overheadBoxes?.[0]?.bottomHeight, 2600);
  assert.equal(pinned.venueVersionId, loaded.venueVersionId);
  const wall = { ...newWall(randomUUID(), 4000, 4750), supportingSurfaceId: platform.id };
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: pinned.revision, layout: { schemaVersion: 1, walls: [wall], braces: [] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const warnings = saved.json().warnings as { kind: string; message: string }[];
  assert.equal(warnings.some(item => item.kind === 'overhead'), true);
  assert.equal(warnings.some(item => item.kind === 'ceiling'), true);
  assert.match(warnings.find(item => item.kind === 'overhead')?.message ?? '', /Lüftung/);
  const frozen = await app.inject({ method: 'POST', url: `${base}/${created.id}/exports`, headers, payload: { name: 'Mit Überbauung' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const shown = [...original.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
  assert(shown.includes('Lüftung'), shown);
  assert(shown.includes('kein statischer Nachweis'), shown);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${created.id}/venue`, headers,
    payload: { venue: { schemaVersion: 1, width: 8000, depth: 6000, ceilingHeight: 8000, overheadBoxes: [] } },
  })).statusCode, 200);
  const afterLayout = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: afterLayout.revision, layout: { schemaVersion: 1, walls: [{ ...wall, supportingSurfaceId: AUDIENCE_FLOOR_ID }], braces: [] } },
  })).statusCode, 200);
  const again = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
  const live = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(live.venue.ceilingHeight, 8000);
  assert.deepEqual(live.venue.overheadBoxes, []);
});
test('an overlapping layout save succeeds and freeze keeps the unresolved keep-clear warning', async () => {
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  const zone = { ...newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 1000, 500), label: 'Notausgang Ost' };
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${created.id}/venue`, headers,
    payload: { venue: { ...loaded.venue, keepClearZones: [zone] } },
  })).statusCode, 200);
  const wall = { ...newWall(randomUUID(), 1000, 500), label: 'Bühnenwand' };
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision, layout: { schemaVersion: 1, walls: [wall], braces: [] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.match(saved.json().warnings[0]?.message ?? '', /Notausgang Ost/);
  assert.match(saved.json().warnings[0]?.message ?? '', /Bühnenwand/);
  const frozen = await app.inject({ method: 'POST', url: `${base}/${created.id}/exports`, headers, payload: { name: 'Mit Freihaltezone' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const shown = [...original.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
  assert(shown.includes('Notausgang Ost'), shown);
  assert(shown.includes('Bühnenwand'), shown);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision + 1, layout: { schemaVersion: 1, walls: [{ ...wall, x: 7000, y: 5000 }], braces: [] } },
  })).statusCode, 200);
  const again = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
  const cleared = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: {
      revision: loaded.revision + 2,
      layout: { schemaVersion: 1, walls: [{ ...wall, x: 7000, y: 5000 }], braces: [] },
    },
  });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.deepEqual(cleared.json().warnings, []);
});
test('saves and reloads explicit groups with the layout', async () => {
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  const left = newWall(randomUUID(), 0, 0);
  const right = newWall(randomUUID(), 2000, 0);
  const group = {
    id: randomUUID(),
    members: [{ kind: 'wall' as const, id: left.id }, { kind: 'wall' as const, id: right.id }],
    rotation: 90,
  };
  const layout = {
    schemaVersion: 1 as const,
    walls: [{ ...left, x: 1000, y: -1000, rotation: 90 }, { ...right, x: 1000, y: 1000, rotation: 90 }],
    braces: [],
    groups: [group],
  };
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision, layout },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const reloaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.deepEqual(reloaded.layout.groups, [group]);
  assert.equal(reloaded.layout.walls[0]?.x, 1000);
  assert.equal(reloaded.layout.walls[0]?.y, -1000);
  assert.equal(reloaded.layout.walls[1]?.x, 1000);
  assert.equal(reloaded.layout.walls[1]?.y, 1000);
  assert.equal(reloaded.layout.walls[0]?.rotation, 90);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: {
      revision: reloaded.revision,
      layout: { schemaVersion: 1, walls: [left, right], groups: [{ ...group, members: [{ kind: 'wall', id: left.id }, { kind: 'wall', id: randomUUID() }], rotation: 0 }] },
    },
  })).statusCode, 400);
});
test('freeze then later group edits do not change the stored construction snapshot', async () => {
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  const frozen = await app.inject({ method: 'POST', url: `${base}/${created.id}/exports`, headers, payload: { name: 'Gruppenfassung' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const left = loaded.layout.walls[0]!;
  const right = loaded.layout.walls[1]!;
  const moved = {
    ...loaded.layout,
    walls: [{ ...left, x: 500, y: 400 }, { ...right, x: 2500, y: 400 }],
    groups: [{ ...loaded.layout.groups![0]!, rotation: 0 }],
  };
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision, layout: moved },
  })).statusCode, 200);
  const again = await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers });
  assert.deepEqual(Buffer.from(again.rawPayload), original);
  const reloaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(reloaded.layout.walls[0]?.x, 500);
  assert.equal(reloaded.layout.walls[1]?.x, 2500);
  assert.deepEqual(reloaded.layout.groups?.[0]?.members, loaded.layout.groups?.[0]?.members);
});
test('pasted copies save and reload without panel assignments; freeze then later paste does not change the snapshot', async () => {
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  const left = { ...newWall(randomUUID(), 1000, 2000), panelId: randomUUID(), assemblyNumber: 1 };
  const right = { ...newWall(randomUUID(), 5000, 2000), assemblyNumber: 2 };
  const group = { id: randomUUID(), members: [{ kind: 'wall' as const, id: left.id }, { kind: 'wall' as const, id: right.id }], rotation: 0 };
  const connection = { id: randomUUID(), a: left.id, b: right.id };
  const source = { schemaVersion: 1 as const, walls: [left, right], braces: [] as [], groups: [group], connections: [connection] };
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision, layout: source },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const frozen = await app.inject({ method: 'POST', url: `${base}/${created.id}/exports`, headers, payload: { name: 'Vor dem Einfügen' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const clipboard = copySelection(source, [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }]);
  assert(clipboard);
  const pasted = pasteClipboard(source, clipboard, randomUUID).layout;
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision + 1, layout: pasted },
  })).statusCode, 200);
  const reloaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(reloaded.layout.walls.length, 4);
  assert.equal(reloaded.layout.walls.filter(wall => wall.id === left.id)[0]?.panelId, left.panelId);
  assert.equal(reloaded.layout.walls.filter(wall => wall.id !== left.id && wall.id !== right.id).every(wall => wall.panelId == null), true);
  assert.equal(reloaded.layout.groups?.length, 2);
  assert.equal(reloaded.layout.connections?.length, 2);
  const again = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
});
test('saves and reloads placeholders with the layout; freeze then later edits do not change the snapshot', async () => {
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  const table = newPlaceholder('table', randomUUID(), 2000, 1500);
  const chair = newPlaceholder('chair', randomUUID(), 2800, 1500);
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision, layout: { ...loaded.layout, placeholders: [table, chair] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const reloaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.deepEqual(reloaded.layout.placeholders, [table, chair]);
  const frozen = await app.inject({ method: 'POST', url: `${base}/${created.id}/exports`, headers, payload: { name: 'Mit Platzhaltern' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const shown = [...original.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
  assert(shown.includes('Tisch'), shown);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: {
      revision: reloaded.revision,
      layout: { ...reloaded.layout, placeholders: [{ ...table, x: 7000, width: 1800 }, chair] },
    },
  })).statusCode, 200);
  const again = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
  const later = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(later.layout.placeholders?.[0]?.x, 7000);
  assert.equal(later.layout.placeholders?.[0]?.width, 1800);
});
test('workspace substitution and viewer writes are denied', async () => {
  const foreignId = randomUUID();
  await fixture.db.insert(workspace).values({ id: foreignId, name: 'Other workspace' });
  const [member] = await fixture.db.select().from(membership);
  await fixture.db.insert(membership).values({ workspaceId: foreignId, userId: member!.userId, role: 'editor' });
  const foreignBase = `/api/workspaces/${foreignId}/scenes`;
  assert.equal((await app.inject({ url: `${foreignBase}/${created.id}`, headers })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PUT', url: `${foreignBase}/${created.id}/layout`, headers, payload: { revision: 1, layout: created.layout } })).statusCode, 404);
  assert.deepEqual((await app.inject({ url: foreignBase, headers })).json(), []);
  await fixture.db.update(membership).set({ role: 'viewer' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  assert.equal((await app.inject({ url: `${base}/${created.id}`, headers })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/${created.id}/layout`, headers, payload: { revision: 1, layout: created.layout } })).statusCode, 403);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${created.id}/venue`, headers,
    payload: { venue: { schemaVersion: 1, width: 8000, depth: 6000, keepClearZones: [newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 1000, 500)] } },
  })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: base, headers, payload: input })).statusCode, 403);
  assert.equal((await app.inject({ url: base })).statusCode, 401);
});
