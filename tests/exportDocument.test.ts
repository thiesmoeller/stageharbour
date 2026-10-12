import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freezeSnapshot, type ConstructionSnapshot } from '../src/shared/export.js';
import {
  bodyRect, composeDocument, contentBounds, coversPoint, defaultCamera, documentPagesFromTemplate, editablePagesFromSettings, pageEdgeMm, textBoxes,
  type ExportDocumentSpec, type FrozenScene,
} from '../src/shared/exportDocument.js';
import { newBrace, newWall, type Scene } from '../src/shared/layout.js';
import { newPlatform } from '../src/shared/levels.js';
import { newLightingFixture } from '../src/shared/hangPlan.js';
import { PAPER_SIZE_MM } from '../src/shared/tiling.js';
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

test('clipped drawing labels never create extra pages or leak into following sheets', async () => {
  const frozen = sceneWith([newWall(randomUUID(), 2000, 3000)]);
  const layout = composeDocument({ spec: spec(frozen.sceneId), scenes: [frozen], productionName: 'Pagination', issuedAtLabel: '10.10.2026' });
  const first = layout.sheets[0]!;
  first.frames[0]!.paint.push({ op: 'text', x: 40, y: first.heightMm + 30, text: 'OFF_PAGE_PODEST', size: 7, color: '#203c36', width: 30, height: 4 });
  const pdf = await renderDocument(layout);
  const document = await getDocument({ data: new Uint8Array(pdf) }).promise;
  assert.equal(document.numPages, layout.sheets.length);
  for (let index = 1; index <= document.numPages; index++) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    assert.ok(!content.items.some(item => 'str' in item && item.str.includes('OFF_PAGE_PODEST')));
  }
});

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


test('ballast appears in scene schedules and venue material sheets in the rendered PDF', async () => {
  const scene = sceneWith([]);
  scene.snapshot.layout.braces = [{ ...newBrace(randomUUID(), 1000, 1000), ballast: { mode: 'heavy' } }];
  const layout = composeDocument({ spec: spec(scene.sceneId, { kind: 'package' }), scenes: [scene],
    productionName: 'Ballast', issuedAtLabel: '29.09.2026', measure: createFontMeasure(),
    stock: { physicalPanels: 0, appearances: 0, panels: [], unassigned: [], unavailable: [], conflicts: [],
      venueMaterials: [{ venueId: randomUUID(), venueName: 'Saal A', required: { braces: 1, slabs: 2, straps: 1 },
        available: { slabs: 1, straps: 1 }, shortage: { slabs: 1, straps: 0 } }] },
  });
  const text = await pdfText(await renderDocument(layout));
  assert.match(text, /Gehwegplatten/);
  assert.match(text, /Spanngurte/);
  assert.match(text, /Materialbedarf/);
  assert.match(text, /Saal A/);
  assert.match(text, /Schwer/);
});

test('wrapped heavy-brace description does not overlap the following slab row in the PDF', async () => {
  const scene = sceneWith([]);
  scene.snapshot.layout.braces = [{ ...newBrace(randomUUID(), 1000, 1000), ballast: { mode: 'heavy' } }];
  const layout = composeDocument({ spec: spec(scene.sceneId), scenes: [scene], productionName: 'Ballast',
    issuedAtLabel: '29.09.2026', measure: createFontMeasure() });
  const pdf = await getDocument({
    data: new Uint8Array(await renderDocument(layout)), disableWorker: true, isEvalSupported: false,
  } as never).promise;
  let checked = false;
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    const items = content.items.filter(item => 'str' in item);
    const strap = items.find(item => /Spanngurt$/.test(item.str));
    const slab = items.find(item => item.str.includes('2 Stück'));
    if (!strap || !slab) continue;
    checked = true;
    assert.ok(strap.transform[5]! - slab.transform[5]! >= strap.height,
      `Wrapped brace text at y=${strap.transform[5]} overlaps slab row at y=${slab.transform[5]} (font height ${strap.height})`);
  }
  assert.ok(checked, 'Found brace and slab text on the parts-list page');
});

test('multiline parts-list rows paginate without clipping, losing rows or overflowing columns', () => {
  const scene = sceneWith([]);
  scene.snapshot.layout.braces = Array.from({ length: 70 }, (_, index) => ({ ...newBrace(randomUUID(), 1000, 1000),
    label: `Stütze-${index}-${'Langtext'.repeat(12)}`, ballast: { mode: 'heavy' as const } }));
  const measure = createFontMeasure();
  const layout = composeDocument({ spec: spec(scene.sceneId), scenes: [scene], productionName: 'Ballast',
    issuedAtLabel: '29.09.2026', measure });
  const schedules = layout.sheets.filter(sheet => sheet.title.startsWith('Stückliste'));
  assert.ok(schedules.length > 1);
  const numbers: string[] = [];
  for (const sheet of schedules) {
    const frame = sheet.frames[0]!;
    for (const item of frame.paint) {
      if (item.op !== 'text') continue;
      assert.ok(item.y + item.height <= frame.clip.y + frame.clip.height + 1e-8, 'Row stays within the page');
      assert.ok(measure(item.text, item.size, item.bold) <= item.width! + 1e-8, 'Even unbroken labels fit the column');
      if (item.x === frame.clip.x && /^\d+$/.test(item.text)) numbers.push(item.text);
    }
  }
  assert.deepEqual(numbers, Array.from({ length: 70 }, (_, index) => String(index + 1)));
});

test('planPaint emits door swings, deck module legs and large paper sizes', async () => {
  const platform = { ...newPlatform(randomUUID(), 3000, 2500), elevation: 400 };
  const frozen = sceneWith([{ ...newWall(randomUUID(), 2000, 3000), width: 2000 }], {
    schemaVersion: 1, width: 8000, depth: 6000, platforms: [platform],
  });
  const wall = frozen.snapshot.resolvedWalls[0]!;
  const [a, b] = wall.corners;
  const openingWidth = 900;
  const ux = (b!.x - a!.x) / Math.hypot(b!.x - a!.x, b!.y - a!.y);
  const uy = (b!.y - a!.y) / Math.hypot(b!.x - a!.x, b!.y - a!.y);
  const nx = uy, ny = -ux;
  const oa = { x: a!.x + ux * 200, y: a!.y + uy * 200 };
  const ob = { x: oa.x + ux * openingWidth, y: oa.y + uy * openingWidth };
  const oc = { x: ob.x + nx * wall.corners[0]!.x * 0 + nx * 28, y: ob.y + ny * 28 };
  const od = { x: oa.x + nx * 28, y: oa.y + ny * 28 };
  frozen.snapshot.resolvedWalls[0] = {
    ...wall,
    openings: [{
      id: randomUUID(), left: 200, sill: 0, width: openingWidth, height: 2000,
      corners: [oa, ob, oc, od],
    }],
  };
  frozen.snapshot.venue.platforms = [platform];
  const measure = createFontMeasure();
  for (const paper of ['A4', 'A3', 'A2', 'A1'] as const) {
    const layout = composeDocument({
      spec: spec(frozen.sceneId, { paper, scale: 50 }),
      scenes: [frozen], productionName: 'Beispielproduktion', issuedAtLabel: '09.10.2026', measure,
    });
    assert.equal(layout.sheets[0]?.paper, paper);
    assert.ok(layout.sheets[0]?.widthMm === PAPER_SIZE_MM[paper].width
      || layout.sheets[0]?.widthMm === PAPER_SIZE_MM[paper].height);
    const plan = layout.sheets.find(sheet => sheet.title === 'Grundriss');
    const paint = plan?.frames.flatMap(frame => frame.paint) ?? [];
    assert.ok(paint.some(item => item.op === 'circle'), `${paper} has deck/assembly circles`);
    assert.ok(paint.some(item => item.op === 'poly' && item.dash), `${paper} has door swing arc`);
    assert.ok(paint.some(item => item.op === 'text' && item.text.includes('+400')), `${paper} elevation stamp`);
  }
  const a2 = await renderDocument(composeDocument({
    spec: spec(frozen.sceneId, { paper: 'A2', orientation: 'landscape' }),
    scenes: [frozen], productionName: 'Beispielproduktion', issuedAtLabel: '09.10.2026', measure,
  }));
  assert.match(await pdfText(a2), /\+400/);
  assert.match(a2.toString('latin1'), /\/MediaBox \[0 0 1683\.779528 1190\.551181\]/);
});

test('audience camera preset uses the venue viewpoint', () => {
  const camera = defaultCamera({ minX: 0, minY: 0, maxX: 8000, maxY: 6000 }, 'audience', {
    x: 3500, y: -900, heightMm: 1250, targetX: 4000, targetY: 3000, targetHeightMm: 1100,
  });
  assert.equal(camera.preset, 'audience');
  assert.equal(camera.position.x, 3500);
  assert.equal(camera.position.y, 1250);
  assert.equal(camera.position.z, -900);
  assert.equal(camera.target.z, 3000);
});

test('hang fixtures and ballast slabs appear as labelled plan symbols', async () => {
  const trussId = randomUUID();
  const hangId = randomUUID();
  const sceneId = randomUUID();
  const scene: Scene = {
    id: sceneId, name: 'Hängeplan', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(),
    lease: null,
    venue: {
      schemaVersion: 1, width: 8000, depth: 6000,
      trusses: [{
        id: trussId, label: 'LX1', x: 4000, y: 3500, rotation: 0,
        length: 6000, sectionWidth: 400, bottomHeight: 3500, thickness: 300,
        hangPoints: [{ id: hangId, offsetMm: 0 }],
      }],
      hangPlan: {
        fixtures: [newLightingFixture(randomUUID(), trussId, hangId, 'fresnel', {
          label: 'F1', barnDoorsAttached: true, focus: { pan: 15 },
        })],
      },
    },
    layout: {
      schemaVersion: 1,
      walls: [newWall(randomUUID(), 1500, 2000)],
      braces: [{ ...newBrace(randomUUID(), 2500, 2500), ballast: { mode: 'heavy' } }],
    },
  };
  const frozen: FrozenScene = {
    sceneId, sceneName: scene.name, venueName: scene.venueName,
    snapshot: freezeSnapshot(scene, { id: randomUUID(), name: 'Hängeplan', issuedAt: new Date('2026-10-09T12:00:00.000Z') }),
  };
  assert.ok((frozen.snapshot.resolvedBraces[0]?.slabs?.length ?? 0) > 0);
  const measure = createFontMeasure();
  const layout = composeDocument({
    spec: spec(sceneId), scenes: [frozen], productionName: 'Beispielproduktion', issuedAtLabel: '09.10.2026', measure,
  });
  const plan = layout.sheets.find(sheet => sheet.title === 'Grundriss');
  const paint = plan?.frames.flatMap(frame => frame.paint) ?? [];
  assert.ok(paint.some(item => item.op === 'text' && item.text === 'F'), 'Fresnel symbol letter');
  assert.ok(paint.some(item => item.op === 'text' && item.text === 'F1'), 'fixture label');
  assert.ok(paint.some(item => item.op === 'line' && item.stroke === '#d97706'), 'focus arrow');
  assert.ok(paint.some(item => item.op === 'text' && /Platte/.test(item.text)), 'ballast slab count on plan');
  const text = await pdfText(await renderDocument(layout));
  assert.match(text, /F1/);
  assert.match(text, /Platte/);
});

test('narrow custom schedule frames wrap rows and report insufficient space', () => {
  const scene = sceneWith([]);
  scene.snapshot.layout.braces = [{ ...newBrace(randomUUID(), 1000, 1000), ballast: { mode: 'heavy' } }];
  const measure = createFontMeasure();
  const pages = documentPagesFromTemplate({ pages: [{ id: randomUUID(), name: 'Stückliste', paper: 'a4',
    frames: [{ id: randomUUID(), kind: 'schedule', x: 0, y: 0, width: 40, height: 20 }] }] }).pages;
  const layout = composeDocument({ spec: spec(scene.sceneId, { customPages: pages }), scenes: [scene], productionName: 'Ballast',
    issuedAtLabel: '29.09.2026', measure });
  const sheet = layout.sheets.find(sheet => sheet.frames.some(frame => frame.kind === 'schedule'))!;
  assert.ok(sheet.diagnostics.some(message => message.includes('Stückliste passt nicht vollständig')));
  const frame = sheet.frames.find(frame => frame.kind === 'schedule')!;
  for (const item of frame.paint) {
    if (item.op !== 'text') continue;
    assert.ok(measure(item.text, item.size) <= item.width!);
    assert.ok(item.y + item.height <= frame.clip.y + frame.clip.height);
  }
});
