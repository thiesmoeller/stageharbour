import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newPlatform, orientedPlatformBox, platformSchema, platformSurfaceFinish } from '../src/shared/levels.js';
import {
  STAGE_DECK_LEG_EDGE_INSET_MM, STAGE_DECK_LEG_SECTION_MM, STAGE_DECK_MODULES_MM,
  clipPlatformToStageDeck, layoutStageDeckModules,
  snapStageDeckElevation, snapStageDeckResizeDelta, snapStageDeckSize, stageDeckLegPositions,
} from '../src/shared/stageDeck.js';

test('Bühnenelement catalog includes the common BE-1 plan sizes', () => {
  assert.deepEqual(STAGE_DECK_MODULES_MM.map(module => [module.width, module.depth]), [
    [2000, 1000], [2000, 500], [1000, 1000], [1000, 500],
  ]);
});

test('snapStageDeckSize rounds to the nearest 0.5 m module grid', () => {
  assert.deepEqual(snapStageDeckSize(4100, 2300), { width: 4000, depth: 2500 });
  assert.deepEqual(snapStageDeckSize(100, 100), { width: 500, depth: 500 });
  assert.deepEqual(snapStageDeckSize(2000, 1000), { width: 2000, depth: 1000 });
});

test('snapStageDeckElevation picks the nearest common leg height', () => {
  assert.equal(snapStageDeckElevation(380), 400);
  assert.equal(snapStageDeckElevation(50), 200);
  assert.equal(snapStageDeckElevation(1100), 1000);
});

test('layoutStageDeckModules tiles a 4×2 m podium with 2×1 m decks', () => {
  const modules = layoutStageDeckModules(4000, 2000);
  assert.equal(modules.length, 4);
  assert.equal(modules.reduce((area, module) => area + module.width * module.depth, 0), 4000 * 2000);
  assert.ok(modules.every(module =>
    STAGE_DECK_MODULES_MM.some(catalog =>
      (catalog.width === module.width && catalog.depth === module.depth)
      || (catalog.width === module.depth && catalog.depth === module.width))));
  assert.ok(modules.every(module => module.width === 2000 && module.depth === 1000));
});

test('layoutStageDeckModules grain 90° lays 2 m modules along depth', () => {
  const modules = layoutStageDeckModules(4000, 2000, 90);
  assert.equal(modules.length, 4);
  assert.equal(modules.reduce((area, module) => area + module.width * module.depth, 0), 4000 * 2000);
  assert.ok(modules.every(module => module.width === 1000 && module.depth === 2000));
});

test('snapStageDeckResizeDelta covers the pointed size on the 0,5 m grid', () => {
  assert.equal(snapStageDeckResizeDelta(2000, 100), 500);
  assert.equal(snapStageDeckResizeDelta(2000, 500), 500);
  assert.equal(snapStageDeckResizeDelta(2000, 0), 0);
  assert.equal(snapStageDeckResizeDelta(2000, -100), -500);
});

test('clipPlatformToStageDeck snaps size and elevation and sets stageDeck style', () => {
  const platform = clipPlatformToStageDeck({
    ...newPlatform(randomUUID(), 4000, 3000),
    elevation: 350,
  });
  assert.equal(platform.style, 'stageDeck');
  assert.equal(platform.elevation, 400);
  const legs = stageDeckLegPositions(4000, 2500);
  assert.ok(legs.length >= 4);
});

test('clipPlatformToStageDeck keeps oriented size after rotation', () => {
  const rotated = {
    ...newPlatform(randomUUID(), 4000, 3000),
    style: 'stageDeck' as const,
    elevation: 400,
    outline: [
      { x: 4000, y: 2000 }, { x: 4000, y: 4000 }, { x: 3000, y: 4000 }, { x: 3000, y: 2000 },
    ],
  };
  // 90°: width along +Y (2000), depth along -X (1000)
  const clipped = clipPlatformToStageDeck(rotated);
  const box = orientedPlatformBox(clipped.outline);
  assert.equal(Math.round(box.width), 2000);
  assert.equal(Math.round(box.depth), 1000);
  assert.equal(layoutStageDeckModules(box.width, box.depth).length, 1);
});

test('orientedPlatformBox reports edge lengths, not the axis-aligned bounding box', () => {
  const outline = [
    { x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 },
  ];
  const rotated = outline.map(point => {
    const cx = 1000, cy = 500, angle = Math.PI / 4;
    const dx = point.x - cx, dy = point.y - cy;
    return {
      x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
    };
  });
  const box = orientedPlatformBox(rotated);
  assert.ok(Math.abs(box.width - 2000) < 1);
  assert.ok(Math.abs(box.depth - 1000) < 1);
  assert.ok(Math.abs(Math.abs(box.rotation) - 45) < 0.1);
});

test('each module keeps four feet inset under the panel', () => {
  assert.equal(stageDeckLegPositions(2000, 1000).length, 4);
  assert.equal(stageDeckLegPositions(4000, 1000).length, 8);
  const inset = STAGE_DECK_LEG_EDGE_INSET_MM + STAGE_DECK_LEG_SECTION_MM / 2;
  const legs = stageDeckLegPositions(2000, 1000);
  const xs = legs.map(leg => Math.abs(leg.x));
  const ys = legs.map(leg => Math.abs(leg.y));
  assert.ok(xs.every(x => x === 1000 - inset));
  assert.ok(ys.every(y => y === 500 - inset));
});

test('podium top and side finishes persist scale and grain independently', () => {
  const parsed = platformSchema.parse({
    ...newPlatform(randomUUID(), 4000, 3000),
    style: 'solid',
    surfaces: {
      top: { kind: 'library', ref: 'library:wood-finewood27', scaleMm: 800, rotationDeg: 90 },
      sides: { kind: 'paint', ral: '9010' },
    },
  });
  assert.deepEqual(platformSurfaceFinish(parsed, 'top'), {
    kind: 'library', ref: 'library:wood-finewood27', scaleMm: 800, rotationDeg: 90,
  });
  assert.deepEqual(platformSurfaceFinish(parsed, 'sides'), { kind: 'paint', ral: '9010' });
});

test('legacy podium finish remains effective on top and sides', () => {
  const platform = { ...newPlatform(randomUUID(), 0, 0), finish: 'library:wood-finewood27' };
  assert.deepEqual(platformSurfaceFinish(platform, 'top'), { kind: 'library', ref: platform.finish });
  assert.deepEqual(platformSurfaceFinish(platform, 'sides'), { kind: 'library', ref: platform.finish });
});
