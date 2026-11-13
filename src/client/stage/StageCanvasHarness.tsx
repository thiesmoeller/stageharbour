import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Vector3 } from 'three';
import type { StageBounds, StageCameraConfig, Vec3 } from './cameraFraming.js';
import { LIGHT_THEME_IDS, lightTheme, type LightThemeId } from './lightThemes.js';
import type { StageQuality } from './renderer.js';
import { StageCanvas, type StageCanvasHandle } from './StageCanvas.js';

type CanvasId = 'a' | 'b';

/** Test hooks for tests/browser/stage-canvas.spec.ts. Coordinates are client CSS pixels. */
export type StageHarnessApi = {
  ready(id: CanvasId): boolean;
  /** Renders a frame and reads the RGBA pixel under the client point. */
  sample(id: CanvasId, x: number, y: number): [number, number, number, number];
  project(id: CanvasId, point: Vec3): { x: number; y: number };
  shadows(id: CanvasId): boolean;
};

declare global {
  interface Window { __stageHarness?: StageHarnessApi }
}

const STAGE_BOUNDS: StageBounds = { min: [-2, 0, -2], max: [2, 1.5, 2] };
const STAGE_CAMERA: StageCameraConfig = { mode: 'look', position: [3, 2.5, -6], target: [0, 0.5, 0] };
const PART_BOUNDS: StageBounds = { min: [-0.4, 0, -0.2], max: [0.4, 1.2, 0.2] };
const PART_CAMERA: StageCameraConfig = { mode: 'frame', bounds: PART_BOUNDS };

const layout: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 480px)', gap: 16, padding: 16, fontFamily: 'system-ui, sans-serif' };
const frame: CSSProperties = { width: 480, height: 320, border: '1px solid #c8c4bb' };
const toolbar: CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', minHeight: 32 };

export function StageCanvasHarness() {
  const handles = useRef<Partial<Record<CanvasId, StageCanvasHandle | null>>>({});
  const [theme, setTheme] = useState<LightThemeId>('studio');
  const [quality, setQuality] = useState<StageQuality>('simple');
  const [previewMounted, setPreviewMounted] = useState(true);
  const [mounts, setMounts] = useState(1);
  const [missed, setMissed] = useState({ a: 0, b: 0 });
  const [hits, setHits] = useState(0);
  useEffect(() => {
    const handle = (id: CanvasId) => {
      const value = handles.current[id];
      if (!value) throw new Error(`canvas ${id} is not mounted`);
      return value;
    };
    window.__stageHarness = {
      ready: id => !!handles.current[id],
      sample: (id, x, y) => {
        const { gl } = handle(id);
        handle(id).render();
        const canvas = gl.domElement, rect = canvas.getBoundingClientRect();
        const px = Math.floor((x - rect.left) * canvas.width / rect.width);
        const py = canvas.height - 1 - Math.floor((y - rect.top) * canvas.height / rect.height);
        const context = gl.getContext(), pixel = new Uint8Array(4);
        context.readPixels(px, py, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
        return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!];
      },
      project: (id, point) => {
        const { gl, camera } = handle(id);
        const rect = gl.domElement.getBoundingClientRect();
        const ndc = new Vector3(...point).project(camera);
        return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
      },
      shadows: id => handle(id).gl.shadowMap.enabled,
    };
    return () => { delete window.__stageHarness; };
  }, []);
  return <main style={layout} data-testid="stage-harness">
    <section>
      <div style={toolbar}>
        <label>Lichtstimmung <select value={theme} onChange={event => setTheme(event.target.value as LightThemeId)}>
          {LIGHT_THEME_IDS.map(id => <option key={id} value={id}>{lightTheme(id).label}</option>)}
        </select></label>
        <label><input type="checkbox" checked={quality === 'enhanced'} onChange={event => setQuality(event.target.checked ? 'enhanced' : 'simple')} /> Erweiterte Darstellung</label>
      </div>
      <div style={frame}>
        <StageCanvas ref={value => { handles.current.a = value; }} data-testid="stage-canvas-a" aria-label="Bühne"
          theme={theme} quality={quality} bounds={STAGE_BOUNDS} camera={STAGE_CAMERA} controls={{ buttons: 'editor' }}
          ground="solid" preserveDrawingBuffer onPointerMissed={() => setMissed(value => ({ ...value, a: value.a + 1 }))}>
          <mesh name="harness-box" position={[0, 0.5, 0]} castShadow receiveShadow onClick={event => { event.stopPropagation(); setHits(value => value + 1); }}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#c0392b" />
          </mesh>
          <mesh name="harness-sphere" position={[1.4, 0.4, 0.8]} castShadow>
            <sphereGeometry args={[0.4, 32, 16]} />
            <meshStandardMaterial color="#2e86c1" roughness={0.4} />
          </mesh>
        </StageCanvas>
      </div>
      <p>Treffer <output data-testid="hits-a">{hits}</output> · Leerklicks <output data-testid="missed-a">{missed.a}</output></p>
    </section>
    <section>
      <div style={toolbar}>
        <button type="button" onClick={() => { setPreviewMounted(value => !value); setMounts(value => value + 1); }}>{previewMounted ? 'Vorschau entfernen' : 'Vorschau einsetzen'}</button>
        <span data-testid="preview-mounts">{mounts}</span>
      </div>
      <div style={frame}>
        {previewMounted && <StageCanvas key={mounts} ref={value => { handles.current.b = value; }} data-testid="stage-canvas-b" aria-label="Teilvorschau"
          theme="sunset" quality="enhanced" bounds={PART_BOUNDS} camera={PART_CAMERA} controls={{ buttons: 'preview' }}
          ground="shadow" onPointerMissed={() => setMissed(value => ({ ...value, b: value.b + 1 }))}>
          <mesh name="harness-part" position={[0, 0.6, 0]} castShadow>
            <boxGeometry args={[0.8, 1.2, 0.4]} />
            <meshStandardMaterial color="#7d6608" roughness={0.7} />
          </mesh>
        </StageCanvas>}
      </div>
      <p>Leerklicks <output data-testid="missed-b">{missed.b}</output></p>
    </section>
  </main>;
}
