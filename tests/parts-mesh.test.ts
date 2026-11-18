import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPartContext, partDefinitionSchema, type PartDefinition } from '../src/shared/parts/definition.js';
import { resolvePart } from '../src/shared/parts/resolve.js';
import { validateDefinition } from '../src/shared/parts/validate.js';
import { meshAssetDependencies } from '../src/shared/parts/assetDependencies.js';
import { partHandles } from '../src/shared/parts/handles.js';
import { buildLibraryExport, planLibraryImport } from '../src/shared/parts/libraryExchange.js';
import { createLayoutPartIndex, resolveLayoutObjects } from '../src/shared/layoutObjects.js';
import { emptyLayout } from '../src/shared/layout.js';
import { STARTER_LIBRARY } from '../src/shared/parts/starter/index.js';
import type { Asset } from '../src/shared/assets.js';
const id = '11111111-1111-4111-8111-111111111111';
const asset: Asset = { id: '22222222-2222-4222-8222-222222222222', name: 'Griff', archived: false, definition: { kind: 'model', width: 120, height: 30, depth: 40, source: { kind: 'upload', fileId: '33333333-3333-4333-8333-333333333333' } } };
const handle = partDefinitionSchema.parse({ id, revision: 1, name: 'Griff', category: 'Zubehör', parameters: [], bodies: [{ kind: 'mesh', key: 'griff', assetId: asset.id, at: [100, 1000, 0], size: [120, 30, 40] }], traits: { stock: 'none' } });
const context = createPartContext({ assets: [asset] });
test('mesh definition round-trips, has dimension handles and no inferred stock or weight', () => {
  const saved = partDefinitionSchema.parse(JSON.parse(JSON.stringify(handle)));
  assert.deepEqual(saved, handle);
  assert.equal(validateDefinition(saved, context).ok, true);
  const result = resolvePart(saved, {}, context);
  assert.deepEqual(result.issues, []);
  assert.equal(result.weightKg, 0);
  assert.ok(partHandles(saved, result).some(handle => handle.measure?.path?.[0] === 'size'));
  assert.equal(result.solids[0]?.kind, 'box');
});
test('nested imported handle follows independent door state, visibility and copies', () => {
  const wall: PartDefinition = { ...handle, id: '44444444-4444-4444-8444-444444444444', name: 'Wand mit Tür',
    parameters: [{ key: 'open', label: 'Türwinkel', type: 'angle', default: 0, scope: 'state', range: { min: 0, max: 90 } }], bodies: [],
    children: [{ key: 'door', group: { ...handle, bodies: [{ ...handle.bodies[0]!, repeat: { count: 2, step: [0, 0, 50] } }] }, at: [0, 0, 0], rotation: [0, 'open', 0] }] };
  const closed = resolvePart(wall, {}, context), opened = resolvePart(wall, { state: { open: 90 } }, context);
  assert.deepEqual(opened.issues, []);
  assert.equal(opened.solids.length, 2);
  const a = closed.solids[0]!, b = opened.solids[0]!;
  assert.ok(a.kind === 'box' && b.kind === 'box');
  if (a.kind !== 'box' || b.kind !== 'box') return;
  assert.equal(a.center.x, 100); assert.ok(Math.abs(b.center.x) < 0.001); assert.ok(Math.abs(b.center.z + 100) < 0.001);
  assert.equal(b.assetId, asset.id);
  assert.deepEqual(meshAssetDependencies(wall), [asset.id]);
  assert.equal(validateDefinition(wall, createPartContext({ assets: [] })).ok, false);
});
test('layout resolution keeps nested mesh solids for Raumsicht', () => {
  const wall: PartDefinition = {
    ...handle, id: '55555555-5555-4555-8555-555555555555', name: 'Wand mit Griff', bodies: [],
    children: [{ key: 'door', group: { ...handle, name: 'Tür' }, at: [0, 0, 0] }],
  };
  const index = createLayoutPartIndex({ parts: [wall], materials: STARTER_LIBRARY.materials });
  const layout = {
    ...emptyLayout(),
    objects: [{
      id: '66666666-6666-4666-8666-666666666666', label: 'Wand mit Griff', part: { id: wall.id, revision: 1 },
      x: 1000, y: 1000, rotation: 0,
    }],
  };
  const objects = resolveLayoutObjects(layout, index);
  assert.equal(objects.length, 1);
  assert.equal(objects[0]!.resolved.solids.filter(solid => solid.kind === 'box' && solid.assetId === asset.id).length, 1);
});

test('library export retains mesh references and import reports missing dependencies', () => {
  const library = buildLibraryExport({ roots: [handle], part: () => undefined, material: () => undefined });
  assert.deepEqual(library.materials, []);
  const body = library.parts[0]?.bodies[0];
  assert.equal(body?.kind, 'mesh');
  assert.ok(body && body.kind === 'mesh' && body.assetId === asset.id);
  const missing = planLibraryImport({ input: library, overwriteMaterials: false, workspace: { assets: [], materials: new Map(), revisions: new Map() } });
  assert.ok(missing.ok);
  if (missing.ok) {
    assert.equal(missing.value.parts.length, 0);
    assert.equal(missing.value.report.rejected.length, 1);
    assert.ok(missing.value.report.rejected[0]!.issues.some(issue => issue.code === 'unknown-asset'));
  }
  const present = planLibraryImport({ input: library, overwriteMaterials: false, workspace: { assets: [asset], materials: new Map(), revisions: new Map() } });
  assert.ok(present.ok);
  if (present.ok) assert.equal(present.value.parts.length, 1);
});
