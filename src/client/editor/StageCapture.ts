import { UnsignedByteType, type Camera, type PerspectiveCamera, type Scene } from 'three';
import { RenderTarget } from 'three/webgpu';

export type StageCaptureHandle = { capturePng: () => Promise<string> };

/** Long edge in pixels — enough for ~200 dpi on an A4 body. */
export const CAPTURE_MAX_EDGE = 2400;

type GpuRenderer = {
  domElement: HTMLCanvasElement;
  render: (scene: Scene, camera: Camera) => void;
  setRenderTarget: (target: RenderTarget | null) => void;
  getRenderTarget: () => RenderTarget | null;
  getClearAlpha?: () => number;
  setClearAlpha?: (alpha: number) => void;
  init?: () => Promise<unknown>;
  readRenderTargetPixelsAsync?: (
    target: RenderTarget, x: number, y: number, width: number, height: number,
  ) => Promise<ArrayBufferView>;
  backend?: { device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } }; isWebGPUBackend?: boolean; constructor?: { name?: string } };
};

function isWebGpuBackend(renderer: GpuRenderer) {
  const backend = renderer.backend;
  // Pascal’s Viewer uses WebGPURenderer({ forceWebGL: true }); isWebGPURenderer stays
  // true even then — inspect the live backend, matching @pascal-app/editor thumbnails.
  return Boolean(
    backend?.device
    || backend?.isWebGPUBackend
    || backend?.constructor?.name === 'WebGPUBackend',
  );
}

function captureSize(aspect: number, maxEdge: number) {
  const safe = Math.max(0.2, Math.min(aspect, 5));
  if (safe >= 1) {
    return { width: maxEdge, height: Math.max(1, Math.round(maxEdge / safe)) };
  }
  return { width: Math.max(1, Math.round(maxEdge * safe)), height: maxEdge };
}

function pixelsToDataUrl(pixels: ArrayBufferView, width: number, height: number, webGpu: boolean) {
  const source = pixels instanceof Uint8Array
    ? pixels
    : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  const actualBytesPerRow = width * 4;
  const tightTotal = actualBytesPerRow * height;
  const paddedBytesPerRow = Math.ceil(actualBytesPerRow / 256) * 256;
  let tight: Uint8ClampedArray;
  if (webGpu) {
    if (paddedBytesPerRow === actualBytesPerRow && source.byteLength >= tightTotal) {
      tight = new Uint8ClampedArray(source.buffer, source.byteOffset, tightTotal);
    } else {
      tight = new Uint8ClampedArray(tightTotal);
      for (let row = 0; row < height; row++) {
        tight.set(
          source.subarray(row * paddedBytesPerRow, row * paddedBytesPerRow + actualBytesPerRow),
          row * actualBytesPerRow,
        );
      }
    }
  } else {
    if (source.byteLength < tightTotal) {
      throw new Error(`Aufnahme zu kurz (${source.byteLength} < ${tightTotal}).`);
    }
    tight = new Uint8ClampedArray(tightTotal);
    for (let row = 0; row < height; row++) {
      const srcStart = (height - 1 - row) * actualBytesPerRow;
      tight.set(source.subarray(srcStart, srcStart + actualBytesPerRow), row * actualBytesPerRow);
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const copy = new Uint8ClampedArray(tight);
  canvas.getContext('2d')!.putImageData(new ImageData(copy, width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

function canvasElementToDataUrl(source: HTMLCanvasElement, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D-Kontext für die Aufnahme fehlt.');
  context.drawImage(source, 0, 0, width, height);
  const url = canvas.toDataURL('image/png');
  if (!url.startsWith('data:image/png')) throw new Error('Die Aufnahme lieferte kein PNG.');
  return url;
}

function assertUsefulPng(url: string) {
  if (url.length < 256) throw new Error('Die Aufnahme ist leer.');
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} (Timeout nach ${ms} ms).`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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

function captureFromCanvas(gl: GpuRenderer, scene: Scene, camera: Camera, width: number, height: number) {
  // Same-tick read after an explicit present — required when the drawing buffer
  // is not preserved across frames (Pascal / three default). Low-res fallback only.
  withCameraAspect(camera, width / height, () => {
    gl.setRenderTarget(null);
    gl.render(scene, camera);
  });
  const url = canvasElementToDataUrl(gl.domElement, width, height);
  assertUsefulPng(url);
  return url;
}

async function captureFromRenderTarget(
  gl: GpuRenderer, scene: Scene, camera: Camera, width: number, height: number,
) {
  if (typeof gl.readRenderTargetPixelsAsync !== 'function') {
    throw new Error('GPU-Auslesen wird nicht unterstützt.');
  }
  const target = new RenderTarget(width, height, { depthBuffer: true, type: UnsignedByteType });
  const previous = gl.getRenderTarget?.() ?? null;
  const previousAlpha = gl.getClearAlpha?.();
  try {
    gl.setClearAlpha?.(1);
    withCameraAspect(camera, width / height, () => {
      gl.setRenderTarget(target);
      gl.render(scene, camera);
    });
    await gl.backend?.device?.queue?.onSubmittedWorkDone?.();
    const pixels = await withTimeout(
      gl.readRenderTargetPixelsAsync(target, 0, 0, width, height),
      8_000,
      'GPU-Auslesen hängt',
    );
    if (!pixels || pixels.byteLength < 4) throw new Error('Die GPU-Aufnahme lieferte keine Pixel.');
    const url = pixelsToDataUrl(pixels, width, height, isWebGpuBackend(gl));
    assertUsefulPng(url);
    return url;
  } finally {
    gl.setRenderTarget(previous);
    if (previousAlpha !== undefined) gl.setClearAlpha?.(previousAlpha);
    target.dispose();
  }
}

/**
 * Capture a Pascal / three viewport to a PNG data URL at print-friendly resolution.
 * Renders into an offscreen target sized from the live CSS aspect (not the tiny
 * sidebar backing store), so PDF pages stay sharp and undistorted.
 */
export async function captureViewportPng(
  gl: GpuRenderer, scene: Scene, camera: Camera, maxEdge = CAPTURE_MAX_EDGE,
): Promise<string> {
  if (typeof gl.init === 'function') {
    await withTimeout(Promise.resolve(gl.init()), 8_000, 'Renderer-Initialisierung hängt');
  }

  const cssW = Math.max(1, gl.domElement.clientWidth || gl.domElement.width || 1);
  const cssH = Math.max(1, gl.domElement.clientHeight || gl.domElement.height || 1);
  const { width, height } = captureSize(cssW / cssH, maxEdge);

  // Prefer render-target so we can upscale past the on-screen canvas.
  if (typeof gl.readRenderTargetPixelsAsync === 'function') {
    try {
      return await captureFromRenderTarget(gl, scene, camera, width, height);
    } catch {
      // Fall through to same-tick canvas copy.
    }
  }

  return captureFromCanvas(gl, scene, camera, width, height);
}
