import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openingParameterKeys, partDefinitionSchema, removeOpening, upsertArchOpening, upsertOpening,
  upsertPolygonOpening, upsertRectOpening,
  type PartDefinition,
} from '../src/shared/parts/index.js';

function panel(): PartDefinition {
  return {
    id: 'c7b30ad4-d1f6-4b03-8907-49f71df737b7',
    revision: 1,
    name: 'Testwand',
    category: 'Test',
    parameters: [],
    bodies: [{
      kind: 'sheet',
      key: 'platte',
      material: 'platte-18',
      plane: 'xy',
      at: [0, 0, 0],
      outline: { shape: 'rect', x: 0, y: 0, width: 3000, height: 2500 },
    }],
    traits: { stock: 'none' },
  };
}

function holes(definition: PartDefinition) {
  const body = definition.bodies[0]!;
  assert.equal(body.kind, 'sheet');
  return body.kind === 'sheet' ? body.holes ?? [] : [];
}

test('a rectangular opening owns four placement parameters and formula bindings', () => {
  const original = panel();
  const definition = upsertRectOpening(original, 'platte', {
    key: 'fenster', left: 450, sill: 900, width: 1200, height: 1000,
  });
  const keys = openingParameterKeys('fenster');

  assert.deepEqual(keys, {
    left: 'fensterLeft', sill: 'fensterSill', width: 'fensterB', height: 'fensterH',
  });
  assert.deepEqual(holes(definition), [{
    shape: 'rect', key: 'fenster',
    x: keys.left, y: keys.sill, width: keys.width, height: keys.height,
  }]);
  assert.deepEqual(definition.parameters.map(parameter =>
    [parameter.key, parameter.label, parameter.type, parameter.scope, parameter.default]), [
    ['fensterLeft', 'fenster · Linke Kante', 'length', 'placement', 450],
    ['fensterSill', 'fenster · Brüstung', 'length', 'placement', 900],
    ['fensterB', 'fenster · Breite', 'length', 'placement', 1200],
    ['fensterH', 'fenster · Höhe', 'length', 'placement', 1000],
  ]);
  assert.deepEqual(original, panel(), 'the helper does not mutate its input');
  assert.equal(partDefinitionSchema.safeParse(definition).success, true);
});

test('upserting an opening updates defaults without duplicating its parameter group', () => {
  const first = upsertRectOpening(panel(), 'platte', {
    key: 'fenster', left: 450, sill: 900, width: 1200, height: 1000, when: '1',
  });
  const updated = upsertRectOpening(first, 'platte', {
    key: 'fenster', left: 300, sill: 750, width: 900, height: 1100,
  });

  assert.deepEqual(updated.parameters.map(parameter => parameter.default), [300, 750, 900, 1100]);
  assert.equal(updated.parameters.length, 4);
  assert.equal(holes(updated)[0]?.when, '1', 'an omitted condition is preserved');
  assert.deepEqual(first.parameters.map(parameter => parameter.default), [450, 900, 1200, 1000]);
});

test('two openings get distinct parameter groups', () => {
  const first = upsertRectOpening(panel(), 'platte', {
    key: 'fenster', left: 100, sill: 800, width: 700, height: 900,
  });
  const second = upsertOpening(first, 'platte', {
    shape: 'rect', key: 'fenster2', left: 1100, sill: 700, width: 800, height: 1000,
  });

  assert.equal(holes(second).length, 2);
  assert.equal(second.parameters.length, 8);
  assert.deepEqual(
    new Set(second.parameters.map(parameter => parameter.key)),
    new Set([...Object.values(openingParameterKeys('fenster')), ...Object.values(openingParameterKeys('fenster2'))]),
  );
});

test('deleting an opening cleans its unreferenced parameter group', () => {
  const created = upsertRectOpening(panel(), 'platte', {
    key: 'fenster', left: 100, sill: 800, width: 700, height: 900,
  });
  const removed = removeOpening(created, 'platte', 'fenster');

  assert.deepEqual(holes(removed), []);
  assert.deepEqual(removed.parameters, []);
  assert.equal(partDefinitionSchema.safeParse(removed).success, true);
});

test('deleting an opening retains its parameter group when another formula references it', () => {
  const keys = openingParameterKeys('fenster');
  const created = upsertRectOpening(panel(), 'platte', {
    key: 'fenster', left: 100, sill: 800, width: 700, height: 900,
  });
  const referenced = {
    ...created,
    connectors: [{ key: 'kante', kind: 'test', at: [0, 0, 0], axis: [1, 0, 0], length: keys.width }],
  } satisfies PartDefinition;
  const removed = removeOpening(referenced, 'platte', 'fenster');

  assert.equal(removed.parameters.length, 4);
  assert.equal(holes(removed).length, 0);
});

test('an arch uses the same four-parameter contract', () => {
  const definition = upsertArchOpening(panel(), 'platte', {
    key: 'bogen', left: 200, sill: 0, width: 1000, height: 2100,
  });
  const keys = openingParameterKeys('bogen');

  assert.deepEqual(holes(definition), [{
    shape: 'arch', key: 'bogen',
    x: keys.left, y: keys.sill, width: keys.width, height: keys.height,
  }]);
  assert.equal(partDefinitionSchema.safeParse(definition).success, true);
});

test('a polygon keeps literal points and removes a replaced rectangular parameter group', () => {
  const rectangle = upsertRectOpening(panel(), 'platte', {
    key: 'sonderform', left: 100, sill: 200, width: 600, height: 800,
  });
  const polygon = upsertPolygonOpening(rectangle, 'platte', {
    key: 'sonderform', points: [[100, 200], [700, 200], [550, 1000], [200, 900]],
  });

  assert.deepEqual(holes(polygon), [{
    shape: 'polygon',
    key: 'sonderform',
    points: [[100, 200], [700, 200], [550, 1000], [200, 900]],
  }]);
  assert.deepEqual(polygon.parameters, []);
  assert.equal(partDefinitionSchema.safeParse(polygon).success, true);
});

test('parameter names remain valid and stable for non-identifier hole keys', () => {
  const keys = openingParameterKeys('2.tuer-rechts');
  assert.deepEqual(keys, {
    left: 'h_2_dtuer_hrechtsLeft',
    sill: 'h_2_dtuer_hrechtsSill',
    width: 'h_2_dtuer_hrechtsB',
    height: 'h_2_dtuer_hrechtsH',
  });
  for (const key of Object.values(keys)) assert.match(key, /^[A-Za-z][A-Za-z0-9_]{0,39}$/);
});
