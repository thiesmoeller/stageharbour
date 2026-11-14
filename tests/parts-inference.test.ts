import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartContext, type PartDefinition } from '../src/shared/parts/definition.js';
import {
  AXIS_COLORS, angleAbout, axisOf, inferenceCandidates, snapAlongAxis, snapAngle, snapPoint, type Ray,
} from '../src/shared/parts/inference.js';
import { normalize, sub, type Vec3 } from '../src/shared/parts/math.js';
import { resolvePart } from '../src/shared/parts/resolve.js';
import { STARTER_MATERIALS } from '../src/shared/parts/starter/index.js';
import { fixtureId } from './helpers/partsFixtures.js';

const CONTEXT = createPartContext({ materials: STARTER_MATERIALS });
const BOXES: PartDefinition = {
  id: fixtureId(710), revision: 1, name: 'Zwei Kisten', category: 'Test', parameters: [], traits: { stock: 'none' },
  bodies: [
    { kind: 'box', key: 'a', material: 'holz-koerper', size: [400, 300, 200], at: [0, 150, 0] },
    { kind: 'box', key: 'b', material: 'holz-koerper', size: [100, 500, 100], at: [600, 250, 0] },
    { kind: 'sheet', key: 'p', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 500], outline: { shape: 'polygon', points: [[0, 0], [300, 0], [0, 300]] } },
  ],
};
const resolved = resolvePart(BOXES, {}, CONTEXT);
const candidates = inferenceCandidates(resolved);
const EYE: Vec3 = { x: 1500, y: 2500, z: -3000 };
const rayTo = (target: Vec3, from = EYE): Ray => ({ origin: from, direction: normalize(sub(target, from)) });

test('candidates: every corner, every edge with its midpoint, and the origin', () => {
  // Two boxes: 8 corners and 12 edges each; the triangle sheet: 6 corners and 9 edges.
  assert.equal(candidates.points.filter(point => point.kind === 'endpoint').length, 8 + 8 + 6);
  assert.equal(candidates.edges.length, 12 + 12 + 9);
  assert.equal(candidates.points.filter(point => point.kind === 'midpoint').length, candidates.edges.length);
  assert.deepEqual(candidates.points.filter(point => point.kind === 'origin').map(point => point.point), [{ x: 0, y: 0, z: 0 }]);
  assert.equal(inferenceCandidates(resolved, new Set(['a'])).points.filter(point => point.solid === 'a').length, 0, 'a dragged solid is left out');
});

test('the pointer near a corner snaps to it as Endpunkt, near the middle of an edge as Mittelpunkt', () => {
  const corner = { x: 200, y: 300, z: -100 };
  const snap = snapPoint({ candidates, ray: rayTo({ x: 203, y: 302, z: -100 }), tolerance: 10 });
  assert.deepEqual(snap && { point: snap.point, label: snap.label, solid: snap.solid }, { point: corner, label: 'Endpunkt', solid: 'a' });
  const middle = snapPoint({ candidates, ray: rayTo({ x: 2, y: 300, z: -100 }), tolerance: 10 });
  assert.deepEqual(middle && { point: middle.point, label: middle.label }, { point: { x: 0, y: 300, z: -100 }, label: 'Mittelpunkt' });
});

test('along an edge the point lands on the edge, on the 1 mm grid', () => {
  const snap = snapPoint({ candidates, ray: rayTo({ x: 77.3, y: 300.4, z: -100 }), tolerance: 5 });
  assert.equal(snap?.label, 'Auf Kante');
  assert.deepEqual(snap?.point, { x: 77, y: 300, z: -100 });
});

test('on a face the point stays in the face plane, on the grid', () => {
  const ray = rayTo({ x: 50.4, y: 300, z: 20.6 });
  const snap = snapPoint({ candidates, ray, hit: { point: { x: 50.4, y: 300, z: 20.6 }, normal: { x: 0, y: 1, z: 0 }, solid: 'a' }, tolerance: 5 });
  assert.deepEqual(snap && { point: snap.point, label: snap.label, solid: snap.solid }, { point: { x: 50, y: 300, z: 21 }, label: 'Auf Fläche', solid: 'a' });
});

test('without a hit the point lies on the floor grid; Alt keeps the exact pointer point', () => {
  const target = { x: -1234.56, y: 0, z: 987.65 };
  const snap = snapPoint({ candidates, ray: rayTo(target), tolerance: 5 });
  assert.equal(snap?.kind, 'grid');
  assert.deepEqual(snap?.point, { x: -1235, y: 0, z: 988 });
  const free = snapPoint({ candidates, ray: rayTo(target), tolerance: 5, bypass: true });
  assert.equal(free?.kind, 'free');
  assert.ok(Math.abs(free!.point.x - target.x) < 1e-6 && Math.abs(free!.point.z - target.z) < 1e-6);
  const nearCorner = snapPoint({ candidates, ray: rayTo({ x: 201, y: 300, z: -100 }), tolerance: 10, bypass: true });
  assert.notEqual(nearCorner?.kind, 'endpoint', 'Alt also ignores corners');
});

test('from a start point the pointer locks onto an axis, coloured like SketchUp', () => {
  const from = { x: -1000, y: 0, z: -1000 };
  const snap = snapPoint({ candidates, ray: rayTo({ x: -400.3, y: 0, z: -998 }), from, tolerance: 5 });
  assert.equal(snap?.kind, 'axis');
  assert.equal(snap?.axis, 'x');
  assert.equal(snap?.label, 'Auf roter Achse');
  assert.deepEqual(snap?.point, { x: -400, y: 0, z: -1000 });
  assert.equal(AXIS_COLORS.x, '#d6322f');
  const up = snapPoint({ candidates, ray: rayTo({ x: -1000, y: 700.2, z: -1000 }), from, tolerance: 5 });
  assert.deepEqual(up && [up.axis, up.label, up.point], ['y', 'Auf grüner Achse', { x: -1000, y: 700, z: -1000 }]);
  assert.equal(AXIS_COLORS.y, '#2f9e44');
});

test('a drag along an axis goes flush with a corner under the pointer or a parallel face, else the grid', () => {
  const origin = { x: 0, y: 300, z: 0 };
  const up = { x: 0, y: 1, z: 0 };
  const corner = snapAlongAxis({ candidates, origin, axis: up, freeDelta: 190, ray: rayTo({ x: 650, y: 501, z: -50 }), tolerance: 10 });
  assert.deepEqual(corner.delta, 200, 'flush with the top of the other box');
  assert.equal(corner.snap?.label, 'Endpunkt');
  const face = snapAlongAxis({
    candidates, origin, axis: up, freeDelta: 40, ray: rayTo({ x: 5000, y: 340, z: 5000 }),
    hit: { point: { x: 5000, y: 345, z: 5000 }, normal: { x: 0, y: -1, z: 0 } }, tolerance: 10,
  });
  assert.equal(face.delta, 45);
  assert.equal(face.snap?.kind, 'face');
  const across = snapAlongAxis({
    candidates, origin, axis: up, freeDelta: 40.4, ray: rayTo({ x: 5000, y: 340, z: 5000 }),
    hit: { point: { x: 5000, y: 345, z: 5000 }, normal: { x: 1, y: 0, z: 0 } }, tolerance: 10,
  });
  assert.deepEqual(across, { delta: 40 }, 'a side face across the drag is no inference');
  assert.deepEqual(snapAlongAxis({ candidates, origin, axis: up, freeDelta: 190.37, ray: rayTo({ x: 650, y: 501, z: -50 }), tolerance: 10, bypass: true }), { delta: 190.37 });
});

test('angles pull to 15° notches, else whole degrees; axisOf and angleAbout', () => {
  assert.equal(snapAngle(44), 45);
  assert.equal(snapAngle(38.6), 39);
  assert.equal(snapAngle(-1.9), 0);
  assert.equal(snapAngle(38.6, true), 38.6);
  assert.equal(axisOf({ x: 0, y: -2, z: 0 }), 'y');
  assert.equal(axisOf({ x: 1, y: 1, z: 0 }), undefined);
  assert.ok(Math.abs(angleAbout({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }) - 90) < 1e-9);
});
