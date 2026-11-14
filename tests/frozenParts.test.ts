import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { elevationFaces } from '../src/shared/elevations.js';
import { constructionSnapshotSchema, freezeSnapshot } from '../src/shared/export.js';
import { composeDocument, type DocumentLayout } from '../src/shared/exportDocument.js';
import { frozenLists, resolveFrozen } from '../src/shared/frozenParts.js';
import type { Layout, LayoutObject, Scene } from '../src/shared/layout.js';
import { createLayoutPartIndex, resolveLayoutObjects } from '../src/shared/layoutObjects.js';
import { elevationOutline, planFigure, planSymbol } from '../src/shared/partDrawings.js';
import { STARTER_LIBRARY, STARTER_PART_IDS } from '../src/shared/parts/starter/index.js';
import { snapshotPlanSymbols } from '../src/shared/planFeatures.js';

const ref = (id: string) => ({ id, revision: 1 });
const wall = (label: string, x: number, variant = 'plain', extra: Partial<LayoutObject> = {}): LayoutObject => ({
  id: randomUUID(), label, part: ref(STARTER_PART_IDS.wall), variant, values: { B: 1200, H: 2400, D: 28 },
  x, y: 3000, rotation: 0, ...extra,
});

function scene(layout: Layout): Scene {
  return {
    id: randomUUID(), name: 'Erste Szene', productionName: 'Produktion', venueName: 'Saal', revision: 1,
    productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(),
    venue: { schemaVersion: 1, width: 9000, depth: 7000 }, lease: null, layout,
  };
}

function studioTitles(layout: DocumentLayout) {
  const paints = layout.sheets.flatMap(sheet => [...sheet.paint, ...sheet.frames.flatMap(frame => frame.paint)]);
  return {
    titles: layout.sheets.map(sheet => sheet.title),
    text: paints.flatMap(paint => paint.op === 'text' ? [paint.text] : []).join('\n'),
  };
}

const freshIndex = () => createLayoutPartIndex(structuredClone(STARTER_LIBRARY));

test('a frozen snapshot inlines the exact revisions, child parts and materials its objects use', () => {
  const door = wall('Tür', 1200, 'doorLeft');
  const piece = { id: randomUUID(), label: 'W-07', partId: STARTER_PART_IDS.wall, variantKey: 'doorLeft', usable: true, archived: false };
  const other = { id: randomUUID(), label: 'T-01', partId: STARTER_PART_IDS.table, variantKey: null, usable: true, archived: false };
  const snapshot = freezeSnapshot(scene({ schemaVersion: 2, objects: [wall('Glatt', 0), { ...door, stockItemId: piece.id }], joints: [] }),
    { id: randomUUID(), name: 'Fassung 1', issuedAt: new Date('2026-11-01T10:00:00Z') },
    { index: freshIndex(), stock: { items: [piece, other], counts: [{ materialKey: 'betonplatte-400', partId: null, variantKey: null, quantity: 4 }] } });
  assert.deepEqual(snapshot.library.parts.map(part => part.id).sort(), [STARTER_PART_IDS.wall, STARTER_PART_IDS.door].sort());
  const materials = snapshot.library.materials.map(material => material.key);
  assert.ok(materials.includes('tischlerplatte-28'));
  assert.ok(materials.includes('tuerrahmen-25x50'), 'materials of the child door are inlined');
  assert.deepEqual(snapshot.stock.items.map(item => item.label), ['W-07'], 'only pieces of the parts in use');
  assert.deepEqual(snapshot.stock.counts, [], 'counts of materials the layout does not use are left out');
});

test('a frozen snapshot renders the same after the library changes and after a JSON round-trip', () => {
  const index = freshIndex();
  const a = wall('A', 0, 'window');
  const b = wall('B', 1200, 'doorLeft');
  const groupId = randomUUID();
  const layout: Layout = {
    schemaVersion: 2, objects: [a, b], joints: [{ a: { object: a.id, connector: 'rechts' }, b: { object: b.id, connector: 'links' } }],
    groups: [{ id: groupId, members: [{ kind: 'object', id: a.id }, { kind: 'object', id: b.id }], rotation: 0 }],
  };
  const snapshot = freezeSnapshot(scene(layout), {
    id: randomUUID(), name: 'Fassung 1', issuedAt: new Date('2026-11-01T10:00:00Z'), elevationGroupIds: [groupId],
  }, { index });
  const before = { lists: frozenLists(snapshot), faces: elevationFaces(snapshot), symbols: snapshotPlanSymbols(snapshot) };
  const live = index.part(ref(STARTER_PART_IDS.wall))!;
  live.bodies[0] = { ...live.bodies[0]!, material: 'sperrholz-12' } as typeof live.bodies[number];
  live.name = 'Umbenannt';
  const reparsed = constructionSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
  const after = { lists: frozenLists(reparsed), faces: elevationFaces(reparsed), symbols: snapshotPlanSymbols(reparsed) };
  assert.deepEqual(after, before);
  assert.equal(before.lists.cutList.sheets[0]?.material, 'tischlerplatte-28');
  assert.equal(before.lists.objects[0]?.partName, 'Wandelement');
  assert.notDeepEqual(
    resolveLayoutObjects(layout, index)[0]!.resolved.cutList.sheets[0]?.material,
    before.lists.cutList.sheets[0]?.material,
    'the live library did change',
  );
  assert.deepEqual(resolveFrozen(reparsed).assembly.chains, [[a.id, b.id]]);
  assert.deepEqual(before.faces.map(face => face.panels.map(panel => [panel.label, panel.assemblyNumber])), [[['A', 1], ['B', 2]]]);
});

test('plan symbols draw floor gaps and the door swing; solids and stairs add their own strokes', () => {
  const index = freshIndex();
  const [plain, door, table, chair, stair] = resolveLayoutObjects({
    schemaVersion: 2, joints: [], objects: [
      wall('Glatt', 0), wall('Tür', 2000, 'doorLeft'),
      { id: randomUUID(), label: 'Tisch', part: ref(STARTER_PART_IDS.table), x: 5000, y: 2000, rotation: 0 },
      { id: randomUUID(), label: 'Stuhl', part: ref(STARTER_PART_IDS.chair), x: 6000, y: 2000, rotation: 0 },
      { id: randomUUID(), label: 'Treppe', part: ref(STARTER_PART_IDS.stair), x: 7000, y: 2000, rotation: 0 },
    ],
  }, index);
  assert.deepEqual(planSymbol(plain!).strokes, []);
  const kinds = planSymbol(door!).strokes.map(stroke => stroke.kind);
  assert.deepEqual(kinds, ['opening', 'leaf', 'swing']);
  const swing = planSymbol(door!).strokes.find(stroke => stroke.kind === 'swing')!;
  const pivot = planSymbol(door!).strokes.find(stroke => stroke.kind === 'leaf')!.points[0]!;
  const radius = Math.hypot(swing.points[0]!.x - pivot.x, swing.points[0]!.y - pivot.y);
  assert.ok(Math.abs(radius - 800) < 1, `door swing radius ${radius}`);
  assert.ok(swing.points.every(point => point.y <= 3000 + 1), 'the door swings towards the audience');
  assert.deepEqual(planSymbol(table!).strokes, [], 'footprint symbols draw only the outline');
  assert.equal(planSymbol(table!).footprint.length, 4);
  const chairStrokes = planSymbol(chair!).strokes;
  assert.ok(chairStrokes.length > 1 && chairStrokes.every(stroke => stroke.kind === 'solid' && stroke.closed));
  assert.ok(planSymbol(stair!).strokes.some(stroke => stroke.kind === 'step'));
});

function edgeLengths(points: readonly { x: number; y: number }[]): number[] {
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length]!;
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
}

/** Edges of a rectangle in plan run with the axes; a chamfered jamb does not. */
function assertRectilinear(polygons: readonly { x: number; y: number }[][], label: string) {
  for (const points of polygons) {
    assert.ok(points.length >= 4, label);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!;
      const next = points[(index + 1) % points.length]!;
      const dx = Math.abs(next.x - point.x);
      const dy = Math.abs(next.y - point.y);
      assert.ok(dx < 0.5 || dy < 0.5, `${label} has a diagonal edge`);
    }
  }
}

test('an open door is a wall with a thin leaf, a rectangular reveal and a frame rim', () => {
  const index = freshIndex();
  const placed = (variant: string, open: number, rotation = 0) => resolveLayoutObjects({
    schemaVersion: 2, joints: [], objects: [
      wall('Wand', 0, variant, { state: { open }, rotation }),
    ],
  }, index)[0]!;
  const plain = planFigure(placed('plain', 0));
  const shutObject = placed('doorLeft', 0);
  const shut = planFigure(shutObject);
  assert.equal(plain.leaves.length, 0);
  assert.equal(plain.frames.length, 0);
  assert.deepEqual(plain.fill, placed('plain', 0).footprint);
  assert.ok(shutObject.footprint.some(point => point.y < 2980), 'the selection hull still includes the frame');
  assert.deepEqual(shut.fill, plain.fill, 'a shut door paints the wall sheet, not a chamfer into the frame');
  assert.equal(shut.openings.length, 1);
  assertRectilinear(shut.openings, 'reveal');
  assertRectilinear(shut.frames, 'frame');
  assert.ok(shut.frames.length >= 2, 'the frame is a rim of jambs around the opening');
  assert.equal(shut.leaves.length, 1);
  assert.equal(shut.leaves[0]!.arc.length, 0, 'a shut leaf draws no swing');
  const shutShort = edgeLengths(shut.leaves[0]!.slab).filter(length => length < 100);
  assert.ok(shutShort.length >= 2 && shutShort.every(length => Math.abs(length - 40) < 1), 'shut leaf keeps the real door thickness');

  const open = placed('doorLeft', 40);
  const figure = planFigure(open);
  assert.ok(open.footprint.some(point => point.y < 3000 - 200), 'the stored hull still covers the swung leaf');
  assert.deepEqual(figure.fill, plain.fill, 'the painted wall stays the sheet, without diagonal jambs');
  assert.equal(figure.leaves.length, 1);
  assert.equal(figure.openings.length, 1);
  assertRectilinear(figure.openings, 'reveal');
  assertRectilinear(figure.frames, 'frame');
  const frameXs = figure.frames.flatMap(frame => frame.map(point => point.x));
  const frameYs = figure.frames.flatMap(frame => frame.map(point => point.y));
  assert.ok(Math.min(...frameXs) > -500 && Math.max(...frameXs) < 500, 'the frame rims the opening instead of cutting the wall ends');
  assert.ok(Math.min(...frameYs) < 2986 - 20, 'the frame stands proud of the wall face as a rectangular rim');
  const [hinge, tip] = figure.leaves[0]!.points;
  assert.ok(tip.y < hinge.y - 200, 'the leaf swings toward the audience');
  assert.ok(Math.abs(Math.hypot(tip.x - hinge.x, tip.y - hinge.y) - 800) < 2, 'leaf length is the clear opening');
  const openShort = edgeLengths(figure.leaves[0]!.slab).filter(length => length < 100);
  assert.ok(openShort.length >= 2 && openShort.every(length => Math.abs(length - 40) < 1), 'open leaf is the 40 mm slab, not the wall depth');
  const arc = figure.leaves[0]!.arc;
  assert.ok(arc.length > 2 && arc.every(point => point.y <= 3000 + 1), 'the swing arc stays on the audience side of the wall');

  const right = planFigure(placed('doorRight', 100));
  const [rightHinge, rightTip] = right.leaves[0]!.points;
  assert.ok(rightTip.x < rightHinge.x && rightTip.y < rightHinge.y, 'a right-hand leaf swings the other way');
  const rightShort = edgeLengths(right.leaves[0]!.slab).filter(length => length < 100);
  assert.ok(rightShort.every(length => Math.abs(length - 40) < 1));

  const turned = planFigure(placed('doorLeft', 100, 90));
  assert.ok(turned.fill.every(point => Math.abs(point.x) < 100), 'a rotated open door still paints the wall, not the swing');
  assert.ok(turned.leaves[0]!.points[1]!.x > turned.leaves[0]!.points[0]!.x + 200);
  assert.ok(edgeLengths(turned.leaves[0]!.slab).some(length => Math.abs(length - 40) < 1), 'a rotated leaf stays 40 mm thick');
  assertRectilinear(turned.frames, 'rotated frame');
});

test('elevations project front faces with their cut-outs and heights above the floor', () => {
  const index = freshIndex();
  const [window, door, turned] = resolveLayoutObjects({
    schemaVersion: 2, joints: [], objects: [
      wall('Fenster', 0, 'window', { values: { B: 1200, H: 2400, D: 28, fensterLeft: 200, fensterSill: 900, fensterB: 600, fensterH: 800 } }),
      wall('Tür', 2000, 'doorLeft'),
      wall('Gedreht', 4000, 'plain', { rotation: 90 }),
    ],
  }, index);
  const outline = elevationOutline(window!, 0);
  assert.deepEqual([Math.round(outline.left), Math.round(outline.width), Math.round(outline.bottom), Math.round(outline.height)], [-600, 1200, 0, 2400]);
  assert.equal(outline.polygons[0]?.holes.length, 1);
  assert.deepEqual(outline.openings.map(item => [item.left, item.sill, item.width, item.height].map(Math.round)), [[200, 900, 600, 800]]);
  const doorway = elevationOutline(door!, 0);
  assert.equal(doorway.polygons[0]?.holes.length, 0, 'a door reaching the floor notches the outline');
  assert.deepEqual(doorway.openings.map(item => [item.left, item.sill, item.width].map(Math.round)), [[200, 0, 800]]);
  const side = elevationOutline(turned!, 90);
  assert.equal(Math.round(side.width), 1200);
  const back = elevationOutline(window!, 0, 'back');
  assert.equal(Math.round(back.left), -600);
  assert.equal(Math.round(back.openings[0]!.left), 1200 - 200 - 600, 'seen from behind the window sits mirrored');
});

test('technical documents list parts, cuts, stock demand and the assembly order', () => {
  const index = freshIndex();
  const a = wall('A', 0);
  const b = wall('B', 1200);
  const layout: Layout = {
    schemaVersion: 2, objects: [a, b, { id: randomUUID(), label: 'Stütze', part: ref(STARTER_PART_IDS.brace), variant: 'standard', values: { ballast: 2 }, x: 0, y: 3600, rotation: 0 }],
    joints: [{ a: { object: a.id, connector: 'rechts' }, b: { object: b.id, connector: 'links' } }],
  };
  const frozen = scene(layout);
  const snapshot = freezeSnapshot(frozen, { id: randomUUID(), name: 'Fassung', issuedAt: new Date('2026-11-01T10:00:00Z') }, {
    index, stock: { items: [], counts: [{ materialKey: 'betonplatte-400', partId: null, variantKey: null, quantity: 1 }] },
  });
  const titles = studioTitles(composeDocument({
    spec: {
      schemaVersion: 1, preset: 'construction', purpose: 'technical', revisionName: 'Fassung', paper: 'A4', orientation: 'auto',
      scale: 50, kind: 'scene', scenes: [{ sceneId: frozen.id, elevationGroupIds: [] }],
      sections: ['dimensionedPlan', 'wallSchedule', 'materialSchedule', 'warnings'],
    },
    scenes: [{ sceneId: frozen.id, sceneName: frozen.name, venueName: frozen.venueName, snapshot }],
    productionName: 'Produktion', issuedAtLabel: '01.11.2026',
  }));
  for (const title of ['Grundriss', 'Stückliste', 'Bauteilliste', 'Zuschnittliste', 'Bestandsbedarf', 'Hinweise']) {
    assert.ok(titles.titles.includes(title), `${title} in ${titles.titles.join(', ')}`);
  }
  assert.match(titles.text, /Montagefolge Verbund 1: 1 A → 2 B/);
  assert.match(titles.text, /Betonplatte 400 × 400 × 50 mm: 2 gebraucht, 1 im Bestand – es fehlen 1\./);
  assert.match(titles.text, /Gesamtgewicht/);
});
