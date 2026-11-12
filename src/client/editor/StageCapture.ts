import { Vector2, type Camera, type PerspectiveCamera, type Scene } from 'three';
import type { SavedCamera } from '../../shared/exportDocument.js';
import type { StageRenderer } from '../stage/renderer.js';

export type StageCaptureOptions = {
  /** Long edge in pixels. Defaults to print-friendly {@link CAPTURE_MAX_EDGE}. */
  maxEdge?: number;
};

export type StageCaptureHandle = { capturePng: (options?: StageCaptureOptions) => Promise<string>; getCamera?: () => SavedCamera };

/** Long edge in pixels — enough for ~200 dpi on an A4 body. */
export const CAPTURE_MAX_EDGE = 2400;
/** Long edge for in-app feedback screenshots (email attachments, not print). */
export const FEEDBACK_CAPTURE_MAX_EDGE = 1200;

/** Output size for a viewport of the given aspect: the long edge is `maxEdge`, extreme aspects are clamped. */
export function captureSize(aspect: number, maxEdge: number) {
  const safe = Math.max(0.2, Math.min(aspect, 5));
  if (safe >= 1) {
    return { width: maxEdge, height: Math.max(1, Math.round(maxEdge / safe)) };
  }
  return { width: Math.max(1, Math.round(maxEdge * safe)), height: maxEdge };
}

function withCameraAspect(camera: Camera, aspect: number, render: () => void) {
  const perspective = camera as PerspectiveCamera;
  const previous = perspective.aspect;
  const canAdjust = typeof previous === 'number' && typeof perspective.updateProjectionMatrix === 'function';
  if (canAdjust) {
    perspective.aspect = aspect;
    perspective.updateProjectionMatrix();
  }
  try {
    render();
  } finally {
    if (canAdjust) {
      perspective.aspect = previous;
      perspective.updateProjectionMatrix();
    }
  }
}

/**
 * Captures the stage as a PNG data URL at print-friendly resolution, looking exactly like the
 * screen (tone mapping, colour space, antialiasing): the drawing buffer is resized to the output
 * size for one frame, read back in the same task, and restored before the browser paints.
 * The size follows the canvas's CSS aspect, not its backing store, so a small pane still exports
 * sharp and undistorted.
 */
export function captureViewportPng(gl: StageRenderer, scene: Scene, camera: Camera, options: StageCaptureOptions = {}): string {
  const canvas = gl.domElement;
  const cssWidth = Math.max(1, canvas.clientWidth || canvas.width || 1);
  const cssHeight = Math.max(1, canvas.clientHeight || canvas.height || 1);
  const { width, height } = captureSize(cssWidth / cssHeight, options.maxEdge ?? CAPTURE_MAX_EDGE);
  const previousSize = gl.getSize(new Vector2());
  const previousPixelRatio = gl.getPixelRatio();
  const previousTarget = gl.getRenderTarget();
  try {
    gl.setRenderTarget(null);
    gl.setPixelRatio(1);
    gl.setSize(width, height, false);
    withCameraAspect(camera, width / height, () => gl.render(scene, camera));
    const url = canvas.toDataURL('image/png');
    if (!url.startsWith('data:image/png') || url.length < 256) throw new Error('Die Aufnahme ist leer.');
    return url;
  } finally {
    gl.setPixelRatio(previousPixelRatio);
    gl.setSize(previousSize.x, previousSize.y, false);
    gl.setRenderTarget(previousTarget);
    gl.render(scene, camera);
  }
}
