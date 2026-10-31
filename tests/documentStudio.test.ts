import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newWall, type Scene } from '../src/shared/layout.js';
import { bodyRect, documentDraftSchema, coversPoint, sheetSizeMm } from '../src/shared/exportDocument.js';
import {
  arrangedPages, constrainFrame, duplicateStudioPage, editableDrawingPage, moveStudioFrame,
  newStudioPage, newStudioFrame, PAGE_LAYOUTS, resizeStudioFrame, studioLayout, studioSpec,
} from '../src/shared/documentStudio.js';

function fixture(): Scene {
  return {
    id: randomUUID(), name: 'Aufbau', productionName: 'Studio-Probe', venueName: 'Saal',
    productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(), revision: 1, lease: null,
    venue: { schemaVersion: 1, width: 8000, depth: 6000 },
    layout: { schemaVersion: 1, walls: [newWall(randomUUID(), 2000, 3000)], braces: [] },
  };
}
const date = new Date('2026-10-31T12:00:00Z');

test('arranging and duplicating automatic pages retains live covers, complete schedules and notes', () => {
  const scene = fixture();
  const spec = studioSpec('technical', [scene.id]);
  const initial = studioLayout(spec, [scene], date);
  assert.ok(initial.sheets.some(sheet => sheet.title === 'Stückliste'));
  const pages = arrangedPages(initial).reverse();
  const copy = duplicateStudioPage(pages[0]!);
  const arranged = studioLayout({ ...spec, customPages: [...pages, copy] }, [scene], date);
  assert.deepEqual(arranged.sheets.slice(0, -1).map(sheet => sheet.frames.map(frame => frame.paint.filter(item => item.op !== 'link'))), initial.sheets.toReversed().map(sheet => sheet.frames.map(frame => frame.paint.filter(item => item.op !== 'link'))));
  assert.equal(arranged.pageCount, initial.pageCount + 1);
  assert.notEqual(copy.id, pages[0]!.id);
  const changedScene = { ...scene, layout: { ...scene.layout, walls: [...scene.layout.walls, newWall(randomUUID(), 3000, 3000)] } };
  const refreshed = studioLayout({ ...spec, customPages: pages }, [changedScene], date);
  assert.notDeepEqual(refreshed.sheets.find(sheet => sheet.title === 'Stückliste')?.frames, initial.sheets.find(sheet => sheet.title === 'Stückliste')?.frames);
});

test('removing an automatic source fails visibly instead of substituting a different page', () => {
  const scene = fixture(); const spec = studioSpec('technical', [scene.id]);
  const pages = arrangedPages(studioLayout(spec, [scene], date));
  pages[0]!.automaticKey = 'missing-source';
  assert.throws(() => studioLayout({ ...spec, customPages: pages }, [scene], date), /nicht mehr verfügbar/);
});

test('all layout presets create valid independently editable pages inside the sheet body', () => {
  const scene = fixture(); const spec = studioSpec('technical', [scene.id]);
  for (const layout of PAGE_LAYOUTS) {
    const page = newStudioPage(spec, scene.id, layout.id);
    assert.equal(page.frames.length, layout.kinds.length);
    assert.ok(documentDraftSchema.safeParse({ spec: { ...spec, customPages: [page] } }).success);
    const body = bodyRect(page.paper, page.orientation);
    for (const frame of page.frames) {
      assert.ok(frame.x >= body.x && frame.y >= body.y);
      assert.ok(frame.x + frame.width <= body.x + body.width + 0.01);
      assert.ok(frame.y + frame.height <= body.y + body.height + 0.01);
    }
  }
});

test('detaching a drawing keeps other automatic pages and binds the frame to its original scene', () => {
  const scene = fixture(); const second = { ...fixture(), productionId: scene.productionId, name: 'Anderes Bühnenbild' };
  const spec = studioSpec('technical', [scene.id, second.id]);
  const initial = studioLayout(spec, [scene, second], date);
  const source = initial.sheets.find(sheet => sheet.sourceKey?.startsWith(second.id) && sheet.frames[0]?.kind === 'plan')!;
  const pages = arrangedPages(initial);
  const index = pages.findIndex(page => page.automaticKey === source.sourceKey);
  pages[index] = editableDrawingPage(pages[index]!, source, spec);
  assert.equal(pages[index]!.automaticKey, undefined);
  assert.equal(pages[index]!.frames[0]!.source.sceneId, second.id);
  assert.equal(pages[index]!.frames[0]!.scale, 50);
  const result = studioLayout({ ...spec, customPages: pages }, [scene, second], date);
  assert.ok(result.sheets.some(sheet => sheet.title === 'Stückliste'));
});

test('moving and resizing a viewport never changes construction scale and continuations follow the parent', () => {
  const scene = fixture(); const spec = studioSpec('technical', [scene.id]);
  const page = newStudioPage({ ...spec, paper: 'A4', orientation: 'portrait' }, scene.id);
  page.frames[0] = { ...page.frames[0]!, width: 70, height: 60, scale: 50 };
  const original = page.frames[0]!;
  const resized = resizeStudioFrame(original, 10, 5, page);
  assert.equal(resized.scale, 50);
  const result = studioLayout({ ...spec, planScope: 'venue', customPages: [{ ...page, frames: [resized] }] }, [scene], date);
  assert.equal(result.sheets[0]!.title, page.name);
  assert.ok(result.pageCount > 1);
  for (const sheet of result.sheets) for (const frame of sheet.frames) {
    assert.equal(frame.scale, 50);
    assert.equal(frame.window!.maxX - frame.window!.minX, frame.clip.width * 50);
    assert.equal(frame.window!.maxY - frame.window!.minY, frame.clip.height * 50);
  }
  for (const point of [{ x: 0, y: 0 }, { x: 8000, y: 6000 }, { x: 2000, y: 3000 }]) assert.ok(coversPoint(result, point.x, point.y));
});

test('snapping uses screen tolerance and frame placement remains inside the printable body', () => {
  const page = newStudioPage({ paper: 'A3', orientation: 'landscape', scale: 50 }, randomUUID());
  const body = bodyRect(page.paper, page.orientation);
  const frame = { ...page.frames[0]!, width: 50, height: 50, x: body.x + 20, y: body.y + 20 };
  const nearAt100 = moveStudioFrame(frame, -18, 0, page, 2);
  const nearAt200 = moveStudioFrame(frame, -19, 0, page, 4);
  assert.equal(nearAt100.frame.x, body.x); assert.equal(nearAt200.frame.x, body.x);
  assert.equal(moveStudioFrame(frame, -18, 0, page, 2, false).frame.x, body.x + 2);
  const bounded = constrainFrame({ ...frame, x: -100, y: 9000, width: 10000 }, page);
  assert.equal(bounded.x, body.x);
  assert.ok(bounded.y + bounded.height <= body.y + body.height);
});

test('long custom text produces continuation pages without losing the last line', () => {
  const scene = fixture(); const spec = studioSpec('technical', [scene.id]);
  const page = newStudioPage(spec, scene.id);
  page.frames = [newStudioFrame('notes', { x: 12, y: 32, width: 70, height: 12 }, scene.id, 50)];
  page.frames[0]!.text = Array.from({ length: 30 }, (_, index) => `Zeile ${index + 1}`).join('\n');
  const result = studioLayout({ ...spec, customPages: [page] }, [scene], date);
  assert.equal(result.sheets[0]!.title, page.name);
  assert.ok(result.pageCount > 1);
  const text = result.sheets.flatMap(sheet => sheet.frames.flatMap(frame => frame.paint.filter(item => item.op === 'text').map(item => item.text))).join(' ');
  assert.match(text, /Zeile 30/);
});

test('source, per-frame layers and free text survive the persisted document contract', () => {
  const scene = fixture(); const spec = studioSpec('technical', [scene.id]);
  const page = newStudioPage(spec, scene.id, 'plan-notes');
  page.frames[0]!.layers = { dimensions: false, warnings: false };
  page.frames[1]!.text = 'Aufbau ab 09:00 Uhr';
  const stored = documentDraftSchema.parse(JSON.parse(JSON.stringify({ spec: { ...spec, customPages: [page] } })));
  assert.equal(stored.spec.customPages![0]!.frames[0]!.source.sceneId, scene.id);
  assert.equal(stored.spec.customPages![0]!.frames[0]!.layers!.dimensions, false);
  assert.equal(stored.spec.customPages![0]!.frames[1]!.text, 'Aufbau ab 09:00 Uhr');
  const duplicate = duplicateStudioPage(page);
  assert.notEqual(duplicate.frames[0]!.id, page.frames[0]!.id);
  assert.equal(sheetSizeMm(duplicate.paper, duplicate.orientation).width, 420);
});

test('automatic schedules gain their new continuation sheets after a source grows', () => {
  const scene = fixture(); const spec = studioSpec('technical', [scene.id]);
  const pages = arrangedPages(studioLayout(spec, [scene], date));
  const grown = { ...scene, layout: { ...scene.layout, walls: Array.from({ length: 100 }, (_, index) => ({ ...newWall(randomUUID(), 2000 + index * 5, 3000), label: `Position ${index + 1} · Eine lange Bezeichnung für die Werkstatt und das Aufbauteam` })) } };
  const automatic = studioLayout(spec, [grown], date);
  const arranged = studioLayout({ ...spec, customPages: pages }, [grown], date);
  const schedules = (layout: ReturnType<typeof studioLayout>) => layout.sheets.filter(sheet => sheet.title.startsWith('Stückliste')).flatMap(sheet => sheet.frames.flatMap(frame => frame.paint.filter(item => item.op === 'text').map(item => item.text)));
  assert.deepEqual(schedules(arranged), schedules(automatic));
  assert.ok(arranged.sheets.some(sheet => sheet.title === 'Stückliste (Fortsetzung)'));
});

test('production-wide preview retains material and stock sheets, including large paper sizes', () => {
  const scene = fixture(); const spec = { ...studioSpec('technical', [scene.id]), kind: 'package' as const, paper: 'A2' as const };
  const initial = studioLayout(spec, [scene], date);
  assert.ok(initial.sheets.some(sheet => sheet.title === 'Bestand'));
  assert.ok(initial.sheets.some(sheet => sheet.title.startsWith('Materialbedarf')));
  const pages = [...arrangedPages(initial), newStudioPage(spec, scene.id, 'plan-notes')];
  const edited = studioLayout({ ...spec, customPages: pages }, [scene], date);
  assert.ok(edited.sheets.some(sheet => sheet.title === 'Bestand'));
  assert.ok(edited.sheets.every(sheet => sheet.paper === 'A2'));
});

test('the cover overview shows the whole venue even when scenery sits at its back edge', () => {
  const scene = fixture(); scene.layout.walls = [newWall(randomUUID(), 7800, 5800)];
  const spec = { ...studioSpec('technical', [scene.id]), orientation: 'landscape' as const };
  const cover = studioLayout(spec, [scene], date).sheets[0]!;
  const frame = cover.frames[0]!;
  const venueOutline = frame.paint.find(item => item.op === 'poly' && item.stroke === '#718469');
  assert.ok(venueOutline?.op === 'poly');
  for (const point of venueOutline.points) {
    assert.ok(point.x >= frame.clip.x && point.x <= frame.clip.x + frame.clip.width);
    assert.ok(point.y >= frame.clip.y && point.y <= frame.clip.y + frame.clip.height);
  }
});
