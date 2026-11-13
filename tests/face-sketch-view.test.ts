import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_CONTEXT, STARTER_TABLE, STARTER_WALL } from '../src/shared/parts/starter/index.js';
import { resolvePartConfiguration, type ResolvedSheet } from '../src/shared/parts/resolve.js';
import { validateDefinition } from '../src/shared/parts/validate.js';
import {
  boxFromDrag, boxLoop, clampBoxInside, cleanPolygon, clipBox, deleteOpening, describeBox, handlePoint, isUsableBox,
  moveBox, movePoints, newOpeningKey, resizeBox, sketchOpenings, sketchViewBox, snap, toSvg, fromSvg, writeOpening,
} from '../src/client/designer/faceSketchView.js';

const resolveWall = (definition = STARTER_WALL, variant = 'plain') =>
  resolvePartConfiguration(definition, { variant }, STARTER_CONTEXT);
const wallSheet = (definition = STARTER_WALL, variant = 'plain') =>
  resolveWall(definition, variant).solids.find((solid): solid is ResolvedSheet => solid.kind === 'sheet' && solid.body === 'platte')!;

test('dragging snaps to the grid, orders the corners and keeps arches tall enough', () => {
  assert.equal(snap(14), 10);
  assert.equal(snap(15), 20);
  assert.deepEqual(boxFromDrag('rect', { x: 303, y: 912 }, { x: 98, y: 407 }), { x: 100, y: 410, width: 200, height: 500 });
  assert.deepEqual(boxFromDrag('arch', { x: 0, y: 0 }, { x: 400, y: 100 }), { x: 0, y: 0, width: 400, height: 200 });
  assert.equal(isUsableBox({ x: 0, y: 0, width: 10, height: 500 }), false);
  assert.equal(isUsableBox({ x: 0, y: 0, width: 300, height: 500 }), true);
});

test('moving and resizing keep the opposite edges, never invert and clamp into the sheet', () => {
  const box = { x: 100, y: 200, width: 300, height: 400 };
  assert.deepEqual(resizeBox(box, 'e', { x: 700, y: 0 }, 'rect'), { x: 100, y: 200, width: 600, height: 400 });
  assert.deepEqual(resizeBox(box, 'sw', { x: 50, y: 100 }, 'rect'), { x: 50, y: 100, width: 350, height: 500 });
  assert.deepEqual(resizeBox(box, 'w', { x: 900, y: 0 }, 'rect'), { x: 390, y: 200, width: 10, height: 400 });
  assert.equal(resizeBox(box, 'n', { x: 0, y: 0 }, 'rect').height, 10);
  const arch = resizeBox({ x: 0, y: 0, width: 200, height: 400 }, 'e', { x: 1000, y: 0 }, 'arch');
  assert.deepEqual(arch, { x: 0, y: 0, width: 1000, height: 500 });
  const limit = { x: 0, y: 0, width: 1000, height: 2000 };
  assert.deepEqual(clampBoxInside(moveBox(box, 2000, -900), limit), { x: 700, y: 0, width: 300, height: 400 });
  assert.deepEqual(clipBox({ x: -50, y: 1900, width: 200, height: 400 }, limit), { x: 0, y: 1900, width: 150, height: 100 });
  assert.deepEqual(handlePoint(box, 'ne'), { x: 400, y: 600 });
  assert.deepEqual(handlePoint(box, 's'), { x: 250, y: 200 });
  assert.deepEqual(movePoints([{ x: 0, y: 0 }, { x: 5, y: 5 }], 14, 26), [{ x: 10, y: 30 }, { x: 15, y: 35 }]);
});

test('arch loops use straight jambs and a half-circle crown', () => {
  const loop = boxLoop('arch', { x: 0, y: 0, width: 400, height: 800 }, 8);
  assert.deepEqual(loop[0], { x: 0, y: 0 });
  assert.deepEqual(loop[1], { x: 400, y: 0 });
  const top = Math.max(...loop.map(point => point.y));
  assert.ok(Math.abs(top - 800) < 1e-9);
  assert.equal(boxLoop('rect', { x: 1, y: 2, width: 3, height: 4 }).length, 4);
  assert.deepEqual(fromSvg(toSvg({ x: 3, y: 4 })), { x: 3, y: 4 });
});

test('the sketch reads outline and holes from the resolved sheet solid', () => {
  const plain = wallSheet();
  assert.deepEqual(sketchOpenings(plain), []);
  const windowed = wallSheet(STARTER_WALL, 'window');
  const openings = sketchOpenings(windowed);
  assert.deepEqual(openings.map(opening => [opening.key, opening.shape]), [['fenster', 'rect']]);
  const view = sketchViewBox(windowed);
  assert.ok(view.width > windowed.blank.width && view.height > windowed.blank.height);
  // SVG is y-down, so the top of the sheet is the smallest y.
  assert.ok(view.y < -windowed.blank.height);
  assert.match(describeBox({ x: 200, y: 1, width: 800, height: 2000 }, { x: 0, y: 0 }), /Links 200 mm · Brüstung 1 mm · 800 mm × 2000 mm/);
});

test('drawn openings write hole formulas and a parameter group, and the wall resolves them', () => {
  const key = newOpeningKey(STARTER_WALL, 'platte');
  assert.equal(key, 'oeffnung');
  const drawn = writeOpening(STARTER_WALL, 'platte', key, { shape: 'rect', box: { x: -300, y: 900, width: 600, height: 800 } });
  const body = drawn.bodies.find(item => item.key === 'platte');
  assert.ok(body?.kind === 'sheet' && body.holes?.some(hole => hole.key === key));
  assert.ok(drawn.parameters.some(parameter => parameter.key === 'oeffnungLeft' && parameter.default === -300));
  assert.deepEqual(drawn.parameters.find(parameter => parameter.key === 'oeffnungLeft')?.range, { min: -300, max: -300 });
  const sheet = wallSheet(drawn);
  const opening = sketchOpenings(sheet).find(item => item.key === key)!;
  assert.deepEqual(opening.bounds, { x: -300, y: 900, width: 600, height: 800 });
  assert.equal(sheet.holes.length, 1);

  const second = newOpeningKey(drawn, 'platte');
  assert.equal(second, 'oeffnung-2');
  const polygon = writeOpening(drawn, 'platte', second, {
    shape: 'polygon', points: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 300 }],
  });
  assert.equal(wallSheet(polygon).openings.length, 2);

  const moved = writeOpening(polygon, 'platte', key, { shape: 'rect', box: { x: -200, y: 900, width: 600, height: 800 } });
  assert.equal(moved.parameters.filter(parameter => parameter.key === 'oeffnungLeft').length, 1);
  assert.equal(moved.parameters.find(parameter => parameter.key === 'oeffnungLeft')?.default, -200);

  const removed = deleteOpening(moved, 'platte', key);
  assert.equal(removed.parameters.some(parameter => parameter.key.startsWith('oeffnungLeft')), false);
  assert.equal(wallSheet(removed).openings.length, 1);
});

test('opening keys skip taken holes and taken parameter names', () => {
  const withClash = { ...STARTER_WALL, parameters: [...STARTER_WALL.parameters,
    { key: 'oeffnungLeft', label: 'x', type: 'length' as const, default: 0, scope: 'placement' as const }] };
  assert.equal(newOpeningKey(withClash, 'platte'), 'oeffnung-2');
});

test('polygon vertices snap and consecutive duplicates collapse', () => {
  assert.deepEqual(cleanPolygon([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 101, y: 4 }]), [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
});

test('a pocket in the middle of a table top passes the save check', () => {
  const drawn = writeOpening(STARTER_TABLE, 'platte', 'oeffnung', { shape: 'rect', box: { x: -120, y: -80, width: 240, height: 160 } });
  const check = validateDefinition(drawn, STARTER_CONTEXT);
  assert.deepEqual(check.issues.filter(issue => issue.severity === 'error'), []);
  assert.equal(check.ok, true);
});

test('known limit: a hole drawn on the plain Wandelement is also applied to the window variant', () => {
  const drawn = writeOpening(STARTER_WALL, 'platte', 'oeffnung', { shape: 'rect', box: { x: -120, y: 2100, width: 240, height: 200 } });
  const codes = validateDefinition(drawn, STARTER_CONTEXT).issues.filter(issue => issue.severity === 'error').map(issue => issue.code);
  assert.ok(codes.includes('hole-overlap') || codes.includes('hole-splits-sheet'));
});
