import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Vector3, type BufferGeometry } from 'three';
import {
  BOX_SIDE_SLOTS, SHEET_SIDE_SLOTS, buildPartGeometry, buildSolidGeometry, placementMatrix, solidSideSlot,
} from '../src/shared/parts/geometry.js';
import type { PartDefinition, SheetHole } from '../src/shared/parts/definition.js';
import { boundsOf, type Vec3 } from '../src/shared/parts/math.js';
import { placeResolvedPart } from '../src/shared/parts/place.js';
import { archSegmentCount, resolvePart, solidVertices, type ResolvedPart, type ResolvedSheet, type ResolvedSolid } from '../src/shared/parts/resolve.js';
import { STARTER_BRACE, STARTER_CONTEXT, STARTER_DECK, STARTER_WALL } from '../src/shared/parts/starter/index.js';
import { CHAIR, DOOR_WALL, FIXTURE_CONTEXT, STAIR, panel } from './helpers/partsFixtures.js';

// Positions are stored as 32-bit floats: about 1e-3 mm at stage scale.
const FLOAT_EPS = 2e-3;

function solid(resolved: ResolvedPart, id: string): ResolvedSolid {
  const found = resolved.solids.find(item => item.id === id);
  assert.ok(found, `solid ${id}`);
  return found;
}

function attribute(geometry: BufferGeometry, name: 'position' | 'normal' | 'uv'): Float32Array {
  return geometry.getAttribute(name).array as Float32Array;
}

function indices(geometry: BufferGeometry): number[] {
  const index = geometry.getIndex();
  assert.ok(index, 'geometry is indexed');
  return Array.from(index.array);
}

function assertFinite(geometry: BufferGeometry) {
  for (const name of ['position', 'normal', 'uv'] as const) {
    assert.ok(attribute(geometry, name).every(Number.isFinite), `${name} has no NaN`);
  }
  const count = geometry.getAttribute('position').count;
  assert.equal(geometry.getAttribute('normal').count, count);
  assert.equal(geometry.getAttribute('uv').count, count);
  assert.ok(indices(geometry).every(index => Number.isInteger(index) && index >= 0 && index < count), 'indices in range');
  const normals = attribute(geometry, 'normal');
  for (let i = 0; i < normals.length; i += 3) {
    assert.ok(Math.abs(Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) - 1) < 1e-5, 'unit normal');
  }
}

function assertGroupsCover(geometry: BufferGeometry) {
  const total = indices(geometry).length;
  let next = 0;
  for (const group of geometry.groups) {
    assert.equal(group.start, next, 'groups are contiguous');
    assert.equal(group.count % 3, 0);
    next += group.count;
  }
  assert.equal(next, total, 'groups cover every triangle');
}

function assertBounds(geometry: BufferGeometry, points: readonly Vec3[], message: string) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox as Box3;
  const expected = boundsOf(points);
  for (const axis of ['x', 'y', 'z'] as const) {
    assert.ok(Math.abs(box.min[axis] - expected.min[axis]) < FLOAT_EPS, `${message} min ${axis}: ${box.min[axis]} is not ${expected.min[axis]}`);
    assert.ok(Math.abs(box.max[axis] - expected.max[axis]) < FLOAT_EPS, `${message} max ${axis}: ${box.max[axis]} is not ${expected.max[axis]}`);
  }
}

/**
 * Topology of the surface after welding vertices that share a position: every edge must be
 * used by exactly two triangles, once in each direction. Returns the enclosed volume, which
 * is positive when the triangles face outwards.
 */
function closedVolume(geometry: BufferGeometry, message: string): number {
  const positions = attribute(geometry, 'position');
  const welded = new Map<string, number>();
  const weld = (index: number) => {
    const key = [0, 1, 2].map(axis => Math.round(positions[index * 3 + axis]! * 100)).join(',');
    const known = welded.get(key);
    if (known !== undefined) return known;
    welded.set(key, welded.size);
    return welded.size - 1;
  };
  const directed = new Map<string, number>();
  const list = indices(geometry);
  let volume = 0;
  for (let i = 0; i < list.length; i += 3) {
    const corners = [list[i]!, list[i + 1]!, list[i + 2]!];
    const ids = corners.map(weld);
    assert.equal(new Set(ids).size, 3, `${message}: degenerate triangle`);
    for (let edge = 0; edge < 3; edge++) {
      const key = `${ids[edge]}>${ids[(edge + 1) % 3]}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
    const [a, b, c] = corners.map(index => new Vector3(positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!));
    volume += a!.dot(b!.clone().cross(c!)) / 6;
  }
  for (const [key, count] of directed) {
    const [from, to] = key.split('>');
    assert.equal(count, 1, `${message}: edge ${key} is used ${count} times in one direction`);
    assert.equal(directed.get(`${to}>${from}`), 1, `${message}: edge ${key} has no opposite`);
  }
  return volume;
}

/** Every triangle's winding agrees with the normals stored at its corners. */
function assertWindingMatchesNormals(geometry: BufferGeometry, message: string) {
  const positions = attribute(geometry, 'position'), normals = attribute(geometry, 'normal');
  const list = indices(geometry);
  for (let i = 0; i < list.length; i += 3) {
    const [a, b, c] = [list[i]!, list[i + 1]!, list[i + 2]!].map(index => new Vector3(positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!));
    const face = b!.clone().sub(a!).cross(c!.clone().sub(a!)).normalize();
    for (const index of [list[i]!, list[i + 1]!, list[i + 2]!]) {
      const stored = new Vector3(normals[index * 3]!, normals[index * 3 + 1]!, normals[index * 3 + 2]!);
      assert.ok(face.dot(stored) > 0.999, `${message}: triangle ${i / 3} faces ${face.toArray()} but stores ${stored.toArray()}`);
    }
  }
}

function groupNormals(geometry: BufferGeometry, slot: number): Vector3[] {
  const normals = attribute(geometry, 'normal');
  const list = indices(geometry);
  const group = geometry.groups.find(item => item.materialIndex === slot);
  assert.ok(group, `group ${slot}`);
  return list.slice(group.start, group.start + group.count).map(index => new Vector3(normals[index * 3]!, normals[index * 3 + 1]!, normals[index * 3 + 2]!));
}

function sheetWith(holes: SheetHole[], overrides: Partial<PartDefinition> = {}): ResolvedPart {
  const resolved = resolvePart(panel({
    bodies: [{
      kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xy', anchor: 'centre', at: [0, 0, 0],
      outline: { shape: 'rect', x: '-B / 2', y: 0, width: 'B', height: 'H' }, holes,
    }],
    ...overrides,
  }), {}, FIXTURE_CONTEXT);
  assert.deepEqual(resolved.issues, []);
  return resolved;
}

test('box: 24 vertices, six sides, bounds of the solid', () => {
  const chair = resolvePart(CHAIR, {}, FIXTURE_CONTEXT);
  const seat = solid(chair, 'sitz');
  const geometry = buildSolidGeometry(seat);
  assertFinite(geometry);
  assertGroupsCover(geometry);
  assert.equal(geometry.getAttribute('position').count, 24);
  assert.equal(indices(geometry).length, 36);
  assert.deepEqual(geometry.groups.map(group => [group.materialIndex, group.count]), [[0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6]]);
  assertBounds(geometry, [{ x: -220, y: 430, z: -220 }, { x: 220, y: 470, z: 220 }], 'seat');
  const expected: Record<keyof typeof BOX_SIDE_SLOTS, [number, number, number]> = {
    right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0], back: [0, 0, 1], front: [0, 0, -1],
  };
  for (const [side, normal] of Object.entries(expected)) {
    const slot = solidSideSlot(seat, side as keyof typeof BOX_SIDE_SLOTS)!;
    assert.equal(slot, BOX_SIDE_SLOTS[side as keyof typeof BOX_SIDE_SLOTS]);
    for (const found of groupNormals(geometry, slot)) assert.deepEqual(found.toArray(), normal, side);
  }
  assert.equal(solidSideSlot(seat, 'edge'), undefined);
  assertWindingMatchesNormals(geometry, 'seat');
  assert.ok(Math.abs(closedVolume(geometry, 'seat') - 440 * 40 * 440) < 1);
  const uv = attribute(geometry, 'uv');
  assert.ok(uv.every(value => value === 0 || value === 1), 'face UVs span 0 to 1');
  const mm = attribute(buildSolidGeometry(seat, { uv: 'mm' }), 'uv');
  assert.deepEqual([...new Set(mm)].sort((a, b) => a - b), [0, 40, 440]);
});

test('beam: an oriented box along its centre line', () => {
  const brace = resolvePart(STARTER_BRACE, {}, STARTER_CONTEXT);
  for (const id of ['stiel', 'schwelle', 'strebe']) {
    const beam = solid(brace, id);
    const geometry = buildSolidGeometry(beam);
    assertFinite(geometry);
    assertGroupsCover(geometry);
    assert.equal(geometry.getAttribute('position').count, 24);
    assert.equal(geometry.groups.length, 6);
    assertBounds(geometry, solidVertices(beam), id);
    assertWindingMatchesNormals(geometry, id);
    assert.equal(beam.kind, 'beam');
    if (beam.kind === 'beam') assert.ok(Math.abs(closedVolume(geometry, id) - 40 * 40 * beam.length) < 1, `${id} volume`);
    // Every vertex is one of the eight corners of the resolved solid.
    const corners = solidVertices(beam);
    const positions = attribute(geometry, 'position');
    for (let i = 0; i < positions.length; i += 3) {
      const nearest = Math.min(...corners.map(corner => Math.hypot(corner.x - positions[i]!, corner.y - positions[i + 1]!, corner.z - positions[i + 2]!)));
      assert.ok(nearest < FLOAT_EPS, `${id} vertex ${i / 3} is ${nearest} mm off a corner`);
    }
  }
  // The strut leans: its top side faces up and away from the wall side.
  const strut = buildSolidGeometry(solid(brace, 'strebe'));
  const pitch = Math.atan2(460, 1160);
  const lean = groupNormals(strut, BOX_SIDE_SLOTS.back)[0]!;
  assert.ok(Math.abs(Math.abs(lean.y) - Math.sin(pitch)) < 1e-6 && Math.abs(Math.abs(lean.z) - Math.cos(pitch)) < 1e-6);
});

test('sheet without holes: 24 vertices in three groups', () => {
  const wall = resolvePart(STARTER_WALL, { variant: 'voll' }, STARTER_CONTEXT);
  const sheet = solid(wall, 'platte');
  const geometry = buildSolidGeometry(sheet);
  assertFinite(geometry);
  assertGroupsCover(geometry);
  // Two caps of four corners, four edge quads.
  assert.equal(geometry.getAttribute('position').count, 8 + 16);
  assert.deepEqual(geometry.groups.map(group => [group.materialIndex, group.count / 3]), [[0, 8], [1, 2], [2, 2]]);
  assertBounds(geometry, [{ x: -600, y: 0, z: -14 }, { x: 600, y: 2400, z: 14 }], 'wall');
  // As in wallMeshGeometry: slot 0 is the edge, the front faces the audience (-Z).
  for (const normal of groupNormals(geometry, SHEET_SIDE_SLOTS.front)) assert.deepEqual(normal.toArray(), [0, 0, -1]);
  for (const normal of groupNormals(geometry, SHEET_SIDE_SLOTS.back)) assert.deepEqual(normal.toArray(), [0, 0, 1]);
  for (const normal of groupNormals(geometry, SHEET_SIDE_SLOTS.edge)) assert.equal(normal.z, 0);
  assert.equal(solidSideSlot(sheet, 'front'), 1);
  assert.equal(solidSideSlot(sheet, 'top'), undefined);
  assertWindingMatchesNormals(geometry, 'wall');
  assert.ok(Math.abs(closedVolume(geometry, 'wall') - 1200 * 2400 * 28) < 10);
});

test('sheet UVs follow the wall panel convention', () => {
  const wall = resolvePart(STARTER_WALL, { variant: 'tuer' }, STARTER_CONTEXT);
  const geometry = buildSolidGeometry(solid(wall, 'platte'));
  const positions = attribute(geometry, 'position'), normals = attribute(geometry, 'normal'), uv = attribute(geometry, 'uv');
  for (let i = 0; i < positions.length / 3; i++) {
    const [x, y, z] = [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
    const [nx, ny, nz] = [Math.abs(normals[i * 3]!), Math.abs(normals[i * 3 + 1]!), Math.abs(normals[i * 3 + 2]!)];
    // Same rule as applyWallPanelUVs, with the panel standing on y = 0 instead of centred.
    const expected = nz >= nx && nz >= ny ? [(x + 600) / 1200, y / 2400]
      : ny >= nx ? [(x + 600) / 1200, (z + 14) / 28]
        : [(z + 14) / 28, y / 2400];
    assert.ok(Math.abs(uv[i * 2]! - expected[0]!) < 1e-6 && Math.abs(uv[i * 2 + 1]! - expected[1]!) < 1e-6, `vertex ${i}`);
  }
  const mm = attribute(buildSolidGeometry(solid(wall, 'platte'), { uv: 'mm' }), 'uv');
  assert.equal(Math.max(...mm), 2400);
  assert.equal(Math.min(...mm), 0);
});

test('sheet with a rectangular hole: counts and a closed surface', () => {
  const resolved = sheetWith([{ shape: 'rect', key: 'fenster', x: -300, y: 900, width: 600, height: 500 }]);
  const sheet = solid(resolved, 'platte') as ResolvedSheet;
  const geometry = buildSolidGeometry(sheet);
  assertFinite(geometry);
  assertGroupsCover(geometry);
  // Eight loop points: two caps of 8 vertices and 8 edge quads of 4.
  assert.equal(geometry.getAttribute('position').count, 2 * 8 + 8 * 4);
  // A polygon of n points with one hole needs n triangles.
  assert.deepEqual(geometry.groups.map(group => [group.materialIndex, group.count / 3]), [[0, 16], [1, 8], [2, 8]]);
  assertBounds(geometry, [{ x: -500, y: 0, z: -6 }, { x: 500, y: 2000, z: 6 }], 'window sheet');
  assertWindingMatchesNormals(geometry, 'window sheet');
  const volume = closedVolume(geometry, 'window sheet');
  assert.ok(Math.abs(volume - sheet.netAreaMm2 * 12) < 10, `volume ${volume}`);
  assert.equal(sheet.netAreaMm2, 1000 * 2000 - 600 * 500);
  // The reveal of the hole faces into the opening.
  const positions = attribute(geometry, 'position'), normals = attribute(geometry, 'normal');
  let reveal = 0;
  for (let i = 0; i < positions.length / 3; i++) {
    if (Math.abs(positions[i * 3]! + 300) < 1e-3 && normals[i * 3]! !== 0 && positions[i * 3 + 1]! >= 900 && positions[i * 3 + 1]! <= 1400) {
      assert.equal(normals[i * 3], 1, 'left reveal faces +X, into the hole');
      reveal++;
    }
  }
  assert.equal(reveal, 4);
});

test('sheet with an arch hole: counts and a closed surface', () => {
  const resolved = sheetWith([{ shape: 'arch', key: 'bogen', x: -400, y: 200, width: 800, height: 1500 }]);
  const sheet = solid(resolved, 'platte') as ResolvedSheet;
  const crown = archSegmentCount(400);
  const holePoints = 4 + crown - 1;
  assert.equal(sheet.holes[0]!.length, holePoints);
  const geometry = buildSolidGeometry(sheet);
  assertFinite(geometry);
  assertGroupsCover(geometry);
  const loopPoints = 4 + holePoints;
  assert.equal(geometry.getAttribute('position').count, 2 * loopPoints + 4 * loopPoints);
  assert.deepEqual(geometry.groups.map(group => [group.materialIndex, group.count / 3]), [[0, 2 * loopPoints], [1, loopPoints], [2, loopPoints]]);
  assertBounds(geometry, [{ x: -500, y: 0, z: -6 }, { x: 500, y: 2000, z: 6 }], 'arch sheet');
  assertWindingMatchesNormals(geometry, 'arch sheet');
  const volume = closedVolume(geometry, 'arch sheet');
  assert.ok(Math.abs(volume - sheet.netAreaMm2 * 12) < 20, `volume ${volume} against ${sheet.netAreaMm2 * 12}`);
});

test('notched outlines, several holes and polygon outlines stay closed', () => {
  const cases: [string, ResolvedPart][] = [
    ['door notch', resolvePart(STARTER_WALL, { variant: 'tuer' }, STARTER_CONTEXT)],
    ['arch to the floor', sheetWith([{ shape: 'arch', key: 'bogen', x: -400, y: 0, width: 800, height: 1900 }])],
    ['window and door', sheetWith([
      { shape: 'rect', key: 'tuer', x: -450, y: 0, width: 400, height: 1800 },
      { shape: 'arch', key: 'fenster', x: 50, y: 900, width: 350, height: 600 },
      { shape: 'polygon', key: 'luke', points: [[100, 200], [400, 200], [250, 500]] },
    ])],
    ['corner notch', sheetWith([{ shape: 'rect', key: 'ecke', x: 200, y: 1500, width: 300, height: 500 }])],
    ['L-shaped deck', resolvePart(panel({
      parameters: [],
      bodies: [{
        kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xz', at: [0, 400, 0],
        // Includes a repeated corner and a point on a straight run; both are dropped on resolve.
        outline: { shape: 'polygon', points: [[0, 0], [1000, 0], [2000, 0], [2000, 1000], [1000, 1000], [1000, 1000], [1000, 2000], [0, 2000]] },
        holes: [{ shape: 'rect', key: 'klappe', x: 200, y: 200, width: 400, height: 400 }],
      }],
    }), {}, FIXTURE_CONTEXT)],
  ];
  for (const [label, resolved] of cases) {
    assert.deepEqual(resolved.issues, [], label);
    const sheet = solid(resolved, 'platte') as ResolvedSheet;
    const geometry = buildSolidGeometry(sheet);
    assertFinite(geometry);
    assertGroupsCover(geometry);
    assertBounds(geometry, solidVertices(sheet), label);
    assertWindingMatchesNormals(geometry, label);
    const volume = closedVolume(geometry, label);
    assert.ok(Math.abs(volume - sheet.netAreaMm2 * sheet.thickness) < 50, `${label}: volume ${volume} against ${sheet.netAreaMm2 * sheet.thickness}`);
    const points = sheet.outline.length + sheet.holes.reduce((sum, hole) => sum + hole.length, 0);
    assert.equal(geometry.getAttribute('position').count, 6 * points, label);
    assert.equal(indices(geometry).length / 3, 2 * points + 2 * (points + 2 * sheet.holes.length - 2), label);
  }
  assert.equal((solid(cases[4]![1], 'platte') as ResolvedSheet).outline.length, 6);
});

test('holes anywhere on a grid of positions triangulate to a closed surface', () => {
  // Axis-aligned holes at many offsets, including ones level with each other, where ear clipping meets collinear points.
  for (let column = 0; column < 6; column++) {
    for (let row = 0; row < 6; row++) {
      const resolved = sheetWith([
        { shape: 'rect', key: 'a', x: -450 + column * 40, y: 100 + row * 150, width: 200, height: 300 },
        { shape: 'rect', key: 'b', x: 150, y: 100 + column * 150, width: 200 + row * 20, height: 300 },
        { shape: 'arch', key: 'c', x: -100 + row * 10, y: 1400, width: 180, height: 400 + column * 20 },
      ]);
      const sheet = solid(resolved, 'platte') as ResolvedSheet;
      const geometry = buildSolidGeometry(sheet);
      const volume = closedVolume(geometry, `grid ${column}/${row}`);
      assert.ok(Math.abs(volume - sheet.netAreaMm2 * 12) < 50, `grid ${column}/${row}`);
      const points = sheet.outline.length + sheet.holes.reduce((sum, hole) => sum + hole.length, 0);
      assert.equal(indices(geometry).length / 3, 2 * points + 2 * (points + 2 * sheet.holes.length - 2), `grid ${column}/${row}`);
    }
  }
});

test('cut-outs in awkward positions resolve to clean outlines and closed meshes', () => {
  const cases: [string, SheetHole[]][] = [
    // An arch that is all crown: springing points and sill corners coincide.
    ['semicircle', [{ shape: 'arch', key: 'a', x: -200, y: 500, width: 400, height: 200 }]],
    // The notch corner (-100, 1800) lies exactly on the line from (500, 0) to the notch end on the top edge.
    ['corner in line with a diagonal', [{ shape: 'polygon', key: 'a', points: [[-300, 1800], [-100, 1800], [-200, 2100]] }]],
    // A notch from the left edge, overlapped by a second cut-out next to its inner corner (-300, 350).
    ['overlapping a notch', [
      { shape: 'rect', key: 'a', x: -290, y: 350, width: 100, height: 500 },
      { shape: 'polygon', key: 'b', points: [[-450, 200], [-150, 250], [-100, 500], [-300, 350], [-520, 500]] },
    ]],
    // Slanted edges that end on the sheet edge: the cut meets the edge exactly where it was drawn.
    ['triangle standing on the floor', [{ shape: 'polygon', key: 'a', points: [[-100, 0], [100, 0], [0, 300]] }]],
    ['corner cut', [{ shape: 'polygon', key: 'a', points: [[-500, 0], [-300, 0], [-500, 300]] }]],
    // A crown point exactly on the sheet edge, with the arch passing through it.
    ['arch through the side', [{ shape: 'arch', key: 'a', x: 450, y: 700, width: 200, height: 400 }]],
    ['level holes', [
      { shape: 'rect', key: 'a', x: -450, y: 100, width: 200, height: 300 },
      { shape: 'rect', key: 'b', x: 150, y: 100, width: 200, height: 300 },
    ]],
  ];
  for (const [label, holes] of cases) {
    const resolved = sheetWith(holes);
    const sheet = solid(resolved, 'platte') as ResolvedSheet;
    const loops = [sheet.outline, ...sheet.holes];
    for (const loop of loops) {
      loop.forEach((point, index) => {
        const next = loop[(index + 1) % loop.length]!;
        assert.ok(Math.hypot(next.x - point.x, next.y - point.y) > 0.01, `${label}: no repeated corner`);
      });
    }
    const geometry = buildSolidGeometry(sheet);
    assertFinite(geometry);
    assertWindingMatchesNormals(geometry, label);
    const volume = closedVolume(geometry, label);
    assert.ok(Math.abs(volume - sheet.netAreaMm2 * 12) < 50, `${label}: volume ${volume}`);
    const points = loops.reduce((sum, loop) => sum + loop.length, 0);
    assert.equal(indices(geometry).length / 3, 2 * points + 2 * (points + 2 * sheet.holes.length - 2), label);
  }
  const semicircle = solid(sheetWith(cases[0]![1]), 'platte') as ResolvedSheet;
  assert.equal(semicircle.holes[0]!.length, archSegmentCount(200) + 1);
  const union = solid(sheetWith(cases[2]![1]), 'platte') as ResolvedSheet;
  // Polygon 67 750 mm², of which a triangle of 20 × 72,078 / 2 lies beyond the edge; rectangle 50 000 mm²;
  // both share the trapezoid under the line from (-290, 357,5) to (-190, 432,5).
  const outsideEdge = 0.5 * 20 * ((350 + 150 * 200 / 220) - (500 - 300 * 20 / 70));
  assert.ok(Math.abs(union.netAreaMm2 - (2_000_000 - 50_000 - (67_750 - outsideEdge) + 4_500)) < 1e-6, `union area ${union.netAreaMm2}`);

  const standing = solid(sheetWith(cases[3]![1]), 'platte') as ResolvedSheet;
  assert.equal(standing.netAreaMm2, 2_000_000 - 30_000);
  assert.deepEqual(standing.outline.map(point => [point.x, point.y]), [[100, 0], [500, 0], [500, 2000], [-500, 2000], [-500, 0], [-100, 0], [0, 300]]);
  const corner = solid(sheetWith(cases[4]![1]), 'platte') as ResolvedSheet;
  assert.equal(corner.netAreaMm2, 2_000_000 - 30_000);
  assert.deepEqual(corner.outline.map(point => [point.x, point.y]), [[-300, 0], [500, 0], [500, 2000], [-500, 2000], [-500, 300]]);

  // A cut-out that only touches the edge from inside would leave a pinch, and one whose edge runs
  // through a corner of the outline has no clean crossing; both are refused rather than bent into shape.
  for (const holes of [
    [{ shape: 'polygon', key: 'spitze', points: [[0, 1500], [100, 1500], [50, 2000]] }],
    [{ shape: 'arch', key: 'bogen', x: -100, y: 1500, width: 200, height: 500 }],
    [
      { shape: 'rect', key: 'ecke', x: -300, y: 350, width: 100, height: 500 },
      { shape: 'polygon', key: 'kerbe', points: [[-450, 200], [-150, 250], [-100, 500], [-300, 350], [-520, 500]] },
    ],
  ] satisfies SheetHole[][]) {
    const touching = resolvePart(panel({
      bodies: [{
        kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0],
        outline: { shape: 'rect', x: '-B / 2', y: 0, width: 'B', height: 'H' }, holes,
      }],
    }), {}, FIXTURE_CONTEXT);
    assert.deepEqual(touching.issues.map(item => [item.code, item.hole]), [['hole-unsupported', holes[0]!.key]]);
  }
});

test('random cut-outs: the sheet is the blank minus the cut-outs, and its mesh is closed', () => {
  let state = 20261112;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const pick = (count: number) => Math.floor(random() * count);
  const inside = (point: { x: number; y: number }, loop: readonly { x: number; y: number }[]) => {
    let hit = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i]!, b = loop[j]!;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  const near = (point: { x: number; y: number }, loop: readonly { x: number; y: number }[]) => loop.some((a, index) => {
    const b = loop[(index + 1) % loop.length]!;
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const along = Math.max(0, Math.min(span, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / span));
    return Math.hypot(point.x - a.x - (b.x - a.x) * along / span, point.y - a.y - (b.y - a.y) * along / span) < 1.6;
  });
  let accepted = 0;
  for (let run = 0; run < 400; run++) {
    // A 50 mm grid makes cut-outs meet the edge, each other's lines and each other's corners often.
    const holes: SheetHole[] = Array.from({ length: 1 + pick(4) }, (_, index): SheetHole => {
      const x = -500 + pick(21) * 50, y = pick(41) * 50, width = 100 + pick(4) * 100, height = 100 + pick(5) * 100;
      const kind = pick(3);
      if (kind === 0) return { shape: 'rect', key: `h${index}`, x, y, width, height };
      if (kind === 1) return { shape: 'arch', key: `h${index}`, x, y, width, height };
      return { shape: 'polygon', key: `h${index}`, points: [[x, y], [x + width, y + 50], [x + width + 50, y + height], [x + width / 2, y + height / 2], [x - 50, y + height]] };
    });
    const resolved = resolvePart(panel({
      bodies: [{
        kind: 'sheet', key: 'platte', material: 'sperrholz-12', plane: 'xy', at: [0, 0, 0],
        outline: { shape: 'rect', x: '-B / 2', y: 0, width: 'B', height: 'H' }, holes,
      }],
    }), {}, FIXTURE_CONTEXT);
    // Overlapping, splitting or covering cut-outs are refused; what is accepted must be right.
    if (resolved.issues.some(item => item.severity === 'error')) continue;
    accepted++;
    const sheet = solid(resolved, 'platte') as ResolvedSheet;
    const label = `run ${run}: ${JSON.stringify(holes)}`;
    const blank = [{ x: -500, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 2000 }, { x: -500, y: 2000 }];
    const loops = [sheet.outline, ...sheet.holes, ...sheet.openings.map(opening => opening.points), blank];
    for (let sample = 0; sample < 60; sample++) {
      const point = { x: -500 + random() * 1000, y: random() * 2000 };
      if (loops.some(loop => near(point, loop))) continue;
      const solidHere = inside(point, sheet.outline) && !sheet.holes.some(hole => inside(point, hole));
      const expected = !sheet.openings.some(opening => inside(point, opening.points));
      assert.equal(solidHere, expected, `${label} at ${point.x}, ${point.y}`);
    }
    const geometry = buildSolidGeometry(sheet);
    const volume = closedVolume(geometry, label);
    assert.ok(Math.abs(volume - sheet.netAreaMm2 * 12) < 100, `${label}: volume ${volume} against ${sheet.netAreaMm2 * 12}`);
    const points = sheet.outline.length + sheet.holes.reduce((sum, hole) => sum + hole.length, 0);
    assert.equal(indices(geometry).length / 3, 2 * points + 2 * (points + 2 * sheet.holes.length - 2), label);
  }
  assert.ok(accepted > 200, `only ${accepted} of 400 cases were accepted`);
});

test('a part geometry has one material slot per stock material and finishable face', () => {
  const deck = resolvePart(STARTER_DECK, {}, STARTER_CONTEXT);
  const built = buildPartGeometry(deck);
  assertFinite(built.geometry);
  assertGroupsCover(built.geometry);
  assert.deepEqual(built.slots, [
    { index: 0, material: 'sperrholz-12' },
    { index: 1, material: 'sperrholz-12', face: 'belag' },
    { index: 2, material: 'buehnenrahmen-40x68' },
    { index: 3, material: 'gummifuss-50' },
    { index: 4, material: 'steckfuss-rohr-50' },
  ]);
  assert.deepEqual(built.geometry.groups.map(group => group.materialIndex), [0, 1, 2, 3, 4]);
  // Deck sheet 24 vertices, four frame beams and eight leg solids of 24 each.
  assert.equal(built.geometry.getAttribute('position').count, 24 * 13);
  assert.equal(indices(built.geometry).length, 36 * 13);
  // The walking surface is the front face of the lying sheet: two triangles facing up.
  assert.equal(built.geometry.groups[1]!.count, 6);
  for (const normal of groupNormals(built.geometry, 1)) assert.ok(Math.abs(normal.y - 1) < 1e-6);
  assertBounds(built.geometry, [deck.bounds.min, deck.bounds.max], 'deck');
  assertWindingMatchesNormals(built.geometry, 'deck');

  const wall = buildPartGeometry(resolvePart(STARTER_WALL, { variant: 'tuer' }, STARTER_CONTEXT));
  assert.deepEqual(wall.slots, [
    { index: 0, material: 'tischlerplatte-28', face: 'edge' },
    { index: 1, material: 'tischlerplatte-28', face: 'front' },
    { index: 2, material: 'tischlerplatte-28', face: 'back' },
  ]);

  // A face for `all` sides is one slot; a face for one side wins over it.
  const boxed = resolvePart(panel({
    parameters: [],
    bodies: [{ kind: 'box', key: 'kiste', material: 'kiste', size: [400, 300, 200], at: [0, 150, 0] }],
    traits: { stock: 'none', faces: [{ key: 'rundum', label: 'Rundum', body: 'kiste', side: 'all' }, { key: 'deckel', label: 'Deckel', body: 'kiste', side: 'top' }] },
  }), {}, FIXTURE_CONTEXT);
  const box = buildPartGeometry(boxed);
  assert.deepEqual(box.slots, [{ index: 0, material: 'kiste', face: 'rundum' }, { index: 1, material: 'kiste', face: 'deckel' }]);
  assert.deepEqual(box.geometry.groups.map(group => group.count), [30, 6]);
  assert.deepEqual(boxed.faces.map(face => [face.key, face.areaMm2]), [['rundum', 2 * (400 * 300 + 300 * 200 + 400 * 200)], ['deckel', 400 * 200]]);
});

test('placed parts: geometry of the placed solids equals the local geometry moved by the placement matrix', () => {
  const placement = { x: 2500, y: -1200, rotation: 30, elevation: 800 };
  for (const [label, resolved] of [
    ['door wall', resolvePart(DOOR_WALL, { state: { offen: 60 } }, FIXTURE_CONTEXT)],
    ['stair', resolvePart(STAIR, { values: { n: 6 } }, FIXTURE_CONTEXT)],
    ['deck', resolvePart(STARTER_DECK, { variant: '1x05' }, STARTER_CONTEXT)],
  ] as const) {
    const placed = placeResolvedPart(resolved, placement);
    const world = buildPartGeometry(placed);
    const local = buildPartGeometry(resolved);
    assert.deepEqual(world.slots, local.slots, label);
    local.geometry.applyMatrix4(placementMatrix(placement));
    const a = attribute(world.geometry, 'position'), b = attribute(local.geometry, 'position');
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i]! - b[i]!) < 5e-3, `${label} position ${i}: ${a[i]} against ${b[i]}`);
    const na = attribute(world.geometry, 'normal'), nb = attribute(local.geometry, 'normal');
    for (let i = 0; i < na.length; i++) assert.ok(Math.abs(na[i]! - nb[i]!) < 1e-5, `${label} normal ${i}`);
    assertBounds(world.geometry, [placed.bounds.min, placed.bounds.max], label);
    assertFinite(world.geometry);
    assertWindingMatchesNormals(world.geometry, label);
  }
});

test('geometry builds without a DOM', () => {
  assert.equal(typeof (globalThis as { document?: unknown }).document, 'undefined');
  assert.equal(typeof (globalThis as { window?: unknown }).window, 'undefined');
});
