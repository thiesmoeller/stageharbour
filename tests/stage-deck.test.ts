import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newPlatform } from '../src/shared/levels.js';
import {
  STAGE_DECK_LEG_EDGE_INSET_MM, STAGE_DECK_LEG_SECTION_MM, STAGE_DECK_MODULES_MM,
  clipPlatformToStageDeck, layoutStageDeckModules,
  snapStageDeckElevation, snapStageDeckSize, stageDeckLegPositions,
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
