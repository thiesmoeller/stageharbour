import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, Raycaster, Vector3 } from 'three';
import { UNIT_BOX, UNIT_SPHERE } from '../src/client/stage/geometryCache.js';
import {
  batchInstances, createInstanceRegistry, hitUserData, hitWorldNormal, instanceBatchKey, instanceCapacity, instanceOwner, placeMatrix,
  primitiveInstance, setInstanceOwners, type InstanceOwner, type StageInstance,
} from '../src/client/stage/instancing.js';

const wood = new MeshBasicMaterial(), steel = new MeshBasicMaterial();
const at = (x: number) => new Matrix4().makeTranslation(x, 0, 0);
const box = (x: number, material = wood, shadows: { cast?: boolean; receive?: boolean } = {}): StageInstance => primitiveInstance(UNIT_BOX, at(x), material, shadows);

test('placements sharing geometry, material and shadow flags are one batch', () => {
  const chairA: InstanceOwner = { userData: { id: 'a' } }, chairB: InstanceOwner = { userData: { id: 'b' } };
  const batches = batchInstances([
    { instances: [box(0), box(1), box(2, steel)], owner: chairA },
    { instances: [box(3), primitiveInstance(UNIT_SPHERE, at(4), wood), box(5, steel)], owner: chairB },
  ]);
  assert.equal(batches.length, 3);
  const [woodBoxes, steelBoxes, spheres] = batches;
  assert.deepEqual(woodBoxes!.items.map(item => item.matrix.elements[12]), [0, 1, 3]);
  assert.deepEqual(woodBoxes!.items.map(item => item.owner), [chairA, chairA, chairB]);
  assert.equal(woodBoxes!.material, wood);
  assert.equal(woodBoxes!.geometryKey, UNIT_BOX.key);
  assert.deepEqual(steelBoxes!.items.map(item => item.matrix.elements[12]), [2, 5]);
  assert.equal(spheres!.geometryKey, UNIT_SPHERE.key);
  assert.equal(new Set(batches.map(batch => batch.key)).size, 3);
});

test('shadow flags split batches, because an InstancedMesh casts or receives as a whole', () => {
  const batches = batchInstances([{ instances: [box(0), box(1, wood, { cast: true }), box(2, wood, { cast: true, receive: true }), box(3, wood, { cast: true })] }]);
  assert.deepEqual(batches.map(batch => [batch.castShadow, batch.receiveShadow, batch.items.length]), [[false, false, 1], [true, false, 2], [true, true, 1]]);
  assert.notEqual(instanceBatchKey('g', 'm', true, false), instanceBatchKey('g', 'm', false, true));
  assert.equal(instanceBatchKey('g', 'm'), instanceBatchKey('g', 'm', false, false));
});

test('a thousand equal placements are one draw, not a thousand', () => {
  const instances = Array.from({ length: 1000 }, (_, index) => box(index));
  const batches = batchInstances([{ instances }]);
  assert.equal(batches.length, 1);
  assert.equal(batches[0]!.items.length, 1000);
});

test('the registry replaces, removes and reports placements per token', () => {
  const registry = createInstanceRegistry();
  const chair = {}, table = {};
  const owner: InstanceOwner = { userData: { id: 'chair' } };
  let notified = 0;
  const unsubscribe = registry.subscribe(() => { notified++; });

  const first = [box(0), box(1)];
  registry.set(chair, first, owner);
  registry.set(table, [box(5, steel)]);
  assert.equal(notified, 2);
  assert.equal(registry.batches().length, 2);
  assert.equal(registry.batches(), registry.batches(), 'batches are computed once per change');
  assert.deepEqual(registry.instancesOf(owner), first);

  const version = registry.version();
  registry.set(chair, first, owner);
  assert.equal(registry.version(), version, 'setting the same placements again is not a change');

  registry.set(chair, [box(9)], owner);
  assert.deepEqual(registry.batches()[0]!.items.map(item => item.matrix.elements[12]), [9]);
  registry.delete(chair);
  assert.equal(registry.batches().length, 1);
  assert.deepEqual(registry.instancesOf(owner), []);
  registry.delete(chair);
  assert.equal(notified, 4, 'deleting an unknown token is not a change');

  registry.set({}, []);
  assert.equal(notified, 4, 'registering nothing is not a change');
  unsubscribe();
  registry.delete(table);
  assert.equal(notified, 4);
  assert.deepEqual(registry.batches(), []);
});

test('batch capacity grows in powers of two so adding a chair rarely reallocates', () => {
  assert.deepEqual([0, 1, 4, 5, 8, 9, 100, 1024, 1025].map(instanceCapacity), [4, 4, 4, 8, 8, 16, 128, 1024, 2048]);
});

test('placeMatrix composes parent, translation, rotation and scale like nested scene objects', () => {
  const parent = new Group();
  parent.position.set(100, 0, 50);
  parent.rotation.set(0, Math.PI / 3, 0);
  const child = new Object3D();
  child.position.set(10, 20, 30);
  child.rotation.set(0.2, -0.4, 0.7);
  child.scale.set(2, 3, 4);
  parent.add(child);
  parent.updateMatrixWorld(true);

  const matrix = placeMatrix(parent.matrixWorld, [10, 20, 30], [2, 3, 4], [0.2, -0.4, 0.7]);
  for (let index = 0; index < 16; index++) assert.ok(Math.abs(matrix.elements[index]! - child.matrixWorld.elements[index]!) < 1e-9, `element ${index}`);
  assert.deepEqual(placeMatrix(undefined, [1, 2, 3]).elements.slice(12, 15), [1, 2, 3]);
  assert.notEqual(placeMatrix(undefined, [0, 0, 0]), placeMatrix(undefined, [0, 0, 0]), 'every placement owns its matrix');
});

function instancedScene() {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), wood, 4);
  const owners: InstanceOwner[] = [{ userData: { pushPull: { id: 'left' } } }, { userData: { pushPull: { id: 'right' } } }];
  // Two boxes side by side; the right one is turned a quarter about Y and stretched.
  mesh.setMatrixAt(0, placeMatrix(undefined, [-5, 0, 0]));
  mesh.setMatrixAt(1, placeMatrix(undefined, [5, 0, 0], [1, 2, 3], [0, Math.PI / 2, 0]));
  mesh.count = 2;
  mesh.instanceMatrix.needsUpdate = true;
  setInstanceOwners(mesh, owners);
  const parent = new Group();
  parent.userData.scope = 'scene';
  parent.rotation.set(0, Math.PI, 0);
  parent.add(mesh);
  parent.updateMatrixWorld(true);
  mesh.computeBoundingSphere();
  return { mesh, owners, parent };
}

test('a ray hit on an instance resolves to that instance\'s owner', () => {
  const { mesh, owners } = instancedScene();
  // The parent is turned half about Y, so the instance at local x = +5 sits at world x = -5.
  const hits = new Raycaster(new Vector3(-5, 0, 20), new Vector3(0, 0, -1)).intersectObject(mesh);
  assert.ok(hits.length > 0);
  assert.equal(hits[0]!.instanceId, 1);
  assert.equal(instanceOwner(mesh, hits[0]!.instanceId), owners[1]);
  assert.deepEqual(hitUserData(hits[0]!, 'pushPull'), { id: 'right' });
  assert.equal(hitUserData(hits[0]!, 'scope'), 'scene', 'what the owner does not carry is looked up on the parents');
  assert.equal(hitUserData(hits[0]!, 'missing'), undefined);
  assert.equal(instanceOwner(mesh, undefined), undefined);
  assert.equal(instanceOwner(mesh, 3), undefined);
});

test('hitWorldNormal accounts for the instance matrix and the mesh\'s world matrix', () => {
  const { mesh } = instancedScene();
  const toward = (origin: Vector3, direction: Vector3) => {
    const hit = new Raycaster(origin, direction).intersectObject(mesh)[0]!;
    return { hit, normal: hitWorldNormal(hit, new Vector3())! };
  };
  const front = toward(new Vector3(-5, 0, 20), new Vector3(0, 0, -1));
  assert.equal(front.hit.instanceId, 1);
  assert.ok(front.normal.distanceTo(new Vector3(0, 0, 1)) < 1e-6, `faces the ray origin, got ${front.normal.toArray()}`);
  const top = toward(new Vector3(5, 20, 0), new Vector3(0, -1, 0));
  assert.equal(top.hit.instanceId, 0);
  assert.ok(top.normal.distanceTo(new Vector3(0, 1, 0)) < 1e-6);
  const side = toward(new Vector3(-20, 0, 0), new Vector3(1, 0, 0));
  assert.equal(side.hit.instanceId, 1);
  assert.ok(side.normal.distanceTo(new Vector3(-1, 0, 0)) < 1e-6);
});

test('ordinary meshes answer the same questions through their parent chain', () => {
  const element = new Group();
  element.userData.pushPull = { id: 'wall' };
  element.rotation.set(0, Math.PI / 2, 0);
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), wood);
  element.add(mesh);
  element.updateMatrixWorld(true);
  const hit = new Raycaster(new Vector3(20, 0, 0), new Vector3(-1, 0, 0)).intersectObject(mesh)[0]!;
  assert.equal(hit.instanceId, undefined);
  assert.deepEqual(hitUserData(hit, 'pushPull'), { id: 'wall' });
  assert.ok(hitWorldNormal(hit, new Vector3())!.distanceTo(new Vector3(1, 0, 0)) < 1e-6);
  assert.equal(hitWorldNormal({ object: mesh, face: null }, new Vector3()), undefined);
});
