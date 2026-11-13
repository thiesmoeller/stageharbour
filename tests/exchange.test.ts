import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutSchema, venueGeometrySchema, type Layout, type LayoutObject, type VenueGeometry } from '../src/shared/layout.js';
import { createLayoutPartIndex } from '../src/shared/layoutObjects.js';
import {
  EXCHANGE_FORMATS, buildMvrXml, buildSceneMesh, exchangeFilename, exportGltf, exportMvr, exportSceneFile,
  mvrGeometryFiles, mvrMatrix, readZip, writeZip, type SceneMesh,
} from '../src/shared/exchange/index.js';
import { derivedUuid } from '../src/shared/exchange/mvr.js';
import { STARTER_LIBRARY, STARTER_PART_IDS } from '../src/shared/parts/starter/index.js';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ralHex } from '../src/shared/ral.js';

const id = (serial: number) => `20000000-0000-4000-8000-${String(serial).padStart(12, '0')}`;
const FLOOR = '00000000-0000-4000-8000-000000000001';
const catalog = createLayoutPartIndex(STARTER_LIBRARY);

const venue: VenueGeometry = venueGeometrySchema.parse({
  schemaVersion: 1, width: 12000, depth: 9000,
  outline: [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 9000 }, { x: 4000, y: 9000 }, { x: 0, y: 6000 }],
  walls: [{ id: id(100), label: 'Rückwand', x: 6000, y: 8800, rotation: 0, width: 8000, height: 4000, thickness: 200 }],
  platforms: [{ id: id(101), label: 'Hinterbühne', elevation: 400, outline: [{ x: 8000, y: 5000 }, { x: 11000, y: 5000 }, { x: 11000, y: 8000 }, { x: 8000, y: 8000 }] }],
  stairs: [{ id: id(102), label: 'Treppe', lowerSurfaceId: FLOOR, upperSurfaceId: id(101), x: 7000, y: 6500, rotation: 90, width: 1200, run: 1600, riserHeight: 160 }],
  trusses: [{ id: id(103), label: 'Traverse 1', x: 6000, y: 3000, rotation: 20, length: 6000, sectionWidth: 400, bottomHeight: 3500, thickness: 300, hangPoints: [] }],
  placeholders: [{ id: id(104), kind: 'chair', label: 'Stuhl Parkett', x: 3000, y: 800, rotation: 0, width: 450, depth: 450, height: 900, supportingSurfaceId: FLOOR }],
});

function part(serial: number, label: string, partId: string, extra: Partial<LayoutObject>): LayoutObject {
  return { id: id(serial), label, part: { id: partId, revision: 1 }, x: 0, y: 0, rotation: 0, support: FLOOR, ...extra };
}

const layout: Layout = layoutSchema.parse({
  schemaVersion: 2,
  objects: [
    part(1, 'Wand mit Tür', STARTER_PART_IDS.wall, {
      variant: 'doorLeft', x: 3000, y: 2000, rotation: 30,
      finishes: { front: { kind: 'paint', ral: '9010' } },
    }),
    part(2, 'Podest A', STARTER_PART_IDS.deck, { variant: '2x1', values: { H: 400 }, x: 9000, y: 6000, rotation: 90, support: id(101) }),
    part(3, 'Stuhl 1', STARTER_PART_IDS.chair, { x: 1000, y: 1000 }),
    part(4, 'Stuhl 2', STARTER_PART_IDS.chair, { x: 1600, y: 1000, rotation: 45 }),
    part(5, 'Stützdreieck', STARTER_PART_IDS.brace, { variant: 'standard', x: 3000, y: 2300, rotation: 30 }),
  ],
  joints: [],
});

const mesh = buildSceneMesh({ layout, venue, catalog });

type Glb = { json: any; bin: Uint8Array };
function parseGlb(buffer: ArrayBuffer): Glb {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'glTF');
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), buffer.byteLength);
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const binStart = 20 + jsonLength;
  assert.equal(view.getUint32(binStart + 4, true), 0x004e4942);
  return { json, bin: bytes.subarray(binStart + 8, binStart + 8 + view.getUint32(binStart, true)) };
}

function accessorFloats(glb: Glb, accessorIndex: number): Float32Array {
  const accessor = glb.json.accessors[accessorIndex];
  const view = glb.json.bufferViews[accessor.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type as 'VEC3'];
  const start = glb.bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return new Float32Array(glb.bin.buffer.slice(start, start + accessor.count * comps * 4));
}

function accessorIndices(glb: Glb, accessorIndex: number): number[] {
  const accessor = glb.json.accessors[accessorIndex];
  const view = glb.json.bufferViews[accessor.bufferView];
  const size = accessor.componentType === 5125 ? 4 : 2;
  const start = glb.bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(glb.bin.buffer, start, accessor.count * size);
  return Array.from({ length: accessor.count }, (_, index) => size === 4 ? data.getUint32(index * 4, true) : data.getUint16(index * 2, true));
}

/** Signed volume of a closed mesh: positive when triangles wind counter-clockwise seen from outside. */
function signedVolume(positions: Float32Array, indices: number[]): number {
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => indices[i + k]! * 3);
    const ax = positions[a!]!, ay = positions[a! + 1]!, az = positions[a! + 2]!;
    const bx = positions[b!]!, by = positions[b! + 1]!, bz = positions[b! + 2]!;
    const cx = positions[c!]!, cy = positions[c! + 1]!, cz = positions[c! + 2]!;
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

function tagsBalanced(xml: string): boolean {
  const stack: string[] = [];
  for (const match of xml.matchAll(/<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) continue;
    if (closing) { if (stack.pop() !== name) return false; } else stack.push(name!);
  }
  return stack.length === 0;
}

async function xmlOf(archive: ArrayBuffer): Promise<{ xml: string; files: Map<string, Uint8Array> }> {
  const entries = await readZip(new Uint8Array(archive));
  const files = new Map(entries.map(entry => [entry.name, entry.data]));
  return { xml: new TextDecoder().decode(files.get('GeneralSceneDescription.xml')), files };
}

test('scene mesh holds the venue shell and one entry per placed object, identical parts sharing a mesh', () => {
  const kinds = mesh.entries.map(entry => entry.kind);
  for (const kind of ['floor', 'wall', 'platform', 'stair', 'truss', 'placeholder'] as const) {
    assert.equal(kinds.filter(value => value === kind).length, 1, kind);
  }
  const placed = mesh.entries.filter(entry => entry.kind === 'part');
  assert.equal(placed.length, layout.objects.length);
  assert.deepEqual(placed.map(entry => entry.id), layout.objects.map(object => object.id));
  assert.deepEqual(mesh.skipped, []);
  const chairs = placed.filter(entry => entry.part?.id === STARTER_PART_IDS.chair);
  assert.equal(chairs.length, 2);
  assert.equal(chairs[0]!.geometryKey, chairs[1]!.geometryKey);
  assert.ok(mesh.geometries.size < mesh.entries.length);
  const podium = placed.find(entry => entry.id === id(2))!;
  assert.deepEqual(podium.placement, { x: 9000, y: 6000, elevation: 400, rotation: 90 });
  const truss = mesh.entries.find(entry => entry.kind === 'truss')!;
  assert.deepEqual(truss.placement, { x: 6000, y: 3000, elevation: 3650, rotation: 20 });
});

test('every entry geometry is a closed mesh in metres with outward winding', () => {
  for (const geometry of mesh.geometries.values()) {
    const positions = geometry.geometry.getAttribute('position').array as Float32Array;
    const index = geometry.geometry.getIndex()!;
    const indices = Array.from({ length: index.count }, (_, i) => index.getX(i));
    assert.ok(signedVolume(positions, indices) > 0, `${geometry.key} winds inwards`);
    geometry.geometry.computeBoundingBox();
    const size = geometry.geometry.boundingBox!.getSize(new (geometry.geometry.boundingBox!.min.constructor as any)());
    assert.ok(Math.max(size.x, size.y, size.z) < 20, `${geometry.key} is not in metres`);
  }
});

test('exportGltf writes a valid glb with a node per entry in metres, +Y up, upstage towards -Z', async () => {
  const glb = parseGlb(await exportGltf(mesh, { name: 'Probe' }));
  assert.equal(glb.json.asset.version, '2.0');
  const root = glb.json.nodes[glb.json.scenes[0].nodes[0]];
  assert.equal(root.name, 'Probe');
  const children = root.children.map((index: number) => glb.json.nodes[index]);
  assert.equal(children.length, mesh.entries.length);
  assert.equal(children.filter((node: any) => node.extras?.stageharbour?.kind === 'part').length, layout.objects.length);
  assert.ok(glb.json.meshes.length < children.length);

  const wall = children.find((node: any) => node.extras.stageharbour.id === id(1));
  assert.equal(wall.name, 'Wand mit Tür');
  const [x, y, z] = wall.translation;
  assert.ok(Math.abs(x - 3) < 1e-6 && Math.abs(y) < 1e-6 && Math.abs(z + 2) < 1e-6, `translation ${wall.translation}`);
  const half = 30 * Math.PI / 180 / 2;
  const [qx, qy, qz, qw] = wall.rotation;
  assert.ok(Math.abs(qx) < 1e-6 && Math.abs(qz) < 1e-6);
  assert.ok(Math.abs(qy - Math.sin(half)) < 1e-6 && Math.abs(qw - Math.cos(half)) < 1e-6);

  const podium = children.find((node: any) => node.extras.stageharbour.id === id(2));
  assert.ok(Math.abs(podium.translation[1] - 0.4) < 1e-9);
  const primitive = glb.json.meshes[podium.mesh].primitives[0];
  const positions = accessorFloats(glb, primitive.attributes.POSITION);
  const xs = Array.from({ length: positions.length / 3 }, (_, i) => positions[i * 3]!);
  const zs = Array.from({ length: positions.length / 3 }, (_, i) => positions[i * 3 + 2]!);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 2) < 0.01, 'podium is 2 m wide');
  assert.ok(Math.abs(Math.max(...zs) - Math.min(...zs) - 1) < 0.01, 'podium is 1 m deep');

  for (const node of children) {
    const closed = glb.json.meshes[node.mesh].primitives.every((p: any) => {
      const volume = signedVolume(accessorFloats(glb, p.attributes.POSITION), accessorIndices(glb, p.indices));
      return Number.isFinite(volume);
    });
    assert.ok(closed);
  }
});

test('paint finishes become materials and stock materials keep their colour', async () => {
  const glb = parseGlb(await exportGltf(mesh));
  const names: string[] = glb.json.materials.map((material: any) => material.name);
  assert.ok(names.some(name => name === `Anstrich ${ralHex('9010')}`), names.join(', '));
  assert.ok(names.includes('Traverse'));
  for (const material of glb.json.materials) {
    assert.equal(material.pbrMetallicRoughness.baseColorFactor.length, 4);
  }
});

test('exportMvr writes a zip with the description, matching object count and glb payloads', async () => {
  const now = new Date('2026-11-12T10:00:00Z');
  const archive = await exportMvr(mesh, { sceneId: id(900), productionName: 'Tatort & Co', venueName: 'Aula "Süd"', sceneName: 'Akt 1', providerVersion: '1.2.3', now });
  const { xml, files } = await xmlOf(archive);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(tagsBalanced(xml));
  assert.match(xml, /<GeneralSceneDescription verMajor="1" verMinor="6" provider="StageHarbour" providerVersion="1\.2\.3">/);
  assert.match(xml, /production="Tatort &amp; Co"/);
  assert.match(xml, /venue="Aula &quot;Süd&quot;"/);
  assert.equal((xml.match(/<SceneObject /g) ?? []).length + (xml.match(/<Truss /g) ?? []).length, mesh.entries.length);
  assert.equal((xml.match(/<Truss /g) ?? []).length, 1);
  const sceneLayer = xml.slice(xml.indexOf('name="Bühnenbild"'));
  assert.equal((sceneLayer.match(/<SceneObject /g) ?? []).length, layout.objects.length);
  for (const object of layout.objects) assert.ok(sceneLayer.includes(`uuid="${object.id}"`));
  const layerIds = [...xml.matchAll(/<Layer uuid="([^"]+)"/g)].map(match => match[1]!);
  assert.equal(new Set(layerIds).size, 2);
  assert.ok(layerIds.every(layer => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(layer)));

  const referenced = [...xml.matchAll(/fileName="([^"]+)"/g)].map(match => match[1]!);
  assert.ok(referenced.length === mesh.entries.length);
  assert.deepEqual([...new Set(referenced)].sort(), [...files.keys()].filter(name => name.endsWith('.glb')).sort());
  assert.equal(files.size, 1 + mesh.geometries.size);
  for (const [name, data] of files) {
    if (name.endsWith('.glb')) {
      assert.equal(String.fromCharCode(...data.subarray(0, 4)), 'glTF');
      parseGlb(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    }
  }
  assert.equal(new Set([...files.keys()].map(name => name.toLowerCase())).size, files.size);
});

test('MVR matrices are millimetres, Z-up, rotation counter-clockwise about Z', () => {
  assert.equal(mvrMatrix({ x: 3000, y: 2000, elevation: 1200, rotation: 0 }), '{1,0,0}{0,1,0}{0,0,1}{3000,2000,1200}');
  const turned = mvrMatrix({ x: 1, y: 2, elevation: 3, rotation: 90 });
  assert.equal(turned, '{0,1,0}{-1,0,0}{0,0,1}{1,2,3}');
  const wall = buildMvrXml(mesh);
  assert.match(wall, /<Matrix>\{0\.866025,0\.5,0\}\{-0\.5,0\.866025,0\}\{0,0,1\}\{3000,2000,0\}<\/Matrix>/);
  assert.match(wall, /<Matrix>\{1,0,0\}\{0,1,0\}\{0,0,1\}\{6000,8800,2000\}<\/Matrix>/);
  const truss = wall.slice(wall.indexOf('<Truss '));
  assert.match(truss, /\{6000,3000,3650\}<\/Matrix>/);
});

test('missing parts are skipped and reported, not exported', async () => {
  const broken = layoutSchema.parse({
    ...layout,
    objects: [...layout.objects, part(7, 'Fremdes Teil', id(555), {})],
  });
  const partial = buildSceneMesh({ layout: broken, venue, catalog });
  assert.equal(partial.entries.filter(entry => entry.kind === 'part').length, layout.objects.length);
  assert.deepEqual(partial.skipped.map(item => item.id), [id(7)]);
  const { xml } = await xmlOf(await exportMvr(partial));
  assert.match(xml, new RegExp(`<Skipped uuid="${id(7)}"`));
});

test('an empty Bühnenbild still exports the venue', async () => {
  const empty = buildSceneMesh({ layout: { schemaVersion: 2, objects: [], joints: [] }, venue, catalog });
  assert.equal(empty.entries.every(entry => entry.layer === 'venue'), true);
  parseGlb(await exportGltf(empty));
  const { xml } = await xmlOf(await exportMvr(empty));
  assert.ok(tagsBalanced(xml));
});

test('exportSceneFile names the file and picks the content type', async () => {
  const scene = { id: id(900), name: 'Akt 1: Große Szene', productionName: 'P', venueName: 'V' };
  const glb = await exportSceneFile({ format: 'gltf', scene, venue, layout, catalog });
  assert.equal(glb.filename, 'Akt_1_Große_Szene.glb');
  assert.equal(glb.contentType, 'model/gltf-binary');
  assert.equal(new Uint8Array(glb.data)[0], 0x67);
  const mvr = await exportSceneFile({ format: 'mvr', scene, venue, layout, catalog });
  assert.equal(mvr.filename, 'Akt_1_Große_Szene.mvr');
  assert.equal(mvr.contentType, EXCHANGE_FORMATS.mvr.contentType);
  assert.equal(new Uint8Array(mvr.data)[0], 0x50);
  assert.equal(exchangeFilename('???', id(900), 'mvr'), '20000000.mvr');
});

test('exports are deterministic for a fixed timestamp', async () => {
  const now = new Date('2026-11-12T10:00:00Z');
  const a = new Uint8Array(await exportMvr(mesh, { sceneId: id(900), now }));
  const b = new Uint8Array(await exportMvr(buildSceneMesh({ layout, venue, catalog }), { sceneId: id(900), now }));
  assert.deepEqual(a, b);
});

test('zip writer round-trips stored and deflated entries and rejects names that differ by case', async () => {
  const text = new TextEncoder().encode('<a>'.repeat(500));
  const noise = Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 11) % 251);
  const files = [{ name: 'a.xml', data: text }, { name: 'b.bin', data: noise }, { name: 'empty.txt', data: new Uint8Array() }];
  for (const compress of [true, false]) {
    const back = await readZip(await writeZip(files, { compress, modified: new Date('2026-01-02T03:04:06Z') }));
    assert.deepEqual(back.map(item => item.name), files.map(item => item.name));
    for (const [index, item] of back.entries()) assert.deepEqual(item.data, files[index]!.data);
  }
  const packed = await writeZip(files);
  assert.ok(packed.length < text.length, 'deflate shrinks the repetitive entry');
  await assert.rejects(writeZip([{ name: 'GEO.glb', data: noise }, { name: 'geo.glb', data: noise }]), /doppelt/);
});

test('derived uuids are stable, distinct and well formed', () => {
  assert.equal(derivedUuid('a'), derivedUuid('a'));
  assert.notEqual(derivedUuid('a'), derivedUuid('b'));
  assert.match(derivedUuid('a'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('geometry file names follow first use and stay portable', () => {
  const files: SceneMesh['geometries'] extends Map<string, unknown> ? Map<string, string> : never = mvrGeometryFiles(mesh);
  assert.equal([...files.values()][0], 'geo-001.glb');
  assert.ok([...files.values()].every(name => /^geo-\d{3}\.glb$/.test(name)));
});

test('a glTF reader places the stage in front of the audience: x to the right, upstage towards -Z', async () => {
  const data = await exportGltf(mesh);
  const loaded = await new GLTFLoader().parseAsync(data, '');
  const box = new Box3().setFromObject(loaded.scene);
  const size = box.getSize(new Vector3());
  assert.ok(box.min.x >= -0.01 && box.max.x <= 12.01, `x ${box.min.x}..${box.max.x}`);
  assert.ok(box.min.z >= -9.01 && box.max.z <= 0.01, `z ${box.min.z}..${box.max.z}`);
  assert.ok(box.min.y >= -0.06 && box.max.y <= 4.01, `y ${box.min.y}..${box.max.y}`);
  assert.ok(size.x > 11 && size.z > 8, 'the floor spans the venue');
  const backWall = loaded.scene.getObjectByName('Rückwand')!;
  assert.ok(Math.abs(backWall.getWorldPosition(new Vector3()).z + 8.8) < 1e-6);
});
