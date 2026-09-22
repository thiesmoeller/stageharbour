import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newWall, type Layout } from '../src/shared/layout.js';
import { newPlatform } from '../src/shared/levels.js';
import {
  MIXED_PROPERTY, applyPlatformFinish, applyWallFinish, applyWallRal, mixedPropertyValue, memberIdsByKind,
} from '../src/shared/editing.js';
import {
  clampCurtainDrop, curtainContactElevation, curtainHangTop, newCurtain,
} from '../src/shared/curtains.js';
import { EXAMPLE_CEILING_HEIGHT } from '../src/shared/overhead.js';
import { parseRalCode, ralHex, RAL_PAINT_SWATCHES } from '../src/shared/ral.js';
import { measureLineCaption, measureLineLength, newMeasureLine } from '../src/shared/measurements.js';
import { newWallPicture } from '../src/shared/wallPictures.js';
import { newReportTemplate, rotateReportFrame } from '../src/shared/reportTemplate.js';
import { planReportExtent } from '../src/shared/planReportExtent.js';
import { newPlaceholder } from '../src/shared/placeholders.js';
import { layoutSchema } from '../src/shared/layout.js';

test('mixedPropertyValue mirrors Figma mixed / shared / empty semantics', () => {
  assert.equal(mixedPropertyValue([]), '');
  assert.equal(mixedPropertyValue([undefined, undefined]), '');
  assert.equal(mixedPropertyValue(['library:a', 'library:a']), 'library:a');
  assert.equal(mixedPropertyValue(['library:a', 'library:b']), MIXED_PROPERTY);
  assert.equal(mixedPropertyValue(['library:a', undefined]), MIXED_PROPERTY);
});

test('applyPlatformFinish paints every selected podium like walls', () => {
  const a = newPlatform(randomUUID(), 1000, 1000);
  const b = { ...newPlatform(randomUUID(), 4000, 1000), finish: 'library:color-white' as const };
  const layout: Layout = { schemaVersion: 1, walls: [], braces: [], platforms: [a, b] };
  const painted = applyPlatformFinish(layout, [a.id, b.id], 'library:color-black');
  assert.equal(painted.platforms?.find(item => item.id === a.id)?.finish, 'library:color-black');
  assert.equal(painted.platforms?.find(item => item.id === b.id)?.finish, 'library:color-black');
  const cleared = applyPlatformFinish(painted, [a.id], undefined);
  assert.equal('finish' in (cleared.platforms?.find(item => item.id === a.id) ?? {}), false);
});

test('applyWallRal sets front and back paint on every selected wall', () => {
  const left = newWall(randomUUID(), 1000, 2000);
  const right = newWall(randomUUID(), 4000, 2000);
  const layout: Layout = { schemaVersion: 1, walls: [left, right], braces: [] };
  const painted = applyWallRal(layout, [left.id, right.id], { frontRal: '7016', backRal: '9010' });
  assert.equal(painted.walls[0]!.frontRal, '7016');
  assert.equal(painted.walls[1]!.backRal, '9010');
  const cleared = applyWallRal(painted, [left.id], { frontRal: undefined });
  assert.equal('frontRal' in (cleared.walls.find(wall => wall.id === left.id) ?? {}), false);
});

test('memberIdsByKind extracts multi-select targets', () => {
  const ids = memberIdsByKind([
    { kind: 'wall', id: 'a' }, { kind: 'platform', id: 'b' }, { kind: 'wall', id: 'c' },
  ], 'wall');
  assert.deepEqual(ids, ['a', 'c']);
});

test('molton drop clamps to podium contact and ceiling hang', () => {
  const platform = newPlatform(randomUUID(), 4000, 3000);
  platform.elevation = 800;
  // Enlarge outline so the curtain track over the centre hits the podium.
  platform.outline = [
    { x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 },
  ];
  const curtain = newCurtain(randomUUID(), 4000, 3000, { length: 6000, height: 4500 });
  assert.equal(curtainContactElevation(curtain, [platform]), 800);
  const venue = { ceilingHeight: EXAMPLE_CEILING_HEIGHT, platforms: [platform] };
  assert.equal(curtainHangTop(curtain, venue), EXAMPLE_CEILING_HEIGHT);
  const clamped = clampCurtainDrop(curtain, venue);
  assert.equal(clamped.bottomClearance, 800);
  assert.equal(clamped.height, EXAMPLE_CEILING_HEIGHT - 800);
});

test('molton hang prefers overlapping truss underside over ceiling', () => {
  const curtain = newCurtain(randomUUID(), 4000, 3000, { length: 4000, height: 5000 });
  const venue = {
    ceilingHeight: 6000,
    trusses: [{ x: 4000, y: 3000, length: 5000, sectionWidth: 400, bottomHeight: 3500, rotation: 0 }],
  };
  assert.equal(curtainHangTop(curtain, venue), 3500);
  const clamped = clampCurtainDrop(curtain, venue);
  assert.equal(clamped.height, 3500);
});

test('RAL swatches resolve hex and reject junk codes', () => {
  assert.ok(RAL_PAINT_SWATCHES.length >= 8);
  assert.equal(parseRalCode('RAL 9010'), '9010');
  assert.equal(parseRalCode('nope'), undefined);
  assert.equal(ralHex('9010')?.startsWith('#'), true);
});

test('measure lines report length captions', () => {
  const line = newMeasureLine(randomUUID(), { x: 0, y: 0 }, { x: 3000, y: 0 });
  assert.equal(measureLineLength(line), 3000);
  assert.equal(measureLineCaption(line), '3000 mm');
  assert.equal(measureLineCaption({ ...line, label: 'Portalbreite' }), 'Portalbreite');
});

test('layout accepts measure lines, wall pictures, report templates and RAL', () => {
  const wall = newWall(randomUUID(), 2000, 2000);
  const picture = newWallPicture(randomUUID(), wall.id, randomUUID());
  const line = newMeasureLine(randomUUID(), { x: 0, y: 0 }, { x: 1000, y: 0 });
  const template = newReportTemplate(randomUUID());
  const rotated = rotateReportFrame(template.pages[0]!.frames[0]!);
  assert.equal(rotated.rotation, 90);
  const layout = layoutSchema.parse({
    schemaVersion: 1,
    walls: [{ ...wall, frontRal: '7016', backRal: '9010', assemblyNumber: 1 }],
    braces: [],
    measureLines: [line],
    wallPictures: [picture],
    reportTemplates: [template],
  });
  assert.equal(layout.walls[0]!.frontRal, '7016');
  assert.equal(layout.measureLines?.length, 1);
  assert.equal(layout.wallPictures?.[0]!.note, 'Auf Angelschnur');
  assert.equal(layout.reportTemplates?.[0]!.pages[0]!.frames[0]!.kind, 'plan');
  assert.equal(layout.reportTemplates?.[0]!.pages[0]!.frames[0]!.planScope, 'scenery');
});

test('construction plan extent fits scenery and ignores audience chairs', () => {
  const wall = newWall(randomUUID(), 4000, 4500);
  const chair = newPlaceholder('chair', randomUUID(), 2000, 800);
  const venue = {
    schemaVersion: 1 as const,
    width: 12000,
    depth: 9000,
    placeholders: [chair],
  };
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [] };
  const scenery = planReportExtent(venue, layout, 'scenery', 0);
  assert.ok(scenery.maxX - scenery.minX < 3000, 'scenery crop is tighter than the full hall');
  assert.ok(scenery.minY > 2000, 'audience chairs below the set are outside the crop');
  const full = planReportExtent(venue, layout, 'venue', 0);
  assert.equal(full.minX, 0);
  assert.equal(full.maxX, 12000);
  assert.equal(full.minY, 0);
  assert.equal(full.maxY, 9000);
});

test('applyWallFinish still bulk-paints walls', () => {
  const a = newWall(randomUUID(), 1000, 1000);
  const b = newWall(randomUUID(), 3000, 1000);
  const layout: Layout = { schemaVersion: 1, walls: [a, b], braces: [] };
  assert.equal(applyWallFinish(layout, [a.id, b.id], 'library:color-black').walls[1]!.finish, 'library:color-black');
});
