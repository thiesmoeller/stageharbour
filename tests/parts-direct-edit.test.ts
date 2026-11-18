import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartContext, type PartBody, type PartDefinition, type PartParameter } from '../src/shared/parts/definition.js';
import {
  addBeam, addBoxFromRect, addFaceFromCircle, addSheetFromOutline, handleLocks, moveBody, moveChild, moveVertex, pushPullFace,
  pushPullNewBody, rotateBody, rotateChild, setHandleMeasure, type EditResult,
} from '../src/shared/parts/directEdit.js';
import { handleForPick, partHandles, type Handle } from '../src/shared/parts/handles.js';
import { add, quatFromAxisAngle, rotate, scale, sub, type Vec3 } from '../src/shared/parts/math.js';
import { resolvePart, solidVertices, type ResolvedPart } from '../src/shared/parts/resolve.js';
import { STARTER_MATERIALS } from '../src/shared/parts/starter/index.js';
import { fixtureId, panel } from './helpers/partsFixtures.js';

const CONTEXT = createPartContext({ materials: STARTER_MATERIALS });
const near = (a: Vec3, b: Vec3, tolerance = 1e-3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= tolerance;
const show = (v: Vec3) => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

const length = (key: string, value: number, extra: Partial<PartParameter> = {}): PartParameter =>
  ({ key, label: key, type: 'length', default: value, scope: 'placement', range: { min: 10, max: 5000 }, ...extra });

function part(bodies: PartBody[], extra: Partial<PartDefinition> = {}): PartDefinition {
  return { id: fixtureId(700), revision: 1, name: 'Modell', category: 'Test', parameters: [], bodies, traits: { stock: 'none' }, ...extra };
}

function ok(result: EditResult): PartDefinition {
  assert.ok(result.ok, result.ok ? '' : result.message);
  return result.definition;
}

function resolved(definition: PartDefinition, variant?: string): ResolvedPart {
  const result = resolvePart(definition, variant ? { variant } : {}, CONTEXT);
  assert.deepEqual(result.issues.filter(issue => issue.severity === 'error'), []);
  return result;
}

const handle = (definition: PartDefinition, id: string, variant?: string): Handle => {
  const found = partHandles(definition, resolved(definition, variant)).find(item => item.id === id);
  assert.ok(found, `handle ${id}`);
  return found;
};

const OPPOSITE: Record<string, string> = {
  'side:right': 'side:left', 'side:left': 'side:right', 'side:top': 'side:bottom', 'side:bottom': 'side:top',
  'side:back': 'side:front', 'side:front': 'side:back',
  'edge:right': 'edge:left', 'edge:left': 'edge:right', 'edge:top': 'edge:bottom', 'edge:bottom': 'edge:top',
};

/** Every face and edge handle moves exactly by the pull along its axis, and the opposite one stays. */
function assertPullsExactly(definition: PartDefinition, distance = 37) {
  const before = resolved(definition);
  const handles = partHandles(definition, before);
  const pulled = handles.filter(item => item.kind === 'face' || item.kind === 'edge');
  assert.ok(pulled.length > 0);
  for (const item of pulled) {
    const next = ok(pushPullFace(definition, before, item, distance));
    const after = partHandles(next, resolved(next));
    const moved = after.find(other => other.id === item.id)!;
    const expected = add(item.position, scale(item.axis, distance));
    assert.ok(near(moved.position, expected), `${item.id}: ${show(moved.position)} should be ${show(expected)}`);
    if (item.measure) {
      assert.ok(Math.abs(moved.measure!.value - item.measure.value - distance) < 1e-3, `${item.id} measures ${item.measure.label} + ${distance}`);
    }
    const opposite = OPPOSITE[item.name];
    if (opposite) {
      const id = `${item.solid}:${opposite}`;
      const still = before.solids.length && handles.find(other => other.id === id);
      const now = after.find(other => other.id === id);
      if (still && now) assert.ok(near(now.position, still.position), `${id} stays when ${item.name} is pulled`);
    }
  }
}

test('a pull moves exactly the pulled face of a box, upright, turned or turned about a pivot', () => {
  assertPullsExactly(part([{ kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 300, 200], at: [0, 150, 0] }]));
  assertPullsExactly(part([{ kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 300, 200], at: [100, 150, 50], rotation: [10, 30, -20] }]));
  assertPullsExactly(part([{
    kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 300, 200], at: [100, 150, 50], rotation: [0, 45, 15], pivot: [0, 0, 0],
  }]));
});

test('a pull moves exactly the pulled end or side of a beam, also a diagonal one without its own section', () => {
  assertPullsExactly(part([{ kind: 'beam', key: 'l', material: 'latte-40x40', from: [0, 0, 0], to: [0, 1000, 0] }]));
  assertPullsExactly(part([{ kind: 'beam', key: 'l', material: 'latte-40x40', from: [-300, 0, 100], to: [200, 800, -400], roll: 15 }]));
});

test('a pull moves exactly the pulled face or edge of a sheet in every plane, anchor and pose', () => {
  for (const plane of ['xy', 'xz', 'yz'] as const) {
    for (const anchor of ['face', 'centre', 'back'] as const) {
      assertPullsExactly(part([{
        kind: 'sheet', key: 'p', material: 'sperrholz-12', plane, anchor, at: [10, 20, 30],
        outline: { shape: 'rect', x: -200, y: 0, width: 400, height: 600 },
      }]));
    }
  }
  assertPullsExactly(part([{
    kind: 'sheet', key: 'p', material: 'sperrholz-12', plane: 'xz', anchor: 'back', at: [0, 100, 0], rotation: [20, 0, 10], pivot: [50, 0, 0],
    outline: { shape: 'polygon', points: [[0, 0], [500, 0], [600, 400], [100, 300]] },
  }]));
  // A clockwise loop pulls outwards all the same.
  assertPullsExactly(part([{
    kind: 'sheet', key: 'p', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0],
    outline: { shape: 'polygon', points: [[0, 0], [0, 400], [500, 400], [500, 0]] },
  }]));
});

test('a number is overwritten with the new number', () => {
  const definition = part([{ kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 300, 200], at: [0, 150, 0] }]);
  const top = handle(definition, 'k:side:top');
  const next = ok(pushPullFace(definition, resolved(definition), top, 100));
  assert.deepEqual(next.bodies[0], { kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 400, 200], at: [0, 200, 0] });
  assert.deepEqual(definition.bodies[0], { kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 300, 200], at: [0, 150, 0] }, 'the input stays');
});

test('Ctrl+push/pull leaves the face and adds a new body extruded from it', () => {
  const definition = part([{ kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 300, 200], at: [0, 150, 0] }]);
  const before = definition.bodies[0];
  const top = handle(definition, 'k:side:top');
  const next = ok(pushPullNewBody(definition, resolved(definition), top, 100));
  assert.deepEqual(next.bodies[0], before, 'the original body stays');
  assert.equal(next.bodies.length, 2);
  const added = next.bodies[1] as Extract<PartBody, { kind: 'box' }>;
  assert.equal(added.kind, 'box');
  assert.equal(added.material, 'holz-koerper');
  assert.deepEqual(added.size, [400, 100, 200]);
  assert.deepEqual(added.at, [0, 350, 0]);
  const topAfter = partHandles(next, resolved(next)).find(item => item.id === `${added.key}:side:bottom`);
  assert.ok(topAfter);
  assert.ok(near(topAfter.position, top.position), 'new body sits on the original face');
});

test('Ctrl+push/pull on a sheet face keeps the outline as a new thick sheet', () => {
  const definition = part([{
    kind: 'sheet', key: 'p', material: 'sperrholz-12', plane: 'xz', anchor: 'face', at: [0, 100, 0],
    outline: { shape: 'polygon', points: [[0, 0], [500, 0], [400, 300], [50, 250]] },
  }]);
  const back = handle(definition, 'p:side:back');
  const next = ok(pushPullNewBody(definition, resolved(definition), back, 80));
  assert.equal(next.bodies.length, 2);
  assert.deepEqual(next.bodies[0], definition.bodies[0]);
  const added = next.bodies[1] as Extract<PartBody, { kind: 'sheet' }>;
  assert.equal(added.kind, 'sheet');
  assert.equal(added.thickness, 80);
  assert.deepEqual(added.outline, (definition.bodies[0] as Extract<PartBody, { kind: 'sheet' }>).outline);
});

test('Ctrl+push/pull refuses edges and tiny distances', () => {
  const sheet = part([{
    kind: 'sheet', key: 'p', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0],
    outline: { shape: 'rect', x: 0, y: 0, width: 400, height: 600 },
  }]);
  assert.equal(pushPullNewBody(sheet, resolved(sheet), handle(sheet, 'p:edge:right'), 50).ok, false);
  const box = part([{ kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 300, 200], at: [0, 150, 0] }]);
  assert.equal(pushPullNewBody(box, resolved(box), handle(box, 'k:side:top'), 0.5).ok, false);
});

test('a bare parameter name moves the parameter, and a formula that follows the drag is no lock', () => {
  const definition = part(
    [{ kind: 'box', key: 'k', material: 'holz-koerper', size: ['B', 'H', 200], at: [0, 'H / 2', 0] }],
    { parameters: [length('B', 400), length('H', 300)] },
  );
  const result = pushPullFace(definition, resolved(definition), handle(definition, 'k:side:top'), 100);
  assert.ok(result.ok);
  assert.deepEqual(result.parameters, ['H']);
  assert.equal(result.definition.parameters[1]!.default, 400);
  assert.deepEqual(result.definition.bodies[0], definition.bodies[0], 'the formulas stay');
  // The bottom moves the parameter too, but `H / 2` does not follow the lower face: locked.
  const bottom = pushPullFace(definition, resolved(definition), handle(definition, 'k:side:bottom'), 100);
  assert.equal(bottom.ok, false);
  assert.ok(!bottom.ok && bottom.reason === 'locked');
  assert.deepEqual(!bottom.ok && bottom.locked, [{ path: 'at[1]', formula: 'H / 2' }]);
});

test('any other formula wins: the drag is refused and names the formula', () => {
  const definition = part(
    [{ kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 'H * 2', 200], at: [0, 300, 0] }],
    { parameters: [length('H', 300)] },
  );
  const top = handle(definition, 'k:side:top');
  const result = pushPullFace(definition, resolved(definition), top, 100);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'locked');
  assert.match(result.message, /size\[1\] = H \* 2/);
  assert.deepEqual(handleLocks(definition, resolved(definition), top), [{ path: 'size[1]', formula: 'H * 2' }]);
  // With the centre on the bare name, `H * 2` lands on the pulled height once H has moved.
  const following = part(
    [{ kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 'H * 2', 200], at: [0, 'H', 0] }],
    { parameters: [length('H', 300)] },
  );
  assert.equal(ok(pushPullFace(following, resolved(following), handle(following, 'k:side:top'), 100)).parameters[0]!.default, 350);
  assert.deepEqual(handleLocks(definition, resolved(definition), handle(definition, 'k:side:right')), []);
});

test('a variant-scope parameter moves in the active variant, other scopes move their default', () => {
  const definition = part(
    [{ kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 'H', 200], at: [0, 0, 0] }],
    {
      parameters: [length('H', 300, { scope: 'variant' })],
      variants: [{ key: 'klein', label: 'Klein', values: { H: 300 } }, { key: 'gross', label: 'Groß', values: { H: 600 } }],
    },
  );
  const top = handle(definition, 'k:side:top', 'gross');
  const next = ok(pushPullFace(definition, resolved(definition, 'gross'), top, 50));
  assert.deepEqual(next.variants, [{ key: 'klein', label: 'Klein', values: { H: 300 } }, { key: 'gross', label: 'Groß', values: { H: 650 } }]);
  assert.equal(next.parameters[0]!.default, 300);
});

test('a parameter outside its range or between its listed values refuses the drag', () => {
  const ranged = part(
    [{ kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 'H', 200], at: [0, 0, 0] }],
    { parameters: [length('H', 300, { range: { min: 100, max: 350 } })] },
  );
  const result = pushPullFace(ranged, resolved(ranged), handle(ranged, 'k:side:top'), 100);
  assert.ok(!result.ok && result.reason === 'range');
  assert.match(!result.ok ? result.message : '', /zwischen 100 und 350/);
  const listed = part(
    [{ kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 'H', 200], at: [0, 0, 0] }],
    { parameters: [length('H', 300, { range: undefined, values: [300, 400] })] },
  );
  assert.equal(pushPullFace(listed, resolved(listed), handle(listed, 'k:side:top'), 50).ok, false);
  assert.equal(ok(pushPullFace(listed, resolved(listed), handle(listed, 'k:side:top'), 100)).parameters[0]!.default, 400);
});

test('typing a measure sets it exactly; a beam measures its length', () => {
  const definition = part([{ kind: 'beam', key: 'l', material: 'latte-40x40', from: [0, 0, 0], to: [0, 1000, 0] }]);
  const end = handle(definition, 'l:side:top');
  assert.deepEqual(end.measure, { label: 'Länge', value: 1000 });
  const next = ok(setHandleMeasure(definition, resolved(definition), end, 1250));
  assert.deepEqual(next.bodies[0], { kind: 'beam', key: 'l', material: 'latte-40x40', from: [0, 0, 0], to: [0, 1250, 0] });
  const side = handle(definition, 'l:side:right');
  const wider = ok(setHandleMeasure(definition, resolved(definition), side, 60));
  assert.deepEqual((wider.bodies[0] as { section?: unknown }).section, [60, 40], 'the section is written out from the profile');
});

test('moving a body moves every point of it; a pivot moves along', () => {
  const definition = part([
    { kind: 'box', key: 'k', material: 'holz-koerper', size: [100, 100, 100], at: [0, 50, 0], rotation: [0, 30, 0], pivot: [50, 0, 0] },
    { kind: 'beam', key: 'l', material: 'latte-40x40', from: [0, 0, 0], to: [300, 400, 0] },
  ]);
  const delta = { x: 120, y: -10, z: 33 };
  const before = resolved(definition);
  let next = ok(moveBody(definition, before, 'k', delta));
  next = ok(moveBody(next, resolved(next), 'l', delta));
  const after = resolved(next);
  for (const solid of before.solids) {
    const moved = after.solids.find(item => item.id === solid.id)!;
    solidVertices(solid).forEach((vertex, index) => assert.ok(near(solidVertices(moved)[index]!, add(vertex, delta))));
  }
  assert.deepEqual((next.bodies[0] as { pivot?: unknown }).pivot, [170, -10, 33]);
});

function assertTurnedAbout(before: ResolvedPart, after: ResolvedPart, axis: Vec3, degrees: number, pivot: Vec3) {
  const turn = quatFromAxisAngle(axis, degrees * Math.PI / 180);
  for (const solid of before.solids) {
    const turned = after.solids.find(item => item.id === solid.id)!;
    if (solid.kind === 'beam' && turned.kind === 'beam') {
      // A beam keeps its section upright: only its centre line turns exactly.
      assert.ok(near(turned.from, add(pivot, rotate(turn, sub(solid.from, pivot))), 2e-3), `${solid.id} from`);
      assert.ok(near(turned.to, add(pivot, rotate(turn, sub(solid.to, pivot))), 2e-3), `${solid.id} to`);
      continue;
    }
    const expected = solidVertices(solid).map(vertex => add(pivot, rotate(turn, sub(vertex, pivot))));
    const actual = solidVertices(turned);
    for (const point of expected) {
      const miss = Math.min(...actual.map(vertex => Math.hypot(vertex.x - point.x, vertex.y - point.y, vertex.z - point.z)));
      // Written angles are rounded to 0.001°: a few micrometres at half a metre.
      assert.ok(miss <= 1e-2, `${solid.id}: ${show(point)} after turning ${JSON.stringify(axis)} ${degrees}, off by ${miss}`);
    }
  }
}

test('rotating turns every point about the pivot, for each body kind and for a child', () => {
  const bodies: PartBody[] = [
    { kind: 'box', key: 'k', material: 'holz-koerper', size: [100, 200, 300], at: [0, 100, 0] },
    { kind: 'box', key: 'kp', material: 'holz-koerper', size: [100, 200, 300], at: [400, 100, 0], rotation: [15, 0, 0], pivot: [300, 0, 0] },
    { kind: 'beam', key: 'l', material: 'latte-40x40', from: [0, 0, 500], to: [300, 400, 500] },
    {
      kind: 'sheet', key: 'p', material: 'sperrholz-12', plane: 'xz', anchor: 'back', at: [0, 0, -400],
      outline: { shape: 'rect', x: 0, y: 0, width: 300, height: 200 },
    },
  ];
  const pivot = { x: 50, y: 0, z: 20 };
  for (const [axis, degrees] of [[{ x: 0, y: 1, z: 0 }, 90], [{ x: 1, y: 0, z: 0 }, -30], [{ x: 0, y: 0, z: 1 }, 45], [{ x: 1, y: 1, z: 0 }, 20]] as const) {
    let definition = part(bodies);
    const before = resolved(definition);
    for (const body of bodies) definition = ok(rotateBody(definition, resolved(definition), body.key, axis, degrees, pivot));
    const unit = scale(axis, 1 / Math.hypot(axis.x, axis.y, axis.z));
    assertTurnedAbout(before, resolved(definition), unit, degrees, pivot);
  }
  const plain = part(bodies.slice(0, 1));
  assert.deepEqual(ok(rotateBody(plain, resolved(plain), 'k', { x: 0, y: 1, z: 0 }, 90)).bodies[0], {
    kind: 'box', key: 'k', material: 'holz-koerper', size: [100, 200, 300], at: [0, 100, 0], rotation: [0, 90, 0],
  });

  const child = panel();
  const context = createPartContext({ materials: STARTER_MATERIALS, parts: [child] });
  const parent = part([], { children: [{ key: 'wand', part: { id: child.id, revision: 1 }, at: [100, 0, 0] }] });
  const resolveParent = (definition: PartDefinition) => resolvePart(definition, {}, context);
  const turned = ok(rotateChild(parent, resolveParent(parent), 'wand', { x: 0, y: 1, z: 0 }, 30, pivot));
  assertTurnedAbout(resolveParent(parent), resolveParent(turned), { x: 0, y: 1, z: 0 }, 30, pivot);
  const moved = ok(moveChild(parent, resolveParent(parent), 'wand', { x: 5, y: 6, z: 7 }));
  assert.deepEqual(moved.children![0]!.at, [105, 6, 7]);
});

test('a rotation held by a bare parameter turns the parameter', () => {
  const definition = part(
    [{ kind: 'box', key: 'k', material: 'holz-koerper', size: [100, 100, 100], at: [0, 50, 0], rotation: [0, 'w', 0] }],
    { parameters: [{ key: 'w', label: 'Winkel', type: 'angle', default: 10, scope: 'placement', range: { min: -180, max: 180 } }] },
  );
  const next = ok(rotateBody(definition, resolved(definition), 'k', { x: 0, y: 1, z: 0 }, 25));
  assert.equal(next.parameters[0]!.default, 35);
  assert.deepEqual(next.bodies[0], definition.bodies[0]);
});

test('point handles move a polygon corner or a beam end freely', () => {
  const definition = part([
    { kind: 'sheet', key: 'p', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0], outline: { shape: 'polygon', points: [[0, 0], [500, 0], [250, 400]] } },
    { kind: 'beam', key: 'l', material: 'latte-40x40', from: [0, 0, 0], to: [0, 500, 0] },
  ]);
  const corner = handle(definition, 'p:point:2');
  assert.deepEqual(corner.position, { x: 250, y: 400, z: 6 });
  let next = ok(moveVertex(definition, resolved(definition), corner, { x: 50, y: 100, z: 0 }));
  assert.deepEqual((next.bodies[0] as Extract<PartBody, { kind: 'sheet' }>).outline, { shape: 'polygon', points: [[0, 0], [500, 0], [300, 500]] });
  next = ok(moveVertex(next, resolved(next), handle(next, 'l:point:to'), { x: 100, y: 0, z: -20 }));
  assert.deepEqual((next.bodies[1] as Extract<PartBody, { kind: 'beam' }>).to, [100, 500, -20]);
});

test('a pick on a sheet rim grabs the nearest edge', () => {
  const definition = part([{ kind: 'sheet', key: 'p', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0], outline: { shape: 'rect', x: 0, y: 0, width: 400, height: 600 } }]);
  const handles = partHandles(definition, resolved(definition));
  assert.equal(handleForPick(handles, 'p', 'edge', { x: 395, y: 300, z: 6 })?.name, 'edge:right');
  assert.equal(handleForPick(handles, 'p', 'edge', { x: 100, y: 3, z: 6 })?.name, 'edge:bottom');
  assert.equal(handleForPick(handles, 'p', 'back', { x: 100, y: 3, z: 12 })?.name, 'side:back');
});

test('a circle sheet exposes centre and radius handles, not every chord vertex', () => {
  const definition = part([{
    kind: 'sheet', key: 'p', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0],
    outline: { shape: 'circle', cx: 100, cy: 50, r: 200 },
  }]);
  const handles = partHandles(definition, resolved(definition));
  const centre = handles.find(item => item.name === 'point:centre');
  const radius = handles.find(item => item.name === 'edge:radius');
  assert.ok(centre, 'centre handle');
  assert.ok(radius, 'radius handle');
  assert.deepEqual(centre.position, { x: 100, y: 50, z: 6 });
  assert.deepEqual(radius.position, { x: 300, y: 50, z: 6 });
  assert.deepEqual(radius.measure, { label: 'Radius', value: 200, path: ['outline', 'r'] });
  assert.ok(!handles.some(item => item.name.startsWith('point:') && item.name !== 'point:centre'));
  assert.ok(!handles.some(item => /^edge:\d+$/.test(item.name)));

  const next = ok(moveVertex(definition, resolved(definition), centre, { x: 20, y: -10, z: 0 }));
  assert.deepEqual((next.bodies[0] as Extract<PartBody, { kind: 'sheet' }>).outline, { shape: 'circle', cx: 120, cy: 40, r: 200 });
  const grown = ok(pushPullFace(next, resolved(next), radius!, 30));
  assert.deepEqual((grown.bodies[0] as Extract<PartBody, { kind: 'sheet' }>).outline, { shape: 'circle', cx: 120, cy: 40, r: 230 });
});

test('drawn boxes, outlines and beams become bodies with plain numbers', () => {
  let definition = part([]);
  const box = addBoxFromRect(definition, { corner: { x: -200, y: 0, z: -100 }, opposite: { x: 300, y: 0, z: 200 }, u: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, height: 20 }, 'holz-koerper');
  assert.ok(box.ok);
  assert.deepEqual(box.definition.bodies[0], { kind: 'box', key: 'quader', material: 'holz-koerper', size: [500, 20, 300], at: [50, 10, 50] });
  definition = box.definition;
  const onFront = addBoxFromRect(definition, { corner: { x: 0, y: 0, z: -100 }, opposite: { x: 100, y: 50, z: -100 }, u: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 0, z: -1 }, height: 30 }, 'holz-koerper');
  assert.ok(onFront.ok);
  assert.equal(onFront.key, 'quader-2');
  assert.deepEqual(onFront.definition.bodies[1], { kind: 'box', key: 'quader-2', material: 'holz-koerper', size: [100, 50, 30], at: [50, 25, -115] });

  for (const [normal, at] of [[{ x: 0, y: 1, z: 0 }, 0], [{ x: 0, y: -1, z: 0 }, 300], [{ x: 0, y: 0, z: -1 }, -50], [{ x: 0, y: 0, z: 1 }, 50], [{ x: 1, y: 0, z: 0 }, 70], [{ x: -1, y: 0, z: 0 }, -70]] as const) {
    const flat = (u: number, v: number): Vec3 => normal.y ? { x: u, y: at, z: v } : normal.z ? { x: u, y: v, z: at } : { x: at, y: v, z: u };
    const result = addSheetFromOutline(part([]), { points: [flat(0, 0), flat(400, 0), flat(400, 300), flat(0, 300)], normal }, 'sperrholz-12');
    assert.ok(result.ok, JSON.stringify(normal));
    const sheet = resolved(result.definition).solids[0]!;
    const vertices = solidVertices(sheet);
    const depth = (v: Vec3) => v.x * normal.x + v.y * normal.y + v.z * normal.z;
    const level = at * (normal.x + normal.y + normal.z);
    assert.ok(vertices.every(v => depth(v) >= level - 1e-6 && depth(v) <= level + 12 + 1e-6), `the sheet lies on the ${JSON.stringify(normal)} side`);
    assert.ok(vertices.some(v => Math.abs(depth(v) - level) < 1e-6), 'the drawn loop is its back face');
  }
  assert.equal(addSheetFromOutline(part([]), { points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], normal: { x: 0, y: 1, z: 0 } }, 'sperrholz-12').ok, false);
  const beam = addBeam(part([]), { x: 0, y: 0, z: 0 }, { x: 0, y: 1200.0004, z: 0 }, 'latte-40x40');
  assert.ok(beam.ok);
  assert.deepEqual(beam.definition.bodies[0], { kind: 'beam', key: 'latte', material: 'latte-40x40', from: [0, 0, 0], to: [0, 1200, 0] });
});

test('addFaceFromCircle creates a sheet with a circle outline', () => {
  const result = addFaceFromCircle(
    part([]),
    { centre: { x: 100, y: 0, z: 50 }, radius: 200, normal: { x: 0, y: 1, z: 0 } },
    'sperrholz-12',
  );
  assert.ok(result.ok);
  assert.deepEqual(result.definition.bodies[0], {
    kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xz', anchor: 'back', at: [0, 0, 0],
    outline: { shape: 'circle', cx: 100, cy: 50, r: 200 },
  });
  const solid = resolved(result.definition).solids[0]!;
  assert.equal(solid.kind, 'sheet');
  assert.ok(solid.kind === 'sheet' && Math.abs(solid.netAreaMm2 - Math.PI * 200 * 200) / (Math.PI * 200 * 200) < 0.01);

  const withSegments = addFaceFromCircle(
    part([]),
    { centre: { x: 0, y: 0, z: 0 }, radius: 100, normal: { x: 0, y: 1, z: 0 }, segments: 12 },
    'sperrholz-12',
  );
  assert.ok(withSegments.ok);
  assert.deepEqual(
    (withSegments.definition.bodies[0] as { outline: { shape: string; segments?: number } }).outline,
    { shape: 'circle', cx: 0, cy: 0, r: 100, segments: 12 },
  );

  assert.equal(addFaceFromCircle(part([]), { centre: { x: 0, y: 0, z: 0 }, radius: 0.5, normal: { x: 0, y: 1, z: 0 } }, 'sperrholz-12').ok, false);
  assert.equal(addFaceFromCircle(part([]), { centre: { x: 0, y: 0, z: 0 }, radius: 100, normal: { x: 1, y: 1, z: 0 } }, 'sperrholz-12').ok, false);
});
