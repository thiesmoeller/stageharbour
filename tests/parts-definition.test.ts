import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PART_SCHEMA_VERSION, connectorsMate, createPartContext, definitionConsistencyIssues, matchVariant,
  materialSchema, normalizeParameterValue, partDefinitionSchema, partLibrarySchema, variantValues,
  type PartDefinition, type PartParameter,
} from '../src/shared/parts/definition.js';
import { definitionDependencies, definitionFormulaSites } from '../src/shared/parts/sites.js';
import {
  STARTER_BRACE, STARTER_DECK, STARTER_LIBRARY, STARTER_MATERIALS, STARTER_PARTS, STARTER_WALL,
} from '../src/shared/parts/starter/index.js';
import { CHAIR, DECK_ROW, DOOR_LEAF, DOOR_WALL, STAIR, WIDE_BRACE, panel } from './helpers/partsFixtures.js';

const clone = <T>(value: T): T => structuredClone(value);

function messages(definition: unknown): string[] {
  const result = partDefinitionSchema.safeParse(definition);
  return result.success ? [] : result.error.issues.map(item => `${item.path.join('.')}: ${item.message}`);
}

function assertRejected(definition: unknown, path: string, pattern?: RegExp) {
  const found = messages(definition);
  const hit = found.find(message => message.startsWith(`${path}:`));
  assert.ok(hit, `expected an issue at ${path}, got ${JSON.stringify(found)}`);
  if (pattern) assert.match(hit, pattern);
}

test('the starter library and the test fixtures are valid', () => {
  const parsed = partLibrarySchema.safeParse(STARTER_LIBRARY);
  assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
  assert.equal(STARTER_LIBRARY.schemaVersion, PART_SCHEMA_VERSION);
  assert.deepEqual(STARTER_LIBRARY.parts.map(part => part.name), [
    'Stützdreieck', 'Steckfuß', 'Bühnenelement', 'Wandelement', 'Tisch', 'Tür',
    'Stuhl', 'Person', 'Lautsprecher', 'Kiste', 'Treppe', 'Schwebendes Podest', 'Massives Podest',
  ]);
  for (const key of ['latte-40x40', 'sperrholz-12', 'steckfuss-rohr-50', 'gummifuss-50', 'betonplatte-400', 'spanngurt-25']) {
    assert.ok(STARTER_MATERIALS.some(material => material.key === key), key);
  }
  for (const fixture of [WIDE_BRACE, DOOR_LEAF, DOOR_WALL, STAIR, DECK_ROW, CHAIR, panel()]) {
    assert.deepEqual(messages(fixture), [], fixture.name);
  }
  // Parsing gives the same data back: the schema has no defaults and no transforms on valid input.
  assert.deepEqual(partLibrarySchema.parse(STARTER_LIBRARY), STARTER_LIBRARY);
});

test('unknown keys are rejected at every level', () => {
  assertRejected({ ...panel(), colour: 'red' }, '');
  const parameter = clone(panel());
  (parameter.parameters[0] as Record<string, unknown>).unit = 'mm';
  assertRejected(parameter, 'parameters.0');
  const body = clone(panel());
  (body.bodies[0] as Record<string, unknown>).depth = 12;
  assertRejected(body, 'bodies.0');
  const outline = clone(panel());
  ((body => body.kind === 'sheet' && ((body.outline as Record<string, unknown>).radius = 3))(outline.bodies[0]!));
  assertRejected(outline, 'bodies.0.outline');
  assertRejected({ ...panel(), traits: { stock: 'none', walkable: true } }, 'traits');
  assert.equal(partLibrarySchema.safeParse({ ...STARTER_LIBRARY, author: 'x' }).success, false);
  assert.equal(partLibrarySchema.safeParse({ ...STARTER_LIBRARY, schemaVersion: 2 }).success, false);
  assert.equal(materialSchema.safeParse({ ...STARTER_MATERIALS[0], density: 1 }).success, false);
});

test('duplicate keys are rejected', () => {
  const base = panel();
  assertRejected({ ...base, parameters: [...base.parameters, base.parameters[0]] }, 'parameters.2.key', /doppelt/);
  assertRejected({ ...base, bodies: [...base.bodies, base.bodies[0]] }, 'bodies.1.key', /doppelt/);
  assertRejected({ ...base, derived: [{ key: 'a', formula: 1 }, { key: 'a', formula: 2 }] }, 'derived.1.key', /doppelt/);
  assertRejected({ ...base, derived: [{ key: 'B', formula: 1 }] }, 'derived.0.key', /Parameter/);
  assertRejected({
    ...base, variants: [{ key: 'a', label: 'A', values: {} }, { key: 'a', label: 'B', values: {} }],
  }, 'variants.1.key', /doppelt/);
  const connector = { key: 'k', kind: 'floor', at: [0, 0, 0], axis: [0, -1, 0] };
  assertRejected({ ...base, connectors: [connector, connector] }, 'connectors.1.key', /doppelt/);
  const face = { key: 'f', label: 'F', body: 'platte', side: 'front' };
  assertRejected({ ...base, traits: { stock: 'none', faces: [face, face] } }, 'traits.faces.1.key', /doppelt/);

  // A child and a body share one namespace because both become path segments of solid ids.
  const shared = clone(DECK_ROW);
  shared.bodies = [{ kind: 'box', key: 'modul', material: 'kiste', size: [10, 10, 10], at: [0, 5, 0] }];
  assertRejected(shared, 'children.0.key', /doppelt/);

  const holes = clone(STARTER_WALL);
  const sheet = holes.bodies[0]!;
  assert.equal(sheet.kind, 'sheet');
  if (sheet.kind === 'sheet') sheet.holes = [sheet.holes![0]!, sheet.holes![0]!];
  assertRejected(holes, 'bodies.0.holes.1.key', /doppelt/);

  const library = { ...STARTER_LIBRARY, materials: [...STARTER_MATERIALS, STARTER_MATERIALS[0]] };
  assert.equal(partLibrarySchema.safeParse(library).success, false);
  assert.equal(partLibrarySchema.safeParse({ ...STARTER_LIBRARY, parts: [...STARTER_PARTS, STARTER_BRACE] }).success, false);
  // The same part in a second revision is a different entry.
  assert.equal(partLibrarySchema.safeParse({ ...STARTER_LIBRARY, parts: [...STARTER_PARTS, { ...STARTER_BRACE, revision: 2 }] }).success, true);
});

test('derived values may only use what is computed before them', () => {
  const base = panel();
  assertRejected({ ...base, derived: [{ key: 'a', formula: 'b + 1' }, { key: 'b', formula: 'B / 2' }] }, 'derived.0.formula', /erst danach/);
  assertRejected({ ...base, derived: [{ key: 'a', formula: 'a + 1' }] }, 'derived.0.formula', /sich selbst/);
  assertRejected({
    ...base, derived: [{ key: 'a', formula: 'c' }, { key: 'b', formula: 'a' }, { key: 'c', formula: 'b' }],
  }, 'derived.0.formula', /erst danach/);
  assert.deepEqual(messages({ ...base, derived: [{ key: 'a', formula: 'B / 2' }, { key: 'b', formula: 'a + H' }] }), []);
});

test('formulas must parse and use known names only', () => {
  const base = panel();
  const withOutline = (width: string | number): PartDefinition => ({
    ...base,
    bodies: [{ kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0], outline: { shape: 'rect', x: 0, y: 0, width, height: 'H' } }],
  });
  assertRejected(withOutline('B +'), 'bodies.0.outline.width', /Zeichen 4/);
  assertRejected(withOutline('breite'), 'bodies.0.outline.width', /unbekannten Namen „breite“/);
  assertRejected(withOutline('i * 2'), 'bodies.0.outline.width', /unbekannten Namen „i“/);
  assertRejected(withOutline('pow(B, 2)'), 'bodies.0.outline.width');
  assertRejected({ ...base, hardware: [{ material: 'kiste', quantity: 'menge' }] }, 'hardware.0.quantity', /„menge“/);
  assertRejected({ ...base, connectors: [{ key: 'k', kind: 'floor', at: [0, 'unten', 0], axis: [0, -1, 0] }] }, 'connectors.0.at.1', /„unten“/);

  // The repeat index is a name inside the repeated body, and nowhere else.
  const repeated = withOutline('B');
  repeated.bodies[0]!.repeat = { count: 3, step: [0, 0, 100] };
  if (repeated.bodies[0]!.kind === 'sheet') repeated.bodies[0]!.at = [0, 'i * 10', 0];
  assert.deepEqual(messages(repeated), []);
  assertRejected({ ...repeated, derived: [{ key: 'x', formula: 'i' }] }, 'derived.0.formula', /„i“/);
  // The count of a level cannot depend on its own index.
  repeated.bodies[0]!.repeat = { count: 'i + 1', step: [0, 0, 100] };
  assertRejected(repeated, 'bodies.0.repeat.count', /„i“/);
});

test('names that would shadow formula functions or object internals are refused', () => {
  const named = (key: string) => ({
    ...panel(),
    parameters: [{ key, label: 'X', type: 'length', default: 1, scope: 'placement', range: { min: 0, max: 2 } }],
    bodies: [{ kind: 'box', key: 'klotz', material: 'kiste', size: [10, 10, 10], at: [0, 5, 0] }],
  });
  assert.deepEqual(messages(named('ok_1')), []);
  for (const key of ['min', 'if', 'sqrt', 'constructor', 'toString', '__proto__', '1a', 'a-b', 'größe']) {
    assertRejected(named(key), 'parameters.0.key');
  }
  const clash = clone(STAIR);
  clash.parameters.push({ key: 'stufe_nr', label: 'Nr', type: 'count', default: 0, scope: 'placement', range: { min: 0, max: 3 } });
  assertRejected(clash, 'bodies.0.repeat', /Zähler „stufe_nr“/);
});

test('parameter domains and variant values are checked', () => {
  const base = panel();
  const withParameter = (parameter: Record<string, unknown>) => ({
    ...base, parameters: [...base.parameters, { key: 'p', label: 'P', type: 'length', default: 10, scope: 'placement', ...parameter }],
  });
  assertRejected(withParameter({}), 'parameters.2', /Bereich oder eine Werteliste/);
  assertRejected(withParameter({ range: { min: 0, max: 20 }, values: [10] }), 'parameters.2', /Bereich oder eine Werteliste/);
  assertRejected(withParameter({ range: { min: 30, max: 20 } }), 'parameters.2', /kleinste Wert/);
  assertRejected(withParameter({ range: { min: 20, max: 30 } }), 'parameters.2', /Standardwert/);
  assertRejected(withParameter({ values: [5, 20] }), 'parameters.2', /Standardwert/);
  assertRejected(withParameter({ values: [10, 10] }), 'parameters.2', /doppelte/);
  assertRejected(withParameter({ type: 'count', default: 1.5, range: { min: 0, max: 3 } }), 'parameters.2', /ganze Zahlen/);
  assertRejected(withParameter({ type: 'toggle', default: 1, range: { min: 0, max: 1 } }), 'parameters.2', /weder Bereich/);
  assertRejected(withParameter({ type: 'toggle', default: 2 }), 'parameters.2', /0 oder 1/);
  assert.deepEqual(messages(withParameter({ type: 'toggle', default: 1 })), []);

  const variant = (values: Record<string, number>) => ({ ...clone(STARTER_BRACE), variants: [{ key: 'v', label: 'V', values }] });
  assertRejected(variant({ X: 1 }), 'variants.0.values.X', /nicht definiert/);
  assertRejected(variant({ ballast: 1 }), 'variants.0.values.ballast', /nicht von der Variante/);
  assertRejected(variant({ T: 5000 }), 'variants.0.values.T', /nicht im Bereich/);
  assert.deepEqual(messages(variant({ T: 600 })), []);
});

test('traits must point at bodies and sides that exist', () => {
  const base = panel();
  assertRejected({ ...base, traits: { stock: 'none', surface: { body: 'deck' } } }, 'traits.surface.body', /nicht gibt/);
  assertRejected({ ...base, traits: { stock: 'none', faces: [{ key: 'f', label: 'F', body: 'deck', side: 'front' }] } }, 'traits.faces.0.body');
  assertRejected({ ...base, traits: { stock: 'none', faces: [{ key: 'f', label: 'F', body: 'platte', side: 'top' }] } }, 'traits.faces.0.side', /front, back, edge, all/);
  const beamSurface = clone(STARTER_BRACE);
  beamSurface.traits = { stock: 'count', surface: { body: 'stiel' } };
  assertRejected(beamSurface, 'traits.surface.body', /Profil/);
  assertRejected({ ...base, bodies: [] }, 'bodies', /mindestens einen Körper/);
});

test('consistency issues carry structured subjects', () => {
  const broken: PartDefinition = { ...panel(), derived: [{ key: 'a', formula: 'b' }, { key: 'b', formula: 1 }] };
  const [first] = definitionConsistencyIssues(broken);
  assert.ok(first);
  assert.equal(first.code, 'forward-reference');
  assert.equal(first.derived, 'a');
  assert.deepEqual(first.location, ['derived', 0, 'formula']);
  assert.match(first.message, /^Hilfswert „a“: /);
  assert.deepEqual(definitionConsistencyIssues(STARTER_DECK), []);
});

test('parameter values are normalised to their domain', () => {
  const length: PartParameter = { key: 'L', label: 'L', type: 'length', default: 500, scope: 'placement', range: { min: 200, max: 1500, step: 50 } };
  assert.equal(normalizeParameterValue(length, 100), 200);
  assert.equal(normalizeParameterValue(length, 9999), 1500);
  assert.equal(normalizeParameterValue(length, 524), 500);
  assert.equal(normalizeParameterValue(length, 526), 550);
  assert.equal(normalizeParameterValue(length, Number.NaN), 500);
  // A step that does not land on the maximum never leads past it.
  assert.equal(normalizeParameterValue({ ...length, range: { min: 0, max: 100, step: 30 } }, 100), 90);
  const listed: PartParameter = { key: 'H', label: 'H', type: 'length', default: 600, scope: 'placement', values: [200, 400, 600] };
  assert.equal(normalizeParameterValue(listed, 290), 200);
  assert.equal(normalizeParameterValue(listed, 310), 400);
  assert.equal(normalizeParameterValue(listed, 5000), 600);
  const count: PartParameter = { key: 'n', label: 'n', type: 'count', default: 2, scope: 'placement', range: { min: 1, max: 6 } };
  assert.equal(normalizeParameterValue(count, 3.4), 3);
  assert.equal(normalizeParameterValue(count, 0), 1);
  const toggle: PartParameter = { key: 't', label: 't', type: 'toggle', default: 0, scope: 'state' };
  assert.equal(normalizeParameterValue(toggle, 5), 1);
  assert.equal(normalizeParameterValue(toggle, 0), 0);
});

test('variants stand for values of the variant-scope parameters', () => {
  assert.deepEqual(variantValues(STARTER_DECK, STARTER_DECK.variants![1]), { B: 2000, T: 500 });
  assert.deepEqual(variantValues(STARTER_DECK, undefined), { B: 2000, T: 1000 });
  assert.equal(matchVariant(STARTER_DECK, { B: 1000, T: 500, H: 800 })?.key, '1x05');
  assert.equal(matchVariant(STARTER_BRACE, { T: 510, H: 1200 }), undefined);
});

test('connectors mate with their own kind or one listed partner', () => {
  assert.equal(connectorsMate({ kind: 'hinge-edge' }, { kind: 'hinge-edge' }), true);
  assert.equal(connectorsMate({ kind: 'hinge-edge' }, { kind: 'deck-edge' }), false);
  assert.equal(connectorsMate({ kind: 'leg-socket' }, { kind: 'floor' }), false);
  assert.equal(connectorsMate({ kind: 'zapfen', partner: 'loch' }, { kind: 'loch' }), true);
  assert.equal(connectorsMate({ kind: 'loch' }, { kind: 'zapfen', partner: 'loch' }), true);
  assert.equal(connectorsMate({ kind: 'zapfen', partner: 'loch' }, { kind: 'nut' }), false);
});

test('formula sites and dependencies cover every element', () => {
  const sites = definitionFormulaSites(STARTER_DECK);
  assert.ok(sites.some(site => site.location.join('.') === 'children.0.values.H'));
  assert.ok(sites.some(site => site.location.join('.') === 'bodies.1.repeat.step.2'));
  const dependencies = definitionDependencies(STARTER_DECK);
  assert.deepEqual([...(dependencies.get('body:platte') ?? [])].sort(), ['B', 'BO', 'H', 'HO', 'T', 'TO']);
  assert.deepEqual([...(dependencies.get('child:fuss') ?? [])].sort(), ['B', 'BO', 'H', 'HO', 'T', 'TO']);
  assert.deepEqual(dependencies.get('derived:fussX'), ['BO', 'B']);
  assert.deepEqual(dependencies.get('connector:kante-vorn')?.slice().sort(), ['B', 'BO', 'H', 'HO', 'T', 'TO']);
  assert.deepEqual(definitionDependencies(STARTER_BRACE).get('hardware:betonplatte-400'), ['ballast']);
});

test('a context looks materials up by key and parts by id and revision', () => {
  const context = createPartContext(STARTER_LIBRARY);
  assert.equal(context.material('latte-40x40')?.kind, 'profile');
  assert.equal(context.material('unbekannt'), undefined);
  assert.equal(context.part({ id: STARTER_DECK.id, revision: 1 })?.name, 'Bühnenelement');
  assert.equal(context.part({ id: STARTER_DECK.id, revision: 2 }), undefined);
});
