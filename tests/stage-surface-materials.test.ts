import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Color, CompressedTexture, DoubleSide, FrontSide, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, NoColorSpace,
  RepeatWrapping, SRGBColorSpace, Texture,
} from 'three';
import { MATERIAL_ASSET_BASE_URL } from '../src/shared/assetHosts.js';
import { RAL_PAINT_SWATCHES, WALL_PAINT_METALNESS, WALL_PAINT_ROUGHNESS } from '../src/shared/ral.js';
import type { SurfaceRecord } from '../src/shared/surfaceRegistry.js';
import { MATERIAL_LIBRARY, libraryMaterial, type LibraryMaterial } from '../src/client/stage/materialLibrary.js';
import {
  DEFAULT_SURFACE_DISPLAY, createSurfaceMaterialFactory, flatMaterialKey, libraryFloorTiling, librarySurfaceTiling, registrySurfaceTiling,
} from '../src/client/stage/surfaceMaterials.js';
import { createTextureCache, type TextureLoad } from '../src/client/stage/textureCache.js';

const face = { faceWidthMm: 4000, faceHeightMm: 2400 };

function harness() {
  const pending = new Map<string, { resolve: (texture: Texture) => void; reject: (error: unknown) => void }>();
  const failures: string[] = [];
  const load: TextureLoad = (url, onLoad, onError) => { pending.set(url, { resolve: onLoad, reject: onError }); };
  const cache = createTextureCache(load, url => failures.push(url));
  return { pending, failures, cache, factory: createSurfaceMaterialFactory(cache) };
}

function textured(): LibraryMaterial {
  const material = MATERIAL_LIBRARY.find(item => item.maps.albedo && item.maps.normal && item.maps.roughness && item.previewColor.toLowerCase() !== item.color.toLowerCase());
  assert.ok(material, 'the library has a finish with albedo, normal and roughness maps');
  return material;
}

const url = (path: string | undefined) => `${MATERIAL_ASSET_BASE_URL}/${path}`;
const hexOf = (color: Color) => `#${color.getHexString()}`;

test('a library finish without a pattern size repeats as the library says, on any face', () => {
  const source = { repeat: [3, 2] as const };
  assert.deepEqual(librarySurfaceTiling(source, {}, face), { repeatX: 3, repeatY: 2, rotation: 0 });
  assert.deepEqual(librarySurfaceTiling(source, { rotationDeg: 180 }, { faceWidthMm: 10, faceHeightMm: 99999 }), { repeatX: 3, repeatY: 2, rotation: Math.PI });
});

test('a pattern size makes one tile that many millimetres, whatever the grain direction', () => {
  const source = { repeat: [3, 2] as const };
  assert.deepEqual(librarySurfaceTiling(source, { scaleMm: 1000 }, face), { repeatX: 4, repeatY: 2.4, rotation: 0 });
  assert.deepEqual(librarySurfaceTiling(source, { scaleMm: 500, rotationDeg: 0 }, face), { repeatX: 8, repeatY: 4.8, rotation: 0 });
  assert.deepEqual(librarySurfaceTiling(source, { scaleMm: 1000, rotationDeg: 180 }, face), { repeatX: 4, repeatY: 2.4, rotation: Math.PI });
  // A quarter turn swaps the texture axes, so the face dimensions swap with them.
  assert.deepEqual(librarySurfaceTiling(source, { scaleMm: 1000, rotationDeg: 90 }, face), { repeatX: 2.4, repeatY: 4, rotation: Math.PI / 2 });
  assert.deepEqual(librarySurfaceTiling(source, { scaleMm: 1000, rotationDeg: 270 }, face), { repeatX: 2.4, repeatY: 4, rotation: 3 * Math.PI / 2 });
});

test('tiling never collapses to zero repeats on a tiny face', () => {
  const tiny = { faceWidthMm: 1, faceHeightMm: 1 };
  assert.deepEqual(librarySurfaceTiling({ repeat: [1, 1] }, { scaleMm: 20000 }, tiny), { repeatX: 0.05, repeatY: 0.05, rotation: 0 });
  assert.equal(registrySurfaceTiling({ tileWidthMm: 10000, tileHeightMm: 10000 }, {}, tiny).repeatX, 0.05);
  assert.equal(libraryFloorTiling({ repeat: [1, 1] }, tiny).repeatY, 0.05);
});

test('a workspace surface tiles at its real-world tile size, or at the pattern size with the same aspect', () => {
  const definition = { tileWidthMm: 2000, tileHeightMm: 1000 };
  assert.deepEqual(registrySurfaceTiling(definition, {}, face), { repeatX: 2, repeatY: 2.4, rotation: 0 });
  assert.deepEqual(registrySurfaceTiling(definition, { scaleMm: 1000 }, face), { repeatX: 4, repeatY: 4.8, rotation: 0 });
  assert.deepEqual(registrySurfaceTiling(definition, { rotationDeg: 90 }, face), { repeatX: 1.2, repeatY: 4, rotation: Math.PI / 2 });
});

test('floor finishes repeat per metre of floor', () => {
  assert.deepEqual(libraryFloorTiling({ repeat: [1, 1] }, { faceWidthMm: 12000, faceHeightMm: 8000 }), { repeatX: 12, repeatY: 8, rotation: 0 });
  assert.deepEqual(libraryFloorTiling({ repeat: [2, 0.5] }, { faceWidthMm: 3000, faceHeightMm: 3000 }), { repeatX: 6, repeatY: 1.5, rotation: 0 });
});

test('RAL paint is a matte standard material in the swatch colour and needs no texture', () => {
  const { factory, cache } = harness();
  const swatch = RAL_PAINT_SWATCHES[0]!;
  const material = factory.createSurfaceMaterial({ kind: 'paint', ral: swatch.code }, face);
  assert.ok(material instanceof MeshStandardMaterial);
  assert.equal(hexOf(material.color), swatch.hex.toLowerCase());
  assert.equal(material.roughness, WALL_PAINT_ROUGHNESS);
  assert.equal(material.metalness, WALL_PAINT_METALNESS);
  assert.equal(material.side, DoubleSide);
  assert.equal(cache.size(), 0);
});

test('missing and unknown finishes give null so the caller keeps its default look', () => {
  const { factory } = harness();
  assert.equal(factory.createSurfaceMaterial(undefined, face), null);
  assert.equal(factory.createSurfaceMaterial({ kind: 'paint', ral: '0000' }, face), null);
  assert.equal(factory.createSurfaceMaterial({ kind: 'library', ref: 'library:gone' }, face), null);
  assert.equal(factory.createSurfaceMaterial({ kind: 'registry', surfaceId: '00000000-0000-4000-8000-000000000001' }, face), null);
});

test('a library finish shows its preview colour until the albedo arrives, then the textured look', () => {
  const { factory, pending, cache } = harness();
  const source = textured();
  const material = factory.createSurfaceMaterial({ kind: 'library', ref: `library:${source.id}`, scaleMm: 1000, rotationDeg: 90 }, face);
  assert.ok(material instanceof MeshStandardMaterial);
  assert.equal(hexOf(material.color), source.previewColor.toLowerCase());
  assert.equal(material.map, null);
  assert.equal(material.roughness, source.roughness);
  assert.equal(material.metalness, source.metalness);
  assert.ok(pending.has(url(source.maps.albedo)) && pending.has(url(source.maps.normal)) && pending.has(url(source.maps.roughness)));

  const albedo = new Texture(), normal = new Texture();
  pending.get(url(source.maps.normal))!.resolve(normal);
  assert.equal(hexOf(material.color), source.previewColor.toLowerCase(), 'a detail map alone does not switch the colour');
  pending.get(url(source.maps.albedo))!.resolve(albedo);
  assert.equal(hexOf(material.color), source.color.toLowerCase());

  const map = material.map!, normalMap = material.normalMap!;
  assert.notEqual(map, albedo, 'each material tiles a clone and leaves the shared texture alone');
  assert.equal(map.source, albedo.source, 'clones share the uploaded image');
  assert.equal(map.colorSpace, SRGBColorSpace);
  assert.equal(normalMap.colorSpace, NoColorSpace);
  assert.equal(albedo.colorSpace, NoColorSpace, 'the shared texture is not modified');
  for (const texture of [map, normalMap]) {
    assert.equal(texture.wrapS, RepeatWrapping);
    assert.equal(texture.wrapT, RepeatWrapping);
    assert.deepEqual(texture.repeat.toArray(), [2.4, 4]);
    assert.equal(texture.rotation, Math.PI / 2);
    assert.equal(texture.flipY, source.flipY);
  }
  assert.equal(cache.references(url(source.maps.albedo)), 1);
});

test('roughness, metalness and occlusion maps are sampled as linear data', () => {
  const { factory, pending } = harness();
  const source = MATERIAL_LIBRARY.find(item => item.maps.albedo && item.maps.roughness && item.maps.ao) ?? textured();
  const material = factory.createLibraryMaterial(source, { repeatX: 1, repeatY: 1, rotation: 0 }) as MeshStandardMaterial;
  for (const request of pending.values()) request.resolve(new Texture());
  assert.equal(material.map?.colorSpace, SRGBColorSpace);
  for (const slot of ['roughnessMap', 'metalnessMap', 'aoMap', 'normalMap'] as const) {
    if (material[slot]) assert.equal(material[slot]!.colorSpace, NoColorSpace, slot);
  }
  assert.ok(material.roughnessMap);
});

test('a texture that fails to load leaves the fallback colour and breaks nothing', () => {
  const { factory, pending, failures } = harness();
  const source = textured();
  const material = factory.createSurfaceMaterial({ kind: 'library', ref: `library:${source.id}` }, face) as MeshStandardMaterial;
  assert.doesNotThrow(() => { for (const request of pending.values()) request.reject(new Error('offline')); });
  assert.equal(material.map, null);
  assert.equal(hexOf(material.color), source.previewColor.toLowerCase());
  assert.equal(failures.length, pending.size);
  assert.doesNotThrow(() => factory.disposeSurfaceMaterial(material));
});

test('two materials of one finish share the texture request and free it with the last one', () => {
  const { factory, pending, cache } = harness();
  const source = textured();
  const albedoUrl = url(source.maps.albedo);
  const first = factory.createSurfaceMaterial({ kind: 'library', ref: `library:${source.id}`, scaleMm: 500 }, face) as MeshStandardMaterial;
  const second = factory.createSurfaceMaterial({ kind: 'library', ref: `library:${source.id}`, scaleMm: 2000 }, face) as MeshStandardMaterial;
  assert.equal(cache.references(albedoUrl), 2);
  const shared = new Texture();
  let sharedDisposed = false;
  shared.addEventListener('dispose', () => { sharedDisposed = true; });
  pending.get(albedoUrl)!.resolve(shared);
  assert.equal(first.map!.source, second.map!.source);
  assert.deepEqual(first.map!.repeat.toArray(), [8, 4.8]);
  assert.deepEqual(second.map!.repeat.toArray(), [2, 1.2]);

  let cloneDisposed = false;
  first.map!.addEventListener('dispose', () => { cloneDisposed = true; });
  factory.disposeSurfaceMaterial(first);
  assert.ok(cloneDisposed);
  assert.equal(cache.references(albedoUrl), 1);
  assert.equal(sharedDisposed, false);
  factory.disposeSurfaceMaterial(first);
  assert.equal(cache.references(albedoUrl), 1, 'disposing twice releases once');
  factory.disposeSurfaceMaterial(second);
  assert.equal(cache.size(), 0);
  assert.ok(sharedDisposed);
});

test('with textures off a finish is its flat preview colour and requests nothing', () => {
  const { factory, cache } = harness();
  const source = textured();
  const material = factory.createSurfaceMaterial({ kind: 'library', ref: `library:${source.id}` }, { ...face, textures: false }) as MeshStandardMaterial;
  assert.ok(material instanceof MeshStandardMaterial);
  assert.equal(hexOf(material.color), source.previewColor.toLowerCase());
  assert.equal(cache.size(), 0);
});

test('solid shading uses diffuse materials and loads the colour map only', () => {
  const { factory, pending } = harness();
  const source = textured();
  const material = factory.createSurfaceMaterial({ kind: 'library', ref: `library:${source.id}` }, { ...face, shading: 'solid' });
  assert.ok(material instanceof MeshLambertMaterial);
  assert.deepEqual([...pending.keys()], [url(source.maps.albedo)]);
  const paint = factory.createSurfaceMaterial({ kind: 'paint', ral: RAL_PAINT_SWATCHES[0]!.code }, { ...face, shading: 'solid', textures: false });
  assert.ok(paint instanceof MeshLambertMaterial);
});

test('see-through library finishes are transparent standard materials', () => {
  const { factory } = harness();
  const glass = MATERIAL_LIBRARY.find(item => item.opacity !== undefined);
  assert.ok(glass, 'the library has a see-through finish');
  const material = factory.createLibraryMaterial(glass, { repeatX: 1, repeatY: 1, rotation: 0 }) as MeshStandardMaterial;
  assert.ok(material instanceof MeshStandardMaterial);
  assert.equal(material.transparent, true);
  assert.equal(material.opacity, glass.opacity);
  const opaque = factory.createLibraryMaterial(textured(), { repeatX: 1, repeatY: 1, rotation: 0 }) as MeshStandardMaterial;
  assert.equal(opaque.transparent, false);
  assert.equal(opaque.opacity, 1);
});

test('compressed textures are never flipped', () => {
  const { factory, pending } = harness();
  const source = { ...textured(), flipY: true };
  const material = factory.createLibraryMaterial(source, { repeatX: 1, repeatY: 1, rotation: 0 }) as MeshStandardMaterial;
  pending.get(url(source.maps.albedo))!.resolve(new CompressedTexture([], 4, 4));
  assert.equal(material.map!.flipY, false);
});

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const file = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const fileUrl = (n: number) => `/api/workspaces/${WORKSPACE}/surfaces/files/${file(n)}`;

function surface(maps: SurfaceRecord['definition']['maps'], overrides: Partial<SurfaceRecord['definition']> = {}): SurfaceRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333', workspaceId: WORKSPACE, productionId: null, scope: 'workspace', name: 'Putz', description: '', archived: false,
    definition: {
      workflow: 'metallic-roughness', tileWidthMm: 2000, tileHeightMm: 1000, maps, baseColorFactor: '#c0b0a0', roughnessFactor: 0.6, metallicFactor: 0.1,
      normalScale: 1.5, displacementScaleMm: 0, normalConvention: 'opengl', ...overrides,
    },
  };
}

test('an uploaded glTF-PBR set maps onto the standard material slots with the right colour spaces', () => {
  const { factory, pending } = harness();
  const record = surface({ baseColor: file(1), normal: file(2), orm: file(3), emissive: file(4), alpha: file(5), displacement: file(6) });
  const material = factory.createSurfaceMaterial({ kind: 'registry', surfaceId: record.id }, { ...face, registry: { workspaceId: WORKSPACE, surface: record } });
  assert.ok(material instanceof MeshStandardMaterial);
  assert.equal(hexOf(material.color), '#c0b0a0');
  assert.equal(material.roughness, 0.6);
  assert.equal(material.metalness, 0.1);
  assert.deepEqual(material.normalScale.toArray(), [1.5, 1.5]);
  assert.equal(material.transparent, true, 'an alpha map makes the surface transparent');
  assert.deepEqual([...pending.keys()].sort(), [1, 2, 3, 4, 5].map(fileUrl), 'displacement is skipped while its scale is zero');

  for (const request of pending.values()) request.resolve(new Texture());
  assert.equal(material.map!.colorSpace, SRGBColorSpace);
  assert.equal(material.emissiveMap!.colorSpace, SRGBColorSpace);
  assert.equal(material.normalMap!.colorSpace, NoColorSpace);
  assert.equal(material.alphaMap!.colorSpace, NoColorSpace);
  assert.equal(material.aoMap, material.roughnessMap, 'the packed ORM texture feeds occlusion, roughness and metalness');
  assert.equal(material.aoMap, material.metalnessMap);
  assert.equal(material.aoMap!.colorSpace, NoColorSpace);
  assert.equal(material.displacementMap, null);
  assert.equal(hexOf(material.emissive), '#ffffff');
  assert.deepEqual(material.map!.repeat.toArray(), [2, 2.4]);
});

test('separate roughness, metalness, occlusion and displacement maps are used when there is no packed set', () => {
  const { factory, pending } = harness();
  const record = surface({ baseColor: file(1), roughness: file(2), metalness: file(3), occlusion: file(4), displacement: file(5) }, { displacementScaleMm: 12 });
  const material = factory.createSurfaceMaterial(
    { kind: 'registry', surfaceId: record.id, scaleMm: 1000, rotationDeg: 90 }, { ...face, registry: { workspaceId: WORKSPACE, surface: record } },
  ) as MeshStandardMaterial;
  const textures = new Map([...pending.keys()].map(key => [key, new Texture()]));
  for (const [key, texture] of textures) pending.get(key)!.resolve(texture);
  assert.equal(material.roughnessMap!.source, textures.get(fileUrl(2))!.source);
  assert.equal(material.metalnessMap!.source, textures.get(fileUrl(3))!.source);
  assert.equal(material.aoMap!.source, textures.get(fileUrl(4))!.source);
  assert.equal(material.displacementMap!.source, textures.get(fileUrl(5))!.source);
  assert.equal(material.displacementScale, 12);
  assert.deepEqual(material.map!.repeat.toArray(), [2.4, 8]);
  assert.equal(material.map!.rotation, Math.PI / 2);
});

test('a workspace surface that is not the referenced one gives null', () => {
  const { factory } = harness();
  const record = surface({ baseColor: file(1) });
  const other = '44444444-4444-4444-8444-444444444444';
  assert.equal(factory.createSurfaceMaterial({ kind: 'registry', surfaceId: other }, { ...face, registry: { workspaceId: WORKSPACE, surface: record } }), null);
});

test('flat materials are shared per look, so equal specs give one instancing key', () => {
  const { factory } = harness();
  const a = factory.flatMaterial({ color: '#AABBCC', roughness: 0.5 });
  const b = factory.flatMaterial({ color: '#aabbcc', roughness: 0.5, metalness: 0 });
  assert.equal(a, b);
  assert.ok(a instanceof MeshStandardMaterial);
  assert.equal(a.side, FrontSide);
  assert.notEqual(factory.flatMaterial({ color: '#aabbcc', roughness: 0.6 }), a);
  assert.notEqual(factory.flatMaterial({ color: '#aabbcc', roughness: 0.5, doubleSided: true }), a);

  const solid = factory.flatMaterial({ color: '#aabbcc', roughness: 0.5 }, { shading: 'solid', textures: false });
  assert.ok(solid instanceof MeshLambertMaterial);
  assert.equal(solid, factory.flatMaterial({ color: '#aabbcc', roughness: 0.9 }, { shading: 'solid', textures: true }), 'roughness does not split diffuse materials');

  const unlit = factory.flatMaterial({ color: '#ff0000', unlit: true, opacity: 0.4, depthWrite: false });
  assert.ok(unlit instanceof MeshBasicMaterial);
  assert.equal(unlit.transparent, true);
  assert.equal(unlit.depthWrite, false);
  assert.equal(unlit, factory.flatMaterial({ color: '#ff0000', unlit: true, opacity: 0.4, depthWrite: false }, { shading: 'solid', textures: false }));
});

test('shared flat materials survive disposeSurfaceMaterial', () => {
  const { factory } = harness();
  const flat = factory.flatMaterial({ color: '#123456' });
  let disposed = false;
  flat.addEventListener('dispose', () => { disposed = true; });
  factory.disposeSurfaceMaterial(flat);
  factory.disposeSurfaceMaterial(null);
  factory.disposeSurfaceMaterial(undefined);
  assert.equal(disposed, false);
  assert.equal(factory.flatMaterial({ color: '#123456' }), flat);
});

test('flat material keys spell out what distinguishes two looks', () => {
  assert.equal(flatMaterialKey({ color: '#FFF000' }), flatMaterialKey({ color: '#fff000', roughness: 1, metalness: 0, opacity: 1, doubleSided: false, depthWrite: true }, DEFAULT_SURFACE_DISPLAY));
  const keys = new Set([
    flatMaterialKey({ color: '#fff000' }),
    flatMaterialKey({ color: '#fff001' }),
    flatMaterialKey({ color: '#fff000', metalness: 1 }),
    flatMaterialKey({ color: '#fff000', opacity: 0.5 }),
    flatMaterialKey({ color: '#fff000', doubleSided: true }),
    flatMaterialKey({ color: '#fff000', depthWrite: false }),
    flatMaterialKey({ color: '#fff000', unlit: true }),
    flatMaterialKey({ color: '#fff000' }, { shading: 'solid', textures: true }),
  ]);
  assert.equal(keys.size, 8);
});

test('the surface tests\' reference finish resolves through the factory', () => {
  const { factory } = harness();
  assert.ok(libraryMaterial('library:wood-finewood27'));
  assert.ok(factory.createSurfaceMaterial({ kind: 'library', ref: 'library:wood-finewood27' }, face));
});
