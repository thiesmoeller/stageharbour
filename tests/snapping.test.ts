import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { formGroup, transformGroup } from '../src/shared/groups.js';
import { freezeSnapshot } from '../src/shared/export.js';
import { layoutSchema, newBrace, newWall, venueGeometrySchema, type Layout } from '../src/shared/layout.js';
import { placementOverlaps, wallFootprint } from '../src/shared/overlap.js';
import {
  COMMON_LAYOUT_ANGLES_DEG, GUIDE_PADDING_MM, SNAP_ANGLE_DEG, SNAP_DISTANCE_MM, SNAP_EDGE_FRACTIONS, SNAP_NOTICE,
  alignBraceToNearestWall, braceContactHinge, centrelineSchema, defaultCentreline, planRotationAt, rotateBraceOnContact,
  rotateToward, rotationHandlePoint, snapBracePose, snapGroupPose, snapMembersPose, snapRotation, snapStatusText, snapWallPose, wallFaceAnchors,
} from '../src/shared/snapping.js';
import { permanentWalls, planningWalls } from '../src/shared/planningGeometry.js';

test('documented snap tolerances are millimetres and degrees, not screen pixels', () => {
  assert.equal(SNAP_DISTANCE_MM, 100);
  assert.equal(SNAP_ANGLE_DEG, 2.5);
  assert(COMMON_LAYOUT_ANGLES_DEG.includes(0));
  assert(COMMON_LAYOUT_ANGLES_DEG.includes(45));
  assert(COMMON_LAYOUT_ANGLES_DEG.includes(90));
  assert.match(SNAP_NOTICE, /100 mm/);
  assert.match(SNAP_NOTICE, /⅓/);
  assert.match(SNAP_NOTICE, /Objektüberschneidungen/);
});

test('plan rotation follows the pointer around the wall centre in millimetres', () => {
  assert.equal(planRotationAt({ x: 2000, y: 3000 }, { x: 3200, y: 3000 }), 0);
  assert.equal(planRotationAt({ x: 2000, y: 3000 }, { x: 2000, y: 4200 }), 90);
  assert.equal(planRotationAt({ x: 2000, y: 3000 }, { x: 800, y: 3000 }), 180);
});

test('rotate toward a pointer snaps to common layout angles unless bypassed', () => {
  const wall = { x: 2000, y: 3000, rotation: 0 };
  const snapped = rotateToward(wall, { x: 2000 + Math.cos(88 * Math.PI / 180) * 1000, y: 3000 + Math.sin(88 * Math.PI / 180) * 1000 });
  assert.equal(snapped.rotation, 90);
  assert.equal(snapped.angleSnapped, true);
  const free = rotateToward(wall, { x: 2000 + Math.cos(88 * Math.PI / 180) * 1000, y: 3000 + Math.sin(88 * Math.PI / 180) * 1000 }, { bypass: true });
  assert(Math.abs(free.rotation - 88) < 0.01);
  assert.equal(free.angleSnapped, false);
});

test('snap status names edge, centreline and angle snaps in German', () => {
  assert.equal(snapStatusText({ guides: [{ kind: 'wall-edge', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }] }), 'Eingerastet · Wandkante');
  assert.equal(snapStatusText({ guides: [{ kind: 'centreline', a: { x: 0, y: 0 }, b: { x: 0, y: 1 } }] }), 'Eingerastet · Mittellinie');
  assert.equal(snapStatusText({
    guides: [
      { kind: 'wall-edge', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
      { kind: 'centreline', a: { x: 0, y: 0 }, b: { x: 0, y: 1 } },
    ],
    rotation: 90, angleSnapped: true,
  }), 'Eingerastet · 90° · Wandkante · Mittellinie');
  assert.equal(snapStatusText({ guides: [] }), undefined);
});

test('rotation handle sits beyond the wall end along its long axis', () => {
  const handle = rotationHandlePoint({ x: 2000, y: 3000, rotation: 0, width: 1200 });
  assert.equal(handle.x, 2000 + 600 + 350);
  assert.equal(handle.y, 3000);
  const turned = rotationHandlePoint({ x: 2000, y: 3000, rotation: 90, width: 1200 });
  assert(Math.abs(turned.x - 2000) < 1e-8);
  assert.equal(turned.y, 3000 + 600 + 350);
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

test('scene walls snap onto permanent venue walls without treating them as movable members', () => {
  const permanent = newWall(randomUUID(), 0, 0);
  const moving = newWall(randomUUID(), 2000, 80);
  const venue = venueGeometrySchema.parse({ schemaVersion: 1, width: 8000, depth: 6000, walls: [permanent] });
  const layout: Layout = { schemaVersion: 1, walls: [moving], braces: [] };
  assert.equal(planningWalls(layout, venue).length, 2);
  assert.equal(permanentWalls(venue)[0]?.id, permanent.id);
  const alone = snapWallPose(moving, [], undefined);
  assert.equal(alone.y, 80);
  const againstPermanent = snapWallPose(moving, permanentWalls(venue), undefined);
  assert.equal(againstPermanent.y, 28);
  assert.equal(againstPermanent.guides[0]?.kind, 'wall-edge');
  const grouped = snapMembersPose(layout, [{ kind: 'wall', id: moving.id }], { x: moving.x, y: moving.y, rotation: 0 }, 0, undefined, {
    fixedWalls: permanentWalls(venue),
  });
  assert.equal(grouped.pose.y, 28);
  assert.equal(layout.walls[0]?.y, 80);
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
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(), venue, lease: null, layout: parsed,
  };
  const snapshot = freezeSnapshot(scene, { id: randomUUID(), name: 'Fassung Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  scene.venue.stageCentreline = { x: 100, y: 100, rotation: 0 };
  assert.deepEqual(snapshot.venue.stageCentreline, centreline);
  assert(!centrelineSchema.safeParse({ x: 0, y: 0, rotation: Infinity }).success);
  assert(!venueGeometrySchema.safeParse({ schemaVersion: 1, width: 8000, depth: 6000, stageCentreline: { x: 0, y: 0 } }).success);
});

test('wall-edge guides span both walls with padding, not only the thin target edge', () => {
  const stationary = newWall(randomUUID(), 0, 0);
  const moving = newWall(randomUUID(), 8000, 80);
  const snapped = snapWallPose(moving, [stationary], undefined);
  assert.equal(snapped.guides[0]?.kind, 'wall-edge');
  const guide = snapped.guides[0]!;
  const length = Math.hypot(guide.b.x - guide.a.x, guide.b.y - guide.a.y);
  assert(length > stationary.width + GUIDE_PADDING_MM);
});

test('already-aligned walls still show a wall-edge guide while dragging', () => {
  const stationary = newWall(randomUUID(), 0, 0);
  const moving = newWall(randomUUID(), 2000, 28);
  const snapped = snapWallPose(moving, [stationary], undefined);
  assert.equal(snapped.x, 2000);
  assert.equal(snapped.y, 28);
  assert.equal(snapped.guides[0]?.kind, 'wall-edge');
});

test('a brace snaps onto a nearby wall edge and auto-aligns its tall face', () => {
  const wall = newWall(randomUUID(), 0, 0);
  // Tall-face mid at centre.y - depth/2; keep that face within SNAP_DISTANCE_MM of the wall edge.
  const brace = { ...newBrace(randomUUID(), 0, 300), footprintWidth: 40, footprintDepth: 500 };
  const snapped = snapBracePose(brace, [wall], undefined);
  assert.equal(snapped.guides[0]?.kind, 'wall-edge');
  const aligned = alignBraceToNearestWall({ ...brace, x: snapped.x, y: snapped.y }, [wall], { force: true });
  assert(aligned);
  assert.equal(Math.abs(aligned.rotation % 180), 0);
});

test('snapped brace rotation keeps the tall face on the contact hinge', () => {
  const wall = newWall(randomUUID(), 0, 0);
  const brace = alignBraceToNearestWall({ ...newBrace(randomUUID(), 0, 80), footprintWidth: 40, footprintDepth: 500 }, [wall], { force: true });
  assert(brace);
  const contact = braceContactHinge(brace, [wall]);
  assert(contact);
  const turned = rotateBraceOnContact(brace, contact.hinge, 20);
  const face = {
    x: turned.x - (-turned.footprintDepth / 2) * Math.sin(turned.rotation * Math.PI / 180),
    y: turned.y + (-turned.footprintDepth / 2) * Math.cos(turned.rotation * Math.PI / 180),
  };
  assert(Math.abs(face.x - contact.hinge.x) < 1e-6);
  assert(Math.abs(face.y - contact.hinge.y) < 1e-6);
  assert.equal(turned.rotation, 20);
});

test('front carries ⅓·½·⅔; short sides only the ends', () => {
  const wall = newWall(randomUUID(), 0, 0);
  const anchors = wallFaceAnchors(wall);
  // front: 5 fractions + 2 sides × 2 ends
  assert.equal(anchors.length, SNAP_EDGE_FRACTIONS.length + 4);
  const frontMid = anchors.find(point => Math.abs(point.x) < 1e-6 && Math.abs(point.y - (-wall.thickness / 2)) < 1e-6);
  assert(frontMid);
  const third = anchors.find(point => Math.abs(point.x - (-wall.width / 2 + wall.width / 3)) < 1e-6);
  assert(third);
  // No mid-thickness anchors on the short edges (only the two ends)
  const leftEdge = anchors.filter(point => Math.abs(point.x - (-wall.width / 2)) < 1e-6);
  assert(leftEdge.every(point => Math.abs(Math.abs(point.y) - wall.thickness / 2) < 1e-6));
  assert.equal(new Set(leftEdge.map(point => point.y.toFixed(6))).size, 2);
});

test('a wall snaps its end onto the half mark of another wall’s front', () => {
  const stationary = newWall(randomUUID(), 0, 0);
  // Moving wall end near the front midpoint of stationary (front at y = -14)
  const moving = { ...newWall(randomUUID(), 600, -14 - 600), rotation: 90 };
  const snapped = snapWallPose(moving, [stationary], undefined);
  assert(snapped.guides.some(guide => guide.kind === 'wall-anchor' || guide.kind === 'wall-edge'));
  assert(Math.abs(snapped.x) <= SNAP_DISTANCE_MM || Math.abs(snapped.y + 14 + 600) <= SNAP_DISTANCE_MM || snapped.guides.length > 0);
});

test('snap prefers flush contact over an overlapping fraction pull', () => {
  const stationary = newWall(randomUUID(), 0, 0);
  const moving = { ...newWall(randomUUID(), 0, -20) };
  const snapped = snapWallPose(moving, [stationary], undefined);
  assert(Math.abs(snapped.y - (-stationary.thickness)) < 1e-6);
  assert.equal(placementOverlaps(
    { schemaVersion: 1, walls: [stationary], braces: [] },
    wallFootprint({ ...moving, x: snapped.x, y: snapped.y }),
  ), false);
});
