import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freezeSnapshot, type ConstructionSnapshot } from '../src/shared/export.js';
import {
  bodyRect, composeDocument, contentBounds, coversPoint, documentPagesFromTemplate, editablePagesFromSettings, pageEdgeMm, textBoxes,
  type ExportDocumentSpec, type FrozenScene,
} from '../src/shared/exportDocument.js';
import { newWall, type Scene } from '../src/shared/layout.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createFontMeasure, renderDocument } from '../src/server/exports/documentPdf.js';

async function pdfText(pdf: Buffer) {
  const params = { data: new Uint8Array(pdf), disableWorker: true, isEvalSupported: false };
  const document = await getDocument(params as never).promise;
  const pages = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
    const page = await document.getPage(index + 1);
    const content = await page.getTextContent();
    return content.items.map(item => 'str' in item ? item.str : '').join(' ');
  }));
  return pages.join('\n');
}

function sceneWith(walls: ReturnType<typeof newWall>[], venue: Scene['venue'] = { schemaVersion: 1, width: 8000, depth: 6000 }): FrozenScene {
  const scene: Scene = {
    id: randomUUID(), name: 'Erste Szene', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(),
    venue, lease: null, layout: { schemaVersion: 1, walls, braces: [] },
  };
  const snapshot = freezeSnapshot(scene, { id: randomUUID(), name: 'Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  return { sceneId: scene.id, sceneName: scene.name, venueName: scene.venueName, snapshot };
}

function spec(sceneId: string, extra: Partial<ExportDocumentSpec> = {}): ExportDocumentSpec {
  return {
    schemaVersion: 1, preset: 'construction', kind: 'scene', revisionName: 'Probe', paper: 'A4', orientation: 'portrait', scale: 50,
    scenes: [{ sceneId, elevationGroupIds: [] }], ...extra,
  };
}

function edgeLengthsMm(pdf: Buffer) {
  const ptPerMm = 72 / 25.4;
  const lengths: number[] = [];
  for (const block of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let x = 0, y = 0;
    for (const token of (block[1] ?? '').matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(m|l)/g)) {
      const nx = Number(token[1]), ny = Number(token[2]);
      if (token[3] === 'l') lengths.push(Math.hypot(nx - x, ny - y) / ptPerMm);
      x = nx; y = ny;
    }
  }
  return lengths;
}

test('a 1200 mm edge keeps 48, 24 and 12 mm at 1:25, 1:50 and 1:100', async () => {
  const frozen = sceneWith([newWall(randomUUID(), 2000, 3000)]);
  const measure = createFontMeasure();
  for (const scale of [25, 50, 100] as const) {
    const layout = composeDocument({ spec: spec(frozen.sceneId, { scale }), scenes: [frozen], productionName: 'Beispielproduktion', issuedAtLabel: '07.09.2026', measure });
    const pdf = await renderDocument(layout);
    const expected = pageEdgeMm(1200, scale);
    assert(edgeLengthsMm(pdf).some(length => Math.abs(length - expected) < 0.1), `${scale} ${edgeLengthsMm(pdf).slice(0, 8).join(',')}`);
    assert.equal(layout.sheets[0]?.scaleLabel, `1:${scale}`);
  }
});

test('rotated walls and negative coordinates stay inside a centred sheet', () => {
  const wall = { ...newWall(randomUUID(), -400, -200), rotation: 37 };
  const frozen = sceneWith([wall]);
  const layout = composeDocument({
    spec: spec(frozen.sceneId), scenes: [frozen], productionName: 'Beispielproduktion', issuedAtLabel: '07.09.2026',
  });
  const bounds = contentBounds(frozen.snapshot, {
    scenery: true, venueContext: true, audience: false, labels: true, dimensions: true, warnings: true,
    constraints: true, orientation: true, softGoods: true,
  });
  for (const corner of frozen.snapshot.resolvedWalls[0]!.corners) {
    assert.equal(coversPoint(layout, corner.x, corner.y), true, `${corner.x},${corner.y}`);
  }
  assert.ok(bounds.minX < 0 && bounds.minY < 0);
  const plan = layout.sheets.find(sheet => sheet.title === 'Grundriss');
  assert.ok(plan?.frames[0]?.window);
  const view = plan!.frames[0]!.window!;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  assert.ok(Math.abs((view.minX + view.maxX) / 2 - cx) < 1);
  assert.ok(Math.abs((view.minY + view.maxY) / 2 - cy) < 1);
});

test('construction plan crop hugs set pieces and ignores audience chairs by default', () => {
  const wall = newWall(randomUUID(), 4000, 4000);
  const frozen = sceneWith([wall]);
  const chair = {
    id: randomUUID(), kind: 'chair' as const, label: 'Parkett', width: 450, depth: 450, height: 900,
    corners: [
      { x: 1000, y: 200 }, { x: 1450, y: 200 }, { x: 1450, y: 650 }, { x: 1000, y: 650 },
    ] as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
  };
  frozen.snapshot = { ...frozen.snapshot, resolvedPlaceholders: [chair] };
  const layers = {
    scenery: true, venueContext: true, audience: false, labels: true, dimensions: true, warnings: true,
    constraints: true, orientation: true, softGoods: true,
  };
  const withoutAudience = contentBounds(frozen.snapshot, layers);
  assert.ok(withoutAudience.minY > 1000, 'chairs below the set stay outside the default crop');
  const withAudience = contentBounds(frozen.snapshot, { ...layers, audience: true });
  assert.ok(withAudience.minY < withoutAudience.minY);
});

test('plan text boxes do not overlap and notes paginate with a repeated heading', () => {
  const walls = Array.from({ length: 6 }, (_, index) => newWall(randomUUID(), 800 + index * 1300, 2000));
  const frozen = sceneWith(walls);
  frozen.snapshot = {
    ...frozen.snapshot,
    warnings: Array.from({ length: 80 }, (_, index) => ({
      objectId: walls[0]!.id, kind: 'ceiling' as const,
      message: `Hinweis ${index + 1}: Die lichte Höhe unter der Überbauung bleibt für die Crew nur dann lesbar, wenn der Satz auf die nächste Zeile umbrochen und nicht über andere Hinweise gelegt wird.`,
    })),
  } as ConstructionSnapshot;
  const layout = composeDocument({
    spec: spec(frozen.sceneId), scenes: [frozen], productionName: 'Beispielproduktion', issuedAtLabel: '07.09.2026',
  });
  for (const sheet of layout.sheets) {
    const boxes = textBoxes({ ...layout, sheets: [sheet] }).filter(box => box.width > 0 && box.height > 0);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        const hit = a.x < b.x + b.width - 0.2 && a.x + a.width > b.x + 0.2 && a.y < b.y + b.height - 0.2 && a.y + a.height > b.y + 0.2;
        assert.equal(hit, false, `${sheet.code} ${a.x},${a.y} vs ${b.x},${b.y}`);
      }
    }
  }
  const notes = layout.sheets.filter(sheet => sheet.title.startsWith('Hinweise'));
  assert.ok(notes.length >= 2);
  assert.ok(notes.some(sheet => sheet.title.includes('Fortsetzung')));
});

test('a missing 3D render stays in the PDF as a recoverable notice', async () => {
  const frozen = sceneWith([newWall(randomUUID(), 1000, 1000)]);
  const layout = composeDocument({
    spec: spec(frozen.sceneId, { preset: 'presentation' }),
    scenes: [frozen], productionName: 'Beispielproduktion', issuedAtLabel: '07.09.2026',
  });
  const pdf = await renderDocument(layout);
  assert.match(await pdfText(pdf), /3D-Ansicht konnte nicht gerendert werden/);
  assert.ok(layout.sheets.some(sheet => sheet.scaleLabel === 'ohne Maßstab'));
});

test('a captured Raumsicht PNG is embedded instead of the missing-render notice', async () => {
  const viewId = randomUUID();
  const frozen = sceneWith([newWall(randomUUID(), 1000, 1000)]);
  const layout = composeDocument({
    spec: spec(frozen.sceneId, {
      viewCameras: [{
        id: viewId, label: 'Umlaufansicht',
        camera: { projection: 'perspective', position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 1, z: 0 }, preset: 'orbit' },
      }],
    }),
    scenes: [frozen], productionName: 'Beispielproduktion', issuedAtLabel: '07.09.2026',
  });
  const frameId = `view-${frozen.sceneId}-${viewId}`;
  assert.ok(layout.sheets.some(sheet => sheet.frames.some(frame => frame.id === frameId)));
  // 1×1 red PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const text = await pdfText(await renderDocument(layout, new Map([[frameId, png]])));
  assert.doesNotMatch(text, /3D-Ansicht konnte nicht gerendert werden/);
});

test('wall marks show the play number and the inventory plate', async () => {
  const wall = { ...newWall(randomUUID(), 2000, 3000), assemblyNumber: 4 };
  const frozen = sceneWith([wall]);
  frozen.snapshot.resolvedWalls[0]!.assemblyNumber = 4;
  frozen.snapshot.resolvedWalls[0]!.panelLabel = 'PL-14';
  const layout = composeDocument({
    spec: spec(frozen.sceneId), scenes: [frozen], productionName: 'Beispielproduktion', issuedAtLabel: '07.09.2026',
  });
  const text = await pdfText(await renderDocument(layout, new Map()));
  assert.match(text, /PL-14/);
});

test('a plan crop keeps scale and several cameras each become a sheet', () => {
  const frozen = sceneWith([newWall(randomUUID(), 2000, 3000)]);
  const layout = composeDocument({
    spec: spec(frozen.sceneId, {
      orientation: 'auto',
      planCrop: { minX: 1000, minY: 2000, maxX: 4000, maxY: 5000 },
      viewCameras: [
        { id: randomUUID(), label: 'Publikumssicht', camera: { projection: 'perspective', position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 1, z: 0 }, preset: 'audience' } },
        { id: randomUUID(), label: 'Von oben', camera: { projection: 'orthographic', position: { x: 0, y: 8, z: 0 }, target: { x: 0, y: 0, z: 0 }, preset: 'top' } },
      ],
    }),
    scenes: [frozen], productionName: 'Beispielproduktion', issuedAtLabel: '07.09.2026',
  });
  assert.ok(layout.sheets.some(sheet => sheet.title === 'Übersicht'));
  assert.equal(layout.sheets.filter(sheet => sheet.title.startsWith('Raumsicht')).length, 2);
  for (const sheet of layout.sheets.filter(item => item.title.startsWith('Raumsicht'))) {
    assert.equal(sheet.orientation, 'landscape');
    assert.ok(sheet.widthMm > sheet.heightMm);
  }
  const plan = layout.sheets.find(sheet => sheet.title === 'Grundriss');
  assert.equal(plan?.frames[0]?.detail, true);
  assert.equal(plan?.scale, 50);
  const overview = layout.sheets.find(sheet => sheet.title === 'Übersicht')?.frames[0]?.window;
  assert.ok(overview && overview.minX <= 1000 && overview.maxX >= 4000 && overview.minY <= 2000 && overview.maxY >= 5000);
});

test('bookmarks and neighbour links are present and a template is not applied until asked', async () => {
  const frozen = sceneWith([newWall(randomUUID(), 1000, 1000)]);
  const layout = composeDocument({
    spec: spec(frozen.sceneId), scenes: [frozen], productionName: 'Beispielproduktion', issuedAtLabel: '07.09.2026',
  });
  const pdf = await renderDocument(layout);
  const latin = pdf.toString('latin1');
  assert.match(latin, /\/Outlines/);
  assert.match(latin, /Grundriss/);
  const adapted = documentPagesFromTemplate({
    pages: [{
      id: randomUUID(), name: 'Blatt 1', paper: 'a4',
      frames: [{ id: randomUUID(), kind: 'plan', x: 0, y: 0, width: 400, height: 400, label: 'Zu groß' }],
    }],
  });
  assert.ok(adapted.repairs.some(item => item.message.includes('außerhalb')));
  assert.equal(layout.sheets.some(sheet => sheet.title === 'Zu groß'), false);
});

test('editablePagesFromSettings seeds a plan frame for Layout bearbeiten', () => {
  const pages = editablePagesFromSettings({ paper: 'A4', orientation: 'auto', scale: 50, sceneId: randomUUID(), name: 'Fassung' });
  assert.equal(pages.length, 1);
  assert.equal(pages[0]!.name, 'Fassung');
  assert.equal(pages[0]!.orientation, 'portrait');
  assert.equal(pages[0]!.frames[0]!.kind, 'plan');
  assert.equal(pages[0]!.frames[0]!.scale, 50);
  const body = bodyRect('A4', 'portrait');
  assert.equal(pages[0]!.frames[0]!.width, body.width);
  assert.equal(pages[0]!.frames[0]!.height, body.height);
});

test('PDF includes the full raised stage even when scene walls occupy only one corner', async () => {
  const outline = [{ x: 12000, y: 1000 }, { x: 16000, y: 1000 }, { x: 16000, y: 5000 }, { x: 12000, y: 5000 }];
  const frozen = sceneWith([newWall(randomUUID(), 1000, 1000)], {
    schemaVersion: 1, width: 18000, depth: 8000,
    platforms: [{ id: randomUUID(), label: 'Raised stage', elevation: 600, outline }],
  });
  const layout = composeDocument({ spec: spec(frozen.sceneId), scenes: [frozen], productionName: 'Test', issuedAtLabel: '28.09.2026' });
  for (const point of outline) assert.ok(coversPoint(layout, point.x, point.y), `stage corner cropped: ${point.x},${point.y}`);
  const text = await pdfText(await renderDocument(layout));
  assert.match(text, /Raised stage/);
});

test('whole-venue scope covers the room while set-only framing stays available', () => {
  const frozen = sceneWith([newWall(randomUUID(), 1500, 1500)], { schemaVersion: 1, width: 18000, depth: 14000 });
  const layout = composeDocument({ spec: spec(frozen.sceneId, { planScope: 'venue' }), scenes: [frozen], productionName: 'Test', issuedAtLabel: '28.09.2026' });
  for (const point of [{ x: 0, y: 0 }, { x: 18000, y: 14000 }]) assert.ok(coversPoint(layout, point.x, point.y));
});
