import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartContext, type PartBody, type PartDefinition } from '../src/shared/parts/definition.js';
import { copyRotateSelection, moveSelection, moveVertex } from '../src/shared/parts/directEdit.js';
import { partHandles } from '../src/shared/parts/handles.js';
import { add } from '../src/shared/parts/math.js';
import { resolvePart, solidVertices } from '../src/shared/parts/resolve.js';
import { STARTER_MATERIALS } from '../src/shared/parts/starter/index.js';
import { moveEdit, pushPullPreviewScale, rotateEdit } from '../src/client/designer/modelling/selectionEdit.js';
import { MODEL_TOOLS } from '../src/client/designer/modelling/tools.js';
import { fixtureId } from './helpers/partsFixtures.js';

const CONTEXT = createPartContext({ materials: STARTER_MATERIALS });

function part(bodies: PartBody[], extra: Partial<PartDefinition> = {}): PartDefinition {
  return { id: fixtureId(740), revision: 1, name: 'Modell', category: 'Test', parameters: [], bodies, traits: { stock: 'none' }, ...extra };
}

function resolved(definition: PartDefinition) {
  const result = resolvePart(definition, {}, CONTEXT);
  assert.deepEqual(result.issues.filter(issue => issue.severity === 'error'), []);
  return result;
}

test('moveEdit is a rigid selection move — never a corner moveVertex', () => {
  const definition = part([
    { kind: 'box', key: 'k', material: 'holz-koerper', size: [400, 300, 200], at: [0, 150, 0] },
    { kind: 'beam', key: 'l', material: 'latte-40x40', from: [0, 0, 0], to: [0, 500, 0] },
  ]);
  const before = resolved(definition);
  const delta = { x: 80, y: -20, z: 40 };
  const targets = { bodies: ['k', 'l'], children: [] as string[] };

  const moved = moveEdit(definition, before, targets, delta);
  assert.ok(moved.ok);
  const after = resolved(moved.definition);
  for (const solid of before.solids) {
    const next = after.solids.find(item => item.body === solid.body);
    assert.ok(next, solid.body);
    const beforeVerts = solidVertices(solid);
    const afterVerts = solidVertices(next);
    assert.equal(afterVerts.length, beforeVerts.length);
    for (let i = 0; i < beforeVerts.length; i++) {
      const expected = add(beforeVerts[i]!, delta);
      const got = afterVerts[i]!;
      assert.ok(Math.hypot(got.x - expected.x, got.y - expected.y, got.z - expected.z) < 1e-3,
        `${solid.body} vertex ${i} should move by the same delta`);
    }
  }

  // A point-handle grab would deform the beam; Verschieben must not take that path.
  const tip = partHandles(definition, before).find(item => item.id === 'l:point:to');
  assert.ok(tip);
  const deformed = moveVertex(definition, before, tip, delta);
  assert.ok(deformed.ok);
  assert.notDeepEqual(
    (deformed.definition.bodies.find(body => body.key === 'l') as Extract<PartBody, { kind: 'beam' }>).from,
    (moved.definition.bodies.find(body => body.key === 'l') as Extract<PartBody, { kind: 'beam' }>).from,
  );
  assert.deepEqual(moveSelection(definition, before, targets, delta), moved);
});

test('rotateEdit with copy uses copyRotateSelection and leaves the original', () => {
  const definition = part([{ kind: 'box', key: 'k', material: 'holz-koerper', size: [200, 100, 100], at: [300, 50, 0] }]);
  const before = resolved(definition);
  const targets = { bodies: ['k'], children: [] as string[] };
  const pivot = { x: 0, y: 0, z: 0 };
  const axis = { x: 0, y: 1, z: 0 };

  const copied = rotateEdit(definition, before, targets, axis, 90, pivot, true);
  assert.ok(copied.ok);
  assert.equal(copied.definition.bodies.length, 2);
  assert.equal(definition.bodies.length, 1);

  const viaHelper = copyRotateSelection(definition, before, targets, axis, 90, pivot);
  assert.ok(viaHelper.ok);
  assert.equal(viaHelper.definition.bodies.length, 2);
  const original = viaHelper.definition.bodies.find(body => body.key === 'k') as Extract<PartBody, { kind: 'box' }>;
  assert.deepEqual(original.at, [300, 50, 0]);
});

test('move and pushpull tool hints describe SketchUp base point and double-click repeat', () => {
  assert.match(MODEL_TOOLS.find(tool => tool.id === 'move')!.hint, /Inferenz/);
  assert.match(MODEL_TOOLS.find(tool => tool.id === 'rotate')!.hint, /Inferenz/);
  assert.match(MODEL_TOOLS.find(tool => tool.id === 'pushpull')!.hint, /Doppelklick/);
  assert.match(MODEL_TOOLS.find(tool => tool.id === 'pushpull')!.hint, /Strg.*neuen Körper/);
  assert.match(MODEL_TOOLS.find(tool => tool.id === 'rotate')!.hint, /Strg/);
  assert.match(MODEL_TOOLS.find(tool => tool.id === 'select')!.hint, /Strg\+A/);
  assert.match(MODEL_TOOLS.find(tool => tool.id === 'rect')!.hint, /Pfeiltasten.*Ebene/);
});

test('pushPullPreviewScale grows about the opposite face without needing a draft rewrite', () => {
  const top = { position: { x: 0, y: 300, z: 0 }, axis: { x: 0, y: 1, z: 0 }, measure: { value: 300 } };
  const preview = pushPullPreviewScale(top, 100);
  assert.ok(preview);
  assert.deepEqual(preview.pivot, { x: 0, y: 0, z: 0 });
  assert.equal(preview.factor, 400 / 300);
  assert.equal(pushPullPreviewScale(top, -300), undefined);
  assert.equal(pushPullPreviewScale({ position: top.position, axis: top.axis }, 50), undefined);
});
