import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler, Matrix4, Vector3 } from 'three';
import { braceCorners, braceMembers } from '../src/shared/braceTransforms.js';
import { STAGE_DECK_LEG_HEIGHTS_MM, STAGE_DECK_MODULES_MM, stageDeckLegPositions } from '../src/shared/stageDeck.js';
import { wallCorners } from '../src/shared/wallPlan.js';
import { PART_LIMITS, createPartContext, type PartDefinition } from '../src/shared/parts/definition.js';
import { hasErrors } from '../src/shared/parts/issues.js';
import { boundsOf, polygonArea, signedArea, type Vec2, type Vec3 } from '../src/shared/parts/math.js';
import { placeFootprint, placePoint, placeResolvedPart, placementTransform } from '../src/shared/parts/place.js';
import {
  archSegmentCount, resolvePart, resolvePartConfiguration, solidVertices,
  type ResolvedPart, type ResolvedSheet, type ResolvedSolid,
} from '../src/shared/parts/resolve.js';
import {
  STARTER_BRACE, STARTER_CONTEXT, STARTER_DECK, STARTER_DECK_LEG, STARTER_TABLE, STARTER_WALL,
} from '../src/shared/parts/starter/index.js';
import {
  CHAIR, DECK_ROW, DOOR_WALL, FIXTURE_CONTEXT, FIXTURE_MATERIALS, FIXTURE_PARTS, STAIR, WIDE_BRACE,
  fixtureId, panel, refOf,
} from './helpers/partsFixtures.js';

const EPS = 1e-6;

function assertClose(actual: number, expected: number, message?: string, tolerance = EPS) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? 'value'}: ${actual} is not ${expected}`);
}

function assertPoint(actual: Vec3, expected: [number, number, number], message?: string) {
  assertClose(actual.x, expected[0], `${message ?? 'point'} x`);
  assertClose(actual.y, expected[1], `${message ?? 'point'} y`);
  assertClose(actual.z, expected[2], `${message ?? 'point'} z`);
}

const sortPoints = (points: readonly Vec3[]) => points
  .map(point => [point.x, point.y, point.z].map(value => Math.round(value * 1e4) / 1e4 + 0) as [number, number, number])
  .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

/** Same corner set, whatever the order and whichever of the equivalent box orientations produced it. */
function assertSameCorners(actual: readonly Vec3[], expected: readonly Vec3[], message: string) {
  assert.equal(actual.length, expected.length, message);
  const a = sortPoints(actual), b = sortPoints(expected);
  // Sorting by rounded coordinates could order near-ties differently, so match greedily instead.
  const rest = [...b];
  for (const point of a) {
    const hit = rest.findIndex(other => Math.hypot(other[0] - point[0], other[1] - point[1], other[2] - point[2]) <= 1e-3);
    assert.ok(hit >= 0, `${message}: corner ${point.join(', ')} has no counterpart`);
    rest.splice(hit, 1);
  }
  for (const point of actual) {
    const nearest = Math.min(...expected.map(other => Math.hypot(other.x - point.x, other.y - point.y, other.z - point.z)));
    assert.ok(nearest <= EPS, `${message}: corner off by ${nearest}`);
  }
}

function solid(resolved: ResolvedPart, id: string): ResolvedSolid {
  const found = resolved.solids.find(item => item.id === id);
  assert.ok(found, `solid ${id} missing; have ${resolved.solids.map(item => item.id).join(', ')}`);
  return found;
}

function sheet(resolved: ResolvedPart, id: string): ResolvedSheet {
  const found = solid(resolved, id);
  assert.equal(found.kind, 'sheet');
  return found as ResolvedSheet;
}

function assertBounds(resolved: ResolvedPart, id: string, min: [number, number, number], max: [number, number, number]) {
  const bounds = boundsOf(solidVertices(solid(resolved, id)));
  assertPoint(bounds.min, min, `${id} min`);
  assertPoint(bounds.max, max, `${id} max`);
}

function assertPolygon(actual: readonly Vec2[], expected: readonly (readonly [number, number])[], message: string) {
  assert.equal(actual.length, expected.length, `${message}: ${JSON.stringify(actual)}`);
  actual.forEach((point, index) => {
    assertClose(point.x, expected[index]![0], `${message}[${index}].x`);
    assertClose(point.y, expected[index]![1], `${message}[${index}].y`);
  });
}

const codes = (resolved: ResolvedPart) => resolved.issues.map(item => `${item.severity}:${item.code}`);

/** Corners of a `braceMembers` box, computed with three.js as `StageBraces` renders it. */
function memberCorners(member: ReturnType<typeof braceMembers>[number]): Vec3[] {
  const euler = new Euler(member.rotation.x, member.rotation.y, member.rotation.z, 'XYZ');
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const corner = new Vector3(sx * member.size.x / 2, sy * member.size.y / 2, sz * member.size.z / 2).applyEuler(euler);
    corners.push({ x: corner.x + member.center.x, y: corner.y + member.center.y, z: corner.z + member.center.z });
  }
  return corners;
}

function assertMatchesBraceMembers(resolved: ResolvedPart, width: number, depth: number, height: number) {
  const label = `${width} × ${depth} × ${height}`;
  assert.deepEqual(resolved.issues, [], label);
  const members = braceMembers({ footprintWidth: width, footprintDepth: depth, height });
  const pairs = [['wall', 'stiel'], ['floor', 'schwelle'], ['diagonal', 'strebe']] as const;
  assert.deepEqual(resolved.solids.map(item => item.id), pairs.map(([, id]) => id));
  for (const [kind, id] of pairs) {
    const member = members.find(item => item.kind === kind)!;
    const found = solid(resolved, id);
    assert.equal(found.kind, 'beam');
    if (found.kind !== 'beam') continue;
    assertPoint(found.center, [member.center.x, member.center.y, member.center.z], `${label} ${id} centre`);
    assertSameCorners(solidVertices(found), memberCorners(member), `${label} ${id}`);
    assertClose(found.size.x, width, `${label} ${id} width`);
    assertClose(found.size.z, 40, `${label} ${id} section height`);
    assertClose(found.length, kind === 'floor' ? member.size.z : member.size.y, `${label} ${id} length`);
  }
  assertPoint(resolved.bounds.min, [-width / 2, 0, -depth / 2], `${label} bounds min`);
  assertPoint(resolved.bounds.max, [width / 2, height, depth / 2], `${label} bounds max`);
  assert.equal(resolved.height, height);
}

test('Stützdreieck equals braceMembers for the default and two other sizes', () => {
  assertMatchesBraceMembers(resolvePart(STARTER_BRACE, {}, STARTER_CONTEXT), 40, 500, 1200);
  assertMatchesBraceMembers(resolvePart(STARTER_BRACE, { variant: 'niedrig' }, STARTER_CONTEXT), 40, 400, 900);
  assertMatchesBraceMembers(resolvePart(STARTER_BRACE, { variant: 'hoch' }, STARTER_CONTEXT), 40, 800, 2400);
});

test('a brace with a free timber width equals braceMembers too', () => {
  for (const [W, T, H] of [[40, 500, 1200], [120, 730, 1850], [65, 1500, 300], [200, 200, 3000]] as const) {
    assertMatchesBraceMembers(resolvePart(WIDE_BRACE, { values: { W, T, H } }, FIXTURE_CONTEXT), W, T, H);
  }
});

test('a placed Stützdreieck has the footprint of braceCorners', () => {
  const resolved = resolvePart(STARTER_BRACE, {}, STARTER_CONTEXT);
  assertPolygon(resolved.footprint, [[-20, -250], [20, -250], [20, 250], [-20, 250]], 'local footprint');
  for (const placement of [{ x: 0, y: 0, rotation: 0 }, { x: 4120, y: -730, rotation: 33 }, { x: -900, y: 2500, rotation: 215 }]) {
    const expected = braceCorners({ ...placement, footprintWidth: 40, footprintDepth: 500 });
    assertPolygon(placeFootprint(resolved, placement), expected.map(point => [point.x, point.y] as const), `rotation ${placement.rotation}`);
  }
});

test('Bühnenelement puts its Steckfüße where stageDeckLegPositions puts them', () => {
  for (const module of STAGE_DECK_MODULES_MM) {
    const variant = STARTER_DECK.variants!.find(item => item.values.B === module.width && item.values.T === module.depth);
    assert.ok(variant, `variant for ${module.label}`);
    assert.equal(variant.label, module.label);
    for (const height of STAGE_DECK_LEG_HEIGHTS_MM) {
      const resolved = resolvePart(STARTER_DECK, { variant: variant.key, values: { H: height } }, STARTER_CONTEXT);
      assert.deepEqual(resolved.issues, [], `${module.label} at ${height}`);
      const tubes = resolved.solids.filter(item => item.body === 'rohr' && item.path.length === 1);
      assert.equal(tubes.length, 4);
      const actual = tubes.map(item => {
        assert.equal(item.kind, 'beam');
        if (item.kind !== 'beam') throw new Error('unreachable');
        assertClose(item.from.y, 12, 'tube starts on the rubber foot');
        assertClose(item.to.y, height - 80, 'tube ends under the 80 mm deck');
        assert.deepEqual([item.size.x, item.size.z], [50, 50]);
        return `${Math.round(item.center.x * 1e6) / 1e6},${Math.round(item.center.z * 1e6) / 1e6}`;
      }).sort();
      const expected = stageDeckLegPositions(module.width, module.depth).map(leg => `${leg.x},${leg.y}`).sort();
      assert.deepEqual(actual, expected, `${module.label} at ${height}`);

      assert.equal(resolved.height, height);
      assertPoint(resolved.bounds.min, [-module.width / 2, 0, -module.depth / 2]);
      assertPoint(resolved.bounds.max, [module.width / 2, height, module.depth / 2]);
      assert.equal(resolved.surfaces.length, 1);
      assert.equal(resolved.surfaces[0]!.elevation, height);
      assertPolygon(resolved.footprint, [
        [-module.width / 2, -module.depth / 2], [module.width / 2, -module.depth / 2],
        [module.width / 2, module.depth / 2], [-module.width / 2, module.depth / 2],
      ], 'footprint');
    }
  }
});

test('Bühnenelement: frame, deck, connectors and children', () => {
  const resolved = resolvePart(STARTER_DECK, {}, STARTER_CONTEXT);
  assert.equal(resolved.variant, '2x1');
  assert.deepEqual(resolved.values, { B: 2000, T: 1000, H: 600 });
  assert.deepEqual(resolved.solids.map(item => item.id), [
    'platte', 'rahmen-lang[0]', 'rahmen-lang[1]', 'rahmen-quer[0]', 'rahmen-quer[1]',
    'fuss[0,0]/gummifuss', 'fuss[0,0]/rohr', 'fuss[0,1]/gummifuss', 'fuss[0,1]/rohr',
    'fuss[1,0]/gummifuss', 'fuss[1,0]/rohr', 'fuss[1,1]/gummifuss', 'fuss[1,1]/rohr',
  ]);
  // The deck sheet lies with its front face up at H; the frame hangs below it down to H - 80.
  assertBounds(resolved, 'platte', [-1000, 588, -500], [1000, 600, 500]);
  assertBounds(resolved, 'rahmen-lang[0]', [-1000, 520, -500], [1000, 588, -460]);
  assertBounds(resolved, 'rahmen-lang[1]', [-1000, 520, 460], [1000, 588, 500]);
  assertBounds(resolved, 'rahmen-quer[0]', [-1000, 520, -460], [-960, 588, 460]);
  assertBounds(resolved, 'rahmen-quer[1]', [960, 520, -460], [1000, 588, 460]);
  // First repeat level steps along x, the second along z.
  assertBounds(resolved, 'fuss[0,0]/rohr', [-992, 12, -492], [-942, 520, -442]);
  assertBounds(resolved, 'fuss[1,0]/rohr', [942, 12, -492], [992, 520, -442]);
  assertBounds(resolved, 'fuss[0,1]/gummifuss', [-992, 0, 442], [-942, 12, 492]);
  assert.deepEqual(solid(resolved, 'fuss[1,1]/rohr').path, ['fuss[1,1]']);
  assert.deepEqual(solid(resolved, 'fuss[1,1]/rohr').index, []);
  assert.deepEqual(solid(resolved, 'fuss[1,1]/rohr').part, refOf(STARTER_DECK_LEG));
  assert.deepEqual(solid(resolved, 'rahmen-quer[1]').index, [1]);

  const connector = (id: string) => {
    const found = resolved.connectors.find(item => item.id === id);
    assert.ok(found, id);
    return found;
  };
  assert.deepEqual(resolved.connectors.filter(item => item.kind === 'deck-edge').map(item => item.id),
    ['kante-vorn', 'kante-hinten', 'kante-links', 'kante-rechts']);
  assertPoint(connector('kante-vorn').position, [-1000, 600, -500]);
  assertPoint(connector('kante-vorn').axis, [1, 0, 0]);
  assert.equal(connector('kante-vorn').length, 2000);
  assert.equal(connector('kante-rechts').length, 1000);
  // The socket under the frame meets the head of the Steckfuß.
  assertPoint(connector('fuss-hr').position, [967, 520, 467]);
  assertPoint(connector('fuss[1,1]/kopf').position, [967, 520, 467]);
  assertPoint(connector('fuss-hr').axis, [0, -1, 0]);
  assertPoint(connector('fuss[1,1]/kopf').axis, [0, 1, 0]);
  assert.deepEqual(connector('fuss[1,1]/kopf').path, ['fuss[1,1]']);
  assertPoint(connector('fuss[0,1]/boden').position, [-967, 0, 467]);

  assert.deepEqual(resolved.parts.map(item => [item.id, item.variant, item.values.H]), [
    ['fuss[0,0]', '600', 600], ['fuss[0,1]', '600', 600], ['fuss[1,0]', '600', 600], ['fuss[1,1]', '600', 600],
  ]);
  assert.deepEqual(resolved.partCounts, [
    { part: refOf(STARTER_DECK_LEG), name: 'Steckfuß', variant: '600', variantValues: { H: 600 }, stock: 'count', count: 4 },
  ]);
  assert.deepEqual(resolved.faces.map(face => [face.key, face.solid, face.areaMm2]), [['belag', 'platte', 2_000_000]]);
  assertPoint(resolved.faces[0]!.plane!.normal, [0, 1, 0]);
});

test('Wandelement footprint equals wallCorners for a rotated placement', () => {
  const resolved = resolvePart(STARTER_WALL, {}, STARTER_CONTEXT);
  assert.deepEqual(resolved.issues, []);
  for (const placement of [{ x: 3210, y: -1540, rotation: 37 }, { x: -250, y: 800, rotation: 180 }, { x: 0, y: 0, rotation: -90 }]) {
    const expected = wallCorners({ ...placement, width: 1200, thickness: 28 });
    assertPolygon(placeFootprint(resolved, placement), expected.map(point => [point.x, point.y] as const), `rotation ${placement.rotation}`);
    assertPolygon(placeResolvedPart(resolved, placement).footprint, expected.map(point => [point.x, point.y] as const), 'placed');
  }
});

test('placing moves solids, connectors, surfaces and faces as three.js would', () => {
  const resolved = resolvePart(STARTER_DECK, { variant: '1x05', values: { H: 400 } }, STARTER_CONTEXT);
  const placement = { x: 2500, y: -1200, rotation: 30, elevation: 800 };
  const placed = placeResolvedPart(resolved, placement);
  assert.equal(placed.rotationY, -30 * Math.PI / 180);
  const matrix = new Matrix4().makeRotationY(placed.rotationY).setPosition(placement.x, placement.elevation, placement.y);
  const world = (point: Vec3): Vec3 => {
    const moved = new Vector3(point.x, point.y, point.z).applyMatrix4(matrix);
    return { x: moved.x, y: moved.y, z: moved.z };
  };
  resolved.solids.forEach((item, index) => {
    const expected = solidVertices(item).map(world);
    solidVertices(placed.solids[index]!).forEach((corner, at) => {
      assertPoint(corner, [expected[at]!.x, expected[at]!.y, expected[at]!.z], `${item.id} corner ${at}`);
      const direct = placePoint(solidVertices(item)[at]!, placement);
      assertPoint(direct, [expected[at]!.x, expected[at]!.y, expected[at]!.z], 'placePoint');
    });
    assert.equal(placed.solids[index]!.id, item.id);
  });
  resolved.connectors.forEach((connector, index) => {
    const expected = world(connector.position);
    assertPoint(placed.connectors[index]!.position, [expected.x, expected.y, expected.z], connector.id);
  });
  const edge = placed.connectors.find(item => item.id === 'kante-vorn')!;
  assertPoint(edge.axis, [Math.cos(Math.PI / 6), 0, Math.sin(Math.PI / 6)], 'edge axis turns with the plan rotation');
  assert.equal(placed.surfaces[0]!.elevation, 1200);
  assertPolygon(placed.surfaces[0]!.outline, placeFootprint(resolved, placement).map(point => [point.x, point.y] as const), 'surface');
  assertPoint(placed.faces[0]!.plane!.origin, [2500, 1200, -1200]);
  assertClose(placed.bounds.min.y, 800, 'bounds start at the elevation');
  assertClose(placed.bounds.max.y, 1200, 'bounds end at elevation + height');
  assertPoint(placementTransform({ x: 1, y: 2, rotation: 0 }).translation, [1, 0, 2]);
});

test('Wandelement: full panel and door variant', () => {
  const full = resolvePart(STARTER_WALL, { variant: 'voll' }, STARTER_CONTEXT);
  const panelSheet = sheet(full, 'platte');
  assertPolygon(panelSheet.outline, [[-600, 0], [600, 0], [600, 2400], [-600, 2400]], 'outline');
  assert.deepEqual(panelSheet.holes, []);
  assert.deepEqual(panelSheet.openings, []);
  assertBounds(full, 'platte', [-600, 0, -14], [600, 2400, 14]);
  assert.equal(full.height, 2400);

  const door = resolvePart(STARTER_WALL, { variant: 'tuer' }, STARTER_CONTEXT);
  assert.deepEqual(door.issues, []);
  const cut = sheet(door, 'platte');
  // A door that reaches the floor is a notch of the outline, not a hole.
  assertPolygon(cut.outline, [[400, 0], [600, 0], [600, 2400], [-600, 2400], [-600, 0], [-400, 0], [-400, 2000], [400, 2000]], 'notched outline');
  assert.ok(signedArea(cut.outline) > 0, 'outline is counter-clockwise');
  assert.deepEqual(cut.holes, []);
  assert.deepEqual(cut.openings.map(item => [item.key, item.shape, item.placement, item.bounds]),
    [['tuer', 'rect', 'edge', { x: -400, y: 0, width: 800, height: 2000 }]]);
  assert.deepEqual(cut.blank, { width: 1200, height: 2400 });
  assertPolygon(door.footprint, [[-600, -14], [600, -14], [600, 14], [-600, 14]], 'footprint');

  const connector = (id: string) => door.connectors.find(item => item.id === id)!;
  assert.deepEqual(door.connectors.map(item => [item.id, item.kind]), [['links', 'hinge-edge'], ['rechts', 'hinge-edge'], ['stuetze', 'brace-mount']]);
  assertPoint(connector('links').position, [-600, 0, 0]);
  assertPoint(connector('rechts').position, [600, 0, 0]);
  assertPoint(connector('links').axis, [0, 1, 0]);
  assert.equal(connector('links').length, 2400);
  assertPoint(connector('stuetze').position, [0, 0, 14]);

  const faces = Object.fromEntries(door.faces.map(face => [face.key, face]));
  assert.deepEqual(Object.keys(faces), ['front', 'back', 'edge']);
  // The front faces the audience (-Z), as the wall panel of wallMeshGeometry does.
  assertPoint(faces.front!.plane!.normal, [0, 0, -1]);
  assertPoint(faces.front!.plane!.origin, [0, 0, -14]);
  assertPoint(faces.back!.plane!.normal, [0, 0, 1]);
  assertPoint(faces.back!.plane!.origin, [0, 0, 14]);
  assert.equal(faces.edge!.plane, undefined);
});

test('sheet planes and anchors', () => {
  const at = (plane: 'xy' | 'xz' | 'yz', anchor?: 'face' | 'centre' | 'back') => resolvePart(panel({
    parameters: [],
    bodies: [{
      kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane, at: [100, 200, 300], ...(anchor ? { anchor } : {}),
      outline: { shape: 'rect', x: 0, y: 0, width: 400, height: 250 },
    }],
  }), {}, FIXTURE_CONTEXT);
  assertBounds(at('xy'), 'platte', [100, 200, 300], [500, 450, 312]);
  assertBounds(at('xy', 'centre'), 'platte', [100, 200, 294], [500, 450, 306]);
  assertBounds(at('xy', 'back'), 'platte', [100, 200, 288], [500, 450, 300]);
  assertBounds(at('xz'), 'platte', [100, 188, 300], [500, 200, 550]);
  assertBounds(at('xz', 'back'), 'platte', [100, 200, 300], [500, 212, 550]);
  assertBounds(at('yz'), 'platte', [88, 200, 300], [100, 450, 700]);
  assertBounds(at('yz', 'centre'), 'platte', [94, 200, 300], [106, 450, 700]);
});

test('holes: inside, arch, polygon, and the cases that are refused', () => {
  const withHoles = (holes: NonNullable<Extract<PartDefinition['bodies'][number], { kind: 'sheet' }>['holes']>) => resolvePart(panel({
    bodies: [{
      kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0],
      outline: { shape: 'rect', x: '-B / 2', y: 0, width: 'B', height: 'H' }, holes,
    }],
  }), {}, FIXTURE_CONTEXT);

  const window = withHoles([{ shape: 'rect', key: 'fenster', x: -300, y: 900, width: 600, height: 500 }]);
  assert.deepEqual(window.issues, []);
  const windowSheet = sheet(window, 'platte');
  assert.equal(windowSheet.outline.length, 4);
  assert.equal(windowSheet.holes.length, 1);
  assert.ok(signedArea(windowSheet.holes[0]!) < 0, 'holes are clockwise');
  assert.equal(windowSheet.netAreaMm2, 1000 * 2000 - 600 * 500);
  assert.equal(windowSheet.grossAreaMm2, 2_000_000);
  assert.equal(windowSheet.openings[0]!.placement, 'inside');

  const arch = withHoles([{ shape: 'arch', key: 'bogen', x: -400, y: 0, width: 800, height: 1900 }]);
  assert.deepEqual(arch.issues, []);
  const archSheet = sheet(arch, 'platte');
  assert.equal(archSegmentCount(400), 32);
  // Two floor points of the notch are replaced by the crown: 4 outline corners + 2 jamb feet + 2 springing points + 31 crown points.
  assert.equal(archSheet.outline.length, 4 + 2 + 2 + 31);
  const exact = 800 * 1500 + Math.PI * 400 * 400 / 2;
  const removed = archSheet.grossAreaMm2 - archSheet.netAreaMm2;
  assert.ok(removed < exact && removed > exact * 0.998, `arch area ${removed} against ${exact}`);
  assert.ok(archSheet.outline.every(point => point.y <= 1900 + EPS || Math.abs(point.x) >= 400), 'crown stays under the arch height');
  assert.ok(archSheet.outline.some(point => Math.abs(point.x) < EPS && Math.abs(point.y - 1900) < EPS), 'crown reaches the arch height');

  const triangle = withHoles([{ shape: 'polygon', key: 'dreieck', points: [[-200, 500], [0, 900], [200, 500]] }]);
  assert.deepEqual(triangle.issues, []);
  assert.equal(sheet(triangle, 'platte').netAreaMm2, 2_000_000 - 80_000);
  assert.ok(signedArea(sheet(triangle, 'platte').holes[0]!) < 0);

  const two = withHoles([
    { shape: 'rect', key: 'a', x: -400, y: 200, width: 300, height: 300 },
    { shape: 'rect', key: 'b', x: 100, y: 200, width: 300, height: 300 },
  ]);
  assert.deepEqual(two.issues, []);
  assert.equal(sheet(two, 'platte').holes.length, 2);

  const split = withHoles([{ shape: 'rect', key: 'schlitz', x: -600, y: 900, width: 1200, height: 100 }]);
  assert.deepEqual(codes(split), ['error:hole-splits-sheet']);
  assert.equal(split.issues[0]!.body, 'platte');
  assert.equal(split.issues[0]!.hole, 'schlitz');
  assert.match(split.issues[0]!.message, /^Ausschnitt „schlitz“ in Körper „platte“: teilt die Platte/);

  const overlap = withHoles([
    { shape: 'rect', key: 'a', x: -300, y: 200, width: 300, height: 300 },
    { shape: 'rect', key: 'b', x: -100, y: 300, width: 300, height: 300 },
  ]);
  assert.deepEqual(codes(overlap), ['error:hole-overlap']);
  assert.equal(overlap.issues[0]!.hole, 'b');

  assert.deepEqual(codes(withHoles([{ shape: 'rect', key: 'weg', x: -600, y: -10, width: 1200, height: 2100 }])), ['error:hole-covers-sheet']);
  assert.deepEqual(codes(withHoles([{ shape: 'rect', key: 'daneben', x: 600, y: 0, width: 100, height: 100 }])), ['warning:hole-outside']);
  assert.deepEqual(codes(withHoles([{ shape: 'arch', key: 'flach', x: -400, y: 0, width: 800, height: 300 }])), ['error:outline-invalid']);
  assert.deepEqual(codes(withHoles([{ shape: 'polygon', key: 'schleife', points: [[0, 100], [200, 300], [200, 100], [0, 300]] }])), ['error:outline-invalid']);
});

test('polygon outlines are accepted in either winding', () => {
  const lShape = (points: [number, number][]) => resolvePart(panel({
    parameters: [],
    bodies: [{ kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xz', at: [0, 100, 0], outline: { shape: 'polygon', points } }],
    traits: { stock: 'none', surface: { body: 'platte' } },
  }), {}, FIXTURE_CONTEXT);
  const points: [number, number][] = [[0, 0], [2000, 0], [2000, 1000], [1000, 1000], [1000, 2000], [0, 2000]];
  for (const variant of [points, [...points].reverse()]) {
    const resolved = lShape(variant);
    assert.deepEqual(resolved.issues, []);
    const found = sheet(resolved, 'platte');
    assert.ok(signedArea(found.outline) > 0);
    assert.equal(found.netAreaMm2, 3_000_000);
    assert.deepEqual(found.blank, { width: 2000, height: 2000 });
    // The walkable surface keeps the concave outline; the footprint is its convex hull.
    assert.equal(polygonArea(resolved.surfaces[0]!.outline), 3_000_000);
    assert.equal(resolved.surfaces[0]!.elevation, 100);
    assert.equal(polygonArea(resolved.footprint), 3_500_000);
  }
});

test('repeat: nested levels, index names and counts from parameters', () => {
  const table = resolvePart(STARTER_TABLE, {}, STARTER_CONTEXT);
  assert.deepEqual(table.solids.map(item => item.id), ['platte', 'bein[0,0]', 'bein[0,1]', 'bein[1,0]', 'bein[1,1]']);
  assertBounds(table, 'bein[0,0]', [-560, 0, -360], [-520, 722, -320]);
  assertBounds(table, 'bein[0,1]', [-560, 0, 320], [-520, 722, 360]);
  assertBounds(table, 'bein[1,0]', [520, 0, -360], [560, 722, -320]);
  assertBounds(table, 'bein[1,1]', [520, 0, 320], [560, 722, 360]);
  assertBounds(table, 'platte', [-600, 722, -400], [600, 750, 400]);

  for (const n of [2, 5, 12]) {
    const stair = resolvePart(STAIR, { values: { n } }, FIXTURE_CONTEXT);
    assert.deepEqual(stair.issues, []);
    assert.equal(stair.solids.filter(item => item.body === 'stufe').length, n);
    assert.equal(stair.surfaces.length, n);
    stair.surfaces.forEach((surface, index) => {
      assert.equal(surface.solid, `stufe[${index}]`);
      assert.equal(surface.elevation, (index + 1) * 180);
      assertPolygon(surface.outline, [[-450, index * 270], [450, index * 270], [450, (index + 1) * 270], [-450, (index + 1) * 270]], `tread ${index}`);
    });
    assert.equal(stair.height, n * 180);
    assert.equal(stair.planSymbol, 'stair');
    const stringer = solid(stair, 'wange[1]');
    assert.equal(stringer.kind, 'beam');
    if (stringer.kind === 'beam') {
      assertPoint(stringer.from, [470, 20, 0]);
      assertPoint(stringer.to, [470, n * 180 - 20, n * 270]);
      assertClose(stringer.length, Math.hypot(n * 180 - 40, n * 270));
    }
  }

  const fractional = resolvePart(panel({
    bodies: [{ kind: 'box', key: 'klotz', material: 'kiste', size: [100, 100, 100], at: [0, 50, 0], repeat: { count: 'B / 400', step: [200, 0, 0] } }],
  }), {}, FIXTURE_CONTEXT);
  assert.deepEqual(codes(fractional), ['warning:repeat-count']);
  assert.equal(fractional.solids.length, 3);
  const none = resolvePart(panel({
    bodies: [{ kind: 'box', key: 'klotz', material: 'kiste', size: [100, 100, 100], at: [0, 50, 0], repeat: { count: 'B - 1000', step: [200, 0, 0] } }],
  }), {}, FIXTURE_CONTEXT);
  assert.deepEqual(codes(none), ['warning:empty-part']);
  const many = resolvePart(panel({
    bodies: [{ kind: 'box', key: 'klotz', material: 'kiste', size: [10, 10, 10], at: [0, 5, 0], repeat: { count: 'B', step: [20, 0, 0] } }],
  }), {}, FIXTURE_CONTEXT);
  assert.deepEqual(codes(many), ['error:repeat-count']);
  assert.equal(many.solids.length, PART_LIMITS.repeatCount);
});

test('body rotation turns about the pivot', () => {
  const box = (extra: Record<string, unknown>) => resolvePart(panel({
    parameters: [],
    bodies: [{ kind: 'box', key: 'klotz', material: 'kiste', size: [100, 20, 40], at: [200, 50, 0], ...extra }],
  }), {}, FIXTURE_CONTEXT);
  assertBounds(box({}), 'klotz', [150, 40, -20], [250, 60, 20]);
  assertBounds(box({ rotation: [0, 0, 90] }), 'klotz', [190, 0, -20], [210, 100, 20]);
  assertBounds(box({ rotation: [0, 0, 90], pivot: [0, 50, 0] }), 'klotz', [-10, 200, -20], [10, 300, 20]);
  assertBounds(box({ rotation: [0, 90, 0] }), 'klotz', [180, 40, -50], [220, 60, 50]);
  // Euler order is that of three.js: X, then Y, then Z about the already turned axes.
  const turned = box({ rotation: [90, 90, 0] });
  const expected = [new Vector3(50, 10, 20), new Vector3(-50, -10, -20)].map(corner => corner.applyEuler(new Euler(Math.PI / 2, Math.PI / 2, 0, 'XYZ')));
  const bounds = boundsOf(solidVertices(solid(turned, 'klotz')));
  assertClose(bounds.max.x - 200, Math.max(...expected.map(corner => Math.abs(corner.x))));
  assertClose(bounds.max.y - 50, Math.max(...expected.map(corner => Math.abs(corner.y))));
  assertClose(bounds.max.z, Math.max(...expected.map(corner => Math.abs(corner.z))));
});

test('beams: section orientation and roll', () => {
  const door = resolvePart(DOOR_WALL, {}, FIXTURE_CONTEXT);
  assert.deepEqual(door.issues, []);
  // Upright 60 × 28 profile rolled by 90°: 28 across the wall, 60 through it.
  assertBounds(door, 'zarge-seite[0]', [-400, 0, -30], [-372, 2000, 30]);
  assertBounds(door, 'zarge-seite[1]', [372, 0, -30], [400, 2000, 30]);
  // Lying profile: width (60) horizontal, height (28) upright.
  assertBounds(door, 'zarge-sturz', [-372, 1972, -30], [372, 2000, 30]);
  const upright = resolvePart(panel({
    parameters: [],
    bodies: [{ kind: 'beam', key: 'pfosten', material: 'zarge-60x28', from: [0, 0, 0], to: [0, 1000, 0] }],
  }), {}, FIXTURE_CONTEXT);
  assertBounds(upright, 'pfosten', [-30, 0, -14], [30, 1000, 14]);
  const along = resolvePart(panel({
    parameters: [],
    bodies: [{ kind: 'beam', key: 'riegel', material: 'zarge-60x28', from: [0, 500, -300], to: [0, 500, 300] }],
  }), {}, FIXTURE_CONTEXT);
  assertBounds(along, 'riegel', [-30, 486, -300], [30, 514, 300]);
});

test('child parts: transform, state, pivot and repeat', () => {
  const closed = resolvePart(DOOR_WALL, {}, FIXTURE_CONTEXT);
  assert.deepEqual(closed.values, { B: 1200, H: 2400, offen: 0 });
  assertBounds(closed, 'blatt/blatt', [-372, 0, -20], [372, 1972, 20]);
  assert.deepEqual(closed.parts.map(item => [item.id, item.values]), [['blatt', { B: 744, H: 1972 }]]);

  const open = resolvePart(DOOR_WALL, { state: { offen: 90 } }, FIXTURE_CONTEXT);
  assert.deepEqual(open.issues, []);
  // The leaf swings about its hinge edge towards the audience.
  assertBounds(open, 'blatt/blatt', [-392, 0, -744], [-352, 1972, 0]);
  const half = resolvePart(DOOR_WALL, { state: { offen: 45 } }, FIXTURE_CONTEXT);
  const reach = 744 * Math.SQRT1_2, lip = 20 * Math.SQRT1_2;
  assertBounds(half, 'blatt/blatt', [-372 - lip, 0, -reach - lip], [-372 + reach + lip, 1972, lip]);
  assertPoint(half.faces.find(face => face.key === 'blatt/front')!.plane!.normal, [-Math.SQRT1_2, 0, -Math.SQRT1_2]);
  // The wall itself does not move with the state.
  assertBounds(open, 'platte', [-600, 0, -14], [600, 2400, 14]);

  const group = (child: Record<string, unknown>) => resolvePart({
    id: fixtureId(20), revision: 1, name: 'Gruppe', category: 'Test', parameters: [], bodies: [],
    children: [{ key: 'stuetze', part: refOf(STARTER_BRACE), at: [1000, 0, 0], ...child }],
    traits: { stock: 'none' },
  }, {}, FIXTURE_CONTEXT);
  assertBounds(group({}), 'stuetze/stiel', [980, 0, -250], [1020, 1200, -210]);
  // Yaw 90°: child +Z (floor tip) goes to +X, child +X to -Z.
  assertBounds(group({ rotation: [0, 90, 0] }), 'stuetze/stiel', [750, 0, -20], [790, 1200, 20]);
  assertBounds(group({ rotation: [0, 90, 0], pivot: [0, 0, 0] }), 'stuetze/stiel', [-250, 0, -1020], [-210, 1200, -980]);
  const row = group({ variant: 'hoch', repeat: { count: 3, step: [0, 0, 600] } });
  assert.deepEqual(row.parts.map(item => [item.id, item.variant, item.index]), [['stuetze[0]', 'hoch', [0]], ['stuetze[1]', 'hoch', [1]], ['stuetze[2]', 'hoch', [2]]]);
  assertBounds(row, 'stuetze[2]/stiel', [980, 0, 800], [1020, 2400, 840]);
  assertPoint(row.connectors.find(item => item.id === 'stuetze[1]/wand')!.position, [1000, 0, 200]);
  assert.deepEqual(row.partCounts.map(item => [item.name, item.variant, item.variantValues, item.count]), [['Stützdreieck', 'hoch', { T: 800, H: 2400 }, 3]]);
  // A child that is switched off leaves nothing behind.
  assert.deepEqual(codes(group({ when: 0 })), ['warning:empty-part']);
});

test('children of children: ids, counts and totals', () => {
  const row = resolvePart(DECK_ROW, { values: { n: 3, H: 800 } }, FIXTURE_CONTEXT);
  assert.deepEqual(row.issues, []);
  assert.equal(row.solids.length, 3 * 13);
  assertBounds(row, 'modul[0]/platte', [-1000, 788, -1500], [1000, 800, -500]);
  assertBounds(row, 'modul[2]/fuss[1,1]/rohr', [942, 12, 1442], [992, 720, 1492]);
  assert.deepEqual(solid(row, 'modul[2]/fuss[1,1]/rohr').path, ['modul[2]', 'fuss[1,1]']);
  assertPolygon(row.footprint, [[-1000, -1500], [1000, -1500], [1000, 1500], [-1000, 1500]], 'footprint');
  assert.deepEqual(row.surfaces.map(surface => [surface.solid, surface.elevation]),
    [['modul[0]/platte', 800], ['modul[1]/platte', 800], ['modul[2]/platte', 800]]);
  assert.deepEqual(row.parts.map(item => item.id), ['modul[0]', 'modul[1]', 'modul[2]']);
  assert.deepEqual(row.parts[1]!.parts.map(item => item.id), ['modul[1]/fuss[0,0]', 'modul[1]/fuss[0,1]', 'modul[1]/fuss[1,0]', 'modul[1]/fuss[1,1]']);
  assert.deepEqual(row.partCounts.map(item => [item.name, item.variant, item.stock, item.count]),
    [['Bühnenelement', '2x1', 'item', 3], ['Steckfuß', '800', 'count', 12]]);
  assertPoint(row.connectors.find(item => item.id === 'modul[1]/kante-vorn')!.position, [-1000, 800, -500]);
  assertPoint(row.connectors.find(item => item.id === 'modul[2]/fuss[0,0]/kopf')!.position, [-967, 720, 533]);
  assert.deepEqual(row.faces.map(face => face.key), ['modul[0]/belag', 'modul[1]/belag', 'modul[2]/belag']);
});

test('variants and scopes', () => {
  const standard = resolvePart(STARTER_BRACE, {}, STARTER_CONTEXT);
  assert.equal(standard.variant, 'standard');
  assert.deepEqual(standard.values, { T: 500, H: 1200, ballast: 0 });
  assert.deepEqual(standard.derived, { s: 40, wandZ: -230, spitzeZ: 230 });
  assert.equal(standard.stock, 'count');
  assert.equal(standard.planSymbol, 'footprint');
  assert.deepEqual(standard.part, refOf(STARTER_BRACE));

  const tall = resolvePart(STARTER_BRACE, { variant: 'hoch', values: { ballast: 2 } }, STARTER_CONTEXT);
  assert.deepEqual(tall.values, { T: 800, H: 2400, ballast: 2 });
  assert.deepEqual(tall.issues, []);

  // A placement cannot reach into the variant, nor state into placement.
  const reaching = resolvePart(STARTER_BRACE, { values: { T: 700 }, state: { ballast: 1 } }, STARTER_CONTEXT);
  assert.deepEqual(reaching.values, { T: 500, H: 1200, ballast: 0 });
  assert.deepEqual(codes(reaching), ['warning:wrong-scope', 'warning:wrong-scope']);
  assert.deepEqual(reaching.issues.map(item => item.parameter), ['T', 'ballast']);
  const stateInValues = resolvePart(DOOR_WALL, { values: { offen: 90 } }, FIXTURE_CONTEXT);
  assert.equal(stateInValues.values.offen, 0);
  assert.deepEqual(codes(stateInValues), ['warning:wrong-scope']);

  const unknownVariant = resolvePart(STARTER_BRACE, { variant: 'riesig' }, STARTER_CONTEXT);
  assert.deepEqual(codes(unknownVariant), ['error:unknown-variant']);
  assert.equal(unknownVariant.variant, 'standard');
  assert.equal(unknownVariant.solids.length, 3);
  assert.deepEqual(codes(resolvePart(STARTER_TABLE, { variant: 'gross' }, STARTER_CONTEXT)), ['error:unknown-variant']);
  assert.deepEqual(codes(resolvePart(STARTER_BRACE, { values: { farbe: 3 } }, STARTER_CONTEXT)), ['warning:unknown-parameter']);

  // A parent may set variant-scope values of a child; the variant they stand for is found again.
  const configured = resolvePartConfiguration(STARTER_BRACE, { values: { T: 800, H: 2400 } }, STARTER_CONTEXT);
  assert.equal(configured.variant, 'hoch');
  assert.deepEqual(configured.issues, []);
  const unmatched = resolvePartConfiguration(STARTER_BRACE, { values: { T: 510 } }, STARTER_CONTEXT);
  assert.equal(unmatched.variant, undefined);
  assert.deepEqual(codes(unmatched), ['error:variant-unmatched']);
  assert.match(unmatched.issues[0]!.message, /T = 510, H = 1200/);

  const deck = resolvePart(STARTER_DECK, { variant: '1x05', values: { H: 1000 } }, STARTER_CONTEXT);
  assert.deepEqual(deck.values, { B: 1000, T: 500, H: 1000 });
  assert.equal(deck.partCounts[0]!.variant, '1000');
  // Without variants the variant-scope parameters keep their defaults.
  assert.equal(resolvePart(DOOR_WALL, {}, FIXTURE_CONTEXT).variant, undefined);
});

test('values outside the domain are clamped or snapped, with a warning', () => {
  const table = resolvePart(STARTER_TABLE, { values: { B: 5000, T: 804, H: 123 } }, STARTER_CONTEXT);
  assert.deepEqual(table.values, { B: 2400, T: 800, H: 500 });
  assert.deepEqual(codes(table), ['warning:value-adjusted', 'warning:value-adjusted', 'warning:value-adjusted']);
  assert.match(table.issues[0]!.message, /^Parameter „B“: Der Wert 5000 ist nicht zulässig; verwendet wird 2400\.$/);
  assert.equal(hasErrors(table.issues), false);
  assertBounds(table, 'platte', [-1200, 472, -400], [1200, 500, 400]);

  const deck = resolvePart(STARTER_DECK, { values: { H: 730 } }, STARTER_CONTEXT);
  assert.equal(deck.values.H, 800);
  assert.equal(deck.height, 800);
  assert.equal(resolvePart(STARTER_BRACE, { values: { ballast: 7 } }, STARTER_CONTEXT).values.ballast, 2);
  assert.equal(resolvePart(DOOR_WALL, { state: { offen: 400 } }, FIXTURE_CONTEXT).values.offen, 120);
  assert.equal(resolvePart(STAIR, { values: { n: 3.6 } }, FIXTURE_CONTEXT).values.n, 4);
  assert.deepEqual(codes(resolvePart(STARTER_TABLE, { values: { B: 1210 } }, STARTER_CONTEXT)), []);
});

test('when switches bodies, holes, connectors and hardware', () => {
  const definition = panel({
    parameters: [{ key: 'an', label: 'An', type: 'toggle', default: 0, scope: 'placement' }],
    bodies: [
      { kind: 'box', key: 'immer', material: 'kiste', size: [100, 100, 100], at: [0, 50, 0] },
      { kind: 'box', key: 'manchmal', material: 'kiste', size: [100, 100, 100], at: [200, 50, 0], when: 'an' },
      { kind: 'box', key: 'jede-zweite', material: 'kiste', size: [10, 10, 10], at: [0, 200, 0], repeat: { count: 4, step: [20, 0, 0] }, when: 'i == 0 + an' },
    ],
    connectors: [{ key: 'haken', kind: 'floor', at: [0, 0, 0], axis: [0, -2, 0], when: 'an' }],
    hardware: [{ material: 'kiste', quantity: 2, when: 'an' }],
  });
  const off = resolvePart(definition, {}, FIXTURE_CONTEXT);
  assert.deepEqual(off.solids.map(item => item.id), ['immer', 'jede-zweite[0]']);
  assert.deepEqual(off.connectors, []);
  assert.deepEqual(off.hardware, [{ material: 'kiste', quantity: 2, weightKg: 8 }]);
  const on = resolvePart(definition, { values: { an: 1 } }, FIXTURE_CONTEXT);
  assert.deepEqual(on.solids.map(item => item.id), ['immer', 'manchmal', 'jede-zweite[1]']);
  assertPoint(on.connectors[0]!.axis, [0, -1, 0], 'axis is normalised');
  assert.deepEqual(on.hardware, [{ material: 'kiste', quantity: 5, weightKg: 20 }]);
});

function chain(length: number): PartDefinition[] {
  return Array.from({ length }, (_, index): PartDefinition => ({
    id: fixtureId(1000 + index), revision: 1, name: `Glied ${index}`, category: 'Test', parameters: [],
    bodies: [{ kind: 'box', key: 'klotz', material: 'kiste', size: [10, 10, 10], at: [0, 5 + index * 10, 0] }],
    ...(index + 1 < length ? { children: [{ key: 'naechstes', part: { id: fixtureId(1001 + index), revision: 1 }, at: [0, 0, 0] as [number, number, number] }] } : {}),
    traits: { stock: 'none' },
  }));
}

test('cycle and depth guards', () => {
  const part = (serial: number, children: number[]): PartDefinition => ({
    id: fixtureId(serial), revision: 1, name: `Teil ${serial}`, category: 'Test', parameters: [],
    bodies: [{ kind: 'box', key: 'klotz', material: 'kiste', size: [10, 10, 10], at: [0, 5, 0] }],
    children: children.map((child, index) => ({ key: `kind${index}`, part: { id: fixtureId(child), revision: 1 }, at: [index * 100 + 100, 0, 0] })),
    traits: { stock: 'none' },
  });
  const context = (parts: PartDefinition[]) => createPartContext({ materials: FIXTURE_MATERIALS, parts });

  const self = part(500, [500]);
  const selfResolved = resolvePart(self, {}, context([self]));
  assert.deepEqual(codes(selfResolved), ['error:child-cycle']);
  assert.equal(selfResolved.issues[0]!.child, 'kind0');
  assert.equal(selfResolved.solids.length, 1);

  const a = part(501, [502]), b = part(502, [503]), c = part(503, [501]);
  const loop = resolvePart(a, {}, context([a, b, c]));
  assert.deepEqual(codes(loop), ['error:child-cycle']);
  assert.equal(loop.issues[0]!.path, 'kind0/kind0');
  assert.match(loop.issues[0]!.message, /Unterbauteil „kind0“ → Unterbauteil „kind0“ → Unterbauteil „kind0“: „Teil 501“ enthält sich selbst\./);
  assert.equal(loop.solids.length, 3);

  // The same part under two parents is no cycle.
  const top = part(510, [511, 512]), left = part(511, [513]), right = part(512, [513]), shared = part(513, []);
  const diamond = resolvePart(top, {}, context([top, left, right, shared]));
  assert.deepEqual(diamond.issues, []);
  assert.equal(diamond.solids.length, 5);

  // A newer revision of the same part inside itself is still a cycle.
  const revised = { ...part(520, [520]), revision: 2 };
  const original = { ...part(520, []), revision: 1 };
  assert.deepEqual(codes(resolvePart(revised, {}, context([revised, original]))), ['error:child-cycle']);

  const allowed = chain(PART_LIMITS.depth + 1);
  const deep = resolvePart(allowed[0]!, {}, context(allowed));
  assert.deepEqual(deep.issues, []);
  assert.equal(deep.solids.length, PART_LIMITS.depth + 1);
  assert.equal(deep.solids.at(-1)!.path.length, PART_LIMITS.depth);

  const tooDeep = chain(PART_LIMITS.depth + 2);
  const refused = resolvePart(tooDeep[0]!, {}, context(tooDeep));
  assert.deepEqual(codes(refused), ['error:child-depth']);
  assert.match(refused.issues[0]!.message, /tiefer als 8 Ebenen/);
  assert.ok(refused.solids.length <= PART_LIMITS.depth + 1);

  const orphan = part(530, [531]);
  const missing = resolvePart(orphan, {}, context([orphan]));
  assert.deepEqual(codes(missing), ['error:unknown-part']);
  assert.equal(missing.solids.length, 1);
});

test('problems in the data come back as issues, never as exceptions', () => {
  const noMaterial = resolvePart(CHAIR, {}, createPartContext({ materials: FIXTURE_MATERIALS.filter(material => material.key !== 'kiste'), parts: FIXTURE_PARTS }));
  assert.deepEqual(codes(noMaterial), ['error:unknown-material']);
  assert.equal(noMaterial.issues[0]!.body, 'sitz');
  assert.equal(noMaterial.issues[0]!.material, 'kiste');

  const wrongKind = resolvePart(panel({
    parameters: [],
    bodies: [{ kind: 'beam', key: 'balken', material: 'sperrholz-12', from: [0, 0, 0], to: [0, 100, 0] }],
  }), {}, FIXTURE_CONTEXT);
  assert.deepEqual(codes(wrongKind), ['error:material-kind']);
  assert.match(wrongKind.issues[0]!.message, /ist Platte, gebraucht wird Profil/);

  const divided = resolvePart(panel({
    bodies: [{ kind: 'box', key: 'klotz', material: 'kiste', size: ['100 / (B - 1000)', 10, 10], at: [0, 5, 0] }],
  }), {}, FIXTURE_CONTEXT);
  assert.deepEqual(codes(divided), ['error:formula']);
  assert.deepEqual(divided.issues[0]!.formula, { code: 'division-by-zero', position: 4, source: '100 / (B - 1000)' });
  assert.equal(divided.issues[0]!.field, 'size[0]');
  assert.equal(divided.solids.length, 0);

  const thin = resolvePart(panel({
    bodies: [{ kind: 'box', key: 'klotz', material: 'kiste', size: ['B - 999.5', 10, 10], at: [0, 5, 0] }],
  }), {}, FIXTURE_CONTEXT);
  assert.deepEqual(codes(thin), ['error:body-too-small']);
  assert.match(thin.issues[0]!.message, /^Körper „klotz“: Breite 0,5 mm unterschreitet das Mindestmaß von 1 mm\.$/);

  const far = resolvePart(panel({
    bodies: [{ kind: 'box', key: 'klotz', material: 'kiste', size: [10, 10, 10], at: ['B * 1000', 5, 0] }],
  }), {}, FIXTURE_CONTEXT);
  assert.deepEqual(codes(far), ['error:out-of-range']);

  const tilted = resolvePart(panel({
    parameters: [],
    bodies: [{ kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0], outline: { shape: 'rect', x: 0, y: 0, width: 100, height: 100 } }],
    traits: { stock: 'none', surface: { body: 'platte' } },
  }), {}, FIXTURE_CONTEXT);
  assert.deepEqual(codes(tilted), ['error:surface-not-horizontal']);

  const child = resolvePart({
    id: fixtureId(40), revision: 1, name: 'Halter', category: 'Test', parameters: [], bodies: [],
    children: [{ key: 'fuss', part: refOf(STARTER_DECK_LEG), values: { H: 650, laenge: 3 }, at: [0, 0, 0], repeat: { count: 2, step: [100, 0, 0] } }],
    traits: { stock: 'none' },
  }, {}, FIXTURE_CONTEXT);
  // Issues of a child configuration are reported once, with the instance they were first seen in.
  assert.deepEqual(codes(child), ['warning:value-adjusted', 'warning:unknown-parameter']);
  assert.deepEqual(child.issues.map(item => item.path), ['fuss[0]', 'fuss[0]']);
  assert.equal(child.parts[1]!.variant, '600');
});

test('resolving is deterministic and leaves the definition untouched', () => {
  const before = JSON.stringify(STARTER_DECK);
  const first = resolvePart(STARTER_DECK, { variant: '2x05', values: { H: 400 } }, STARTER_CONTEXT);
  const second = resolvePart(STARTER_DECK, { variant: '2x05', values: { H: 400 } }, STARTER_CONTEXT);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(STARTER_DECK), before);
  // The result is plain data: it survives a structured clone and JSON.
  assert.deepEqual(structuredClone(first), first);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(first))), JSON.stringify(first));
});
