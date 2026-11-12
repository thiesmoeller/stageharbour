import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSchema, venueGeometrySchema } from '../src/shared/layout.js';
import {
  captureDocument, captureFootprints, captureLists, captureSolids, captureSurfaces, captureWarnings, generatedFixtures,
  loadFixtures, neutralWarnings, storedInput, type LoadedFixture,
} from './golden/capture.js';
import { captureCombinedDocument, captureCombinedLists, captureCombinedPdf, COMBINED_NAME } from './golden/combined.js';
import { INPUT_DECIMALS } from './golden/format.js';
import { capturePdf } from './golden/pdf.js';
import {
  checkGolden, goldenFilesOnDisk, removeGoldenFile, updatingGoldens, type GoldenAspect,
} from './golden/store.js';

/**
 * Golden baseline of the per-kind (v1) geometry, warning, list and export pipelines.
 * Regenerate deliberately with `UPDATE_GOLDENS=1 npm test` and review the diff; see tests/golden/README.md.
 */

const fixtures = loadFixtures();

const ASPECTS: { aspect: Exclude<GoldenAspect, 'input'>; capture: (fixture: LoadedFixture) => unknown | Promise<unknown> }[] = [
  { aspect: 'footprints', capture: captureFootprints },
  { aspect: 'solids', capture: captureSolids },
  { aspect: 'surfaces', capture: captureSurfaces },
  { aspect: 'warnings', capture: captureWarnings },
  { aspect: 'lists', capture: captureLists },
  { aspect: 'document', capture: captureDocument },
  { aspect: 'pdf', capture: capturePdf },
];

const COMBINED_ASPECTS: { aspect: 'lists' | 'document' | 'pdf'; capture: () => unknown | Promise<unknown> }[] = [
  { aspect: 'lists', capture: () => captureCombinedLists(fixtures) },
  { aspect: 'document', capture: () => captureCombinedDocument(fixtures) },
  { aspect: 'pdf', capture: () => captureCombinedPdf(fixtures) },
];

for (const fixture of fixtures) {
  test(`golden ${fixture.name}: input matches fixtures.ts and the schemas`, () => {
    const generated = generatedFixtures().find(item => item.name === fixture.name);
    assert.ok(generated, `fixtures.ts no longer defines ${fixture.name}`);
    checkGolden(fixture.name, 'input', storedInput(generated), INPUT_DECIMALS);
    const { venue, layout } = fixture.scene;
    assert.deepEqual(layoutSchema.parse(layout), layout, 'layout must survive a second parse unchanged');
    assert.deepEqual(venueGeometrySchema.parse(venueGeometrySchema.encode(venue)), venue, 'venue must survive encode/parse unchanged');
  });
  for (const { aspect, capture } of ASPECTS) {
    test(`golden ${fixture.name}: ${aspect}`, async () => {
      checkGolden(fixture.name, aspect, await capture(fixture));
    });
  }
}

for (const { aspect, capture } of COMBINED_ASPECTS) {
  test(`golden ${COMBINED_NAME}: ${aspect}`, async () => {
    checkGolden(COMBINED_NAME, aspect, await capture());
  });
}

test('golden captures are deterministic within one process', async () => {
  for (const fixture of fixtures) {
    assert.deepEqual(captureSolids(fixture), captureSolids(fixture), `${fixture.name} solids`);
    assert.deepEqual(captureLists(fixture), captureLists(fixture), `${fixture.name} lists`);
    assert.deepEqual(captureDocument(fixture), captureDocument(fixture), `${fixture.name} document`);
  }
  const [first] = fixtures;
  assert.deepEqual(await capturePdf(first!), await capturePdf(first!));
});

test('golden directory holds exactly the expected files', () => {
  const expected = [
    ...fixtures.flatMap(fixture => ['input', ...ASPECTS.map(item => item.aspect)].map(aspect => `${fixture.name}/${aspect}.json`)),
    ...COMBINED_ASPECTS.map(item => `${COMBINED_NAME}/${item.aspect}.json`),
  ].sort();
  const found = goldenFilesOnDisk();
  if (updatingGoldens()) {
    for (const file of found) if (!expected.includes(file)) removeGoldenFile(file);
    return;
  }
  assert.deepEqual(found, expected);
});

test('golden fixtures cover every element kind and option the baseline claims', () => {
  const layouts = fixtures.map(fixture => fixture.scene.layout);
  const venues = fixtures.map(fixture => fixture.scene.venue);
  const walls = layouts.flatMap(layout => layout.walls);
  const types = new Set(layouts.flatMap(layout => layout.wallTypes ?? []).map(type => type.name));
  for (const name of ['Glattwand', 'Türwand · Scharnier links', 'Türwand · Scharnier rechts', 'Fensterwand', 'Bogen', 'Halbe Wand']) {
    assert.ok(types.has(name), `wall type ${name}`);
  }
  assert.ok(walls.some(wall => !wall.typeId), 'a wall without a type');
  assert.ok(walls.some(wall => ![0, 90, 180, 270].includes(wall.rotation)), 'a wall with a non-right rotation');
  assert.ok(walls.some(wall => (wall.doorOpenPercent ?? 0) > 0 && (wall.doorOpenPercent ?? 0) < 100), 'a partly open door');
  assert.ok(walls.some(wall => wall.surfaces?.front?.splitMm !== undefined), 'banded finish');
  assert.ok(walls.some(wall => wall.surfaces?.back && wall.surfaces.back.full), 'per-face finish');
  assert.ok(walls.some(wall => wall.assemblyNumber !== undefined), 'assembly numbers');
  assert.ok(walls.some(wall => wall.panelId), 'panel assignments');
  assert.ok(layouts.some(layout => (layout.connections ?? []).length > 0), 'hinge connections');
  assert.ok(layouts.some(layout => (layout.groups ?? []).length > 0), 'explicit groups');
  assert.ok(layouts.some(layout => (layout.cableRuns ?? []).length > 0), 'cable runs');
  assert.ok(layouts.some(layout => (layout.dimensions ?? []).length > 0), 'dimensions');
  assert.ok(layouts.some(layout => (layout.wallPictures ?? []).length > 0), 'wall pictures');
  const modes = new Set<string>(layouts.flatMap(layout => layout.braces).map(brace => brace.ballast?.mode ?? 'none'));
  for (const mode of ['none', 'single', 'heavy']) assert.ok(modes.has(mode), `ballast mode ${mode}`);
  assert.ok(layouts.flatMap(layout => layout.braces).some(brace => !brace.ballast), 'a brace without ballast field');
  const platforms = [...layouts.flatMap(layout => layout.platforms ?? []), ...venues.flatMap(venue => venue.platforms ?? [])];
  const styles = new Set<string>(platforms.map(platform => platform.style ?? 'floating'));
  for (const style of ['floating', 'solid', 'stageDeck']) assert.ok(styles.has(style), `platform style ${style}`);
  assert.ok(platforms.some(platform => platform.supportingSurfaceId && platform.supportingSurfaceId !== platform.id), 'stacked platform');
  assert.ok(layouts.some(layout => (layout.stairs ?? []).length > 0), 'stairs');
  const kinds = new Set([...layouts.flatMap(layout => layout.placeholders ?? []), ...venues.flatMap(venue => venue.placeholders ?? [])].map(item => item.kind));
  for (const kind of ['table', 'chair', 'person', 'speaker', 'box']) assert.ok(kinds.has(kind as never), `placeholder kind ${kind}`);
  assert.ok(layouts.flatMap(layout => layout.placeholders ?? []).some(item => item.seatedFigure), 'seated figure');
});

test('golden warnings fixture triggers every warning family and kind', () => {
  const fixture = fixtures.find(item => item.name === 'warnings')!;
  const found = new Set(neutralWarnings(fixture).map(item => `${item.family}:${item.kind}`));
  for (const key of [
    'overlap:scene', 'keep-clear:wall', 'keep-clear:brace', 'keep-clear:platform', 'keep-clear:stair', 'keep-clear:placeholder',
    'overhead:ceiling', 'overhead:overhead', 'placement:missing-surface', 'placement:unknown-surface',
    'inventory:unassigned', 'inventory:unavailable', 'inventory:duplicate', 'inventory:incompatible', 'inventory:shortage',
  ]) assert.ok(found.has(key), `warnings fixture must trigger ${key}`);
  const venueOverlap = fixtures.some(item => neutralWarnings(item).some(warning => warning.kind === 'venue'));
  assert.ok(venueOverlap, 'some fixture has a venue-level overlap');
});
