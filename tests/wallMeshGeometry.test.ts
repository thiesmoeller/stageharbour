import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { newWall, venueGeometrySchema } from '../src/shared/layout.js';
import { resolveWall } from '../src/shared/wall-types.js';
import { wallSolid } from '../src/shared/transforms.js';
import { buildWallPanelGeometry, openingFlushSides, openingTouchesBoundary, wallGeometryGroupCoverage, wallShadowVolumes } from '../src/shared/wallMeshGeometry.js';
import { openingEdgeHandles, openingJambSolids } from '../src/client/editor/wallOpeningHandles.js';

const size = { x: 5000, y: 2989, z: 200 };
const cut = { id: randomUUID(), left: 1000, sill: 0, width: 2000, height: 2500 };

function rayHits(geometry: ReturnType<typeof buildWallPanelGeometry>, origin: Vector3, direction = new Vector3(0, 0, 1)) {
  const materials = [0, 1, 2, 3, 4].map(() => new MeshBasicMaterial());
  const mesh = new Mesh(geometry, materials);
  return new Raycaster(origin, direction).intersectObject(mesh).length;
}

test('solid wall panel geometry covers every triangle with five material slots', () => {
  const geometry = buildWallPanelGeometry(size, []);
  const coverage = wallGeometryGroupCoverage(geometry);
  assert.equal(coverage.complete, true);
  assert.equal(geometry.groups.length, 5);
  assert(geometry.groups.every(group => (group.materialIndex ?? -1) >= 0 && (group.materialIndex ?? -1) <= 4));
  assert(rayHits(geometry, new Vector3(0, 0, -1000)) > 0, 'solid wall must be hit through the face centre');
  geometry.dispose();
});

test('cutout geometry leaves a hole and jambs remain hittable', () => {
  const geometry = buildWallPanelGeometry(size, [cut]);
  assert.equal(wallGeometryGroupCoverage(geometry).complete, true);
  assert.equal(rayHits(geometry, new Vector3(0, -hh(cut), -1000)), 0, 'ray through cutout centre must miss');
  assert(rayHits(geometry, new Vector3(-size.x / 2 + cut.left / 2, 0, -1000)) > 0, 'left jamb must remain hittable');
  assert(rayHits(geometry, new Vector3(size.x / 2 - 100, 0, -1000)) > 0, 'right jamb must remain hittable');
  geometry.dispose();
});

test('rebuilding solid geometry after removing a cutout restores a hittable full face', () => {
  const withCut = buildWallPanelGeometry(size, [cut]);
  withCut.dispose();
  const solidAgain = buildWallPanelGeometry(size, []);
  assert.equal(wallGeometryGroupCoverage(solidAgain).complete, true);
  assert(rayHits(solidAgain, new Vector3(0, -hh(cut), -1000)) > 0, 'former cutout centre must be solid again');
  assert(rayHits(solidAgain, new Vector3(0, 0, -1000)) > 0);
  solidAgain.dispose();
});

test('opening jamb pick solids and edge handles cover Ausschnitt interaction surfaces', () => {
  const wall = { size, openings: [cut] };
  const jambs = openingJambSolids(wall);
  assert.deepEqual(jambs.map(j => j.key).sort(), [`${cut.id}-L`, `${cut.id}-R`, `${cut.id}-T`].sort());
  assert.equal(openingJambSolids({ size, openings: [] }).length, 0);
  const edges = openingEdgeHandles(cut, size.z);
  assert.equal(edges.length, 4);
  assert.deepEqual(edges.map(e => e.edge).sort(), ['bottom', 'left', 'right', 'top']);
  assert(edges.every(e => e.pushPullKind === 'wallOpening' && e.openingId === cut.id));
});

test('removing the last inline opening clears the field and resolveWall stays solid', () => {
  const wall = { ...newWall(randomUUID(), 4000, 3000), width: 5000, height: 2989, thickness: 200, openings: [cut] };
  const without = (({ openings: _drop, ...rest }) => rest)(wall);
  const parsed = venueGeometrySchema.safeParse({ schemaVersion: 1, width: 10000, depth: 8000, walls: [without] });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data!.walls![0]!.openings, undefined);
  const resolved = resolveWall(without, []);
  assert.equal(resolved.openings.length, 0);
  const solid = wallSolid(resolved);
  assert.equal(solid.openings.length, 0);
  const geometry = buildWallPanelGeometry(solid.size, solid.openings);
  assert(rayHits(geometry, new Vector3(0, 0, -1000)) > 0);
  geometry.dispose();
});

test('flush-left end opening notches the outer contour and stays raycastable', () => {
  const openLeft = { id: randomUUID(), left: 0, sill: 0, width: 1500, height: 2500 };
  const geometry = buildWallPanelGeometry(size, [openLeft]);
  assert.equal(wallGeometryGroupCoverage(geometry).complete, true);
  assert.equal(rayHits(geometry, new Vector3(-size.x / 2 + 750, -hh(openLeft), -1000)), 0, 'open end must miss');
  assert(rayHits(geometry, new Vector3(size.x / 2 - 100, 0, -1000)) > 0, 'remaining solid must hit');
  assert.deepEqual(openingFlushSides(openLeft, size), { left: true, right: false, bottom: true, top: false });
  assert.deepEqual(openingJambSolids({ size, openings: [openLeft] }).map(j => j.key).sort(), [`${openLeft.id}-R`, `${openLeft.id}-T`].sort());
  geometry.dispose();
});

test('flush-right end opening notches the outer contour and stays raycastable', () => {
  const openRight = { id: randomUUID(), left: 3500, sill: 0, width: 1500, height: 2500 };
  const geometry = buildWallPanelGeometry(size, [openRight]);
  assert.equal(wallGeometryGroupCoverage(geometry).complete, true);
  assert.equal(rayHits(geometry, new Vector3(size.x / 2 - 750, -hh(openRight), -1000)), 0, 'open end must miss');
  assert(rayHits(geometry, new Vector3(-size.x / 2 + 100, 0, -1000)) > 0, 'remaining solid must hit');
  assert.equal(openingFlushSides(openRight, size).right, true);
  assert.deepEqual(openingJambSolids({ size, openings: [openRight] }).map(j => j.key).sort(), [`${openRight.id}-L`, `${openRight.id}-T`].sort());
  geometry.dispose();
});

test('fully inset opening still uses an interior hole', () => {
  const window = { id: randomUUID(), left: 1000, sill: 800, width: 1200, height: 1000 };
  assert.equal(openingTouchesBoundary(window, size), false);
  const geometry = buildWallPanelGeometry(size, [window]);
  assert.equal(wallGeometryGroupCoverage(geometry).complete, true);
  assert.equal(rayHits(geometry, new Vector3(-size.x / 2 + 1600, -size.y / 2 + 1300, -1000)), 0);
  assert(rayHits(geometry, new Vector3(0, 0, -1000)) > 0);
  geometry.dispose();
});

test('flush-right floor cutout (screenshot repro) leaves the void empty of face triangles', () => {
  const panel = { x: 6839, y: 2400, z: 533 };
  const opening = { id: randomUUID(), left: 4600, sill: 0, width: 2239, height: 2000 };
  assert.deepEqual(openingFlushSides(opening, panel), { left: false, right: true, bottom: true, top: false });
  const geometry = buildWallPanelGeometry(panel, [opening]);
  const pos = geometry.getAttribute('position');
  const hw = panel.x / 2, hh = panel.y / 2;
  const voidRect = { x0: -hw + opening.left, y0: -hh, x1: hw, y1: -hh + opening.height };
  let facesInVoid = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3;
    const onFace = Math.abs(Math.abs((az + bz + cz) / 3) - panel.z / 2) < 1;
    if (onFace && mx > voidRect.x0 + 2 && mx < voidRect.x1 - 2 && my > voidRect.y0 + 2 && my < voidRect.y1 - 2) facesInVoid++;
  }
  assert.equal(facesInVoid, 0);
  assert.equal(rayHits(geometry, new Vector3((voidRect.x0 + voidRect.x1) / 2, (voidRect.y0 + voidRect.y1) / 2, -1000)), 0);
  geometry.dispose();
});

test('shadow volumes leave the cutout empty and cover remaining solid cells', () => {
  const panel = { x: 5000, y: 2400, z: 400 };
  const opening = { id: randomUUID(), left: 1000, sill: 0, width: 2500, height: 2000 };
  const volumes = wallShadowVolumes(panel, [opening]);
  assert.equal(volumes.length, 3);
  const hw = panel.x / 2, hh = panel.y / 2;
  const voidRect = { x0: -hw + 1000, y0: -hh, x1: -hw + 3500, y1: -hh + 2000 };
  for (const volume of volumes) {
    const [cx, cy] = volume.position;
    assert(!(cx > voidRect.x0 + 1 && cx < voidRect.x1 - 1 && cy > voidRect.y0 + 1 && cy < voidRect.y1 - 1),
      `shadow box at ${cx},${cy} must not sit inside the cutout`);
  }
  const solid = wallShadowVolumes(panel, []);
  assert.equal(solid.length, 1);
  assert.deepEqual(solid[0]!.size, [5000, 2400, 400]);
});

test('Roman-arch floor opening leaves the crown void empty and keeps the corners above the spring line', () => {
  const panel = { x: 1200, y: 2400, z: 250 };
  const opening = { id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000, profile: 'arch' as const };
  const geometry = buildWallPanelGeometry(panel, [opening]);
  assert.equal(wallGeometryGroupCoverage(geometry).complete, true);
  const hw = panel.x / 2, hh = panel.y / 2;
  const cx = -hw + opening.left + opening.width / 2;
  const springY = -hh + opening.sill + opening.height - opening.width / 2;
  const crownY = -hh + opening.sill + opening.height - 20;
  assert.equal(rayHits(geometry, new Vector3(cx, springY + opening.width / 4, -1000)), 0, 'inside the arch crown must miss');
  assert.equal(rayHits(geometry, new Vector3(cx, -hh + 1000, -1000)), 0, 'inside the jambs must miss');
  assert(rayHits(geometry, new Vector3(-hw + 50, 0, -1000)) > 0, 'left pier must remain');
  // Outside the semicircle, beside the crown, solid remains.
  assert(rayHits(geometry, new Vector3(-hw + opening.left + 40, crownY, -1000)) > 0, 'corner above spring outside the arc must hit');
  assert(rayHits(geometry, new Vector3(-hw + opening.left + opening.width - 40, crownY, -1000)) > 0, 'opposite crown corner must hit');
  const shadows = wallShadowVolumes(panel, [opening]);
  for (const volume of shadows) {
    const [vx, vy] = volume.position;
    const dx = vx - cx, dy = vy - springY;
    const inJambs = Math.abs(vx - cx) < opening.width / 2 - 1 && vy > -hh + 1 && vy < springY - 1;
    const inCrown = vy >= springY && dx * dx + dy * dy < (opening.width / 2 - 2) ** 2;
    assert(!inJambs && !inCrown, `shadow at ${vx},${vy} must not fill the arch void`);
  }
  geometry.dispose();
});

test('inset Roman-arch window uses an interior hole with a curved crown', () => {
  const panel = { x: 5000, y: 2989, z: 200 };
  const opening = { id: randomUUID(), left: 1500, sill: 600, width: 1200, height: 1400, profile: 'arch' as const };
  assert.equal(openingTouchesBoundary(opening, panel), false);
  const geometry = buildWallPanelGeometry(panel, [opening]);
  assert.equal(wallGeometryGroupCoverage(geometry).complete, true);
  const hw = panel.x / 2, hh = panel.y / 2;
  const cx = -hw + opening.left + opening.width / 2;
  const crownY = -hh + opening.sill + opening.height - 30;
  assert.equal(rayHits(geometry, new Vector3(cx, -hh + opening.sill + 400, -1000)), 0);
  assert.equal(rayHits(geometry, new Vector3(cx, crownY, -1000)), 0);
  assert(rayHits(geometry, new Vector3(-hw + opening.left + 30, crownY, -1000)) > 0);
  geometry.dispose();
});

function hh(opening: { sill: number; height: number }) {
  return -size.y / 2 + opening.sill + opening.height / 2;
}
