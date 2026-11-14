import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3 } from 'three';
import { BOX_SIDE_SLOTS, buildSolidGeometry, finishRepeat } from '../src/shared/parts/geometry.js';
import { partLibraryJsonSchema, partLibrarySchema, parameterDisplay, type PartDefinition, type PartMaterial } from '../src/shared/parts/definition.js';
import { resolvePart, type ResolvedBeam } from '../src/shared/parts/resolve.js';
import { validateDefinition } from '../src/shared/parts/validate.js';
import {
  STARTER_BRACE, STARTER_BRACE_BALLAST, STARTER_CONTEXT, STARTER_LIBRARY, STARTER_PIPE_CLOTH_FLAT,
} from '../src/shared/parts/starter/index.js';
import { panel } from './helpers/partsFixtures.js';

const codes = (definition: PartDefinition) => validateDefinition(definition, STARTER_CONTEXT).issues.map(item => `${item.severity}:${item.code}`);

test('Rohrrahmen mit Stoff: tube rows in the cut list, the cloth cut with its hem', () => {
  const resolved = resolvePart(STARTER_PIPE_CLOTH_FLAT, {}, STARTER_CONTEXT);
  assert.deepEqual(resolved.issues, []);
  assert.deepEqual(resolved.cutList.beams.map(row => [row.material, row.shape, row.lengthMm, row.count]), [
    ['alurohr-30', 'tube', 2400, 2], ['alurohr-30', 'tube', 1940, 2],
  ]);
  const [cloth] = resolved.cutList.sheets;
  assert.deepEqual({ ...cloth, weightKg: Math.round(cloth!.weightKg * 1000) / 1000 }, {
    material: 'nessel-bemalt', thicknessMm: 1, widthMm: 2000, heightMm: 2400, count: 1,
    areaMm2: 4_800_000, grossAreaMm2: 4_800_000, weightKg: 1.536, hemMm: 50, cutWidthMm: 2100, cutHeightMm: 2500,
  });
  const tube = resolved.solids.find(solid => solid.body === 'stiel') as ResolvedBeam;
  assert.deepEqual(tube.profile, { shape: 'tube', wall: 2 });
  assert.equal(resolved.faces.find(face => face.key === 'bild')?.areaMm2, 4_800_000);
  assert.deepEqual(codes(STARTER_PIPE_CLOTH_FLAT), []);
});

test('a round profile draws as a cylinder in the beam box, with every box side slot for picking', () => {
  const resolved = resolvePart(STARTER_PIPE_CLOTH_FLAT, {}, STARTER_CONTEXT);
  const tube = resolved.solids.find(solid => solid.body === 'stiel') as ResolvedBeam;
  const geometry = buildSolidGeometry(tube);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox as Box3;
  assert.ok(Math.abs(box.max.x - box.min.x - 30) < 0.01, 'diameter across');
  assert.ok(Math.abs(box.max.y - box.min.y - 2400) < 0.01, 'length');
  assert.deepEqual([...new Set(geometry.groups.map(group => group.materialIndex))].sort(), Object.values(BOX_SIDE_SLOTS).sort());
  const square = buildSolidGeometry({ ...tube, profile: undefined });
  assert.ok(geometry.getAttribute('position').count > square.getAttribute('position').count, 'more vertices than a square beam');
  const rod = buildSolidGeometry({ ...tube, profile: { shape: 'round' } });
  assert.ok(rod.getAttribute('position').count < geometry.getAttribute('position').count, 'a rod has no inner wall');
});

test('a sheet may be cloth; the cloth thickness defaults to 1 mm and other kinds stay refused', () => {
  const cloth = panel({ bodies: [{ kind: 'sheet', key: 'platte', material: 'nessel-bemalt', plane: 'xy', at: [0, 0, 0], outline: { shape: 'rect', x: 0, y: 0, width: 'B', height: 'H' } }] });
  const resolved = resolvePart(cloth, {}, STARTER_CONTEXT);
  assert.equal(resolved.solids[0]?.kind === 'sheet' && resolved.solids[0].thickness, 1);
  const beam = panel({ bodies: [{ kind: 'beam', key: 'b', material: 'nessel-bemalt', from: [0, 0, 0], to: [0, 100, 0] }] });
  assert.match(validateDefinition(beam, STARTER_CONTEXT).issues[0]!.message, /ist Stoff, gebraucht wird Profil/);
});

test('fit-to-face shows the artwork once on the face, a tiled finish repeats at its pattern size', () => {
  const nessel = STARTER_LIBRARY.materials.find(material => material.key === 'nessel-bemalt')!;
  assert.deepEqual(finishRepeat(nessel, { width: 2000, height: 2400 }), { x: 1, y: 1 });
  const tiled: Pick<PartMaterial, 'finish' | 'finishFit'> = { finish: { kind: 'library', ref: 'library:wood', scaleMm: 500 } };
  assert.deepEqual(finishRepeat(tiled, { width: 2000, height: 1000 }), { x: 4, y: 2 });
});

test('Stützdreieck mit Beschwerung: the drawn plates are the count, the drawn strap counts once', () => {
  const pieces = (ballast: number) => resolvePart(STARTER_BRACE_BALLAST, { values: { ballast } }, STARTER_CONTEXT);
  const none = pieces(0);
  assert.deepEqual(none.hardware, []);
  assert.equal(none.solids.length, 3);
  const one = pieces(1);
  assert.deepEqual(one.hardware, [{ material: 'betonplatte-400', quantity: 1, weightKg: 18 }]);
  assert.equal(one.solids.filter(solid => solid.body.startsWith('gurt')).length, 0, 'no strap below two plates');
  const two = pieces(2);
  assert.deepEqual(two.hardware, [
    { material: 'betonplatte-400', quantity: 2, weightKg: 36 },
    { material: 'spanngurt-25', quantity: 1, weightKg: 0.3 },
  ]);
  const straps = two.solids.filter(solid => solid.body.startsWith('gurt'));
  assert.equal(straps.length, 3);
  assert.ok(straps.every(solid => solid.displayOnly === true));
  // Same totals as the hardware lines of the original Stützdreieck.
  const original = resolvePart(STARTER_BRACE, { values: { ballast: 2 } }, STARTER_CONTEXT);
  assert.deepEqual(two.hardware, original.hardware);
  assert.ok(Math.abs(two.weightKg - original.weightKg) < 1e-9);
  const top = Math.max(...two.solids.filter(solid => solid.body === 'betonplatte').map(solid => solid.kind === 'box' ? solid.center.y + solid.size.y / 2 : 0));
  assert.equal(top, 140, 'two 50 mm plates stacked on the 40 mm sill');
  assert.deepEqual(codes(STARTER_BRACE_BALLAST), []);
});

test('a display-only body without a hardware line of its material gets a warning, not an error', () => {
  const untied = panel({
    bodies: [...panel().bodies, { kind: 'box', key: 'gurt', material: 'spanngurt-25', displayOnly: true, size: [10, 10, 10], at: [0, 5, 0] }],
  });
  assert.deepEqual(codes(untied), ['warning:display-only-untied']);
  assert.equal(partLibrarySchema.safeParse({ ...STARTER_LIBRARY, parts: [untied] }).success, true);
  const resolved = resolvePart(untied, {}, STARTER_CONTEXT);
  assert.deepEqual(resolved.hardware, []);
});

test('parameter display and value labels are optional, checked against the domain, and in the JSON schema', () => {
  const base = panel();
  const B = base.parameters[0]!;
  const withList = (parameter: Partial<typeof B>) => panel({ parameters: [{ ...B, ...parameter }, base.parameters[1]!] });
  assert.deepEqual(codes(withList({ range: undefined, values: [500, 1000], default: 1000, display: 'list', valueLabels: ['Halb', 'Voll'] })), []);
  assert.deepEqual(codes(withList({ range: undefined, values: [500, 1000], default: 1000, valueLabels: ['Halb'] })), ['error:parameter-domain']);
  assert.deepEqual(codes(withList({ display: 'list' })), ['error:parameter-domain']);
  assert.deepEqual(codes(withList({ display: 'readonly' })), []);
  assert.equal(parameterDisplay(B), 'input');
  assert.equal(parameterDisplay({ type: 'toggle' }), 'list');
  assert.equal(parameterDisplay({ type: 'length', values: [1, 2] }), 'list');
  assert.equal(parameterDisplay({ ...B, display: 'hidden' }), 'hidden');
  const text = JSON.stringify(partLibraryJsonSchema());
  for (const word of ['fabric', 'tube', 'round', 'displayOnly', 'valueLabels', 'display', 'hemMm', 'finishFit', 'readonly', 'hidden']) {
    assert.ok(text.includes(`"${word}"`), `the schema names "${word}"`);
  }
});
