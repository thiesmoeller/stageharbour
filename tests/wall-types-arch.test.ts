import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  isArchOpening, migrateLegacyArchWallType, openingOutlinePoints, openingSpringHeight, pointInOpening,
  typesOf, wallTypeSchema,
} from '../src/shared/wall-types.js';
import { EXAMPLE_ARCH_OPENING, GROUP_WALL_TYPE_NAMES } from '../src/shared/inventory.js';

test('Roman arch spring height is clear height minus half the opening width', () => {
  assert.equal(openingSpringHeight(EXAMPLE_ARCH_OPENING), 1600);
  assert.equal(isArchOpening(EXAMPLE_ARCH_OPENING), true);
  assert.equal(isArchOpening({ ...EXAMPLE_ARCH_OPENING, profile: 'rectangle' }), false);
  assert.equal(isArchOpening({ ...EXAMPLE_ARCH_OPENING, height: 300 }), false);
});

test('arch outline keeps straight jambs and a semicircular crown', () => {
  const points = openingOutlinePoints(EXAMPLE_ARCH_OPENING, 8);
  assert.deepEqual(points[0], { x: 200, y: 0 });
  assert.deepEqual(points[1], { x: 1000, y: 0 });
  assert.deepEqual(points[2], { x: 1000, y: 1600 });
  assert.deepEqual(points[points.length - 1], { x: 200, y: 1600 });
  const crown = points.reduce((best, point) => point.y > best.y ? point : best, points[0]!);
  assert.equal(crown.x, 600);
  assert.equal(crown.y, 2000);
});

test('pointInOpening treats corners above the spring line outside the semicircle as solid', () => {
  assert.equal(pointInOpening(EXAMPLE_ARCH_OPENING, 600, 1000), true);
  assert.equal(pointInOpening(EXAMPLE_ARCH_OPENING, 600, 1990), true);
  assert.equal(pointInOpening(EXAMPLE_ARCH_OPENING, 210, 1990), false);
  assert.equal(pointInOpening(EXAMPLE_ARCH_OPENING, 990, 1990), false);
});

test('wall type schema accepts arch openings that fit the panel and rejects short crowns', () => {
  const ok = wallTypeSchema.safeParse({
    id: randomUUID(), name: 'Bogen', width: 1200, height: 2400, thickness: 250,
    openings: [{ id: randomUUID(), ...EXAMPLE_ARCH_OPENING }],
  });
  assert.equal(ok.success, true);
  const short = wallTypeSchema.safeParse({
    id: randomUUID(), name: 'Bogen', width: 1200, height: 2400, thickness: 250,
    openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 300, profile: 'arch' }],
  });
  assert.equal(short.success, false);
});

test('legacy rectangular Bogen openings upgrade to a Roman-arch profile on parse', () => {
  const openingId = randomUUID();
  const parsed = wallTypeSchema.parse({
    id: randomUUID(), name: GROUP_WALL_TYPE_NAMES.arch, width: 1200, height: 2400, thickness: 250,
    openings: [{ id: openingId, left: 200, sill: 0, width: 800, height: 2000 }],
  });
  assert.deepEqual(parsed.openings[0], { id: openingId, left: 200, sill: 0, width: 800, height: 2000, profile: 'arch' });
});

test('stock-sized arch panels without the Bogen name also upgrade the stand-in opening', () => {
  const upgraded = migrateLegacyArchWallType({
    id: randomUUID(), name: 'Bogenwand Alt', width: 1200, height: 2400, thickness: 250,
    openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000 }],
  });
  assert.equal(upgraded.openings[0]?.profile, 'arch');
});

test('door openings with the same clear size stay rectangular', () => {
  const parsed = wallTypeSchema.parse({
    id: randomUUID(), name: 'Türwand · Scharnier links', width: 1200, height: 2400, thickness: 28,
    openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000, hinge: 'left' as const }],
  });
  assert.equal(parsed.openings[0]?.profile, undefined);
  assert.equal(parsed.openings[0]?.hinge, 'left');
});

test('typesOf upgrades legacy Bogen wall types so resolveWall sees the arch', () => {
  const types = typesOf({
    wallTypes: [{
      id: randomUUID(), name: GROUP_WALL_TYPE_NAMES.arch, width: 1200, height: 2400, thickness: 250,
      openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000 }],
    }],
  });
  assert.equal(types[0]?.openings[0]?.profile, 'arch');
});
