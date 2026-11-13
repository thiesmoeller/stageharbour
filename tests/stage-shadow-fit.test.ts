import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera, Vector3 } from 'three';
import { boundsCorners, boundsRadius, type StageBounds } from '../src/client/stage/cameraFraming.js';
import { LIGHT_THEMES, LIGHT_THEME_IDS, keyLightDirection } from '../src/client/stage/lightThemes.js';
import { fitDirectionalShadow, withShadowFootprint, type ShadowFit } from '../src/client/stage/shadowFit.js';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);
const shadow = LIGHT_THEMES.studio.shadow;

function shadowCamera(fit: ShadowFit) {
  const camera = new OrthographicCamera(fit.camera.left, fit.camera.right, fit.camera.top, fit.camera.bottom, fit.camera.near, fit.camera.far);
  camera.position.set(...fit.position);
  camera.lookAt(...fit.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

test('the shadow camera reproduces Pascal\'s bounds-sphere fit', () => {
  const bounds: StageBounds = { min: [-6, 0, -4], max: [6, 3.5, 4] };
  const radius = boundsRadius(bounds);
  const fit = fitDirectionalShadow(bounds, [1, 1, 1], shadow);
  const size = radius * 1.15 + Math.min(3, radius * 0.25);
  close(fit.camera.right, size);
  close(fit.camera.left, -size);
  close(fit.camera.top, size);
  close(fit.camera.near, 10);
  close(fit.camera.far, size + 10 + radius * 1.15 + 3);
  assert.deepEqual(fit.target, [0, 1.75, 0]);
  close(new Vector3(...fit.position).distanceTo(new Vector3(...fit.target)), size + 10);
  assert.equal(fit.mapSize, 1024);
  assert.equal(fit.normalBias, 0.08);
});

test('every stage corner lies inside the shadow frustum for each theme', () => {
  const stages: StageBounds[] = [
    { min: [-10, 0, -8], max: [10, 6, 8] },
    { min: [2, 0, 3], max: [4, 1, 5] },
    { min: [-0.4, 0, -0.2], max: [0.4, 1.2, 0.2] },
  ];
  for (const id of LIGHT_THEME_IDS) {
    for (const bounds of stages) {
      const camera = shadowCamera(fitDirectionalShadow(bounds, keyLightDirection(LIGHT_THEMES[id]), shadow));
      for (const corner of boundsCorners(bounds)) {
        const point = new Vector3(...corner).project(camera);
        assert.ok(Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1, `${id}: ${point.toArray()}`);
      }
    }
  }
});

test('small parts get a finer shadow map and a bias that suits their size', () => {
  const fit = fitDirectionalShadow({ min: [-0.2, 0, -0.2], max: [0.2, 0.5, 0.2] }, [0, 1, 0], shadow);
  assert.equal(fit.mapSize, 2048);
  assert.ok(fit.normalBias < shadow.normalBias);
  close(fit.normalBias, 4 * fit.camera.right / 2048);
});

test('a shadow catcher fit covers the shadow a part casts under a low light', () => {
  const part: StageBounds = { min: [-0.4, 0, -0.2], max: [0.4, 1.2, 0.2] };
  const direction = keyLightDirection(LIGHT_THEMES.sunset);
  const covered = withShadowFootprint(part, direction);
  const drop = 1.2 / direction[1];
  close(covered.min[0], -0.4 - direction[0] * drop);
  close(covered.min[2], -0.2 - direction[2] * drop);
  assert.deepEqual([covered.max[0], covered.max[1], covered.max[2], covered.min[1]], [0.4, 1.2, 0.2, 0]);
  const camera = shadowCamera(fitDirectionalShadow(covered, direction, shadow));
  const tip = new Vector3(-0.4 - direction[0] * drop, 0, -0.2 - direction[2] * drop).project(camera);
  assert.ok(Math.abs(tip.x) <= 1 && Math.abs(tip.y) <= 1 && Math.abs(tip.z) <= 1);
  assert.deepEqual(withShadowFootprint(part, [1, 0, 0]), part);
});

test('missing or broken bounds fall back to a 30 m sphere round the origin', () => {
  for (const bounds of [undefined, { min: [0, 0, 0], max: [Number.NaN, 1, 1] } as StageBounds]) {
    const fit = fitDirectionalShadow(bounds, [0, 2, 0], shadow);
    close(fit.camera.right, 30 * 1.15 + 3);
    assert.deepEqual(fit.target, [0, 0, 0]);
    close(fit.position[1], 30 * 1.15 + 3 + 10);
  }
});
