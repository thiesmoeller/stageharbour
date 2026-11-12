import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera, PerspectiveCamera, Vector3, type Camera } from 'three';
import {
  DEFAULT_STAGE_BOUNDS, boundsCorners, boundsFromMillimetres, boundsRadius, frameOrthographic, framePerspective,
  isUsableBounds, resolveStageCamera, stageViewCamera, stageViewEye, type StageBounds, type StageLookCamera, type Viewport,
} from '../src/client/stage/cameraFraming.js';

const close = (actual: number, expected: number, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≉ ${expected}`);

function cameraFor(look: StageLookCamera, viewport: Viewport): Camera {
  const camera = look.projection === 'orthographic'
    ? Object.assign(new OrthographicCamera(-viewport.width / 2, viewport.width / 2, viewport.height / 2, -viewport.height / 2, look.near, look.far), { zoom: look.zoom })
    : new PerspectiveCamera(look.fov, viewport.width / viewport.height, look.near, look.far);
  camera.up.set(...look.up);
  camera.position.set(...look.position);
  camera.lookAt(...look.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function projectedCorners(bounds: StageBounds, look: StageLookCamera, viewport: Viewport) {
  const camera = cameraFor(look, viewport);
  return boundsCorners(bounds).map(corner => new Vector3(...corner).project(camera));
}

const partBounds: StageBounds = { min: [-0.4, 0, -0.2], max: [0.4, 1.2, 0.2] };
const stageBounds: StageBounds = { min: [-6, 0, -4], max: [6, 3.5, 4] };

test('perspective framing keeps every corner inside the view and the depth range', () => {
  for (const viewport of [{ width: 480, height: 320 }, { width: 320, height: 480 }, { width: 200, height: 200 }]) {
    for (const bounds of [partBounds, stageBounds, DEFAULT_STAGE_BOUNDS]) {
      const look = framePerspective(bounds, { aspect: viewport.width / viewport.height });
      const corners = projectedCorners(bounds, look, viewport);
      for (const corner of corners) {
        assert.ok(Math.abs(corner.x) <= 1 && Math.abs(corner.y) <= 1, `corner outside view: ${corner.toArray()}`);
        assert.ok(corner.z > -1 && corner.z < 1, `corner clipped: ${corner.z}`);
      }
      const extent = Math.max(...corners.flatMap(corner => [Math.abs(corner.x), Math.abs(corner.y)]));
      assert.ok(extent > 0.45, `frame is too loose: ${extent}`);
    }
  }
});

test('perspective framing distance follows the bounding sphere and field of view', () => {
  const look = framePerspective(partBounds, { aspect: 1, fov: 40, margin: 1 });
  const distance = new Vector3(...look.position).distanceTo(new Vector3(...look.target));
  close(distance, boundsRadius(partBounds) / Math.sin(20 * Math.PI / 180));
  assert.deepEqual(look.target, [0, 0.6, 0]);
  const narrow = framePerspective(partBounds, { aspect: 0.5, fov: 40, margin: 1 });
  assert.ok(new Vector3(...narrow.position).distanceTo(new Vector3(...narrow.target)) > distance, 'portrait viewports back off further');
});

test('orthographic framing fits the bounding sphere into the shorter viewport side', () => {
  const viewport = { width: 480, height: 320 };
  const look = frameOrthographic(stageBounds, { viewport, margin: 1 });
  close(look.zoom, 320 / (2 * boundsRadius(stageBounds)));
  for (const corner of projectedCorners(stageBounds, look, viewport)) {
    assert.ok(Math.abs(corner.x) <= 1 && Math.abs(corner.y) <= 1);
    assert.ok(corner.z > -1 && corner.z < 1);
  }
});

test('frame cameras fall back to the canvas bounds, then to a default box', () => {
  const viewport = { width: 400, height: 300 };
  assert.deepEqual(resolveStageCamera({ mode: 'frame' }, viewport, partBounds), framePerspective(partBounds, { aspect: 4 / 3 }));
  assert.deepEqual(resolveStageCamera({ mode: 'frame', bounds: stageBounds }, viewport, partBounds), framePerspective(stageBounds, { aspect: 4 / 3 }));
  assert.deepEqual(resolveStageCamera({ mode: 'frame' }, viewport), framePerspective(DEFAULT_STAGE_BOUNDS, { aspect: 4 / 3 }));
  const broken: StageBounds = { min: [1, 0, 0], max: [0, 1, Number.NaN] };
  assert.equal(isUsableBounds(broken), false);
  assert.deepEqual(resolveStageCamera({ mode: 'frame', bounds: broken }, viewport), framePerspective(DEFAULT_STAGE_BOUNDS, { aspect: 4 / 3 }));
  assert.equal(resolveStageCamera({ mode: 'frame', projection: 'orthographic' }, viewport, partBounds).projection, 'orthographic');
});

test('look cameras keep their values and fill editor defaults', () => {
  const look = resolveStageCamera({ mode: 'look', position: [1, 2, 3], target: [0, 1, 0] }, { width: 100, height: 100 });
  assert.deepEqual(look, { projection: 'perspective', position: [1, 2, 3], target: [0, 1, 0], up: [0, 1, 0], fov: 40, zoom: 50, near: 0.01, far: 1000 });
});

test('millimetre plan boxes map to view-space metres with z up', () => {
  assert.deepEqual(boundsFromMillimetres([0, 0, 0], [8000, 6000, 3500]), { min: [0, 0, 0], max: [8, 3.5, 6] });
});

test('Raumsicht presets reproduce the editor eye positions', () => {
  const input = { target: [4, 0, 3] as const, eye: [1, 5, -6] as const, span: 10 };
  assert.deepEqual(stageViewEye('top', input), [4, 20, 3]);
  assert.deepEqual(stageViewEye('side', input), [-20, 2, 3]);
  assert.deepEqual(stageViewEye('front', input), [4, 2, -10]);
  assert.deepEqual(stageViewEye('orbit', input), [1, 5, -6]);
  assert.deepEqual(stageViewEye('audience', { ...input, focus: true }), [6, 4, -2]);
});

test('Raumsicht presets reproduce StageCamera distance, zoom and up vector', () => {
  const viewport = { width: 1000, height: 500 };
  const orbit = stageViewCamera('orbit', { target: [0, 0, 0], position: [0, 3, -4], span: 10, viewport });
  close(new Vector3(...orbit.position).length(), 10 * 0.7 / Math.tan(20 * Math.PI / 180));
  close(orbit.position[1] / orbit.position[2], -3 / 4);
  assert.equal(orbit.projection, 'perspective');
  assert.equal(orbit.fov, 40);
  const portrait = stageViewCamera('orbit', { target: [0, 0, 0], position: [0, 3, -4], span: 10, viewport: { width: 500, height: 1000 } });
  close(new Vector3(...portrait.position).length(), 10 * 0.7 / (Math.tan(20 * Math.PI / 180) * 0.5));
  const top = stageViewCamera('top', { target: [0, 0, 0], position: [0, 20, 0], span: 10, viewport });
  assert.equal(top.projection, 'orthographic');
  assert.deepEqual(top.up, [0, 0, 1]);
  close(top.zoom, 500 / 13);
  assert.deepEqual(stageViewCamera('front', { target: [0, 0, 0], position: [0, 2, -10], span: 10, viewport }).up, [0, 1, 0]);
  assert.deepEqual(stageViewCamera('audience', { target: [0, 0, 0], position: [1, 1.6, -8], span: 10, viewport }).position, [1, 1.6, -8]);
});
