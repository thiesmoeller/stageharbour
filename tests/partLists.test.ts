import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assemblyOrder } from '../src/shared/assembly.js';
import type { Layout, LayoutObject } from '../src/shared/layout.js';
import { createLayoutPartIndex, resolveLayoutObjectDetails } from '../src/shared/layoutObjects.js';
import { combineLists, sceneLists, stockItemFits, type StockInventory } from '../src/shared/partLists.js';
import { STARTER_LIBRARY, STARTER_PART_IDS } from '../src/shared/parts/starter/index.js';

const index = createLayoutPartIndex(STARTER_LIBRARY);
const ref = (id: string) => ({ id, revision: 1 });

function wall(label: string, x: number, extra: Partial<LayoutObject> = {}): LayoutObject {
  return {
    id: randomUUID(), label, part: ref(STARTER_PART_IDS.wall), variant: 'plain',
    values: { B: 1200, H: 2400, D: 28 }, x, y: 3000, rotation: 0, ...extra,
  };
}
const deck = (label: string, x: number, extra: Partial<LayoutObject> = {}): LayoutObject => ({
  id: randomUUID(), label, part: ref(STARTER_PART_IDS.deck), variant: '2x1', values: { H: 400 }, x, y: 1000, rotation: 0, ...extra,
});
const brace = (label: string, ballast: number): LayoutObject => ({
  id: randomUUID(), label, part: ref(STARTER_PART_IDS.brace), variant: 'standard', values: { ballast }, x: 0, y: 3500, rotation: 0,
});

function resolve(objects: LayoutObject[], joints: Layout['joints'] = []) {
  return resolveLayoutObjectDetails({ schemaVersion: 2, objects, joints }, index);
}

test('parts list counts placed parts and the children built into them', () => {
  const { objects } = resolve([deck('Podest A', 1000), deck('Podest B', 3000), wall('W1', 0)]);
  const lists = sceneLists({ objects, context: index.context });
  const decks = lists.parts.find(row => row.partId === STARTER_PART_IDS.deck);
  assert.deepEqual({ placed: decks?.placed, nested: decks?.nested, count: decks?.count, variant: decks?.variantLabel }, {
    placed: 2, nested: 0, count: 2, variant: '2 × 1 m',
  });
  const legs = lists.parts.find(row => row.partId === STARTER_PART_IDS.deckLeg);
  assert.equal(legs?.nested, 8);
  assert.equal(legs?.placed, 0);
  assert.equal(legs?.variantLabel, '40 cm');
  assert.equal(lists.objects.length, 3);
});

test('cut list sums equal rows across objects and the weight is their total', () => {
  const { objects } = resolve([wall('W1', 0), wall('W2', 1200), wall('W3', 2400, { values: { B: 600, H: 2400, D: 28 } })]);
  const lists = sceneLists({ objects, context: index.context });
  const sheets = lists.cutList.sheets;
  assert.equal(sheets.length, 2, 'two sizes of Tischlerplatte');
  const wide = sheets.find(row => row.widthMm === 1200);
  assert.equal(wide?.count, 2);
  assert.equal(wide?.materialName, 'Tischlerplatte 28 mm');
  const single = objects.reduce((sum, item) => sum + item.resolved.weightKg, 0);
  assert.ok(Math.abs(lists.weightKg - single) < 1e-6, `${lists.weightKg} vs ${single}`);
});

test('hardware and count stock are demanded and compared with counted stock', () => {
  const { objects } = resolve([brace('S1', 2), brace('S2', 1), deck('Podest', 1000)]);
  const stock: StockInventory = {
    items: [],
    counts: [
      { materialKey: 'betonplatte-400', partId: null, variantKey: null, quantity: 2 },
      { materialKey: null, partId: STARTER_PART_IDS.deckLeg, variantKey: '400', quantity: 10 },
    ],
  };
  const lists = sceneLists({ objects, context: index.context, stock });
  const slabs = lists.stock.rows.find(row => row.materialKey === 'betonplatte-400');
  assert.deepEqual({ required: slabs?.required, available: slabs?.available, shortage: slabs?.shortage }, { required: 3, available: 2, shortage: 1 });
  const straps = lists.stock.rows.find(row => row.materialKey === 'spanngurt-25');
  assert.deepEqual({ required: straps?.required, available: straps?.available, shortage: straps?.shortage }, { required: 1, available: null, shortage: 0 });
  const braces = lists.stock.rows.find(row => row.partId === STARTER_PART_IDS.brace);
  assert.deepEqual({ kind: braces?.kind, required: braces?.required, available: braces?.available }, { kind: 'count', required: 2, available: null });
  const legs = lists.stock.rows.find(row => row.partId === STARTER_PART_IDS.deckLeg);
  assert.deepEqual({ required: legs?.required, available: legs?.available, shortage: legs?.shortage }, { required: 4, available: 10, shortage: 0 });
  assert.ok(lists.stock.warnings.some(warning => warning.kind === 'shortage' && /Betonplatte/.test(warning.message)));
});

test('item stock reports assignment, missing, unusable, incompatible and duplicate pieces', () => {
  const pieces = [
    { id: randomUUID(), label: 'W-01', partId: STARTER_PART_IDS.wall, variantKey: 'plain', values: { B: 1200, H: 2400, D: 28 }, usable: true, archived: false },
    { id: randomUUID(), label: 'W-02', partId: STARTER_PART_IDS.wall, variantKey: 'plain', usable: false, archived: false },
    { id: randomUUID(), label: 'W-03', partId: STARTER_PART_IDS.wall, variantKey: 'window', usable: true, archived: false },
  ];
  const stock: StockInventory = { items: pieces, counts: [] };
  const [w01, w02, w03] = pieces;
  const { objects } = resolve([
    wall('Ohne', 0),
    wall('Erste', 1200, { stockItemId: w01!.id }),
    wall('Zweite', 2400, { stockItemId: w01!.id }),
    wall('Kaputt', 3600, { stockItemId: w02!.id }),
    wall('Fenster', 4800, { stockItemId: w03!.id }),
    wall('Weg', 6000, { stockItemId: randomUUID() }),
  ]);
  const lists = sceneLists({ objects, context: index.context, stock, scene: { id: 's', name: 'Szene' } });
  const kinds = lists.stock.warnings.map(warning => warning.kind).sort();
  assert.deepEqual(kinds, ['duplicate', 'incompatible', 'missing', 'shortage', 'unassigned', 'unusable']);
  const walls = lists.stock.rows.find(row => row.partId === STARTER_PART_IDS.wall);
  assert.deepEqual({ required: walls?.required, assigned: walls?.assigned, available: walls?.available, shortage: walls?.shortage },
    { required: 6, assigned: 5, available: 1, shortage: 5 });
  assert.equal(lists.objects.find(row => row.label === 'Erste')?.stockItemLabel, 'W-01');
  assert.equal(stockItemFits(w01!, objects[1]!), true);
  assert.equal(stockItemFits(w01!, { ...objects[1]!, resolved: { ...objects[1]!.resolved, values: { ...objects[1]!.resolved.values, B: 600 } } }), false);
});

test('a venue visit takes the largest quantity of every row and checks shortage again', () => {
  const stock: StockInventory = { items: [], counts: [{ materialKey: 'betonplatte-400', partId: null, variantKey: null, quantity: 2 }] };
  const first = sceneLists({ objects: resolve([brace('S1', 2)]).objects, context: index.context, stock, scene: { id: 'a', name: 'A' } });
  const second = sceneLists({ objects: resolve([brace('S1', 1), brace('S2', 1), brace('S3', 1)]).objects, context: index.context, stock, scene: { id: 'b', name: 'B' } });
  const visit = combineLists([first, second], stock);
  const slabs = visit.stock.rows.find(row => row.materialKey === 'betonplatte-400');
  assert.deepEqual({ required: slabs?.required, shortage: slabs?.shortage }, { required: 3, shortage: 1 });
  assert.equal(visit.stock.rows.find(row => row.partId === STARTER_PART_IDS.brace)?.required, 3);
  assert.equal(visit.stock.rows.find(row => row.materialKey === 'spanngurt-25')?.required, 1);
  assert.equal(visit.stock.warnings.filter(warning => warning.kind === 'shortage').length, 1);
  assert.deepEqual(visit.scenes.map(scene => scene.name), ['A', 'B']);
  assert.equal(visit.objects.length, 4);
  const beams = visit.cutList.beams.find(row => row.material === 'latte-40x40');
  assert.equal(beams?.count, second.cutList.beams.find(row => row.key === beams?.key)?.count);
});

test('hinge joints order a chain left to right and fill missing assembly numbers', () => {
  const a = wall('A', 0);
  const b = wall('B', 1200);
  const c = wall('C', 2400, { assemblyNumber: 7 });
  const loose = wall('Lose', 5000);
  const joints: Layout['joints'] = [
    { a: { object: c.id, connector: 'links' }, b: { object: b.id, connector: 'rechts' } },
    { a: { object: b.id, connector: 'links' }, b: { object: a.id, connector: 'rechts' } },
  ];
  const { objects } = resolve([c, loose, b, a], joints);
  const order = assemblyOrder(joints, objects);
  assert.deepEqual(order.chains, [[a.id, b.id, c.id]]);
  assert.deepEqual([order.numbers.get(a.id), order.numbers.get(b.id), order.numbers.get(c.id)], [1, 2, 7]);
  assert.equal(order.numbers.has(loose.id), false);
  const noHinges = assemblyOrder([{ a: { object: a.id, connector: 'stuetze' }, b: { object: b.id, connector: 'links' } }], objects);
  assert.deepEqual(noHinges.chains, []);
});
