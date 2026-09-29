import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ballastStockSchema, materialRequirements, sceneMaterials } from '../src/shared/ballast.js';
import { braceBallast, braceCorners, braceSolid } from '../src/shared/braceTransforms.js';
import { braceSchema, newBrace } from '../src/shared/layout.js';
import { keepClearWarnings, newKeepClearZone } from '../src/shared/keepClear.js';
import { AUDIENCE_FLOOR_ID } from '../src/shared/levels.js';
import { duplicateLayout } from '../src/shared/scenes.js';

const brace = () => newBrace(randomUUID(), 1000, 1000);
test('legacy braces have no ballast; validation and copies preserve explicit choices', () => {
  assert.equal(braceSchema.parse(brace()).ballast, undefined);
  for (const ballast of [{ mode: 'none' }, { mode: 'single', side: 'right' }, { mode: 'heavy' }]) {
    const b = braceSchema.parse({ ...brace(), ballast });
    const copy = duplicateLayout({ schemaVersion: 1, walls: [], braces: [b] }, randomUUID);
    assert.deepEqual(copy.braces[0]!.ballast, ballast);
  }
  assert.equal(braceSchema.safeParse({ ...brace(), ballast: { mode: 'single', side: 'front' } }).success, false);
  for (const slabs of [-1, 0.5, Infinity]) assert.equal(ballastStockSchema.safeParse({ slabs, straps: 0 }).success, false);
});
test('requirements use independent scene maxima and report shortages', () => {
  const single = braceSchema.parse({ ...brace(), ballast: { mode: 'single' } });
  const heavy = braceSchema.parse({ ...brace(), ballast: { mode: 'heavy' } });
  assert.deepEqual(sceneMaterials({ braces: [brace(), single, heavy] }), { braces: 3, slabs: 3, straps: 1 });
  assert.deepEqual(materialRequirements([{ braces: [single, single, single] }, { braces: [heavy] }], { slabs: 2, straps: 0 }), {
    required: { braces: 3, slabs: 3, straps: 1 }, available: { slabs: 2, straps: 0 }, shortage: { slabs: 1, straps: 1 },
  });
});
test('single slab rests on floor and rail; opposite sides mirror and rotate with the brace', () => {
  const b = brace();
  const left = braceBallast({ ...b, ballast: { mode: 'single', side: 'left' } })[0]!;
  const right = braceBallast({ ...b, ballast: { mode: 'single', side: 'right' } })[0]!;
  assert.equal(left.center.x, -right.center.x);
  const lowerHeights = [-200, 200].map(x => right.center.y + x * Math.sin(right.rotation.z) - 25 * Math.cos(right.rotation.z));
  assert.ok(Math.abs(Math.min(...lowerHeights)) < 1e-8);
  assert.ok(Math.abs(Math.max(...lowerHeights) - 40) < 1e-8);
  const corners = braceCorners({ ...b, rotation: 90, ballast: { mode: 'single', side: 'left' } });
  assert.ok(Math.min(...corners.map(p => p.y)) < b.y - 400);
  const solid = braceSolid({ ...b, ballast: { mode: 'heavy' } }, 600);
  assert.equal(solid.footprint[0]!.y, 600);
  const slabs = solid.ballast.filter(p => p.kind === 'slab');
  assert.equal(slabs.length, 2);
  assert.ok(slabs.every(p => p.center.y - p.size.y / 2 === 40));
  assert.equal(solid.ballast.filter(p => p.kind === 'buckle').length, 1);
});
test('keep-clear checks include slab overhang beyond the timber', () => {
  const b = braceSchema.parse({ ...brace(), ballast: { mode: 'single', side: 'left' } });
  const zone = newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 0, 0);
  zone.polygon = [{ x: 650, y: 900 }, { x: 700, y: 900 }, { x: 700, y: 1100 }, { x: 650, y: 1100 }];
  const venue = { schemaVersion: 1 as const, width: 5000, depth: 5000, keepClearZones: [zone] };
  assert.equal(keepClearWarnings(venue, { walls: [], braces: [b] }).length, 1);
  assert.equal(keepClearWarnings(venue, { walls: [], braces: [{ ...b, ballast: undefined }] }).length, 0);
});
