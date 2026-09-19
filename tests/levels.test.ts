import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  AUDIENCE_FLOOR_ID, EXAMPLE_PLATFORM_DEPTH, EXAMPLE_PLATFORM_ELEVATION, EXAMPLE_PLATFORM_WIDTH,
  EXAMPLE_STAIR_RISER, EXAMPLE_STAIR_RUN, EXAMPLE_STAIR_WIDTH,
  axisAlignedPlatformOutline, layoutDiagnostics, newPlatform, newStair, placementDiagnostic, platformCentroid,
  platformSchema, reassignLayoutSupports, reassignVenueSupports, resolveSupportingSurfaceId, rotatePlatformOutline, stairCorners, stairRise,
  stairSchema, supportingSurfaces, surfaceElevation, surfaceElevationUnderPoint, translatePlatformOutline,
} from '../src/shared/levels.js';
import { newBrace, newWall, wallCorners } from '../src/shared/layout.js';
import { newPlaceholder } from '../src/shared/placeholders.js';
import { braceCorners } from '../src/shared/braceTransforms.js';

const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000 };
const platformOutline = [
  { x: 0, y: 3500 }, { x: 8000, y: 3500 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 },
];

test('a supporting surface carries a known outline and elevation above the audience floor', () => {
  const platform = platformSchema.parse({
    id: randomUUID(), label: 'Bühne', elevation: EXAMPLE_PLATFORM_ELEVATION, outline: platformOutline,
    finish: 'library:color-white',
  });
  assert.equal(platform.elevation, 400);
  assert.equal(platform.finish, 'library:color-white');
  assert.deepEqual(platform.outline, platformOutline);
  const surfaces = supportingSurfaces({ ...venue, platforms: [platform] });
  assert.equal(surfaces[0]?.id, AUDIENCE_FLOOR_ID);
  assert.equal(surfaces[0]?.elevation, 0);
  assert.deepEqual(surfaces[0]?.outline[2], { x: 8000, y: 6000 });
  assert.equal(surfaces[1]?.elevation, 400);
  assert.equal(surfaceElevation(surfaces, platform.id), 400);
  assert.equal(surfaceElevation(surfaces, AUDIENCE_FLOOR_ID), 0);
  assert.equal(surfaceElevation(surfaces, undefined), 0);
  assert.equal(surfaceElevation(surfaces, randomUUID()), 0);
});

test('example platform millimetres are labelled placeholders, not a measured venue', () => {
  const platform = newPlatform(randomUUID(), 4000, 4750);
  assert.equal(platform.label, 'Podest');
  assert.equal(platform.elevation, EXAMPLE_PLATFORM_ELEVATION);
  assert.equal(EXAMPLE_PLATFORM_WIDTH, 4000);
  assert.equal(EXAMPLE_PLATFORM_DEPTH, 2500);
  assert.deepEqual(platform.outline[0], { x: 2000, y: 3500 });
  assert.deepEqual(platform.outline[2], { x: 6000, y: 6000 });
});

test('stairs connect two elevations using configurable millimetre dimensions', () => {
  const platform = { id: randomUUID(), label: 'Bühne', elevation: 400, outline: platformOutline };
  const stair = stairSchema.parse({
    id: randomUUID(), label: 'Treppe',
    lowerSurfaceId: AUDIENCE_FLOOR_ID, upperSurfaceId: platform.id,
    x: 4000, y: 2500, rotation: 0,
    width: EXAMPLE_STAIR_WIDTH, run: EXAMPLE_STAIR_RUN, riserHeight: EXAMPLE_STAIR_RISER,
  });
  const surfaces = supportingSurfaces({ ...venue, platforms: [platform] });
  assert.equal(stairRise(stair, surfaces), 400);
  assert.equal(stair.width, 1200);
  assert.equal(stair.run, 2000);
  assert.equal(stair.riserHeight, 160);
  assert.deepEqual(stairCorners(stair)[0], { x: 3400, y: 1500 });
  assert.deepEqual(stairCorners(stair)[2], { x: 4600, y: 3500 });
  assert(!stairSchema.safeParse({ ...stair, lowerSurfaceId: stair.upperSurfaceId }).success);
  assert(!stairSchema.safeParse({ ...stair, width: 0 }).success);
});

test('a wall or brace without an explicit supporting surface is diagnosed and stays at floor height', () => {
  const platform = { id: randomUUID(), label: 'Bühne', elevation: 400, outline: platformOutline };
  const surfaces = supportingSurfaces({ ...venue, platforms: [platform] });
  const onStage = newWall(randomUUID(), 4000, 5000);
  delete (onStage as { supportingSurfaceId?: string }).supportingSurfaceId;
  const diagnostic = placementDiagnostic({ id: onStage.id, supportingSurfaceId: onStage.supportingSurfaceId, corners: wallCorners(onStage) }, surfaces);
  assert.equal(diagnostic?.kind, 'missing-surface');
  assert.match(diagnostic?.message ?? '', /Auflagefläche/);
  assert.equal(surfaceElevation(surfaces, onStage.supportingSurfaceId), 0);
  const brace = newBrace(randomUUID(), 4000, 5000);
  delete (brace as { supportingSurfaceId?: string }).supportingSurfaceId;
  assert.equal(placementDiagnostic({
    id: brace.id, supportingSurfaceId: brace.supportingSurfaceId, corners: braceCorners(brace),
  }, surfaces)?.kind, 'missing-surface');
});

test('majority footprint coverage picks podium or floor; stacked podiums use the topmost surface', () => {
  const lower = { id: randomUUID(), label: 'Unterpodest', elevation: 200, outline: platformOutline };
  const upper = {
    id: randomUUID(), label: 'Oberpodest', elevation: 600,
    outline: [{ x: 2000, y: 4000 }, { x: 6000, y: 4000 }, { x: 6000, y: 6000 }, { x: 2000, y: 6000 }],
  };
  const surfaces = supportingSurfaces({ ...venue, platforms: [lower, upper] });
  const onFloor = wallCorners(newWall(randomUUID(), 4000, 2000));
  assert.equal(resolveSupportingSurfaceId(onFloor, surfaces), AUDIENCE_FLOOR_ID);
  const onLowerOnly = wallCorners(newWall(randomUUID(), 1000, 5000));
  assert.equal(resolveSupportingSurfaceId(onLowerOnly, surfaces), lower.id);
  const onUpper = wallCorners(newWall(randomUUID(), 4000, 5000));
  assert.equal(resolveSupportingSurfaceId(onUpper, surfaces), upper.id);
  // Mostly on the podium (y=4000 centre, 1200×28 wall along x) → podium wins over floor.
  const mostlyOnPodium = wallCorners({ ...newWall(randomUUID(), 4000, 3600), width: 2000, thickness: 400 });
  assert.equal(resolveSupportingSurfaceId(mostlyOnPodium, surfaces), lower.id);
});

test('moving a podium under existing walls reassigns their supporting surface', () => {
  const wall = newWall(randomUUID(), 4000, 3000);
  assert.equal(wall.supportingSurfaceId, AUDIENCE_FLOOR_ID);
  const platform = newPlatform(randomUUID(), 4000, 3000);
  platform.elevation = 400;
  const layout = reassignLayoutSupports({
    walls: [wall], braces: [], platforms: [platform],
  }, venue);
  assert.equal(layout.walls[0]?.supportingSurfaceId, platform.id);
  assert.equal(surfaceElevation(supportingSurfaces(venue, layout), layout.walls[0]?.supportingSurfaceId), 400);
});

test('movable layout platforms join the venue floor as supporting surfaces; stairs use their elevations', () => {
  const movable = newPlatform(randomUUID(), 2000, 1500);
  movable.elevation = 400;
  const surfaces = supportingSurfaces(venue, { platforms: [movable] });
  assert.equal(surfaces.some(surface => surface.id === movable.id && surface.elevation === 400), true);
  const stair = newStair(randomUUID(), AUDIENCE_FLOOR_ID, movable.id, 2000, 400);
  assert.equal(stairRise(stair, surfaces), 400);
  const unknown = newStair(randomUUID(), AUDIENCE_FLOOR_ID, randomUUID(), 0, 0);
  assert.equal(layoutDiagnostics({
    walls: [], braces: [], platforms: [movable], stairs: [unknown],
  }, venue).some(item => item.kind === 'unknown-surface'), true);
});

test('platform outline translate and rotate keep the centroid under control', () => {
  const platform = newPlatform(randomUUID(), 4000, 3000);
  const centre = platformCentroid(platform.outline);
  assert.equal(centre.x, 4000);
  assert.equal(centre.y, 3000);
  const moved = translatePlatformOutline(platform.outline, 500, -200);
  assert.deepEqual(platformCentroid(moved), { x: 4500, y: 2800 });
  const turned = rotatePlatformOutline(platform.outline, 90);
  const after = platformCentroid(turned);
  assert(Math.abs(after.x - 4000) < 1e-6);
  assert(Math.abs(after.y - 3000) < 1e-6);
  const rebuilt = axisAlignedPlatformOutline(4000, 3000, 2000, 1000, 90);
  assert.equal(rebuilt.length, 4);
  assert(Math.abs(platformCentroid(rebuilt).x - 4000) < 1e-6);
});

test('venue chairs jump onto a podium the same way layout placeholders do', () => {
  const platform = newPlatform(randomUUID(), 4000, 3000);
  platform.elevation = 400;
  const chair = newPlaceholder('chair', randomUUID(), 4000, 3000);
  assert.equal(chair.supportingSurfaceId, AUDIENCE_FLOOR_ID);
  const venue = reassignVenueSupports({
    schemaVersion: 1 as const, width: 8000, depth: 6000, platforms: [platform], placeholders: [chair],
  });
  assert.equal(venue.placeholders?.[0]?.supportingSurfaceId, platform.id);
  assert.equal(surfaceElevation(supportingSurfaces(venue), venue.placeholders?.[0]?.supportingSurfaceId), 400);
});

test('Steckfüße land on the next surface under each plan point', () => {
  const lower = {
    ...newPlatform(randomUUID(), 2000, 2000),
    elevation: 400,
    outline: [
      { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { x: 0, y: 4000 },
    ],
  };
  const upper = {
    ...newPlatform(randomUUID(), 5000, 2000),
    elevation: 800,
    outline: [
      { x: 2000, y: 1000 }, { x: 6000, y: 1000 }, { x: 6000, y: 3000 }, { x: 2000, y: 3000 },
    ],
  };
  assert.equal(surfaceElevationUnderPoint({ x: 1000, y: 2000 }, [lower, upper], 800, upper.id), 400);
  assert.equal(surfaceElevationUnderPoint({ x: 5000, y: 2000 }, [lower, upper], 800, upper.id), 0);
  assert.equal(surfaceElevationUnderPoint({ x: 3000, y: 2000 }, [lower, upper], 800, upper.id), 400);
});

test('podiums may partially overlap without changing Höhe über Fußboden', () => {
  const lower = {
    ...newPlatform(randomUUID(), 3000, 3000),
    elevation: 400,
    outline: [
      { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { x: 0, y: 4000 },
    ],
  };
  const overhang = {
    ...newPlatform(randomUUID(), 5000, 2000),
    elevation: 800,
    outline: [
      { x: 3000, y: 1000 }, { x: 7000, y: 1000 }, { x: 7000, y: 3000 }, { x: 3000, y: 3000 },
    ],
  };
  const venue = reassignVenueSupports({
    schemaVersion: 1 as const, width: 10000, depth: 8000, platforms: [lower, overhang],
  });
  const item = venue.platforms!.find(entry => entry.id === overhang.id)!;
  assert.equal(item.elevation, 800);
});
