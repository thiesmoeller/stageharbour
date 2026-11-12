import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePart, type ResolvedPart } from '../src/shared/parts/resolve.js';
import { STARTER_BRACE, STARTER_CONTEXT, STARTER_DECK, STARTER_TABLE, STARTER_WALL } from '../src/shared/parts/starter/index.js';
import { CHAIR, DECK_ROW, DOOR_WALL, FIXTURE_CONTEXT, panel } from './helpers/partsFixtures.js';

function assertClose(actual: number, expected: number, message: string, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} is not ${expected}`);
}

const beamRows = (resolved: ResolvedPart) => resolved.cutList.beams.map(row => [row.material, row.lengthMm, row.count] as const);

test('Stützdreieck: three lengths of Latte, the diagonal from Pythagoras', () => {
  const resolved = resolvePart(STARTER_BRACE, {}, STARTER_CONTEXT);
  // Diagonal between the timber axes: 500 - 40 across, 1200 - 40 up.
  const diagonal = Math.sqrt(460 * 460 + 1160 * 1160);
  assertClose(diagonal, 1247.8781991845, 'hand value', 1e-9);
  assert.deepEqual(beamRows(resolved), [['latte-40x40', 1248, 1], ['latte-40x40', 1200, 1], ['latte-40x40', 500, 1]]);
  const [strut, stile, rail] = resolved.cutList.beams;
  assert.deepEqual(strut!.section, { width: 40, height: 40 });
  assertClose(strut!.totalLengthMm, diagonal, 'diagonal length');
  assertClose(stile!.totalLengthMm, 1200, 'stile length');
  assertClose(rail!.totalLengthMm, 500, 'rail length');
  // 0,75 kg/m.
  assertClose(strut!.weightKg, diagonal / 1000 * 0.75, 'diagonal weight');
  assertClose(stile!.weightKg, 0.9, 'stile weight');
  assertClose(rail!.weightKg, 0.375, 'rail weight');
  assert.deepEqual(resolved.cutList.sheets, []);
  assert.deepEqual(resolved.hardware, []);
  assertClose(resolved.weightKg, (1200 + 500 + diagonal) / 1000 * 0.75, 'weight');
  assertClose(resolved.weightKg, 2.2109086493884, 'weight by hand', 1e-9);
});

test('Stützdreieck: other sizes and ballast', () => {
  const low = resolvePart(STARTER_BRACE, { variant: 'niedrig' }, STARTER_CONTEXT);
  assert.deepEqual(beamRows(low), [['latte-40x40', 932, 1], ['latte-40x40', 900, 1], ['latte-40x40', 400, 1]]);
  assertClose(low.cutList.beams[0]!.totalLengthMm, Math.hypot(360, 860), 'low diagonal');
  const tall = resolvePart(STARTER_BRACE, { variant: 'hoch' }, STARTER_CONTEXT);
  assert.deepEqual(beamRows(tall), [['latte-40x40', 2479, 1], ['latte-40x40', 2400, 1], ['latte-40x40', 800, 1]]);
  assertClose(tall.cutList.beams[0]!.totalLengthMm, Math.hypot(760, 2360), 'tall diagonal');

  const one = resolvePart(STARTER_BRACE, { values: { ballast: 1 } }, STARTER_CONTEXT);
  assert.deepEqual(one.hardware, [{ material: 'betonplatte-400', quantity: 1, weightKg: 18 }]);
  assertClose(one.weightKg, 2.2109086493884 + 18, 'one slab', 1e-9);
  // Two slabs come with the strap that ties them.
  const two = resolvePart(STARTER_BRACE, { values: { ballast: 2 } }, STARTER_CONTEXT);
  assert.deepEqual(two.hardware, [
    { material: 'betonplatte-400', quantity: 2, weightKg: 36 },
    { material: 'spanngurt-25', quantity: 1, weightKg: 0.3 },
  ]);
  assertClose(two.weightKg, 2.2109086493884 + 36.3, 'two slabs', 1e-9);
});

test('Wandelement: net area without the door, weight from the net area', () => {
  const full = resolvePart(STARTER_WALL, { variant: 'voll' }, STARTER_CONTEXT);
  assert.deepEqual(full.cutList.sheets, [{
    material: 'tischlerplatte-28', thicknessMm: 28, widthMm: 1200, heightMm: 2400, count: 1,
    areaMm2: 2_880_000, grossAreaMm2: 2_880_000, weightKg: 36,
  }]);
  assert.equal(full.weightKg, 36);

  const door = resolvePart(STARTER_WALL, { variant: 'tuer' }, STARTER_CONTEXT);
  // 1200 × 2400 minus 800 × 2000 = 1,28 m² at 12,5 kg/m².
  assert.deepEqual(door.cutList.sheets, [{
    material: 'tischlerplatte-28', thicknessMm: 28, widthMm: 1200, heightMm: 2400, count: 1,
    areaMm2: 1_280_000, grossAreaMm2: 2_880_000, weightKg: 16,
  }]);
  assert.equal(door.weightKg, 16);
  assert.deepEqual(door.cutList.beams, []);

  const faces = Object.fromEntries(door.faces.map(face => [face.key, face.areaMm2]));
  assert.equal(faces.front, 1_280_000);
  assert.equal(faces.back, 1_280_000);
  // Perimeter of the notched outline: 2 × 200 floor + 2 × 2400 + 1200 + 2 × 2000 jambs + 800 head, times 28.
  assert.equal(faces.edge, (400 + 4800 + 1200 + 4000 + 800) * 28);
});

test('a hole inside a sheet counts against the net area', () => {
  const resolved = resolvePart(panel({
    bodies: [{
      kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0],
      outline: { shape: 'rect', x: '-B / 2', y: 0, width: 'B', height: 'H' },
      holes: [{ shape: 'rect', key: 'fenster', x: -250, y: 1000, width: 500, height: 400 }],
    }],
    traits: { stock: 'none', faces: [{ key: 'rand', label: 'Rand', body: 'platte', side: 'edge' }, { key: 'alles', label: 'Alles', body: 'platte', side: 'all' }] },
  }), {}, FIXTURE_CONTEXT);
  const [row] = resolved.cutList.sheets;
  assert.equal(row!.areaMm2, 2_000_000 - 200_000);
  assert.equal(row!.grossAreaMm2, 2_000_000);
  // 1,8 m² at 8 kg/m².
  assertClose(resolved.weightKg, 14.4, 'weight');
  const rim = (2 * (1000 + 2000) + 2 * (500 + 400)) * 12;
  assert.deepEqual(resolved.faces.map(face => [face.key, face.areaMm2]), [['rand', rim], ['alles', rim + 2 * 1_800_000]]);
});

test('Bühnenelement and Tisch: totals over bodies and children', () => {
  const deck = resolvePart(STARTER_DECK, {}, STARTER_CONTEXT);
  assert.deepEqual(beamRows(deck), [
    ['buehnenrahmen-40x68', 2000, 2], ['buehnenrahmen-40x68', 920, 2], ['steckfuss-rohr-50', 508, 4],
  ]);
  assert.deepEqual(deck.cutList.beams[0]!.section, { width: 40, height: 68 });
  assert.deepEqual(deck.cutList.sheets.map(row => [row.material, row.widthMm, row.heightMm, row.count, row.areaMm2]),
    [['sperrholz-12', 2000, 1000, 1, 2_000_000]]);
  // A box of a hardware material is one piece of it.
  assert.deepEqual(deck.hardware, [{ material: 'gummifuss-50', quantity: 4, weightKg: 0.2 }]);
  // Frame 2 × 2 m + 2 × 0,92 m at 1,6 kg/m; legs 4 × 0,508 m at 1,5 kg/m; deck 2 m² at 8 kg/m²; feet 4 × 0,05 kg.
  assertClose(deck.weightKg, 6.4 + 2.944 + 3.048 + 16 + 0.2, 'deck weight');

  const table = resolvePart(STARTER_TABLE, {}, STARTER_CONTEXT);
  assert.deepEqual(beamRows(table), [['latte-40x40', 722, 4]]);
  assertClose(table.cutList.beams[0]!.totalLengthMm, 2888, 'leg length total');
  // Top 0,96 m² at 12,5 kg/m²; legs 2,888 m at 0,75 kg/m.
  assertClose(table.weightKg, 12 + 2.166, 'table weight');

  const row = resolvePart(DECK_ROW, { values: { n: 3, H: 800 } }, FIXTURE_CONTEXT);
  assert.deepEqual(beamRows(row), [
    ['buehnenrahmen-40x68', 2000, 6], ['buehnenrahmen-40x68', 920, 6], ['steckfuss-rohr-50', 708, 12],
  ]);
  assert.deepEqual(row.cutList.sheets.map(item => [item.count, item.areaMm2]), [[3, 6_000_000]]);
  assert.deepEqual(row.hardware.map(item => [item.material, item.quantity]), [['gummifuss-50', 12]]);
  assertClose(row.hardware[0]!.weightKg, 0.6, 'feet weight');
  assertClose(row.weightKg, 19.2 + 8.832 + 12.744 + 48 + 0.6, 'row weight');
});

test('door wall and chair: mixed materials', () => {
  const door = resolvePart(DOOR_WALL, { state: { offen: 70 } }, FIXTURE_CONTEXT);
  assert.deepEqual(beamRows(door), [['zarge-60x28', 2000, 2], ['zarge-60x28', 744, 1]]);
  assert.deepEqual(door.cutList.sheets.map(row => [row.material, row.widthMm, row.heightMm, row.areaMm2]), [
    ['tischlerplatte-28', 1200, 2400, 1_280_000], ['tuerblatt-40', 744, 1972, 744 * 1972],
  ]);
  // Wall 1,28 m² at 12,5; frame 4,744 m at 1,2; leaf 0,744 × 1,972 m² at 20. The swing changes nothing.
  assertClose(door.weightKg, 16 + 5.6928 + 29.34336, 'door wall weight');
  assertClose(resolvePart(DOOR_WALL, {}, FIXTURE_CONTEXT).weightKg, door.weightKg, 'closed door weight');

  const chair = resolvePart(CHAIR, {}, FIXTURE_CONTEXT);
  assert.deepEqual(chair.hardware, [{ material: 'kiste', quantity: 1, weightKg: 4 }]);
  // Seat 4 kg; legs 4 × 0,43 m at 0,75; back 0,44 × 0,4 m² at 8.
  assertClose(chair.weightKg, 4 + 1.29 + 1.408, 'chair weight');
});

test('rows group by whole millimetres and keep the exact totals', () => {
  const resolved = resolvePart(panel({
    parameters: [],
    bodies: [
      { kind: 'beam', key: 'a', material: 'latte-40x40', from: [0, 0, 0], to: [0, 999.6, 0] },
      { kind: 'beam', key: 'b', material: 'latte-40x40', from: [100, 0, 0], to: [100, 1000.4, 0] },
      { kind: 'beam', key: 'c', material: 'latte-40x40', from: [200, 0, 0], to: [200, 1000.6, 0] },
      { kind: 'beam', key: 'd', material: 'latte-40x40', section: [40, 60], from: [300, 0, 0], to: [300, 1000, 0] },
      { kind: 'sheet', key: 'e', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 500], outline: { shape: 'rect', x: 0, y: 0, width: 300.2, height: 200 } },
      { kind: 'sheet', key: 'f', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 600], outline: { shape: 'rect', x: 0, y: 0, width: 299.9, height: 200 } },
      { kind: 'sheet', key: 'g', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 700], thickness: 18, outline: { shape: 'rect', x: 0, y: 0, width: 300, height: 200 } },
    ],
  }), {}, FIXTURE_CONTEXT);
  assert.deepEqual(resolved.issues, []);
  assert.deepEqual(resolved.cutList.beams.map(row => [row.lengthMm, row.section.height, row.count]), [[1001, 40, 1], [1000, 60, 1], [1000, 40, 2]]);
  assertClose(resolved.cutList.beams[2]!.totalLengthMm, 2000, 'exact total');
  assert.deepEqual(resolved.cutList.sheets.map(row => [row.widthMm, row.heightMm, row.thicknessMm, row.count]), [[300, 200, 18, 1], [300, 200, 12, 2]]);
  assertClose(resolved.cutList.sheets[1]!.areaMm2, (300.2 + 299.9) * 200, 'exact area');
});
