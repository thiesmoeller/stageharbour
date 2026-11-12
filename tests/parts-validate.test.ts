import assert from 'node:assert/strict';
import test from 'node:test';
import { PART_LIMITS, createPartContext, type PartDefinition, type PartParameter } from '../src/shared/parts/definition.js';
import type { PartIssue } from '../src/shared/parts/issues.js';
import { STARTER_BRACE, STARTER_CONTEXT, STARTER_LIBRARY, STARTER_MATERIALS, STARTER_PARTS, STARTER_TABLE } from '../src/shared/parts/starter/index.js';
import { validateDefinition, validateLibrary } from '../src/shared/parts/validate.js';
import {
  CHAIR, DECK_ROW, DOOR_LEAF, DOOR_WALL, FIXTURE_CONTEXT, FIXTURE_MATERIALS, FIXTURE_PARTS, STAIR, WIDE_BRACE,
  fixtureId, panel, refOf,
} from './helpers/partsFixtures.js';

const errors = (issues: readonly PartIssue[]) => issues.filter(item => item.severity === 'error');
const codes = (issues: readonly PartIssue[]) => issues.map(item => `${item.severity}:${item.code}`);

const range = (key: string, min: number, max: number, fallback: number, scope: PartParameter['scope'] = 'placement'): PartParameter =>
  ({ key, label: key, type: 'length', default: fallback, scope, range: { min, max } });

/** A part with one box whose width is the given formula over B (500–2000, default 1000) and H (1000–3000, default 2000). */
const strip = (width: string, overrides: Partial<PartDefinition> = {}) => panel({
  bodies: [{ kind: 'box', key: 'leiste', label: 'Leiste', material: 'kiste', size: [width, 10, 10], at: [0, 5, 0] }],
  ...overrides,
});

test('the starter parts and the fixtures pass', () => {
  for (const definition of STARTER_PARTS) {
    const result = validateDefinition(definition, STARTER_CONTEXT);
    assert.deepEqual(result.issues, [], definition.name);
    assert.equal(result.ok, true);
    assert.deepEqual(result.definition, definition);
    assert.equal(result.sampled, false);
  }
  for (const definition of [WIDE_BRACE, DOOR_LEAF, DOOR_WALL, STAIR, DECK_ROW, CHAIR, panel()]) {
    const result = validateDefinition(definition, FIXTURE_CONTEXT);
    assert.deepEqual(result.issues, [], definition.name);
    assert.equal(result.ok, true);
  }
  // Three variants and the migration-only dimension overrides are sampled at
  // their defaults and endpoints, including ballast 0, 1 and 2.
  assert.equal(validateDefinition(STARTER_BRACE, STARTER_CONTEXT).evaluated, 87);
  // Defaults, six single ends, eight corners.
  assert.equal(validateDefinition(STARTER_TABLE, STARTER_CONTEXT).evaluated, 15);
});

test('a body under 1 mm at one end of a range is rejected, naming body and parameter', () => {
  // 1000,5 mm at the default, 1500,5 mm at the smallest B, 0,5 mm at the largest.
  const result = validateDefinition(strip('2000.5 - B'), FIXTURE_CONTEXT);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result.issues), ['error:body-too-small']);
  const [found] = result.issues;
  assert.equal(found!.body, 'leiste');
  assert.equal(found!.parameter, 'B');
  assert.equal(found!.field, 'size[0]');
  assert.equal(found!.message, 'Körper „leiste“: Breite 0,5 mm unterschreitet das Mindestmaß von 1 mm. Tritt auf bei B = 2000.');

  const low = validateDefinition(strip('B - 499.5'), FIXTURE_CONTEXT);
  assert.equal(low.ok, false);
  assert.match(low.issues[0]!.message, /Körper „leiste“.*Tritt auf bei B = 500\.$/);
  assert.equal(low.issues[0]!.parameter, 'B');

  // The other parameter is not blamed for it.
  const second = validateDefinition(strip('3000.5 - H'), FIXTURE_CONTEXT);
  assert.equal(second.issues[0]!.parameter, 'H');
  assert.match(second.issues[0]!.message, /Tritt auf bei H = 3000\.$/);

  // Negative sizes, sheet outlines, beam lengths and thickness are caught the same way.
  assert.match(validateDefinition(strip('1500 - B'), FIXTURE_CONTEXT).issues[0]!.message, /Breite -500 mm/);
  const sheet = validateDefinition(panel({
    bodies: [{
      kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0], thickness: '(B - 499) / 100',
      outline: { shape: 'rect', x: 0, y: 0, width: 'B', height: '3000.5 - H' },
    }],
  }), FIXTURE_CONTEXT);
  assert.deepEqual(sheet.issues.map(item => [item.code, item.body, item.field, item.parameter]), [
    ['body-too-small', 'platte', 'thickness', 'B'],
    ['body-too-small', 'platte', 'outline.height', 'H'],
  ]);
  const beam = validateDefinition(panel({
    bodies: [{ kind: 'beam', key: 'latte', material: 'latte-40x40', from: [0, 0, 0], to: [0, 'H - 1000', 0] }],
  }), FIXTURE_CONTEXT);
  assert.deepEqual(beam.issues.map(item => [item.code, item.body, item.parameter]), [['body-too-small', 'latte', 'H']]);
  assert.match(beam.issues[0]!.message, /Körper „latte“: Länge 0 mm .* Tritt auf bei H = 1000\.$/);
});

test('a failure that needs two parameters at their ends is found in the combinations', () => {
  // 1500,5 at the defaults; only B = 500 together with H = 3000 gives 0,5.
  const result = validateDefinition(strip('B - 500 + 3000 - H + 0.5'), FIXTURE_CONTEXT);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result.issues), ['error:body-too-small']);
  assert.equal(result.issues[0]!.parameter, 'B');
  assert.match(result.issues[0]!.message, /Tritt auf bei B = 500, H = 3000\.$/);
  assert.equal(result.evaluated, 1 + 4 + 4);
});

test('non-finite values and formula errors at an end of a range are rejected', () => {
  const root = validateDefinition(strip('sqrt(B - 600) + 10'), FIXTURE_CONTEXT);
  assert.equal(root.ok, false);
  assert.deepEqual(codes(root.issues), ['error:formula']);
  assert.equal(root.issues[0]!.formula?.code, 'non-finite');
  assert.equal(root.issues[0]!.body, 'leiste');
  assert.equal(root.issues[0]!.parameter, 'B');
  assert.match(root.issues[0]!.message, /Körper „leiste“.*Tritt auf bei B = 500\.$/);

  const divided = validateDefinition(strip('10000 / (2000 - B)'), FIXTURE_CONTEXT);
  assert.equal(divided.issues[0]!.formula?.code, 'division-by-zero');
  assert.equal(divided.issues[0]!.parameter, 'B');

  // A derived value that fails is named itself.
  const derived = validateDefinition(strip('halb', { derived: [{ key: 'halb', formula: '100 / (H - 3000) + 500' }] }), FIXTURE_CONTEXT);
  assert.equal(derived.ok, false);
  // The body that reads the failed value is not reported a second time.
  assert.deepEqual(codes(derived.issues), ['error:formula']);
  assert.equal(derived.issues[0]!.message, 'Hilfswert „halb“: Formel „100 / (H - 3000) + 500“: Division durch null (Zeichen 5). Tritt auf bei H = 3000.');
  assert.equal(derived.issues[0]!.derived, 'halb');
  assert.equal(derived.issues[0]!.parameter, 'H');

  const position = validateDefinition(strip('100', {
    bodies: [{ kind: 'box', key: 'leiste', material: 'kiste', size: [100, 10, 10], at: ['B * 100', 5, 0] }],
  }), FIXTURE_CONTEXT);
  assert.deepEqual(codes(position.issues), ['error:out-of-range']);
  assert.equal(position.issues[0]!.parameter, 'B');
});

test('every listed value and both toggle states are tried', () => {
  const listed = validateDefinition(strip('abs(L - 300) + 0.5', {
    parameters: [{ key: 'L', label: 'Länge', type: 'length', default: 100, scope: 'placement', values: [100, 200, 300, 400] }],
  }), FIXTURE_CONTEXT);
  assert.equal(listed.ok, false);
  assert.match(listed.issues[0]!.message, /Tritt auf bei L = 300\.$/);
  assert.equal(listed.evaluated, 4);

  const toggle = validateDefinition(strip('100 - 99.5 * kurz', {
    parameters: [{ key: 'kurz', label: 'Kurz', type: 'toggle', default: 0, scope: 'state' }],
  }), FIXTURE_CONTEXT);
  assert.equal(toggle.ok, false);
  assert.equal(toggle.issues[0]!.parameter, 'kurz');
  assert.match(toggle.issues[0]!.message, /Tritt auf bei kurz = 1\.$/);
});

test('every variant is evaluated; variant-scope ranges are not, when variants exist', () => {
  const definition = strip('T - 199.5', {
    parameters: [range('T', 200, 1500, 500, 'variant'), range('H', 1000, 3000, 2000)],
    variants: [
      { key: 'a', label: 'Normal', values: { T: 500 } },
      { key: 'b', label: 'Schmal', values: { T: 200 } },
    ],
  });
  const result = validateDefinition(definition, FIXTURE_CONTEXT);
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map(item => [item.code, item.body, item.parameter, item.variant]), [['body-too-small', 'leiste', 'T', 'b']]);
  assert.match(result.issues[0]!.message, /Tritt auf bei T = 200, Variante „Schmal“\.$/);
  assert.equal(result.evaluated, 2 * 3);

  // With only the wide variant the range end T = 200 cannot be reached by any placement.
  assert.equal(validateDefinition({ ...definition, variants: [definition.variants![0]!] }, FIXTURE_CONTEXT).ok, true);
  // Without variants the variant-scope range is what a parent part may set, so its ends count.
  const free = validateDefinition({ ...definition, variants: undefined }, FIXTURE_CONTEXT);
  assert.equal(free.ok, false);
  assert.equal(free.issues[0]!.variant, undefined);
});

test('errors inside child parts are attributed to the parameter that reaches them', () => {
  const child = strip('B - 99.5', { id: fixtureId(60), name: 'Leiste', parameters: [range('B', 1, 5000, 500, 'variant')] });
  const parent: PartDefinition = {
    id: fixtureId(61), revision: 1, name: 'Rahmen', category: 'Test',
    parameters: [range('L', 100, 1000, 500), range('H', 1000, 3000, 2000)],
    bodies: [],
    children: [{ key: 'kind', part: refOf(child), values: { B: 'L' }, at: [0, 'H', 0], repeat: { count: 2, step: [0, 0, 100] } }],
    traits: { stock: 'none' },
  };
  const context = createPartContext({ materials: FIXTURE_MATERIALS, parts: [child, parent] });
  // The child alone is fine above B = 100,5; its own range end is what makes it fail.
  assert.equal(validateDefinition(child, context).ok, false);
  const result = validateDefinition(parent, context);
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map(item => [item.code, item.path, item.body, item.parameter]), [['body-too-small', 'kind[0]', 'leiste', 'L']]);
  assert.equal(result.issues[0]!.message,
    'Unterbauteil „kind[0]“ → Körper „leiste“: Breite 0,5 mm unterschreitet das Mindestmaß von 1 mm. Tritt auf bei L = 100, H = 2000.');
});

test('sheet cut-outs that break at an end of a range are rejected', () => {
  const definition = panel({
    bodies: [{
      kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0],
      outline: { shape: 'rect', x: '-B / 2', y: 0, width: 'B', height: 'H' },
      holes: [{ shape: 'rect', key: 'tuer', x: -400, y: 0, width: 800, height: 2000 }],
    }],
  });
  // At B = 500 the door is wider than the sheet and cuts it in two.
  const result = validateDefinition(definition, FIXTURE_CONTEXT);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(item => item.code === 'hole-splits-sheet' && item.body === 'platte' && item.hole === 'tuer' && item.parameter === 'B'));
  for (const found of errors(result.issues)) assert.match(found.message, /Ausschnitt „tuer“ in Körper „platte“/);
});

test('warnings do not reject', () => {
  const result = validateDefinition(panel({
    bodies: [{
      kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0],
      outline: { shape: 'rect', x: '-B / 2', y: 0, width: 'B', height: 'H' },
      holes: [{ shape: 'rect', key: 'griff', x: 800, y: 500, width: 100, height: 100 }],
    }],
  }), FIXTURE_CONTEXT);
  assert.equal(result.ok, true);
  assert.deepEqual(codes(result.issues), ['warning:hole-outside']);
  assert.equal(result.issues[0]!.parameter, 'B');
});

test('structure errors are reported in German with the field path', () => {
  const result = validateDefinition({ ...panel(), farbe: 'rot', revision: 0 }, FIXTURE_CONTEXT);
  assert.equal(result.ok, false);
  assert.equal(result.definition, undefined);
  assert.equal(result.evaluated, 0);
  assert.deepEqual(result.issues.map(item => [item.code, item.field]), [['schema', 'revision'], ['schema', undefined]]);
  assert.match(result.issues[0]!.message, /^revision: Zu klein/);
  assert.match(result.issues[1]!.message, /Unbekannter Schlüssel: "farbe"/);
  assert.equal(validateDefinition(null, FIXTURE_CONTEXT).ok, false);
  assert.equal(validateDefinition('Tisch', FIXTURE_CONTEXT).ok, false);
  const reserved = validateDefinition(strip('100', { parameters: [range('max', 0, 10, 5)] }), FIXTURE_CONTEXT);
  assert.deepEqual(reserved.issues.map(item => item.message), ['parameters.0.key: Der Name ist für Formeln reserviert']);
});

test('keys, formulas and trait references are checked before anything is evaluated', () => {
  const base = strip('B');
  const result = validateDefinition({
    ...base,
    parameters: [...base.parameters, base.parameters[0]!],
    derived: [{ key: 'a', formula: 'b' }, { key: 'b', formula: 'H +' }],
    connectors: [{ key: 'k', kind: 'floor', at: [0, 'unten', 0], axis: [0, -1, 0] }],
    traits: { stock: 'none', surface: { body: 'deck' }, faces: [{ key: 'f', label: 'F', body: 'leiste', side: 'edge' }] },
  }, FIXTURE_CONTEXT);
  assert.equal(result.ok, false);
  assert.equal(result.evaluated, 0);
  assert.deepEqual(result.issues.map(item => item.code).sort(),
    ['duplicate-key', 'formula', 'forward-reference', 'trait-reference', 'trait-reference', 'unknown-name']);
  const byCode = Object.fromEntries(result.issues.map(item => [item.code, item]));
  assert.equal(byCode['duplicate-key']!.parameter, 'B');
  assert.equal(byCode['forward-reference']!.derived, 'a');
  assert.equal(byCode.formula!.derived, 'b');
  assert.deepEqual(byCode.formula!.formula, { code: 'syntax', position: 3, source: 'H +' });
  assert.equal(byCode['unknown-name']!.connector, 'k');
  assert.match(byCode['unknown-name']!.message, /^Verbinder „k“: Die Formel „unten“ verwendet den unbekannten Namen „unten“\.$/);
  assert.ok(!('location' in byCode.formula!));
});

test('materials must exist and be of the kind the body needs', () => {
  const missing = validateDefinition(strip('B', {
    bodies: [{ kind: 'box', key: 'leiste', material: 'gold', size: ['B', 10, 10], at: [0, 5, 0] }],
    hardware: [{ material: 'schraube', quantity: 4 }, { material: 'latte-40x40', quantity: 1 }],
  }), FIXTURE_CONTEXT);
  assert.equal(missing.ok, false);
  assert.equal(missing.evaluated, 0);
  assert.deepEqual(missing.issues.map(item => [item.code, item.body, item.hardware, item.material]), [
    ['unknown-material', 'leiste', undefined, 'gold'],
    ['unknown-material', undefined, 'schraube', 'schraube'],
    ['material-kind', undefined, 'latte-40x40', 'latte-40x40'],
  ]);
  assert.equal(missing.issues[0]!.message, 'Körper „leiste“: Das Material „gold“ ist nicht vorhanden.');
  assert.match(missing.issues[2]!.message, /ist Profil, gebraucht wird Zubehör/);
  const kind = validateDefinition(strip('B', {
    bodies: [{ kind: 'box', key: 'leiste', material: 'sperrholz-12', size: ['B', 10, 10], at: [0, 5, 0] }],
  }), FIXTURE_CONTEXT);
  assert.deepEqual(codes(kind.issues), ['error:material-kind']);
});

test('child references must resolve, fit the child and stay acyclic', () => {
  const holder = (child: Record<string, unknown>, serial = 70): PartDefinition => ({
    id: fixtureId(serial), revision: 1, name: `Halter ${serial}`, category: 'Test', parameters: [], bodies: [],
    children: [{ key: 'kind', part: refOf(STARTER_BRACE), at: [0, 0, 0], ...child }],
    traits: { stock: 'none' },
  });
  assert.equal(validateDefinition(holder({}), FIXTURE_CONTEXT).ok, true);
  assert.equal(validateDefinition(holder({ variant: 'hoch', values: { ballast: 2 } }), FIXTURE_CONTEXT).ok, true);

  const unknown = validateDefinition(holder({ part: { id: fixtureId(999), revision: 1 } }), FIXTURE_CONTEXT);
  assert.deepEqual(unknown.issues.map(item => [item.code, item.child]), [['unknown-part', 'kind']]);
  assert.deepEqual(codes(validateDefinition(holder({ part: { ...refOf(STARTER_BRACE), revision: 7 } }), FIXTURE_CONTEXT).issues), ['error:unknown-part']);

  const variant = validateDefinition(holder({ variant: 'riesig' }), FIXTURE_CONTEXT);
  assert.deepEqual(variant.issues.map(item => [item.code, item.child, item.variant]), [['unknown-variant', 'kind', 'riesig']]);
  assert.match(variant.issues[0]!.message, /„Stützdreieck“ hat keine Variante „riesig“/);

  const parameter = validateDefinition(holder({ values: { breite: 40 } }), FIXTURE_CONTEXT);
  assert.deepEqual(parameter.issues.map(item => [item.code, item.child, item.parameter, item.field]), [['unknown-parameter', 'kind', 'breite', 'values.breite']]);

  // Variant-scope values that stand for no variant of the child are found by evaluation.
  const unmatched = validateDefinition(holder({ values: { T: 510 } }), FIXTURE_CONTEXT);
  assert.equal(unmatched.ok, false);
  assert.deepEqual(unmatched.issues.map(item => [item.code, item.path]), [['variant-unmatched', 'kind']]);

  const self = holder({ part: { id: fixtureId(71), revision: 1 } }, 71);
  assert.deepEqual(codes(validateDefinition(self, createPartContext({ materials: FIXTURE_MATERIALS, parts: [self] })).issues), ['error:child-cycle']);

  const a = holder({ part: { id: fixtureId(73), revision: 1 } }, 72);
  const b = holder({ part: { id: fixtureId(74), revision: 1 } }, 73);
  const c = holder({ part: { id: fixtureId(72), revision: 1 } }, 74);
  const loop = validateDefinition(a, createPartContext({ materials: FIXTURE_MATERIALS, parts: [a, b, c] }));
  assert.deepEqual(loop.issues.map(item => [item.code, item.child]), [['child-cycle', 'kind']]);
  assert.equal(loop.evaluated, 0);

  // A child whose own child is missing is reported at the child of this part.
  const broken = validateDefinition(a, createPartContext({ materials: FIXTURE_MATERIALS, parts: [a, b] }));
  assert.deepEqual(codes(broken.issues), ['error:unknown-part']);
  assert.match(broken.issues[0]!.message, /„Halter 73“ verweist auf ein Unterbauteil, das nicht vorhanden ist/);

  const chain = Array.from({ length: PART_LIMITS.depth + 2 }, (_, index) => index + 1 < PART_LIMITS.depth + 2
    ? holder({ part: { id: fixtureId(81 + index), revision: 1 } }, 80 + index)
    : { ...holder({}, 80 + index), children: [], bodies: [{ kind: 'box' as const, key: 'klotz', material: 'kiste', size: [10, 10, 10] as [number, number, number], at: [0, 5, 0] as [number, number, number] }] });
  const context = createPartContext({ materials: FIXTURE_MATERIALS, parts: chain });
  assert.deepEqual(codes(validateDefinition(chain[0]!, context).issues), ['error:child-depth']);
  assert.equal(validateDefinition(chain[1]!, context).ok, true);
});

test('many parameters are sampled deterministically, corners included', () => {
  const keys = Array.from({ length: 10 }, (_, index) => `p${index}`);
  const definition = strip(`${keys.join(' + ')} - 999.5`, { parameters: keys.map(key => range(key, 10, 100, 50)) });
  // Only all ten at their maximum leave 0,5 mm; 1024 corners exceed the budget of 256.
  const result = validateDefinition(definition, FIXTURE_CONTEXT);
  assert.equal(result.sampled, true);
  assert.equal(result.ok, false);
  assert.equal(result.issues.find(item => item.code === 'body-too-small')?.body, 'leiste');
  assert.ok(result.evaluated <= 1 + 20 + 256, `evaluated ${result.evaluated}`);
  assert.ok(result.evaluated > 200);
  assert.deepEqual(validateDefinition(definition, FIXTURE_CONTEXT), result);

  // With room for every corner nothing is sampled.
  const wide = validateDefinition(definition, FIXTURE_CONTEXT, { maxCombinationsPerVariant: 2048 });
  assert.equal(wide.sampled, false);
  assert.equal(wide.evaluated, 1 + 20 + 1024);
  assert.equal(wide.ok, false);

  // Long value lists are cut to their ends for the combinations, yet each value is tried alone.
  const lists = Array.from({ length: 3 }, (_, index): PartParameter => ({
    key: `q${index}`, label: 'Q', type: 'length', default: 100, scope: 'placement', values: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
  }));
  const listed = validateDefinition(strip('abs(q1 - 500) + 0.5', { parameters: lists }), FIXTURE_CONTEXT);
  assert.equal(listed.sampled, true);
  assert.equal(listed.ok, false);
  assert.match(listed.issues[0]!.message, /Tritt auf bei q1 = 500\.$/);
  // 27 single values; of the 8 corners, all-smallest is the default and three are single values.
  assert.equal(listed.evaluated, 1 + 27 + 4);
});

test('a library is checked part by part against its own materials and parts', () => {
  const result = validateLibrary(STARTER_LIBRARY);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.library, STARTER_LIBRARY);

  const withoutLeg = validateLibrary({ ...STARTER_LIBRARY, parts: STARTER_PARTS.filter(part => part.name !== 'Steckfuß') });
  assert.equal(withoutLeg.ok, false);
  assert.deepEqual(withoutLeg.issues.map(item => [item.code, item.partName, item.child]), [['unknown-part', 'Bühnenelement', 'fuss']]);
  assert.match(withoutLeg.issues[0]!.message, /^Bauteil „Bühnenelement“: Unterbauteil „fuss“: /);
  // What the file leaves out may come from the catalog it is imported into.
  assert.equal(validateLibrary({ ...STARTER_LIBRARY, parts: STARTER_PARTS.filter(part => part.name !== 'Steckfuß') }, STARTER_CONTEXT).ok, true);

  const withoutLatte = validateLibrary({ ...STARTER_LIBRARY, materials: STARTER_MATERIALS.filter(material => material.key !== 'latte-40x40') });
  assert.deepEqual([...new Set(withoutLatte.issues.map(item => item.partName))], ['Stützdreieck', 'Tisch']);
  assert.ok(withoutLatte.issues.every(item => item.code === 'unknown-material' && item.material === 'latte-40x40'));

  const malformed = validateLibrary({ schemaVersion: 1, materials: [], parts: [{ ...STARTER_PARTS[0], extra: 1 }] });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.library, undefined);
  assert.deepEqual(malformed.issues.map(item => [item.code, item.field]), [['schema', 'parts.0']]);
  assert.equal(validateLibrary(FIXTURE_PARTS).ok, false);
});
