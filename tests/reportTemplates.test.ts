import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { newWall, newBrace, venueGeometrySchema, layoutSchema, type Layout } from '../src/shared/layout.js';
import { newPlaceholder } from '../src/shared/placeholders.js';
import { newPlatform } from '../src/shared/levels.js';
import {
  REPORT_A4_DRAWING_MM, REPORT_VIEW_LABELS, newReportFrame, newReportTemplate, rotateReportFrame,
  stripLayoutReportTemplates, liftReportTemplatesToVenue, reportFrameSchema, reportTemplateSchema,
  saveReportTemplatesSchema, type ReportFrame,
} from '../src/shared/reportTemplate.js';
import { planReportExtent, sceneryPlanPoints } from '../src/shared/planReportExtent.js';
import { planPreviewFromScene } from '../src/client/editor/PlanPreview.js';
import { captureTemplateLayout, duplicateLayout, applyVenueVersion } from '../src/shared/scenes.js';
import { freezeSnapshot } from '../src/shared/export.js';

const here = dirname(fileURLToPath(import.meta.url));

test('Standardblatt seeds plan (scenery), 3D orbit and front elevation on A4', () => {
  const template = reportTemplateSchema.parse(newReportTemplate(randomUUID()));
  assert.equal(template.pages.length, 1);
  assert.equal(template.pages[0]!.paper, 'a4');
  const kinds = template.pages[0]!.frames.map(frame => frame.kind);
  assert.deepEqual(kinds, ['plan', 'view3d', 'elevation']);
  const [plan, view3d, elevation] = template.pages[0]!.frames;
  assert.equal(plan!.planScope, 'scenery');
  assert.equal(view3d!.view, 'orbit');
  assert.equal(view3d!.label, REPORT_VIEW_LABELS.orbit);
  assert.equal(elevation!.view, 'front');
  assert.ok(plan!.x + plan!.width <= REPORT_A4_DRAWING_MM.width + 1);
  assert.ok(elevation!.y + elevation!.height <= REPORT_A4_DRAWING_MM.height + 1);
});

test('report frames accept every Kamerablick and both plan scopes', () => {
  for (const view of ['orbit', 'audience', 'top', 'front', 'side'] as const) {
    const frame = reportFrameSchema.parse(newReportFrame(randomUUID(), 'view3d', { view, label: REPORT_VIEW_LABELS[view] }));
    assert.equal(frame.view, view);
  }
  for (const planScope of ['scenery', 'venue'] as const) {
    const frame = reportFrameSchema.parse(newReportFrame(randomUUID(), 'plan', { planScope }));
    assert.equal(frame.planScope, planScope);
  }
});

test('rotateReportFrame swaps dimensions and toggles 0/90', () => {
  const frame = newReportFrame(randomUUID(), 'plan', { width: 110, height: 160 });
  const once = rotateReportFrame(frame);
  assert.equal(once.rotation, 90);
  assert.equal(once.width, 160);
  assert.equal(once.height, 110);
  const twice = rotateReportFrame(once);
  assert.equal(twice.rotation, 0);
  assert.equal(twice.width, 110);
  assert.equal(twice.height, 160);
});

test('saveReportTemplatesSchema rejects duplicate template ids', () => {
  const id = randomUUID();
  const a = newReportTemplate(id);
  const b = { ...newReportTemplate(randomUUID()), id };
  assert.equal(saveReportTemplatesSchema.safeParse({ reportTemplates: [a, b] }).success, false);
  assert.equal(saveReportTemplatesSchema.safeParse({ reportTemplates: [a] }).success, true);
});

test('venue geometry round-trips report templates with planScope and views', () => {
  const template = newReportTemplate(randomUUID());
  const frame = template.pages[0]!.frames.find(item => item.kind === 'plan')!;
  template.pages[0]!.frames = template.pages[0]!.frames.map(item =>
    item.id === frame.id ? { ...item, planScope: 'venue' as const, label: 'Grundriss Spielstätte' } : item);
  const venue = venueGeometrySchema.parse({
    schemaVersion: 1, width: 10000, depth: 8000, reportTemplates: [template],
  });
  assert.equal(venue.reportTemplates?.[0]!.pages[0]!.frames.find(item => item.kind === 'plan')!.planScope, 'venue');
  assert.equal(venue.reportTemplates?.[0]!.pages[0]!.frames.find(item => item.kind === 'view3d')!.view, 'orbit');
});

test('scenery plan extent excludes audience chairs and hugs set walls', () => {
  const wall = newWall(randomUUID(), 5000, 5000);
  const chair = newPlaceholder('chair', randomUUID(), 1500, 600);
  const table = newPlaceholder('table', randomUUID(), 4800, 4900);
  const venue = {
    schemaVersion: 1 as const, width: 14000, depth: 10000,
    placeholders: [chair],
  };
  const layout: Layout = {
    schemaVersion: 1, walls: [wall], braces: [], placeholders: [table],
  };
  const points = sceneryPlanPoints(venue, layout);
  assert.ok(points.every(point => point.y > 2000), 'audience chairs are not scenery points');
  const scenery = planReportExtent(venue, layout, 'scenery', 0);
  assert.ok(scenery.maxX - scenery.minX < 4000);
  assert.ok(scenery.minY > 3000);
  const full = planReportExtent(venue, layout, 'venue', 0);
  assert.deepEqual(full, { minX: 0, minY: 0, maxX: 14000, maxY: 10000 });
});

test('empty scenery falls back to the venue footprint', () => {
  const venue = { schemaVersion: 1 as const, width: 9000, depth: 7000 };
  const layout: Layout = { schemaVersion: 1, walls: [], braces: [] };
  assert.deepEqual(planReportExtent(venue, layout, 'scenery', 0), {
    minX: 0, minY: 0, maxX: 9000, maxY: 7000,
  });
});

test('plan preview origin follows scenery crop for Bühnenbild frames', () => {
  const wall = newWall(randomUUID(), 4000, 4500);
  const venue = { schemaVersion: 1 as const, width: 12000, depth: 9000 };
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [] };
  const scenery = planPreviewFromScene(venue, layout, 'scenery');
  const hall = planPreviewFromScene(venue, layout, 'venue');
  assert.ok((scenery.originX ?? 0) > 0);
  assert.ok((scenery.originY ?? 0) > 0);
  assert.equal(hall.originX ?? 0, 0);
  assert.equal(hall.originY ?? 0, 0);
  assert.ok(scenery.width < hall.width);
});

test('lift moves layout templates onto an empty venue and never overwrites existing ones', () => {
  const sceneTemplate = newReportTemplate(randomUUID(), 'Szeneblatt');
  const venueTemplate = newReportTemplate(randomUUID(), 'Saalblatt');
  const layout = layoutSchema.parse({
    schemaVersion: 1, walls: [], braces: [], reportTemplates: [sceneTemplate],
  });
  const empty = liftReportTemplatesToVenue(layout, { schemaVersion: 1 as const, width: 1, depth: 1 });
  assert.equal(empty.venue.reportTemplates?.[0]!.name, 'Szeneblatt');
  assert.equal(empty.layout.reportTemplates, undefined);
  const kept = liftReportTemplatesToVenue(layout, {
    schemaVersion: 1 as const, width: 1, depth: 1, reportTemplates: [venueTemplate],
  });
  assert.equal(kept.venue.reportTemplates?.[0]!.name, 'Saalblatt');
  assert.equal(kept.layout.reportTemplates, undefined);
});

test('stripLayoutReportTemplates removes only the deprecated field', () => {
  const wall = newWall(randomUUID(), 1000, 1000);
  const layout = layoutSchema.parse({
    schemaVersion: 1, walls: [wall], braces: [], reportTemplates: [newReportTemplate(randomUUID())],
  });
  const stripped = stripLayoutReportTemplates(layout);
  assert.equal(stripped.reportTemplates, undefined);
  assert.equal(stripped.walls[0]!.id, wall.id);
});

test('duplicate, capture and venue-apply never keep layout report templates', () => {
  const template = newReportTemplate(randomUUID());
  const layout = layoutSchema.parse({
    schemaVersion: 1, walls: [newWall(randomUUID(), 2000, 2000)], braces: [newBrace(randomUUID(), 1000, 1000)],
    reportTemplates: [template],
  });
  const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, reportTemplates: [template] };
  assert.equal(duplicateLayout(layout, randomUUID).reportTemplates, undefined);
  assert.equal(captureTemplateLayout(layout).reportTemplates, undefined);
  assert.equal(applyVenueVersion(layout, venue).layout.reportTemplates, undefined);
  assert.equal(venue.reportTemplates?.[0]!.id, template.id);
});

test('freezeSnapshot can carry venue report templates but PDF renderer source ignores them', () => {
  const template = newReportTemplate(randomUUID());
  const wall = newWall(randomUUID(), 2000, 3000);
  const snapshot = freezeSnapshot({
    id: randomUUID(), name: 'Probe', productionName: 'Show', venueName: 'Saal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(),
    venue: { schemaVersion: 1, width: 8000, depth: 6000, reportTemplates: [template] },
    layout: { schemaVersion: 1, walls: [wall], braces: [] },
    lease: null,
  }, { id: randomUUID(), name: 'Fassung Probe', issuedAt: new Date('2026-09-23T00:00:00.000Z') });
  assert.equal(snapshot.venue.reportTemplates?.[0]!.id, template.id);
  const pdfSource = readFileSync(join(here, '../src/server/exports/pdf.ts'), 'utf8');
  assert.equal(pdfSource.includes('reportTemplate'), false);
  assert.equal(pdfSource.includes('planScope'), false);
  assert.equal(pdfSource.includes('view3d'), false);
});

test('insertable frame factories keep construction defaults for PDF-ready metadata', () => {
  const plan = newReportFrame(randomUUID(), 'plan') as ReportFrame;
  const view = newReportFrame(randomUUID(), 'view3d', { view: 'front', label: REPORT_VIEW_LABELS.front });
  const elevation = newReportFrame(randomUUID(), 'elevation', { view: 'side', label: REPORT_VIEW_LABELS.side });
  assert.equal(plan.planScope, 'scenery');
  assert.equal(view.view, 'front');
  assert.equal(elevation.view, 'side');
  assert.equal(plan.rotation, 0);
});

test('platforms and braces enlarge scenery extent; chairs still do not', () => {
  const platform = newPlatform(randomUUID(), 6000, 5500);
  const brace = newBrace(randomUUID(), 6100, 5600);
  const chair = newPlaceholder('chair', randomUUID(), 500, 400);
  const venue = {
    schemaVersion: 1 as const, width: 12000, depth: 9000,
    placeholders: [chair], platforms: [platform],
  };
  const layout: Layout = { schemaVersion: 1, walls: [], braces: [brace] };
  const extent = planReportExtent(venue, layout, 'scenery', 0);
  assert.ok(extent.minY > 1000);
  assert.ok(extent.maxX > 5500);
});

test('report frames reject free FoV and camera position — only Kamerablick presets exist today', () => {
  const base = newReportFrame(randomUUID(), 'view3d', { view: 'orbit' });
  assert.equal(reportFrameSchema.safeParse({ ...base, fov: 40 }).success, false);
  assert.equal(reportFrameSchema.safeParse({ ...base, cameraPosition: { x: 1, y: 2, z: 3 } }).success, false);
  assert.equal(reportFrameSchema.safeParse({ ...base, viewport: { fov: 50 } }).success, false);
});

test('construction Kamerablick set matches sheet-editor insertables (no audience on construction sheets)', () => {
  const construction = ['orbit', 'top', 'front', 'side'] as const;
  for (const view of construction) {
    assert.equal(reportFrameSchema.parse(newReportFrame(randomUUID(), 'view3d', { view })).view, view);
  }
  assert.ok(REPORT_VIEW_LABELS.audience);
});
