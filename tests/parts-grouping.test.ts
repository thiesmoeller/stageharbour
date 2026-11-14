import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartContext, partDefinitionSchema, type PartDefinition } from '../src/shared/parts/definition.js';
import { bindFieldToParameter, bindMeasureToParameter, moveSelection, pushPullFace, rotateSelection } from '../src/shared/parts/directEdit.js';
import { explodeChild, makeChildFromBodies, makeGroup, renameFormula } from '../src/shared/parts/grouping.js';
import { partHandles } from '../src/shared/parts/handles.js';
import { resolvePart, solidVertices, type ResolvedPart } from '../src/shared/parts/resolve.js';
import { STARTER_MATERIALS, STARTER_PARTS } from '../src/shared/parts/starter/index.js';
import { fixtureId } from './helpers/partsFixtures.js';

const CHILD_ID = fixtureId(720);

function shape(resolved: ResolvedPart) {
  const solids = resolved.solids.map(solid => solidVertices(solid)
    .map(point => [point.x, point.y, point.z].map(value => (Math.round(value * 100) / 100 + 0).toFixed(2)).join(','))
    .sort().join(';')).sort();
  const beams = resolved.cutList.beams.map(row => ({ ...row })).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  return { solids, beams, sheets: resolved.cutList.sheets, hardware: resolved.hardware, weight: Math.round(resolved.weightKg * 1e6) / 1e6 };
}

test('renaming touches whole identifiers only, never functions or parts of longer names', () => {
  const names = new Map([['B', 'kid_B'], ['max', 'nope'], ['s', 'kid_s']]);
  assert.equal(renameFormula('max(B, Bx) + s * 2 - B2 + min(s, B)', names), 'max(kid_B, Bx) + kid_s * 2 - B2 + min(kid_s, kid_B)');
  assert.equal(renameFormula(1200, names), 1200);
});

test('every starter keeps its shape, cut list and weight when bodies become a child and the child is exploded again', () => {
  for (const starter of STARTER_PARTS) {
    if (starter.bodies.length < 2) continue;
    const context = createPartContext({ materials: STARTER_MATERIALS, parts: STARTER_PARTS });
    const before = resolvePart(starter, {}, context);
    const keys = starter.bodies.slice(1).map(body => body.key);
    const grouped = makeChildFromBodies(starter, before, keys, { id: CHILD_ID, name: 'Gruppe' });
    assert.ok(grouped.ok, starter.name);
    assert.equal(partDefinitionSchema.safeParse(grouped.child).success, true, `${starter.name}: the new part is valid`);
    assert.equal(partDefinitionSchema.safeParse(grouped.parent).success, true, `${starter.name}: the parent stays valid`);
    assert.deepEqual(grouped.parent.bodies.map(body => body.key), [starter.bodies[0]!.key]);
    const withChild = createPartContext({ materials: STARTER_MATERIALS, parts: [...STARTER_PARTS, grouped.child] });
    const after = resolvePart(grouped.parent, {}, withChild);
    assert.deepEqual(after.issues.filter(issue => issue.severity === 'error'), [], starter.name);
    assert.deepEqual(shape(after), shape(before), `${starter.name}: grouped`);

    const exploded = explodeChild(grouped.parent, grouped.childKey, grouped.child);
    assert.ok(exploded.ok, starter.name);
    assert.equal(partDefinitionSchema.safeParse(exploded.definition).success, true, `${starter.name}: the exploded part is valid`);
    assert.equal(exploded.definition.children?.some(child => child.key === grouped.childKey) ?? false, false);
    assert.deepEqual(shape(resolvePart(exploded.definition, {}, withChild)), shape(before), `${starter.name}: exploded`);
  }
});

test('grouping passes the names the bodies read and moves their faces along', () => {
  const pipe = STARTER_PARTS.find(part => part.name === 'Rohrrahmen mit Stoff')!;
  const context = createPartContext({ materials: STARTER_MATERIALS, parts: STARTER_PARTS });
  const grouped = makeChildFromBodies(pipe, resolvePart(pipe, {}, context), ['stoff'], { id: CHILD_ID, name: 'Bespannung' });
  assert.ok(grouped.ok);
  assert.deepEqual(grouped.child.parameters.map(parameter => [parameter.key, parameter.scope]), [['B', 'placement'], ['H', 'placement'], ['r', 'placement']]);
  assert.deepEqual(grouped.parent.children?.at(-1), {
    key: 'bespannung', label: 'Bespannung', part: { id: CHILD_ID, revision: 1 }, at: [0, 0, 0], values: { B: 'B', H: 'H', r: 'r' },
  });
  assert.deepEqual(grouped.child.traits.faces?.map(face => face.key), ['bild']);
  assert.equal(grouped.parent.traits.faces, undefined);
  assert.equal(makeChildFromBodies(pipe, resolvePart(pipe, {}, context), [], { id: CHILD_ID, name: 'Leer' }).ok, false);
});

test('a moved child explodes to bodies at the moved place; a turned one is refused for now', () => {
  const child: PartDefinition = {
    id: CHILD_ID, revision: 1, name: 'Kiste', category: 'Test', traits: { stock: 'none' },
    parameters: [{ key: 'H', label: 'Höhe', type: 'length', default: 300, scope: 'placement', range: { min: 10, max: 1000 } }],
    derived: [{ key: 'halb', formula: 'H / 2' }],
    bodies: [{ kind: 'box', key: 'k', material: 'holz-koerper', size: [200, 'H', 200], at: [0, 'halb', 0] }],
  };
  const parent: PartDefinition = {
    id: fixtureId(721), revision: 1, name: 'Zwei', category: 'Test', traits: { stock: 'none' },
    parameters: [{ key: 'X', label: 'Abstand', type: 'length', default: 500, scope: 'placement', range: { min: 0, max: 2000 } }],
    bodies: [{ kind: 'box', key: 'k', material: 'holz-koerper', size: [100, 100, 100], at: [0, 50, 0] }],
    children: [{ key: 'kiste', part: { id: CHILD_ID, revision: 1 }, at: ['X', 0, 100], values: { H: 'X / 2' } }],
  };
  const context = createPartContext({ materials: STARTER_MATERIALS, parts: [child] });
  const exploded = explodeChild(parent, 'kiste', child);
  assert.ok(exploded.ok);
  assert.deepEqual(exploded.definition.derived, [
    { key: 'kiste_H', label: 'Höhe', formula: 'X / 2' }, { key: 'kiste_halb', formula: 'kiste_H / 2' },
  ]);
  assert.deepEqual(exploded.definition.bodies[1], {
    kind: 'box', key: 'kiste-k', material: 'holz-koerper', size: [200, 'kiste_H', 200], at: ['X', 'kiste_halb', 100],
  });
  assert.deepEqual(shape(resolvePart(exploded.definition, {}, context)), shape(resolvePart(parent, {}, context)));
  const turned = { ...parent, children: [{ ...parent.children![0]!, rotation: [0, 90, 0] as [number, number, number] }] };
  assert.equal(explodeChild(turned, 'kiste', child).ok, false);
});

test('„Als Option freigeben“ binds the measure and keeps the opposite face in place when the option changes', () => {
  const context = createPartContext({ materials: STARTER_MATERIALS });
  const definition: PartDefinition = {
    id: fixtureId(722), revision: 1, name: 'Klotz', category: 'Test', parameters: [], traits: { stock: 'none' },
    bodies: [{ kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 750, 200], at: [0, 375, 0] }],
  };
  const resolved = resolvePart(definition, {}, context);
  const top = partHandles(definition, resolved).find(handle => handle.id === 'k:side:top')!;
  const bound = bindMeasureToParameter(definition, resolved, top);
  assert.ok(bound.ok);
  assert.equal(bound.parameter, 'hoehe');
  assert.deepEqual(bound.definition.parameters, [{ key: 'hoehe', label: 'Höhe', type: 'length', default: 750, scope: 'placement', range: { min: 1, max: 10000 } }]);
  assert.deepEqual(bound.definition.bodies[0], { kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 'hoehe', 200], at: [0, 'hoehe / 2', 0] });
  const taller = resolvePart(bound.definition, { values: { hoehe: 900 } }, context);
  const solid = taller.solids[0]!;
  assert.ok(solid.kind === 'box' && solid.center.y - solid.size.y / 2 === 0 && solid.size.y === 900, 'the bottom stays on the floor');
  // Pulling the top now moves the option.
  const pulled = pushPullFace(bound.definition, resolvePart(bound.definition, {}, context), { ...top }, 50);
  assert.ok(pulled.ok && pulled.parameters[0] === 'hoehe' && pulled.definition.parameters[0]!.default === 800);
  // The bottom face of a box on a plinth keeps its height.
  const raised = { ...definition, bodies: [{ ...definition.bodies[0]!, at: [0, 475, 0] as [number, number, number] }] };
  const raisedTop = partHandles(raised, resolvePart(raised, {}, context)).find(handle => handle.id === 'k:side:top')!;
  const raisedBound = bindMeasureToParameter(raised, resolvePart(raised, {}, context), raisedTop);
  assert.ok(raisedBound.ok);
  assert.deepEqual((raisedBound.definition.bodies[0] as { at: unknown }).at, [0, '100 + hoehe / 2', 0]);
  const field = bindFieldToParameter(definition, resolved, { body: 'k' }, ['size', 0], 'Breite');
  assert.ok(field.ok);
  assert.deepEqual((field.definition.bodies[0] as { size: unknown }).size, ['breite', 750, 200]);
  const again = bindFieldToParameter(field.definition, resolvePart(field.definition, {}, context), { body: 'k' }, ['size', 0], 'Breite');
  assert.ok(again.ok && again.parameter === 'breite' && again.definition === field.definition, 'a bound field stays bound');
});

test('a handle grouped into a door follows the group when the door moves or swings', () => {
  const context = createPartContext({ materials: STARTER_MATERIALS });
  const door: PartDefinition = {
    id: fixtureId(730), revision: 1, name: 'Tür', category: 'Türen', parameters: [], traits: { stock: 'none' },
    bodies: [
      { kind: 'box', key: 'blatt', material: 'holz-koerper', size: [800, 2000, 40], at: [400, 1000, 20] },
      { kind: 'box', key: 'griff', material: 'holz-koerper', size: [40, 80, 30], at: [780, 1000, 55] },
    ],
  };
  const before = resolvePart(door, {}, context);
  const grouped = makeGroup(door, before, ['blatt', 'griff'], { id: fixtureId(731), name: 'Tür' });
  assert.ok(grouped.ok);
  assert.equal(grouped.parent.bodies.length, 0);
  assert.equal(grouped.parent.children?.[0]?.part, undefined);
  assert.equal(partDefinitionSchema.safeParse(grouped.parent).success, true);
  const placed = resolvePart(grouped.parent, {}, context);
  const handle = placed.solids.find(solid => solid.body === 'griff');
  assert.ok(handle?.kind === 'box');
  assert.equal(handle.center.x, 780);
  const targets = { bodies: [] as string[], children: [grouped.childKey] };
  const moved = moveSelection(grouped.parent, placed, targets, { x: 100, y: 0, z: 0 });
  assert.ok(moved.ok);
  const afterMove = resolvePart(moved.definition, {}, context).solids.find(solid => solid.body === 'griff');
  assert.ok(afterMove?.kind === 'box' && afterMove.center.x === 880 && afterMove.center.y === 1000 && afterMove.center.z === 55);
  const swung = rotateSelection(grouped.parent, placed, targets, { x: 0, y: 1, z: 0 }, 90, { x: 0, y: 0, z: 0 });
  assert.ok(swung.ok);
  const afterSwing = resolvePart(swung.definition, {}, context).solids.find(solid => solid.body === 'griff');
  assert.ok(afterSwing?.kind === 'box');
  assert.ok(Math.abs(afterSwing.center.y - 1000) < 0.5, 'the handle stays at the door height');
  assert.ok(Math.abs(Math.hypot(afterSwing.center.x, afterSwing.center.z) - Math.hypot(780, 55)) < 1, 'the handle stays in the group frame');
  assert.ok(Math.abs(afterSwing.center.x - 780) > 100, 'the swing carries the offset handle around the hinge');
  const opened = explodeChild(grouped.parent, grouped.childKey, grouped.child);
  assert.ok(opened.ok);
  assert.deepEqual(opened.definition.bodies.map(body => body.key).sort(), ['tuer-blatt', 'tuer-griff']);
  assert.equal(opened.definition.children?.length ?? 0, 0);
});
