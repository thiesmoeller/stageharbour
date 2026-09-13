import { useEffect, useState } from 'react';
import { defaultLighting, lightingPresets, type StageLightingSettings } from '../../shared/lighting.js';

export function LightingPanel({ value = defaultLighting, scope, onChange }: { value?: StageLightingSettings; scope: string; onChange?: (value: StageLightingSettings) => void }) {
  function change(patch: Partial<StageLightingSettings>) { onChange?.({ ...value, ...patch }); }
  return <details className="lighting-panel"><summary>Lichtstimmung{value.enabled ? ' · aktiv' : ''}</summary>
    <div className="lighting-controls"><p>{scope}</p><fieldset disabled={!onChange}>
      <label className="lighting-toggle"><input type="checkbox" checked={value.enabled} onChange={event => change({ enabled: event.target.checked })} /> Bühnenlicht aktivieren</label>
      <div className="lighting-presets">{Object.entries(lightingPresets).map(([key, preset]) => <button key={key} type="button" className="quiet" onClick={() => {
        const { label: _label, ...settings } = preset;
        change({ ...settings, enabled: true });
      }}>{preset.label}</button>)}</div>
      <div className="lighting-fields">
        <LightNumber label="Frontlicht (%)" value={value.front} min={0} max={200} step={1} onChange={front => change({ front })} />
        <LightNumber label="Gegenlicht (%)" value={value.back} min={0} max={200} step={1} onChange={back => change({ back })} />
        <label>Frontlichtfarbe<input type="color" value={value.frontColor} onChange={event => change({ frontColor: event.target.value })} /></label>
        <label>Gegenlichtfarbe<input type="color" value={value.backColor} onChange={event => change({ backColor: event.target.value })} /></label>
        <LightNumber label="Grundhelligkeit (%)" value={value.ambient} min={0} max={100} step={1} onChange={ambient => change({ ambient })} />
        <LightNumber label="Aufhängepunkt (mm)" value={value.height} min={1000} max={12000} step={100} onChange={height => change({ height })} />
        <LightNumber label="Öffnungswinkel (°)" value={value.beam} min={20} max={120} step={1} onChange={beam => change({ beam })} />
      </div>
    </fieldset>
    <p>Frontlicht kommt von der Publikumseite (−Z); Pascals Studio-Licht von hinten wird dafür abgeschaltet. Gegenlicht bleibt Randlicht ohne Schatten. Grundhelligkeit 0 % ist dunkles Theater (kein Ambient/IBL); höhere Werte füllen Schatten. Die Vorschau ist gestalterisch, keine gemessene Beleuchtungsstärke.</p></div>
  </details>;
}

function LightNumber({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return <label>{label}<input type="number" value={text} min={min} max={max} step={step}
    onChange={event => {
      setText(event.target.value);
      if (event.target.value !== '' && event.target.validity.valid) onChange(Number(event.target.value));
    }} onBlur={() => setText(String(value))} /></label>;
}
