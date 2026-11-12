import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copySelection, pasteClipboard, removeSelection } from '../src/shared/clipboard.js';
import { applyObjectFinishes, transformSelection } from '../src/shared/editing.js';
import { formGroup, groupPivot } from '../src/shared/groups.js';
import { emptyLayout, layoutSchema, type Layout, type LayoutObject } from '../src/shared/layout.js';
import { layoutV1ToV2, layoutV1Schema, migrateLayout } from '../src/shared/layoutMigrate.js';
import { createLayoutPartIndex, resolveLayoutObjectDetails } from '../src/shared/layoutObjects.js';
import { resolvedObjectOverlapWarnings } from '../src/shared/overlap.js';
import { STARTER_LIBRARY, STARTER_PART_IDS } from '../src/shared/parts/starter/index.js';
import { membersInBounds } from '../src/shared/selection.js';
import { snapObjectConnectors } from '../src/shared/snapping.js';

const ids = {
  wallA: '10000000-0000-4000-8000-000000000001',
  wallB: '10000000-0000-4000-8000-000000000002',
  brace: '10000000-0000-4000-8000-000000000003',
  platform: '10000000-0000-4000-8000-000000000004',
  stair: '10000000-0000-4000-8000-000000000005',
  chair: '10000000-0000-4000-8000-000000000006',
  type: '10000000-0000-4000-8000-000000000007',
  opening: '10000000-0000-4000-8000-000000000008',
  connection: '10000000-0000-4000-8000-000000000009',
  group: '10000000-0000-4000-8000-000000000010',
  stock: '10000000-0000-4000-8000-000000000011',
  floor: '00000000-0000-4000-8000-000000000001',
} as const;

const index = createLayoutPartIndex(STARTER_LIBRARY);
const migrationIndex = { part: index.part };
const member = (id: string) => ({ kind: 'object' as const, id });
const wallObject = (id: string, x: number, y = 0): LayoutObject => ({
  id,
  label: `Wand ${id.at(-1)}`,
  part: { id: STARTER_PART_IDS.wall, revision: 1 },
  variant: 'plain',
  values: { B: 1200, H: 2400, D: 28 },
  x,
  y,
  rotation: 0,
  support: ids.floor,
});

test('layout v2 accepts objects and joints and rejects every v1 object array', () => {
  const layout = layoutSchema.parse({
    schemaVersion: 2,
    objects: [wallObject(ids.wallA, 0), wallObject(ids.wallB, 1200)],
    joints: [{
      a: { object: ids.wallA, connector: 'rechts' },
      b: { object: ids.wallB, connector: 'links' },
    }],
  });
  assert.equal(layout.objects.length, 2);
  assert.equal(layout.joints.length, 1);
  assert.equal(layoutSchema.safeParse({ ...layout, walls: [] }).success, false);
  assert.equal(layoutSchema.safeParse({ schemaVersion: 1, walls: [], braces: [] }).success, false);
});

test('v1 migration maps every per-kind object, stock/finish/state, groups and hinge joints', () => {
  const v1 = layoutV1Schema.parse({
    schemaVersion: 1,
    wallTypes: [{
      id: ids.type,
      name: 'Türwand · Scharnier links',
      width: 1200,
      height: 2400,
      thickness: 28,
      openings: [{
        id: ids.opening,
        left: 200,
        sill: 0,
        width: 800,
        height: 2000,
        hinge: 'left',
      }],
    }],
    walls: [
      {
        id: ids.wallA,
        label: 'Türwand',
        typeId: ids.type,
        x: 0,
        y: 0,
        rotation: 0,
        width: 1200,
        height: 2400,
        thickness: 28,
        doorOpenPercent: 35,
        panelId: ids.stock,
        assemblyNumber: 7,
        supportingSurfaceId: ids.floor,
        surfaces: {
          front: { full: { kind: 'paint', ral: '3000' } },
        },
      },
      {
        id: ids.wallB,
        label: 'Wand',
        x: 1200,
        y: 0,
        rotation: 0,
        width: 1200,
        height: 2400,
        thickness: 28,
      },
    ],
    braces: [{
      id: ids.brace,
      label: 'Stütze',
      x: 0,
      y: 500,
      rotation: 0,
      footprintWidth: 40,
      footprintDepth: 650,
      height: 1500,
      ballast: { mode: 'heavy' },
    }],
    platforms: [{
      id: ids.platform,
      label: 'Podest',
      elevation: 600,
      style: 'stageDeck',
      outline: [
        { x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 },
      ],
    }],
    stairs: [{
      id: ids.stair,
      label: 'Treppe',
      x: 1000,
      y: -500,
      rotation: 0,
      width: 1000,
      run: 1200,
      riserHeight: 200,
      lowerSurfaceId: ids.floor,
      upperSurfaceId: ids.platform,
    }],
    placeholders: [{
      id: ids.chair,
      label: 'Stuhl',
      kind: 'chair',
      x: 3000,
      y: 1000,
      rotation: 20,
      width: 450,
      depth: 450,
      height: 900,
      seatedFigure: true,
    }],
    connections: [{ id: ids.connection, a: ids.wallA, b: ids.wallB }],
    groups: [{
      id: ids.group,
      members: [{ kind: 'wall', id: ids.wallA }, { kind: 'brace', id: ids.brace }],
      rotation: 0,
    }],
  });
  const layout = layoutV1ToV2(v1, migrationIndex);
  assert.equal(layout.schemaVersion, 2);
  assert.equal(layout.objects.length, 6);
  const wall = layout.objects.find(object => object.id === ids.wallA)!;
  assert.equal(wall.part.id, STARTER_PART_IDS.wall);
  assert.equal(wall.variant, 'doorLeft');
  assert.deepEqual(wall.state, { open: 35 });
  assert.equal(wall.stockItemId, ids.stock);
  assert.equal(wall.assemblyNumber, 7);
  assert.deepEqual(wall.finishes?.front, { full: { kind: 'paint', ral: '3000' } });
  const brace = layout.objects.find(object => object.id === ids.brace)!;
  assert.deepEqual(brace.values, { B: 40, TO: 650, HO: 1500, ballast: 2 });
  assert.equal(layout.objects.find(object => object.id === ids.platform)?.part.id, STARTER_PART_IDS.deck);
  assert.equal(layout.objects.find(object => object.id === ids.stair)?.part.id, STARTER_PART_IDS.stair);
  assert.equal(layout.objects.find(object => object.id === ids.chair)?.part.id, STARTER_PART_IDS.chair);
  assert.deepEqual(layout.groups?.[0]?.members, [member(ids.wallA), member(ids.brace)]);
  assert.deepEqual(layout.joints[0], {
    id: ids.connection,
    a: { object: ids.wallA, connector: 'rechts' },
    b: { object: ids.wallB, connector: 'links' },
  });
  assert.deepEqual(migrateLayout(layout, migrationIndex), layout);
});

test('resolved layout objects provide world footprints, support elevation and diagnostics once', () => {
  const base: LayoutObject = {
    id: ids.platform,
    label: 'Podest',
    part: { id: STARTER_PART_IDS.solidPlatform, revision: 1 },
    values: { B: 2000, T: 1000, H: 400 },
    x: 1000,
    y: 1000,
    rotation: 0,
    support: ids.floor,
  };
  const wall = { ...wallObject(ids.wallA, 1000, 1000), support: ids.platform };
  const layout: Layout = { schemaVersion: 2, objects: [base, wall], joints: [] };
  const details = resolveLayoutObjectDetails(layout, index, { supportElevations: { [ids.floor]: 0 } });
  assert.deepEqual(details.issues, []);
  assert.equal(details.byId.get(ids.wallA)?.elevation, 400);
  assert.equal(details.byId.get(ids.wallA)?.bounds.min.y, 400);
  assert.equal(details.byId.get(ids.platform)?.footprint.length, 4);

  const unresolved = resolveLayoutObjectDetails({
    ...layout,
    objects: [{ ...wall, support: '20000000-0000-4000-8000-000000000099' }],
  }, index);
  assert.equal(unresolved.issues[0]?.kind, 'unknown-support');
});

test('generic selection, transform, groups, finishes and clipboard preserve object semantics', () => {
  const a = { ...wallObject(ids.wallA, 0), stockItemId: ids.stock, assemblyNumber: 1 };
  const b = wallObject(ids.wallB, 1200);
  let layout: Layout = { schemaVersion: 2, objects: [a, b], joints: [] };
  layout = formGroup(layout, [member(a.id), member(b.id)], ids.group);
  assert.deepEqual(groupPivot(layout, ids.group), { x: 600, y: 0 });
  layout = transformSelection(layout, [member(a.id), member(b.id)], { x: 100, y: 200, rotation: 90 });
  assert.deepEqual(layout.objects.map(object => [Math.round(object.x), Math.round(object.y), object.rotation]), [
    [700, -400, 90], [700, 800, 90],
  ]);
  layout = applyObjectFinishes(layout, [a.id], { front: { kind: 'library', ref: 'black' } });
  assert.deepEqual(layout.objects[0]?.finishes?.front, { kind: 'library', ref: 'black' });

  const copied = copySelection(layout, [member(a.id), member(b.id)])!;
  const generated = [
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
  ];
  const pasted = pasteClipboard(layout, copied, () => generated.shift()!, { x: 1000, y: 0 });
  assert.equal(pasted.pasted.length, 2);
  assert.equal(pasted.layout.objects.length, 4);
  assert.equal(pasted.layout.objects[2]?.stockItemId, undefined);
  assert.equal(pasted.layout.objects[2]?.assemblyNumber, undefined);
  assert.equal(removeSelection(pasted.layout, pasted.pasted).objects.length, 2);
});

test('resolved footprints drive marquee, overlap and connector snapping', () => {
  const layout: Layout = {
    schemaVersion: 2,
    objects: [wallObject(ids.wallA, 0), wallObject(ids.wallB, 1250)],
    joints: [],
  };
  const details = resolveLayoutObjectDetails(layout, index, { supportElevations: { [ids.floor]: 0 } });
  assert.deepEqual(membersInBounds(details.objects, { minX: -700, maxX: 700, minY: -100, maxY: 100 }), [member(ids.wallA)]);
  assert.equal(resolvedObjectOverlapWarnings(details.objects).length, 0);

  const movingLayout = {
    ...layout,
    objects: [layout.objects[0]!, { ...layout.objects[1]!, x: 1250 }],
  };
  const movingDetails = resolveLayoutObjectDetails(movingLayout, index, { supportElevations: { [ids.floor]: 0 } });
  const snap = snapObjectConnectors(movingDetails.objects[1]!, [movingDetails.objects[0]!]);
  assert.equal(snap.x, 1200);
  assert.equal(snap.y, 0);
  assert.equal(snap.connection?.targetObject, ids.wallA);
  assert.equal(snap.guides[0]?.kind, 'connector');

  const overlapping = resolveLayoutObjectDetails({
    ...layout,
    objects: [layout.objects[0]!, { ...layout.objects[1]!, x: 100 }],
  }, index, { supportElevations: { [ids.floor]: 0 } });
  assert.equal(resolvedObjectOverlapWarnings(overlapping.objects).length, 1);
});

test('emptyLayout is the only writable empty scene shape', () => {
  assert.deepEqual(emptyLayout(), { schemaVersion: 2, objects: [], joints: [] });
});
