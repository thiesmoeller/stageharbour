import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { newWall, venueGeometrySchema } from '../src/shared/layout.js';
import { resolveWall } from '../src/shared/wall-types.js';
import { wallSolid } from '../src/shared/transforms.js';
import { buildWallPanelGeometry, openingFlushSides, openingTouchesBoundary, wallGeometryGroupCoverage } from '../src/shared/wallMeshGeometry.js';
import { openingEdgeHandles, openingJambSolids } from '../src/client/editor/WallMesh.js';

const size = { x: 5000, y: 2989, z: 200 };
const cut = { id: randomUUID(), left: 1000, sill: 0, width: 2000, height: 2500 };

function rayHits(geometry: ReturnType<typeof buildWallPanelGeometry>, origin: Vector3, direction = new Vector3(0, 0, 1)) {
  const materials = [0, 1, 2].map(() => new MeshBasicMaterial());
  const mesh = new Mesh(geometry, materials);
  return new Raycaster(origin, direction).intersectObject(mesh).length;
}

test('solid wall panel geometry covers every triangle with three material slots', () => {
  const geometry = buildWallPanelGeometry(size, []);
  const coverage = wallGeometryGroupCoverage(geometry);
  assert.equal(coverage.complete, true);
  assert(geometry.groups.every(group => group.materialIndex === 0 || group.materialIndex === 1 || group.materialIndex === 2));
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

test('flush-left cutout can be removed and the full face returns', () => {
  const openLeft = { id: randomUUID(), left: 0, sill: 0, width: 2000, height: 2500 };
  buildWallPanelGeometry(size, [openLeft]).dispose();
  const solid = buildWallPanelGeometry(size, []);
  assert(rayHits(solid, new Vector3(-size.x / 2 + 1000, -hh(openLeft), -1000)) > 0);
  solid.dispose();
});

function hh(opening: { sill: number; height: number }) {
  return -size.y / 2 + opening.sill + opening.height / 2;
}
