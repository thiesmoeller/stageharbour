import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { formGroup, groupPivot, transformGroup } from '../src/shared/groups.js';
import { keepClearWarnings } from '../src/shared/keepClear.js';
import { layoutSchema, newWall, type Layout } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID } from '../src/shared/levels.js';
import {
  EXAMPLE_BOX_DEPTH, EXAMPLE_BOX_HEIGHT, EXAMPLE_BOX_WIDTH,
  EXAMPLE_CHAIR_DEPTH, EXAMPLE_CHAIR_HEIGHT, EXAMPLE_CHAIR_WIDTH,
  EXAMPLE_PERSON_DEPTH, EXAMPLE_PERSON_HEIGHT, EXAMPLE_PERSON_WIDTH,
  EXAMPLE_SPEAKER_DEPTH, EXAMPLE_SPEAKER_HEIGHT, EXAMPLE_SPEAKER_WIDTH,
  EXAMPLE_TABLE_DEPTH, EXAMPLE_TABLE_HEIGHT, EXAMPLE_TABLE_WIDTH,
  PLACEHOLDER_EXAMPLE_NOTICE, newPlaceholder, placeholderCorners, placeholderSchema,
} from '../src/shared/placeholders.js';

test('each placeholder kind parses with a label, millimetre size, pose and supporting surface', () => {
  const kinds = [
    ['table', 'Tisch', EXAMPLE_TABLE_WIDTH, EXAMPLE_TABLE_DEPTH, EXAMPLE_TABLE_HEIGHT],
    ['chair', 'Stuhl', EXAMPLE_CHAIR_WIDTH, EXAMPLE_CHAIR_DEPTH, EXAMPLE_CHAIR_HEIGHT],
    ['person', 'Person', EXAMPLE_PERSON_WIDTH, EXAMPLE_PERSON_DEPTH, EXAMPLE_PERSON_HEIGHT],
    ['speaker', 'Lautsprecher', EXAMPLE_SPEAKER_WIDTH, EXAMPLE_SPEAKER_DEPTH, EXAMPLE_SPEAKER_HEIGHT],
    ['box', 'Kiste', EXAMPLE_BOX_WIDTH, EXAMPLE_BOX_DEPTH, EXAMPLE_BOX_HEIGHT],
  ] as const;
  for (const [kind, label, width, depth, height] of kinds) {
    const id = randomUUID();
    const parsed = placeholderSchema.parse({
      id, kind, label, x: 2000, y: 3000, rotation: 15, width, depth, height, supportingSurfaceId: AUDIENCE_FLOOR_ID,
    });
    assert.equal(parsed.kind, kind);
    assert.equal(parsed.label, label);
    assert.equal(parsed.width, width);
    assert.equal(parsed.depth, depth);
    assert.equal(parsed.height, height);
    assert.equal(parsed.x, 2000);
    assert.equal(parsed.y, 3000);
    assert.equal(parsed.rotation, 15);
    assert.equal(parsed.supportingSurfaceId, AUDIENCE_FLOOR_ID);
  }
  assert(!placeholderSchema.safeParse({
    id: randomUUID(), kind: 'lamp', label: 'Leuchte', x: 0, y: 0, rotation: 0, width: 100, depth: 100, height: 100,
  }).success);
  assert(!placeholderSchema.safeParse({
    id: randomUUID(), kind: 'table', label: 'Tisch', x: 0, y: 0, rotation: 0, width: 0, depth: 800, height: 750,
  }).success);
});

test('example placeholder millimetres are labelled defaults, not measured inventory', () => {
  assert.equal(PLACEHOLDER_EXAMPLE_NOTICE, 'Beispielmaße, keine gemessene Inventarvorgabe.');
  assert.equal(EXAMPLE_TABLE_WIDTH, 1200);
  assert.equal(EXAMPLE_TABLE_DEPTH, 800);
  assert.equal(EXAMPLE_TABLE_HEIGHT, 750);
  assert.equal(EXAMPLE_CHAIR_WIDTH, 450);
  assert.equal(EXAMPLE_CHAIR_DEPTH, 450);
  assert.equal(EXAMPLE_CHAIR_HEIGHT, 900);
  assert.equal(EXAMPLE_PERSON_WIDTH, 500);
  assert.equal(EXAMPLE_PERSON_DEPTH, 400);
  assert.equal(EXAMPLE_PERSON_HEIGHT, 1750);
  assert.equal(EXAMPLE_SPEAKER_WIDTH, 400);
  assert.equal(EXAMPLE_SPEAKER_DEPTH, 350);
  assert.equal(EXAMPLE_SPEAKER_HEIGHT, 600);
  assert.equal(EXAMPLE_BOX_WIDTH, 600);
  assert.equal(EXAMPLE_BOX_DEPTH, 600);
  assert.equal(EXAMPLE_BOX_HEIGHT, 600);
  const table = newPlaceholder('table', randomUUID(), 2000, 3000);
  assert.equal(table.label, 'Tisch');
  assert.equal(table.kind, 'table');
  assert.equal(table.width, 1200);
  assert.equal(table.depth, 800);
  assert.equal(table.height, 750);
  assert.equal(table.supportingSurfaceId, AUDIENCE_FLOOR_ID);
  assert.deepEqual(placeholderCorners(table)[0], { x: 1400, y: 2600 });
  assert.deepEqual(placeholderCorners(table)[2], { x: 2600, y: 3400 });
  const rotated = placeholderCorners({ ...table, rotation: 90 })[0]!;
  assert(Math.abs(rotated.x - 2400) < 1e-8);
  assert(Math.abs(rotated.y - 2400) < 1e-8);
  assert.equal(newPlaceholder('chair', randomUUID(), 0, 0).label, 'Stuhl');
  assert.equal(newPlaceholder('person', randomUUID(), 0, 0).label, 'Person');
  assert.equal(newPlaceholder('speaker', randomUUID(), 0, 0).label, 'Lautsprecher');
  assert.equal(newPlaceholder('box', randomUUID(), 0, 0).label, 'Kiste');
});

test('layouts without placeholders still parse; duplicate IDs and invalid millimetres are rejected', () => {
  const parsed = layoutSchema.parse({ schemaVersion: 1, walls: [] });
  assert.deepEqual(parsed.placeholders ?? [], []);
  const table = newPlaceholder('table', randomUUID(), 0, 0);
  const saved = layoutSchema.parse({ schemaVersion: 1, walls: [], placeholders: [table] });
  assert.deepEqual(saved.placeholders, [table]);
  assert(!layoutSchema.safeParse({ schemaVersion: 1, walls: [], placeholders: [table, table] }).success);
  assert(!layoutSchema.safeParse({ schemaVersion: 1, walls: [], placeholders: [{ ...table, height: 0 }] }).success);
});

test('a table overlapping a keep-clear zone is named in the warning', () => {
  const zone = {
    id: randomUUID(), label: 'Notausgang Ost', reason: 'Notausgang', supportingSurfaceId: AUDIENCE_FLOOR_ID,
    polygon: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 }],
  };
  const table = { ...newPlaceholder('table', randomUUID(), 1000, 500), label: 'Probetisch' };
  const warnings = keepClearWarnings({ keepClearZones: [zone] }, { walls: [], braces: [], placeholders: [table] });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.objectKind, 'placeholder');
  assert.equal(warnings[0]?.objectId, table.id);
  assert.match(warnings[0]?.message ?? '', /Notausgang Ost/);
  assert.match(warnings[0]?.message ?? '', /Probetisch/);
});

test('a placeholder joins an explicit wall group and transforms around the centroid', () => {
  const wall = newWall(randomUUID(), 0, 0);
  const table = newPlaceholder('table', randomUUID(), 2000, 0);
  const id = randomUUID();
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [], placeholders: [table] };
  const grouped = formGroup(layout, [
    { kind: 'wall', id: wall.id }, { kind: 'placeholder', id: table.id },
  ], id);
  assert.deepEqual(groupPivot(grouped, id), { x: 1000, y: 0 });
  const moved = transformGroup(grouped, id, { x: 1500, y: 400, rotation: 0 });
  assert.equal(moved.walls[0]?.x, 500);
  assert.equal(moved.walls[0]?.y, 400);
  assert.equal(moved.placeholders?.[0]?.x, 2500);
  assert.equal(moved.placeholders?.[0]?.y, 400);
  assert.deepEqual(groupPivot(moved, id), { x: 1500, y: 400 });
});
