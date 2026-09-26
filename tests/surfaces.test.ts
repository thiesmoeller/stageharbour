import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { layoutSchema, newWall } from '../src/shared/layout.js';
import {
  DEFAULT_SURFACE_SPLIT_MM,
  migrateWallSurfaces,
  patchWallSurfaces,
  resolveFaceBand,
} from '../src/shared/surfaces.js';
import {
  buildWallPanelGeometry,
  WALL_MAT_BACK_LOWER,
  WALL_MAT_BACK_UPPER,
  WALL_MAT_EDGE,
  WALL_MAT_FRONT_LOWER,
  WALL_MAT_FRONT_UPPER,
  wallGeometryGroupCoverage,
  wallShadowVolumes,
} from '../src/shared/wallMeshGeometry.js';
import { libraryPresetWithSurface } from '../src/client/editor/surfaceMaterials.js';

test('migrateWallSurfaces lifts finish and RAL into surfaces', () => {
  const fromFinish = migrateWallSurfaces({
    id: 'a', finish: 'library:wood-finewood27',
  });
  assert.deepEqual(fromFinish.surfaces?.front?.full, { kind: 'library', ref: 'library:wood-finewood27' });
  assert.equal('finish' in fromFinish, false);

  const fromRal = migrateWallSurfaces({
    id: 'b', frontRal: '7016', backRal: '9010',
  });
  assert.deepEqual(fromRal.surfaces?.front?.full, { kind: 'paint', ral: '7016' });
  assert.deepEqual(fromRal.surfaces?.back?.full, { kind: 'paint', ral: '9010' });
  assert.equal('frontRal' in fromRal, false);

  const layout = layoutSchema.parse({
    schemaVersion: 1,
    walls: [{ ...newWall(randomUUID(), 1000, 1000), finish: 'library:color-white' }],
    braces: [],
  });
  assert.deepEqual(layout.walls[0]!.surfaces?.front?.full, { kind: 'library', ref: 'library:color-white' });
});

test('layoutSchema.encode migrates legacy finish so Fastify can serialize raw DB rows', () => {
  const raw = {
    schemaVersion: 1 as const,
    walls: [{ ...newWall(randomUUID(), 1000, 1000), finish: 'library:preset-sand' as const }],
    braces: [],
  };
  // Response serialization encodes the handler return value without a prior parse.
  const encoded = layoutSchema.encode(raw);
  assert.equal('finish' in encoded.walls[0]!, false);
  assert.deepEqual(encoded.walls[0]!.surfaces?.front?.full, {
    kind: 'library', ref: 'library:preset-sand',
  });
});

test('patchWallSurfaces supports full face and two bands', () => {
  const painted = patchWallSurfaces(undefined, 'front', {
    mode: 'full', full: { kind: 'paint', ral: '9010' },
  });
  assert.deepEqual(painted?.front?.full, { kind: 'paint', ral: '9010' });

  const banded = patchWallSurfaces(painted, 'front', {
    mode: 'bands',
    splitMm: DEFAULT_SURFACE_SPLIT_MM,
    lower: { kind: 'library', ref: 'library:wood-finewood27', rotationDeg: 90 },
    upper: { kind: 'paint', ral: '7016' },
  });
  assert.equal(banded?.front?.splitMm, DEFAULT_SURFACE_SPLIT_MM);
  assert.equal(resolveFaceBand(banded?.front, 'lower')?.kind, 'library');
  assert.equal(resolveFaceBand(banded?.front, 'upper')?.kind, 'paint');
});

test('libraryPresetWithSurface applies rotation and scale to mapProperties', () => {
  const preset = libraryPresetWithSurface(
    { kind: 'library', ref: 'library:wood-finewood27', scaleMm: 1000, rotationDeg: 90 },
    { faceWidthMm: 4000, faceHeightMm: 2400 },
  );
  assert.ok(preset);
  assert.equal(preset!.mapProperties.rotation, Math.PI / 2);
  assert.equal(preset!.mapProperties.repeatX, 4);
  assert.equal(preset!.mapProperties.repeatY, 2.4);
});

test('applyWallPanelUVs map face corners to 0–1 in panel millimetres', () => {
  const size = { x: 4000, y: 2000, z: 100 };
  const geometry = buildWallPanelGeometry(size, []);
  const uv = geometry.getAttribute('uv');
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  let foundFrontCorner = false;
  for (let i = 0; i < position.count; i++) {
    if (normal.getZ(i) > -0.5) continue;
    const x = position.getX(i), y = position.getY(i);
    if (Math.abs(x + size.x / 2) < 1 && Math.abs(y + size.y / 2) < 1) {
      assert.ok(Math.abs(uv.getX(i) - 0) < 1e-5);
      assert.ok(Math.abs(uv.getY(i) - 0) < 1e-5);
      foundFrontCorner = true;
    }
    if (Math.abs(x - size.x / 2) < 1 && Math.abs(y - size.y / 2) < 1) {
      assert.ok(Math.abs(uv.getX(i) - 1) < 1e-5);
      assert.ok(Math.abs(uv.getY(i) - 1) < 1e-5);
    }
  }
  assert.equal(foundFrontCorner, true);
  geometry.dispose();
});

test('banded front split assigns lower and upper material groups', () => {
  const size = { x: 4000, y: 2400, z: 100 };
  const geometry = buildWallPanelGeometry(size, [], { frontMm: 1200 });
  assert.equal(wallGeometryGroupCoverage(geometry).complete, true);
  assert.equal(geometry.groups.length, 5);
  const frontLower = geometry.groups.find(g => g.materialIndex === WALL_MAT_FRONT_LOWER)!;
  const frontUpper = geometry.groups.find(g => g.materialIndex === WALL_MAT_FRONT_UPPER)!;
  assert.ok(frontLower.count > 0);
  assert.ok(frontUpper.count > 0);
  assert.ok(geometry.groups.find(g => g.materialIndex === WALL_MAT_EDGE)!.count > 0);
  assert.ok(geometry.groups.find(g => g.materialIndex === WALL_MAT_BACK_LOWER)!.count > 0);
  assert.equal(geometry.groups.find(g => g.materialIndex === WALL_MAT_BACK_UPPER)!.count, 0);
  geometry.dispose();
});

/** Every front/back band triangle must lie entirely on its side of the split (no diagonal wedges). */
function assertHorizontalBandGroups(
  geometry: ReturnType<typeof buildWallPanelGeometry>,
  size: { x: number; y: number; z: number },
  splits: { frontMm?: number; backMm?: number },
) {
  const hh = size.y / 2;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  assert.ok(index);
  const frontSplitY = splits.frontMm !== undefined ? -hh + splits.frontMm : undefined;
  const backSplitY = splits.backMm !== undefined ? -hh + splits.backMm : undefined;
  const eps = 0.5; // mm — ExtrudeGeometry float noise
  for (const group of geometry.groups) {
    const splitY = group.materialIndex === WALL_MAT_FRONT_LOWER || group.materialIndex === WALL_MAT_FRONT_UPPER
      ? frontSplitY
      : group.materialIndex === WALL_MAT_BACK_LOWER || group.materialIndex === WALL_MAT_BACK_UPPER
        ? backSplitY
        : undefined;
    if (splitY === undefined) continue;
    const lower = group.materialIndex === WALL_MAT_FRONT_LOWER || group.materialIndex === WALL_MAT_BACK_LOWER;
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const ys = [0, 1, 2].map(k => position.getY(index.getX(i + k)));
      if (lower) {
        assert.ok(Math.max(...ys) <= splitY + eps,
          `lower band triangle crosses above splitY=${splitY}: ${ys.join(',')}`);
      } else {
        assert.ok(Math.min(...ys) >= splitY - eps,
          `upper band triangle crosses below splitY=${splitY}: ${ys.join(',')}`);
      }
    }
  }
}

test('single (unbanded) front keeps one full-face material slot', () => {
  const size = { x: 4000, y: 2400, z: 100 };
  const geometry = buildWallPanelGeometry(size, []);
  assert.ok(geometry.groups.find(g => g.materialIndex === WALL_MAT_FRONT_LOWER)!.count > 0);
  assert.equal(geometry.groups.find(g => g.materialIndex === WALL_MAT_FRONT_UPPER)!.count, 0);
  geometry.dispose();
});

test('banded front split is a horizontal stripe, not diagonal wedges', () => {
  const size = { x: 4000, y: 2400, z: 100 };
  const splits = { frontMm: 1200 };
  const geometry = buildWallPanelGeometry(size, [], splits);
  assertHorizontalBandGroups(geometry, size, splits);
  geometry.dispose();
});

test('banded front with doorway stays a horizontal stripe around the opening', () => {
  const size = { x: 5100, y: 2400, z: 28 };
  const opening = { id: randomUUID(), left: 1800, sill: 0, width: 1000, height: 2000 };
  const splits = { frontMm: 1200 };
  const geometry = buildWallPanelGeometry(size, [opening], splits);
  assert.equal(wallGeometryGroupCoverage(geometry).complete, true);
  assertHorizontalBandGroups(geometry, size, splits);
  geometry.dispose();
});

test('openings stay empty with banded materials and shadow volumes', () => {
  const size = { x: 5000, y: 2400, z: 200 };
  const opening = { id: randomUUID(), left: 1000, sill: 0, width: 2000, height: 2000 };
  const geometry = buildWallPanelGeometry(size, [opening], { frontMm: 1000, backMm: 1000 });
  assert.equal(wallGeometryGroupCoverage(geometry).complete, true);
  assertHorizontalBandGroups(geometry, size, { frontMm: 1000, backMm: 1000 });
  const volumes = wallShadowVolumes(size, [opening]);
  assert.ok(volumes.length >= 2);
  const hw = size.x / 2, hh = size.y / 2;
  const voidRect = { x0: -hw + 1000, y0: -hh, x1: -hw + 3000, y1: -hh + 2000 };
  for (const volume of volumes) {
    const [cx, cy] = volume.position;
    assert(!(cx > voidRect.x0 + 1 && cx < voidRect.x1 - 1 && cy > voidRect.y0 + 1 && cy < voidRect.y1 - 1));
  }
  geometry.dispose();
});
