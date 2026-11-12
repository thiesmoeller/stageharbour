import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MeshBasicMaterial, MeshStandardMaterial, type BufferGeometry } from 'three';
import type { PartMaterial } from '../../shared/parts/definition.js';
import { buildPartGeometry, buildSolidGeometry, type PartGeometry } from '../../shared/parts/geometry.js';
import type { ResolvedPart } from '../../shared/parts/resolve.js';
import type { StageBounds } from '../stage/cameraFraming.js';
import type { StageQuality } from '../stage/renderer.js';
import { StageCanvas } from '../stage/StageCanvas.js';
import type { DesignerSelection } from './draft.js';
import { SharedGeometryCache, resolvedGeometryKey } from './geometryCache.js';
import { solidSelection, sameSelection } from './views.js';

const partGeometries = new SharedGeometryCache<PartGeometry>(entry => entry.geometry.dispose());
const MM = 0.001;
const FALLBACK_COLOR = '#c9cfd2';
const EMPTY_BOUNDS: StageBounds = { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] };

/** Geometry of a resolved part, shared with every other preview that shows the same shape. */
function useSharedPartGeometry(resolved: ResolvedPart): { key: string; geometry: PartGeometry } | undefined {
  const key = useMemo(() => resolvedGeometryKey(resolved), [resolved]);
  const latest = useRef(resolved);
  latest.current = resolved;
  const [entry, setEntry] = useState<{ key: string; geometry: PartGeometry }>();
  useLayoutEffect(() => {
    const geometry = partGeometries.acquire(key, () => buildPartGeometry(latest.current));
    setEntry({ key, geometry });
    return () => partGeometries.release(key);
  }, [key]);
  return entry;
}

/** Metres, rounded to 5 cm so that small edits do not re-frame the camera. */
export function previewBounds(resolved: Pick<ResolvedPart, 'bounds' | 'solids'>): StageBounds {
  if (!resolved.solids.length) return EMPTY_BOUNDS;
  const step = (value: number, round: (value: number) => number) => round(value * MM / 0.05) * 0.05;
  const { min, max } = resolved.bounds;
  return {
    min: [step(min.x, Math.floor), step(min.y, Math.floor), step(min.z, Math.floor)],
    max: [step(max.x, Math.ceil), step(max.y, Math.ceil), step(max.z, Math.ceil)],
  };
}

function PartMesh({ resolved, materials, selection }: { resolved: ResolvedPart; materials: readonly PartMaterial[]; selection?: DesignerSelection }) {
  const shared = useSharedPartGeometry(resolved);
  const colors = useMemo(() => new Map(materials.map(material => [material.key, material.color])), [materials]);
  const slots = shared?.geometry.slots;
  const surfaces = useMemo(() => (slots ?? []).map(slot => new MeshStandardMaterial({
    color: colors.get(slot.material) ?? FALLBACK_COLOR, roughness: 0.82, metalness: 0,
  })), [slots, colors]);
  useEffect(() => () => surfaces.forEach(material => material.dispose()), [surfaces]);

  const highlighted = useMemo(() => {
    if (!selection) return [];
    return resolved.solids.filter(solid => sameSelection(solidSelection(solid), selection)).map(solid => buildSolidGeometry(solid));
  }, [resolved, selection]);
  useEffect(() => () => highlighted.forEach((geometry: BufferGeometry) => geometry.dispose()), [highlighted]);
  const highlight = useMemo(() => new MeshBasicMaterial({
    color: '#e59a2f', transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), []);
  useEffect(() => () => highlight.dispose(), [highlight]);

  if (!shared) return null;
  return <group scale={MM}>
    <mesh geometry={shared.geometry.geometry} material={surfaces} castShadow receiveShadow dispose={null} name="designer-part" />
    {highlighted.map((geometry, index) => <mesh key={index} geometry={geometry} material={highlight} renderOrder={2} dispose={null} />)}
  </group>;
}

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p className="muted designer-preview-failed" role="status">Die 3D-Vorschau ist in diesem Browser nicht verfügbar. Die Ansichten darunter bleiben nutzbar.</p>
      : this.props.children;
  }
}

/** 3D preview of the resolved part on the owned stage canvas, framed to its bounds. */
export function PartPreview3D({ resolved, materials, selection, label = '3D-Vorschau' }: {
  resolved: ResolvedPart | undefined; materials: readonly PartMaterial[]; selection?: DesignerSelection; label?: string;
}) {
  const [quality, setQuality] = useState<StageQuality>('simple');
  const bounds = useMemo(() => resolved ? previewBounds(resolved) : EMPTY_BOUNDS, [resolved]);
  const camera = useMemo(() => ({ mode: 'frame' as const, bounds }), [bounds]);
  const geometryKey = useMemo(() => resolved ? resolvedGeometryKey(resolved) : '', [resolved]);
  return <div className="designer-preview" data-testid="designer-preview" data-solids={resolved?.solids.length ?? 0} data-geometry={geometryKey}>
    <div className="designer-preview-bar">
      <strong>3D-Vorschau</strong>
      <label className="checkbox-line"><input type="checkbox" checked={quality === 'enhanced'}
        onChange={event => setQuality(event.target.checked ? 'enhanced' : 'simple')} /> Erweiterte Darstellung</label>
    </div>
    <PreviewBoundary>
      <div className="designer-canvas"><StageCanvas aria-label={label} theme="studio" quality={quality} bounds={bounds} camera={camera}
        controls={{ buttons: 'preview' }} ground="solid">
        {resolved && <PartMesh resolved={resolved} materials={materials} selection={selection} />}
      </StageCanvas></div>
    </PreviewBoundary>
  </div>;
}
