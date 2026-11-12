import { composeDocument } from '../../src/shared/exportDocument.js';
import { germanDate } from '../../src/shared/export.js';
import { studioSpec } from '../../src/shared/documentStudio.js';
import { freezePackage } from '../../src/shared/package.js';
import { createFontMeasure } from '../../src/server/exports/documentPdf.js';
import { renderDocument } from '../../src/server/exports/documentPdf.js';
import { renderPackage } from '../../src/server/exports/packagePdf.js';
import { normalise, type Json } from './format.js';
import { pdfFingerprint } from './pdf.js';
import { frozenSceneOf, revisionOf, type LoadedFixture } from './capture.js';
import { GOLDEN_ISSUED_AT, GOLDEN_PRODUCTION_ID, GOLDEN_REVISION_NAME } from './fixtures.js';

export const COMBINED_NAME = 'all-scenes';

/** One production package over the synthetic fixture scenes (the demo seed has its own production): cross-scene stock, cover and parts-list sheets. */
function combinable(all: readonly LoadedFixture[]) {
  return all.filter(fixture => fixture.scene.productionId === GOLDEN_PRODUCTION_ID);
}

function combinedPackage(all: readonly LoadedFixture[]) {
  const fixtures = combinable(all);
  const first = fixtures[0]!;
  const panels = fixtures.flatMap(fixture => fixture.panels);
  const ballast = { slabs: 4, straps: 2 };
  const revision = { ...revisionOf(first), elevationGroupIds: [] as string[] };
  return freezePackage(fixtures.map(fixture => fixture.scene), revision, panels, ballast);
}

export function captureCombinedLists(all: readonly LoadedFixture[]): Json {
  const pkg = combinedPackage(all);
  return normalise({
    scenes: pkg.scenes.map(scene => ({ name: scene.sceneName, walls: scene.resolvedWalls.length, braces: scene.resolvedBraces.length })),
    sceneLists: pkg.sceneLists,
    stock: pkg.stock,
  });
}

function combinedDocument(all: readonly LoadedFixture[]) {
  const fixtures = combinable(all);
  const first = fixtures[0]!;
  const pkg = combinedPackage(fixtures);
  const spec = {
    ...studioSpec('technical', fixtures.map(fixture => fixture.scene.id), GOLDEN_REVISION_NAME),
    paper: first.document.paper, scale: first.document.scale,
  };
  return composeDocument({
    spec, scenes: fixtures.map(frozenSceneOf), productionName: first.scene.productionName,
    issuedAtLabel: germanDate(GOLDEN_ISSUED_AT), stock: pkg.stock, measure: createFontMeasure(),
  });
}

export function captureCombinedDocument(fixtures: readonly LoadedFixture[]): Json {
  return normalise({ document: combinedDocument(fixtures) });
}

export async function captureCombinedPdf(fixtures: readonly LoadedFixture[]): Promise<Json> {
  const pdf = await pdfFingerprint(await renderDocument(combinedDocument(fixtures)));
  const pkg = await pdfFingerprint(await renderPackage(combinedPackage(fixtures)));
  return JSON.parse(JSON.stringify({ document: pdf, package: pkg })) as Json;
}
