import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { STARTER_BRACE, STARTER_CONTEXT, STARTER_DECK, STARTER_MATERIALS, STARTER_TABLE, STARTER_WALL } from '../src/shared/parts/starter/index.js';
import { resolvePart, resolvePartConfiguration } from '../src/shared/parts/resolve.js';
import { validateDefinition } from '../src/shared/parts/validate.js';
import { formulaFromText, previewFormula, previewScope } from '../src/client/designer/formulaPreview.js';
import { PART_VIEWS, buildPartView, projectPoint, solidSelection, viewDepth } from '../src/client/designer/views.js';
import {
  issuesForSelection, moveItem, newBody, newPartDefinition, newVariant, removeBody, removeParameter, selectionOfIssue,
  uniqueKey, updateParameter, withParameterDomain, withParameterType,
} from '../src/client/designer/draft.js';
import { SharedGeometryCache, resolvedGeometryKey } from '../src/client/designer/geometryCache.js';

test('formula fields show the evaluated number in the current variant and defaults', () => {
  const brace = resolvePart(STARTER_BRACE, { variant: 'hoch' }, STARTER_CONTEXT);
  const scope = previewScope(brace);
  assert.deepEqual(previewFormula('H - s / 2', scope), { kind: 'value', value: 2380, text: '2380' });
  assert.deepEqual(previewFormula('wandZ', scope), { kind: 'value', value: -380, text: '-380' });
  assert.deepEqual(previewFormula(12.5, scope), { kind: 'value', value: 12.5, text: '12,5' });
  assert.deepEqual(previewFormula('', scope), { kind: 'empty' });
  assert.deepEqual(previewFormula(undefined, scope), { kind: 'empty' });
});

test('formula fields show the German formula error inline', () => {
  const scope = previewScope(resolvePart(STARTER_TABLE, {}, STARTER_CONTEXT));
  const unknown = previewFormula('B + breite', scope);
  assert.equal(unknown.kind, 'error');
  assert.match(unknown.kind === 'error' ? unknown.message : '', /Unbekannter Name „breite“ \(Zeichen 5\)/);
  const syntax = previewFormula('B +', scope);
  assert.match(syntax.kind === 'error' ? syntax.message : '', /Zahl, Name oder Klammer erwartet/);
  const zero = previewFormula('B / (T - T)', scope);
  assert.match(zero.kind === 'error' ? zero.message : '', /Division durch null/);
  assert.match((previewFormula('B = 2', scope) as { message: string }).message, /„==“/);
});

test('repeat indices count as their first instance in the preview', () => {
  const scope = previewScope(resolvePart(STARTER_TABLE, {}, STARTER_CONTEXT), ['i', 'j']);
  assert.deepEqual(previewFormula('i * 100 + j', scope), { kind: 'value', value: 0, text: '0' });
  assert.equal(previewFormula('k', scope).kind, 'error');
  assert.deepEqual(previewFormula('B', undefined), { kind: 'empty' });
  assert.equal(previewFormula('B +', undefined).kind, 'error');
});

test('field text keeps plain numbers as numbers and everything else as formula text', () => {
  assert.equal(formulaFromText('1200'), 1200);
  assert.equal(formulaFromText(' -12.5 '), -12.5);
  assert.equal(formulaFromText('.5'), 0.5);
  assert.equal(formulaFromText('B / 2'), 'B / 2');
  assert.equal(formulaFromText('12,5'), '12,5');
  assert.equal(formulaFromText(''), '');
  assert.equal(formulaFromText('9999999'), '9999999');
});

test('orthographic projection follows the part frame', () => {
  const point = { x: 100, y: 200, z: 300 };
  assert.deepEqual(projectPoint('top', point), { x: 100, y: -300 });
  assert.deepEqual(projectPoint('front', point), { x: 100, y: -200 });
  assert.deepEqual(projectPoint('side', point), { x: 300, y: -200 });
  assert.equal(viewDepth('top', point), 200);
  assert.equal(viewDepth('front', point), -300);
  assert.equal(viewDepth('side', point), 100);
  assert.deepEqual(PART_VIEWS.map(view => view.label), ['Draufsicht', 'Vorderansicht', 'Seitenansicht']);
});

test('views of the Stützdreieck show its footprint, elevation and side', () => {
  const brace = resolvePart(STARTER_BRACE, { variant: 'standard' }, STARTER_CONTEXT);
  const top = buildPartView('top', brace);
  assert.equal(top.shapes.length, 3);
  assert.deepEqual(top.size, { width: 40, height: 500 });
  const front = buildPartView('front', brace);
  assert.deepEqual(front.size, { width: 40, height: 1200 });
  const side = buildPartView('side', brace);
  assert.equal(Math.round(side.size.width), 500);
  assert.equal(Math.round(side.size.height), 1200);
  assert.ok(side.viewBox.width > 500 && side.viewBox.x < -250);
  const mount = side.connectors.find(connector => connector.id === 'wand')!;
  assert.deepEqual(mount.at, { x: -250, y: -0 });
  assert.deepEqual(mount.direction, { x: -1, y: 0 });
  assert.deepEqual(mount.select, { kind: 'connector', key: 'wand' });
  assert.equal(top.connectors.find(connector => connector.id === 'wand')!.direction?.y, 1);
});

test('a sheet facing the viewer is drawn with its cut-outs; edge connectors become lines', () => {
  const wall = resolvePart(STARTER_WALL, { variant: 'tuer' }, STARTER_CONTEXT);
  const front = buildPartView('front', wall);
  const sheet = front.shapes.find(shape => shape.solid === 'platte')!;
  assert.equal((sheet.d.match(/M/g) ?? []).length, 1);
  assert.equal((sheet.d.match(/[ML]/g) ?? []).length, 8);
  assert.deepEqual(front.size, { width: 1200, height: 2400 });
  const hinge = front.connectors.find(connector => connector.id === 'links')!;
  assert.deepEqual(hinge.at, { x: -600, y: -0 });
  assert.deepEqual(hinge.end, { x: -600, y: -2400 });
  const top = buildPartView('top', wall);
  assert.deepEqual(top.size, { width: 1200, height: 28 });
});

test('solids of child parts select the child; views paint back to front', () => {
  const deck = resolvePart(STARTER_DECK, { variant: '2x1', values: { H: 800 } }, STARTER_CONTEXT);
  const leg = deck.solids.find(solid => solid.id === 'fuss[1,0]/rohr')!;
  assert.deepEqual(solidSelection(leg), { kind: 'child', key: 'fuss' });
  assert.deepEqual(solidSelection(deck.solids.find(solid => solid.id === 'platte')!), { kind: 'body', key: 'platte' });
  const top = buildPartView('top', deck);
  assert.equal(top.shapes.at(-1)!.solid, 'platte');
  const depths = top.shapes.map(shape => shape.depth);
  assert.deepEqual(depths, [...depths].sort((a, b) => a - b));
  assert.equal(top.connectors.filter(connector => !connector.select).length, 8);
  const empty = buildPartView('front', { solids: [], connectors: [] });
  assert.deepEqual(empty.size, { width: 0, height: 0 });
  assert.ok(empty.viewBox.width > 0);
});

test('a new part is a valid definition and new bodies get free keys', () => {
  const definition = newPartDefinition(randomUUID(), STARTER_MATERIALS);
  const checked = validateDefinition(definition, STARTER_CONTEXT);
  assert.equal(checked.ok, true, checked.issues.map(item => item.message).join('\n'));
  const resolved = resolvePartConfiguration(definition, {}, STARTER_CONTEXT);
  assert.equal(resolved.solids.length, 5);
  assert.equal(resolved.cutList.beams[0]!.count, 4);
  const body = newBody('sheet', definition, STARTER_MATERIALS);
  assert.equal(body.key, 'platte-2');
  assert.equal(body.material, 'sperrholz-12');
  assert.equal(newBody('box', definition, STARTER_MATERIALS).material, 'gummifuss-50');
  assert.equal(uniqueKey('bein', ['bein', 'bein-2']), 'bein-3');
});

test('list helpers move, and parameter edits keep variants consistent', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c']);
  const renamed = updateParameter(STARTER_BRACE, 0, { ...STARTER_BRACE.parameters[0]!, key: 'tiefe' });
  assert.deepEqual(renamed.variants![0]!.values, { H: 1200, tiefe: 500 });
  const placement = updateParameter(STARTER_BRACE, 1, { ...STARTER_BRACE.parameters[1]!, scope: 'placement' });
  assert.deepEqual(placement.variants![1]!.values, { T: 400 });
  const toVariant = updateParameter(STARTER_BRACE, 2, { ...STARTER_BRACE.parameters[2]!, scope: 'variant' });
  assert.equal(toVariant.variants![0]!.values.ballast, 0);
  assert.deepEqual(removeParameter(STARTER_BRACE, 0).variants![2]!.values, { H: 2400 });
  assert.deepEqual(newVariant(STARTER_BRACE).values, { T: 500, H: 1200 });
  assert.equal(newVariant(STARTER_BRACE).key, 'variante');
  const toggle = withParameterType(STARTER_BRACE.parameters[0]!, 'toggle');
  assert.equal(toggle.range, undefined);
  assert.equal(toggle.default, 1);
  assert.deepEqual(withParameterDomain(STARTER_BRACE.parameters[0]!, 'values').values, [500]);
  assert.deepEqual(withParameterDomain(STARTER_DECK.parameters[0]!, 'range').range, { min: 1000, max: 2000 });
});

test('removing a body drops the traits that named it; issues map back to the element', () => {
  const removed = removeBody(STARTER_DECK, 0);
  assert.equal(removed.traits.surface, undefined);
  assert.deepEqual(removed.traits.faces, []);
  const broken = { ...STARTER_TABLE, bodies: [{ ...STARTER_TABLE.bodies[0]!, outline: { shape: 'rect' as const, x: 0, y: 0, width: 'B - 2000', height: 'T' } }, STARTER_TABLE.bodies[1]!] };
  const resolved = resolvePart(broken, {}, STARTER_CONTEXT);
  const field = issuesForSelection(resolved.issues, { kind: 'body', key: 'platte' }, 'outline.width');
  assert.equal(field.length, 1);
  assert.match(field[0]!.message, /Breite -800 mm unterschreitet/);
  assert.deepEqual(issuesForSelection(resolved.issues, { kind: 'body', key: 'bein' }), []);
  assert.deepEqual(selectionOfIssue(field[0]!, broken), { kind: 'body', key: 'platte' });
  assert.deepEqual(selectionOfIssue({ path: 'fuss[0,1]' }, STARTER_DECK), { kind: 'child', key: 'fuss' });
  assert.deepEqual(selectionOfIssue({ hardware: 'spanngurt-25' }, STARTER_BRACE), { kind: 'hardware', index: 1 });
});

test('geometry is shared while used and disposed after it falls out of the idle window', () => {
  const disposed: string[] = [];
  let built = 0;
  const cache = new SharedGeometryCache<string>(value => disposed.push(value), 1);
  const a = cache.acquire('a', () => `geometry-a-${++built}`);
  const again = cache.acquire('a', () => `geometry-a-${++built}`);
  assert.equal(a, again);
  assert.equal(cache.users('a'), 2);
  cache.release('a');
  cache.release('a');
  assert.equal(cache.has('a'), true);
  assert.equal(cache.acquire('a', () => `geometry-a-${++built}`), a);
  cache.release('a');
  cache.acquire('b', () => 'geometry-b');
  cache.release('b');
  assert.deepEqual(disposed, ['geometry-a-1']);
  assert.equal(built, 1);
  const table = resolvePart(STARTER_TABLE, {}, STARTER_CONTEXT);
  assert.equal(resolvedGeometryKey(table), resolvedGeometryKey(resolvePart(STARTER_TABLE, {}, STARTER_CONTEXT)));
  assert.notEqual(resolvedGeometryKey(table), resolvedGeometryKey(resolvePart(STARTER_TABLE, { values: { B: 1300 } }, STARTER_CONTEXT)));
});
