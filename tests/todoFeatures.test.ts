import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { clampCurtainDrop, curtainContactElevation, curtainHangTop, newCurtain } from '../src/shared/curtains.js';
import { mixedPropertyValue, MIXED_PROPERTY } from '../src/shared/editing.js';
import { newPlatform } from '../src/shared/levels.js';
import { measureLineCaption, measureLineLength, newMeasureLine } from '../src/shared/measurements.js';
import { parseRalCode, ralHex, RAL_PAINT_SWATCHES } from '../src/shared/ral.js';

test('mixedPropertyValue mirrors mixed, shared and empty inspector values', () => {
  assert.equal(mixedPropertyValue([]), '');
  assert.equal(mixedPropertyValue([undefined, undefined]), '');
  assert.equal(mixedPropertyValue(['library:a', 'library:a']), 'library:a');
  assert.equal(mixedPropertyValue(['library:a', 'library:b']), MIXED_PROPERTY);
});

test('molton drop clamps to podium contact and overhead hang', () => {
  const platform = newPlatform(randomUUID(), 4000, 3000);
  platform.elevation = 800;
  platform.outline = [
    { x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 },
  ];
  const curtain = newCurtain(randomUUID(), 4000, 3000, { length: 6000, height: 4500 });
  assert.equal(curtainContactElevation(curtain, [platform]), 800);
  assert.equal(curtainHangTop(curtain, { ceilingHeight: 4000, platforms: [platform] }), 4000);
  assert.deepEqual(
    Object.fromEntries(Object.entries(clampCurtainDrop(curtain, { ceilingHeight: 4000, platforms: [platform] }))
      .filter(([key]) => key === 'bottomClearance' || key === 'height')),
    { height: 3200, bottomClearance: 800 },
  );

  const underTruss = clampCurtainDrop(curtain, {
    ceilingHeight: 6000,
    trusses: [{ x: 4000, y: 3000, length: 5000, sectionWidth: 400, bottomHeight: 3500, rotation: 0 }],
  });
  assert.equal(underTruss.height, 3500);
});

test('RAL swatches and measure-line captions keep their UI contracts', () => {
  assert.ok(RAL_PAINT_SWATCHES.length >= 8);
  assert.equal(parseRalCode('RAL 9010'), '9010');
  assert.equal(parseRalCode('nope'), undefined);
  assert.equal(ralHex('9010')?.startsWith('#'), true);
  const line = newMeasureLine(randomUUID(), { x: 0, y: 0 }, { x: 3000, y: 0 });
  assert.equal(measureLineLength(line), 3000);
  assert.equal(measureLineCaption(line), '3000 mm');
  assert.equal(measureLineCaption({ ...line, label: 'Portalbreite' }), 'Portalbreite');
});
