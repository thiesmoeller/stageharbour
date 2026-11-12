import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMatchesGolden, boxesMatch, compareBoxes, compareFootprints, compareLists, compareSolids, compareSurfaces,
  compareToGolden, compareWarnings, polygonDeviation, polygonsMatch, DEFAULT_TOLERANCE_MM,
} from './golden/compare.js';
import { loadV2GoldenFixtures } from './golden/v2.js';
import type { NeutralBox, NeutralFootprints, NeutralSolids, NeutralSurfaces, NeutralWarning } from './golden/types.js';

const square = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 }];
const shift = (points: typeof square, dx: number, dy = 0) => points.map(point => ({ x: point.x + dx, y: point.y + dy }));

const box = (part: string, x: number, size = { x: 1200, y: 2400, z: 28 }, rotationY = 0): NeutralBox => ({
  part, center: { x, y: size.y / 2, z: 1000 }, size, rotation: { x: 0, y: rotationY, z: 0 },
});

test('polygon comparison ignores start vertex and winding', () => {
  assert.equal(polygonsMatch(square, [...square.slice(2), ...square.slice(0, 2)]), true);
  assert.equal(polygonsMatch(square, [...square].reverse()), true);
  assert.equal(polygonsMatch(square, [...square.slice(1), square[0]!].reverse()), true);
  assert.equal(polygonDeviation(square, square), 0);
});

test('polygon comparison reports a 2 mm shift and a different vertex count', () => {
  assert.equal(polygonsMatch(square, shift(square, 2)), false);
  assert.equal(polygonsMatch(square, shift(square, 0.4)), true);
  assert.equal(polygonsMatch(square, shift(square, 2), { tolerance: 2.5 }), true);
  assert.equal(polygonsMatch(square, square.slice(0, 3)), false);
});

test('footprint comparison reports the element and the size of the deviation', () => {
  const expected: NeutralFootprints = { a: { kind: 'wall', polygon: square }, b: { kind: 'brace', polygon: shift(square, 5000) } };
  assert.deepEqual(compareFootprints(expected, { ...expected, a: { kind: 'wall', polygon: [...square.slice(1), square[0]!] } }), []);
  const moved = compareFootprints(expected, { ...expected, a: { kind: 'wall', polygon: shift(square, 2) } });
  assert.equal(moved.length, 1);
  assert.match(moved[0]!.message, /deviates by up to 2\.000 mm/);
  assert.equal(moved[0]!.path, 'a');
  assert.equal(compareFootprints(expected, { a: expected.a! }).length, 1, 'missing element');
  assert.equal(compareFootprints(expected, { ...expected, c: expected.a! }).length, 1, 'unexpected element');
  assert.equal(compareFootprints(expected, { ...expected, c: expected.a! }, { allowExtra: true }).length, 0);
  assert.equal(compareFootprints(expected, { ...expected, a: { kind: 'platform', polygon: square } }).length, 0, 'kind is metadata by default');
  assert.equal(compareFootprints(expected, { ...expected, a: { kind: 'platform', polygon: square } }, { compareKind: true }).length, 1);
});

test('box comparison ignores order, part names and equivalent rotations', () => {
  const a = box('panel', 1000), b = box('panel', 3000);
  assert.equal(compareBoxes([a, b], [b, a]).length, 0);
  assert.equal(compareBoxes([a], [{ ...a, part: 'other' }]).length, 0);
  const turned: NeutralBox = { part: 'turned', center: a.center, size: { x: 28, y: 2400, z: 1200 }, rotation: { x: 0, y: 90, z: 0 } };
  assert.equal(boxesMatch(a, turned), true, 'axis swap plus quarter turn is the same solid');
  const flipped: NeutralBox = { ...a, rotation: { x: 0, y: 180, z: 0 } };
  assert.equal(boxesMatch(a, flipped), true, 'half turn of a symmetric box');
});

test('box comparison reports a 2 mm shift, a size change and missing boxes', () => {
  const a = box('panel', 1000);
  assert.equal(compareBoxes([a], [box('panel', 1002)]).length, 2);
  assert.equal(compareBoxes([a], [box('panel', 1002)], { tolerance: 2 }).length, 0);
  assert.equal(compareBoxes([a], [box('panel', 1000, { x: 1200, y: 2400, z: 31 })]).length, 2);
  const missing = compareBoxes([a, box('panel', 3000)], [a]);
  assert.equal(missing.length, 1);
  assert.match(missing[0]!.message, /missing in actual/);
  assert.match(compareBoxes([a], [a, box('extra', 9000)])[0]!.message, /unexpected in actual/);
});

test('solid comparison covers spheres and prisms and keeps default tolerance of half a millimetre', () => {
  assert.equal(DEFAULT_TOLERANCE_MM, 0.5);
  const expected: NeutralSolids = {
    chair: {
      boxes: [box('seat', 1000)],
      spheres: [{ part: 'head', center: { x: 1, y: 2, z: 3 }, radius: 50 }],
      prisms: [{ part: 'slab', outline: square, bottom: 0, top: 400 }],
    },
  };
  const same: NeutralSolids = {
    chair: {
      boxes: [box('x', 1000)],
      spheres: [{ part: 'y', center: { x: 1, y: 2, z: 3 }, radius: 50 }],
      prisms: [{ part: 'z', outline: [...square].reverse(), bottom: 0, top: 400 }],
    },
  };
  assert.deepEqual(compareSolids(expected, same), []);
  assert.equal(compareSolids(expected, { chair: { ...same.chair!, spheres: [{ part: 'y', center: { x: 1, y: 4, z: 3 }, radius: 50 }] } }).length, 2);
  assert.equal(compareSolids(expected, { chair: { ...same.chair!, prisms: [{ part: 'z', outline: square, bottom: 0, top: 402 }] } }).length, 2);
});

test('surface comparison checks outlines, elevations and per-element heights', () => {
  const expected: NeutralSurfaces = { surfaces: [{ id: 's', outline: square, elevation: 400 }], elevations: { wall: 400 } };
  assert.deepEqual(compareSurfaces(expected, { surfaces: [{ id: 's', outline: [...square].reverse(), elevation: 400 }], elevations: { wall: 400 } }), []);
  assert.equal(compareSurfaces(expected, { surfaces: [{ id: 's', outline: square, elevation: 402 }], elevations: { wall: 400 } }).length, 1);
  assert.equal(compareSurfaces(expected, { surfaces: expected.surfaces, elevations: { wall: 0 } }).length, 1);
});

test('warning comparison is a multiset over family, kind and ids', () => {
  const warning = (ids: string[], message = 'm'): NeutralWarning => ({ family: 'overlap', kind: 'scene', ids, message });
  assert.deepEqual(compareWarnings([warning(['a', 'b']), warning(['c', 'd'])], [warning(['d', 'c']), warning(['b', 'a'], 'other')]), []);
  assert.equal(compareWarnings([warning(['a', 'b'])], [warning(['a', 'b'], 'other')], { compareMessages: true }).length, 2);
  assert.equal(compareWarnings([warning(['a', 'b'])], []).length, 1);
});

test('list comparison uses the numeric tolerance and reports paths', () => {
  const expected = { materials: { slabs: 3, straps: 1 }, rows: [['a', 1200]] };
  assert.deepEqual(compareLists(expected, { materials: { slabs: 3, straps: 1 }, rows: [['a', 1200.2]] }), []);
  const found = compareLists(expected, { materials: { slabs: 4, straps: 1 }, rows: [['a', 1203]] });
  assert.deepEqual(found.map(item => item.path), ['materials.slabs', 'rows[0][1]']);
  assert.equal(compareLists(expected, { materials: expected.materials }).length, 1);
});

test('migrated demo seed matches the v1 golden geometry within 0.5 mm', () => {
  const fixture = loadV2GoldenFixtures().find(item => item.name === 'demo-seed')!;
  assertMatchesGolden(fixture.name, {
    footprints: fixture.footprints,
    solids: fixture.solids,
    surfaces: fixture.surfaces,
  }, { ids: fixture.objectIds, allowExtra: true });
});

test('a 2 mm change in migrated geometry is caught against the golden', () => {
  const fixture = loadV2GoldenFixtures().find(item => item.name === 'demo-seed')!;
  const footprints = structuredClone(fixture.footprints);
  const [id, item] = Object.entries(footprints)[0]!;
  footprints[id] = { ...item, polygon: shift(item.polygon as typeof square, 2) };
  const solids = structuredClone(fixture.solids);
  solids[id]!.boxes[0]!.center.x += 2;
  const options = { ids: fixture.objectIds, allowExtra: true };
  const found = compareToGolden(fixture.name, { footprints, solids }, options);
  assert.ok(found.some(entry => entry.path.startsWith(`footprints: ${id}`)));
  assert.ok(found.some(entry => entry.path.startsWith(`solids: ${id}`)));
  assert.equal(compareToGolden(fixture.name, { footprints, solids }, { ...options, tolerance: 2.5 }).length, 0);
});

test('reviewed intentional v2 golden differences stay explicit', () => {
  const expected = {
    'kitchen-sink': { footprints: 13, solids: 158, surfaces: 1 },
    warnings: { footprints: 3, solids: 19, surfaces: 0 },
    'wall-types': { footprints: 22, solids: 40, surfaces: 0 },
    'stage-decks': { footprints: 0, solids: 517, surfaces: 0 },
  } as Record<string, { footprints: number; solids: number; surfaces: number }>;
  for (const fixture of loadV2GoldenFixtures().filter(item => item.name !== 'demo-seed')) {
    const mismatches = compareToGolden(fixture.name, {
      footprints: fixture.footprints,
      solids: fixture.solids,
      surfaces: fixture.surfaces,
    }, { ids: fixture.objectIds, allowExtra: true });
    const count = (aspect: string) => mismatches.filter(item => item.path.startsWith(`${aspect}:`)).length;
    assert.deepEqual({
      footprints: count('footprints'),
      solids: count('solids'),
      surfaces: count('surfaces'),
    }, expected[fixture.name], fixture.name);
  }
});
