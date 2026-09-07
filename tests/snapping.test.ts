import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { formGroup, transformGroup } from '../src/shared/groups.js';
import { freezeSnapshot } from '../src/shared/export.js';
import { layoutSchema, newWall, venueGeometrySchema, type Layout } from '../src/shared/layout.js';
import {
  COMMON_LAYOUT_ANGLES_DEG, SNAP_ANGLE_DEG, SNAP_DISTANCE_MM, SNAP_NOTICE, centrelineSchema,
  defaultCentreline, snapGroupPose, snapRotation, snapWallPose,
} from '../src/shared/snapping.js';

test('documented snap tolerances are millimetres and degrees, not screen pixels', () => {
  assert.equal(SNAP_DISTANCE_MM, 100);
  assert.equal(SNAP_ANGLE_DEG, 2.5);
  assert(COMMON_LAYOUT_ANGLES_DEG.includes(0));
  assert(COMMON_LAYOUT_ANGLES_DEG.includes(45));
  assert(COMMON_LAYOUT_ANGLES_DEG.includes(90));
  assert.match(SNAP_NOTICE, /100 mm/);
  assert.match(SNAP_NOTICE, /2,5/);
  assert.match(SNAP_NOTICE, /Spiegeln ist nicht vorgesehen/);
});

test('a wall edge within SNAP_DISTANCE_MM snaps onto another wall edge', () => {
  const stationary = newWall(randomUUID(), 0, 0);
  const moving = newWall(randomUUID(), 2000, 80);
  const snapped = snapWallPose(moving, [stationary], undefined);
  assert.equal(snapped.x, 2000);
  assert.equal(snapped.y, 28);
  assert.equal(snapped.rotation, 0);
  assert.equal(snapped.guides[0]?.kind, 'wall-edge');
});

test('a wall centre within SNAP_DISTANCE_MM snaps onto the venue centreline', () => {
  const centreline = centrelineSchema.parse({ x: 4000, y: 3000, rotation: 90 });
  const moving = newWall(randomUUID(), 4080, 3000);
  const snapped = snapWallPose(moving, [], centreline);
  assert.equal(snapped.x, 4000);
  assert.equal(snapped.y, 3000);
  assert.equal(snapped.guides[0]?.kind, 'centreline');
});

test('bypass leaves coordinates unsnapped', () => {
  const centreline = { x: 4000, y: 3000, rotation: 90 };
  const moving = newWall(randomUUID(), 4080, 3000);
  const snapped = snapWallPose(moving, [newWall(randomUUID(), 0, 0)], centreline, { bypass: true });
  assert.equal(snapped.x, 4080);
  assert.equal(snapped.y, 3000);
  assert.deepEqual(snapped.guides, []);
});

test('a rotated centreline still snaps in millimetres', () => {
  const centreline = { x: 0, y: 0, rotation: 45 };
  const moving = newWall(randomUUID(), 100, 0);
  const snapped = snapWallPose(moving, [], centreline);
  assert.equal(snapped.x, 50);
  assert.equal(snapped.y, 50);
});

test('rotating the venue outline does not change millimetre snap to a rotated centreline', () => {
  const outline = [{ x: 0, y: 0 }, { x: 5000, y: 2000 }, { x: 3000, y: 7000 }, { x: -500, y: 4000 }];
  const venue = venueGeometrySchema.parse({
    schemaVersion: 1, width: 8000, depth: 6000, outline, stageCentreline: { x: 0, y: 0, rotation: 45 },
  });
  const moving = newWall(randomUUID(), 100, 0);
  const snapped = snapWallPose(moving, [], venue.stageCentreline);
  assert.equal(snapped.x, 50);
  assert.equal(snapped.y, 50);
});

test('a group snaps as one pose and keeps relative millimetre offsets', () => {
  const left = newWall(randomUUID(), 0, 0);
  const right = newWall(randomUUID(), 2000, 0);
  const id = randomUUID();
  const layout: Layout = formGroup({ schemaVersion: 1, walls: [left, right], braces: [] }, [
    { kind: 'wall', id: left.id }, { kind: 'wall', id: right.id },
  ], id);
  const snapped = snapGroupPose(layout, id, { x: 1080, y: 0, rotation: 0 }, { x: 1100, y: 0, rotation: 90 });
  assert.equal(snapped.pose.x, 1100);
  assert.equal(snapped.pose.y, 0);
  const moved = transformGroup(layout, id, snapped.pose);
  const a = moved.walls.find(wall => wall.id === left.id)!;
  const b = moved.walls.find(wall => wall.id === right.id)!;
  assert.equal(a.x, 100);
  assert.equal(b.x, 2100);
  assert.equal(b.x - a.x, 2000);
  assert.equal(a.y, 0);
  assert.equal(b.y, 0);
});

test('grouped members are not exploded onto separate snap points', () => {
  const left = newWall(randomUUID(), 0, 80);
  const right = newWall(randomUUID(), 2000, 80);
  const stationary = newWall(randomUUID(), 0, 0);
  const id = randomUUID();
  const layout: Layout = formGroup({ schemaVersion: 1, walls: [left, right, stationary], braces: [] }, [
    { kind: 'wall', id: left.id }, { kind: 'wall', id: right.id },
  ], id);
  const snapped = snapGroupPose(layout, id, { x: 1000, y: 80, rotation: 0 }, undefined);
  const moved = transformGroup(layout, id, snapped.pose);
  const a = moved.walls.find(wall => wall.id === left.id)!;
  const b = moved.walls.find(wall => wall.id === right.id)!;
  assert.equal(a.y, 28);
  assert.equal(b.y, 28);
  assert.equal(b.x - a.x, 2000);
  assert.equal(moved.walls.find(wall => wall.id === stationary.id)?.y, 0);
});

test('optional common-angle snapping uses the documented degree tolerance', () => {
  assert.equal(snapRotation(44), 45);
  assert.equal(snapRotation(1), 0);
  assert.equal(snapRotation(40), 40);
  assert.equal(snapRotation(358), 0);
  const moving = { ...newWall(randomUUID(), 5000, 5000), rotation: 44 };
  assert.equal(snapWallPose(moving, [], undefined, { snapAngles: true }).rotation, 45);
  assert.equal(snapWallPose(moving, [], undefined).rotation, 44);
});

test('a centreline beyond SNAP_DISTANCE_MM does not pull the wall', () => {
  const moving = newWall(randomUUID(), 4201, 3000);
  const snapped = snapWallPose(moving, [], { x: 4000, y: 3000, rotation: 90 });
  assert.equal(snapped.x, 4201);
  assert.equal(snapped.y, 3000);
  assert.deepEqual(snapped.guides, []);
});

test('venue geometry stores a configurable centreline; freeze copies it so later edits cannot change the snapshot', () => {
  const centreline = defaultCentreline({ width: 8000, depth: 6000 });
  assert.deepEqual(centreline, { x: 4000, y: 3000, rotation: 90 });
  const venue = venueGeometrySchema.parse({
    schemaVersion: 1, width: 8000, depth: 6000, stageCentreline: centreline,
  });
  assert.deepEqual(venue.stageCentreline, centreline);
  const parsed = layoutSchema.parse({ schemaVersion: 1, walls: [] });
  const scene = {
    id: randomUUID(), name: 'Erste Szene', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(), venue, lease: null, layout: parsed,
  };
  const snapshot = freezeSnapshot(scene, { id: randomUUID(), name: 'Fassung Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  scene.venue.stageCentreline = { x: 100, y: 100, rotation: 0 };
  assert.deepEqual(snapshot.venue.stageCentreline, centreline);
  assert(!centrelineSchema.safeParse({ x: 0, y: 0, rotation: Infinity }).success);
  assert(!venueGeometrySchema.safeParse({ schemaVersion: 1, width: 8000, depth: 6000, stageCentreline: { x: 0, y: 0 } }).success);
});
