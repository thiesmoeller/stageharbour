import { useMemo, useState, type FormEvent } from 'react';
import { Box3, Vector3, type Object3D } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { modelDimensionsFromReference, type ModelAxis } from '../../shared/assets.js';
import { StageCanvas } from '../stage/StageCanvas.js';

export type ModelCalibrationValue = { width: number; height: number; depth: number; rotation: [number, number, number] };
export function ModelCalibration({ object, initial, busy, onAccept, onCancel }: {
  object: Object3D; initial?: ModelCalibrationValue; busy: boolean;
  onAccept: (value: ModelCalibrationValue) => void; onCancel: () => void;
}) {
  const copy = useMemo(() => clone(object), [object]);
  const box = useMemo(() => new Box3().setFromObject(copy), [copy]);
  const native = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
  const [axis, setAxis] = useState<ModelAxis>('height');
  const [length, setLength] = useState(initial?.height ?? Math.round(native.y * 1000));
  const [rotation, setRotation] = useState<[number, number, number]>(initial?.rotation ?? [0, 0, 0]);
  const [error, setError] = useState('');
  let dimensions: ReturnType<typeof modelDimensionsFromReference> | undefined;
  try { dimensions = modelDimensionsFromReference(native, axis, length); } catch { /* validate on submission */ }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!dimensions || Object.values(dimensions).some(value => value < 1 || value > 100000)) {
      setError('Alle Außenmaße müssen zwischen 1 und 100000 mm liegen.'); return;
    }
    onAccept({ ...dimensions, rotation });
  }
  const scale = 1 / Math.max(native.x, native.y, native.z);
  return <form onSubmit={submit} aria-label="Modell ausrichten und Maß prüfen">
    <fieldset disabled={busy}><legend>GLB-Vorschau · Ausrichtung und Maß prüfen</legend>
      <StageCanvas style={{ height: 240 }} bounds={{ min: [-1, -1, -1], max: [1, 1, 1] }} controls={{ buttons: 'preview' }} aria-label="Vorschau des importierten Modells">
        <group rotation={rotation.map(value => value * Math.PI / 180) as [number, number, number]} scale={scale}>
          <primitive object={copy} position={[-center.x, -center.y, -center.z]} dispose={null} />
        </group>
      </StageCanvas>
      <label>Bekanntes Außenmaß<select value={axis} onChange={event => setAxis(event.target.value as ModelAxis)}>
        <option value="width">Breite</option><option value="height">Höhe</option><option value="depth">Tiefe</option>
      </select></label>
      <label>Länge (mm)<input type="number" min={1} max={100000} required value={length} onChange={event => { setLength(event.target.valueAsNumber); setError(''); }} /></label>
      <p>Proportionen bleiben erhalten. {dimensions && `${Math.round(dimensions.width)} × ${Math.round(dimensions.height)} × ${Math.round(dimensions.depth)} mm (B × H × T)`}</p>
      {(['X', 'Y', 'Z'] as const).map((label, index) => <label key={label}>Drehung {label} (°)<input type="number" min={-360} max={360} value={rotation[index]} required onChange={event => {
        const next: [number, number, number] = [...rotation]; next[index] = event.target.valueAsNumber; setRotation(next);
      }} /></label>)}
      {error && <p role="alert">{error}</p>}
      <button type="submit">Maße übernehmen</button><button type="button" onClick={onCancel}>Abbrechen</button>
    </fieldset>
  </form>;
}
