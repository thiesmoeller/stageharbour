import { useEffect, useRef, useState } from 'react';
import {
  builtInFixtureTypes, focusTowardPoint, openBarnDoors, patchFixtureFocus, type BarnDoorFlaps,
  type HangPlan, type LightLookFixtureState, type LightingFixture,
} from '../../shared/hangPlan.js';
import { trussHangWorld, type Truss } from '../../shared/truss.js';

/** Session blackout level: 1 = full, 0 = out (not saved on the look). */
export function useBlackoutLevel(initial = 1) {
  const [level, setLevel] = useState(initial);
  const levelRef = useRef(initial);
  const anim = useRef<number | null>(null);
  levelRef.current = level;
  function go(target: number, ms: number) {
    if (anim.current) cancelAnimationFrame(anim.current);
    if (ms <= 0) { setLevel(target); return; }
    const start = performance.now();
    const from = levelRef.current;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setLevel(from + (target - from) * t);
      if (t < 1) anim.current = requestAnimationFrame(tick);
      else anim.current = null;
    };
    anim.current = requestAnimationFrame(tick);
  }
  useEffect(() => () => { if (anim.current) cancelAnimationFrame(anim.current); }, []);
  return {
    level,
    blackoutFast: () => go(0, 0),
    blackoutSlow: () => go(0, 2000),
    restoreFast: () => go(1, 0),
    restoreSlow: () => go(1, 2000),
  };
}

/** Selected fixture controls live beside the other lighting controls. */
export function FixtureControlOverlay({ fixture, lookState, hangPlan, trusses, stageWidth, stageDepth, canEditLook, canEditFocus, focusAimMode, onFocusAimMode, onLookPatch, onHangPlanChange, blackout, onClose }: {
  fixture: LightingFixture;
  lookState?: LightLookFixtureState;
  hangPlan: HangPlan;
  trusses: readonly Truss[];
  stageWidth: number;
  stageDepth: number;
  canEditLook?: boolean;
  canEditFocus?: boolean;
  focusAimMode?: boolean;
  onFocusAimMode?: (on: boolean) => void;
  onLookPatch?: (patch: Partial<LightLookFixtureState>) => void;
  onHangPlanChange?: (plan: HangPlan) => void;
  blackout: ReturnType<typeof useBlackoutLevel>;
  onClose: () => void;
}) {
  const intensity = lookState?.intensity ?? 100;
  const color = lookState?.color ?? '#ffe0b3';
  const type = builtInFixtureTypes[fixture.typeId];
  const beam = fixture.focus?.beam ?? type.defaultBeam;
  const flaps = fixture.focus?.barnDoors ?? openBarnDoors;

  function setFocus(patch: Partial<NonNullable<LightingFixture['focus']>>) {
    if (!onHangPlanChange) return;
    onHangPlanChange(patchFixtureFocus(hangPlan, fixture.id, { ...fixture.focus, ...patch }));
  }

  function aimAtCentre() {
    const truss = trusses.find(item => item.id === fixture.trussId);
    const hang = truss?.hangPoints.find(point => point.id === fixture.hangPointId);
    if (!truss || !hang || !onHangPlanChange) return;
    const world = trussHangWorld(truss, hang);
    const aimed = focusTowardPoint(
      { x: world.x, y: truss.bottomHeight, z: world.y },
      { x: stageWidth / 2, z: stageDepth / 2 },
    );
    onHangPlanChange(patchFixtureFocus(hangPlan, fixture.id, aimed));
  }

  return <>
    <div className="fixture-desk" data-testid="fixture-desk" role="region" aria-label={`${fixture.label} steuern`}>
      <div className="fixture-desk-head">
        <strong>{fixture.label}</strong>
        <span>{type.label}</span>
        <button type="button" className="quiet" onClick={onClose} aria-label="Schließen">×</button>
      </div>
      {canEditLook && <div className="fixture-desk-blackout" role="group" aria-label="Blackout Look">
        <button type="button" className="quiet" onClick={blackout.blackoutFast}>Blackout schnell</button>
        <button type="button" className="quiet" onClick={blackout.blackoutSlow}>Blackout langsam</button>
        <button type="button" className="quiet" onClick={blackout.restoreFast}>Auf schnell</button>
        <button type="button" className="quiet" onClick={blackout.restoreSlow}>Auf langsam</button>
      </div>}
      {canEditLook ? <fieldset>
        <legend className="sr-only">Look-Pegel</legend>
        <p className="muted">Look · Stimmung (nicht Hang)</p>
        <label className="fixture-fader">Intensität
          <input type="range" min={0} max={200} step={1} value={intensity} aria-label={`${fixture.label} Intensität`}
            onChange={event => onLookPatch?.({ intensity: Number(event.target.value) })} />
          <span>{intensity} %</span>
        </label>
        <label>Farbe<input type="color" value={color} aria-label={`${fixture.label} Farbe`}
          onChange={event => onLookPatch?.({ color: event.target.value })} /></label>
      </fieldset> : <p className="muted">Einrichten · An/Aus in der Schalterleiste. Hier: Ausrichtung &amp; Klappen.</p>}
      {canEditFocus && <fieldset className="fixture-focus">
        <legend>Ausrichtung &amp; Klappen (Hang)</legend>
        <p className="muted">Venue-Default · selten umhängen · typisch nur zielen / Flügelblenden.</p>
        <button type="button" className="quiet" aria-pressed={!!focusAimMode}
          onClick={() => onFocusAimMode?.(!focusAimMode)}>
          {focusAimMode ? 'Zielpunkt wählen …' : 'Auf Fläche zielen'}
        </button>
        <button type="button" className="quiet" onClick={aimAtCentre}>Auf Bühnenmitte</button>
        <div className="lighting-fields">
          <LookNumber label="Pan (°)" value={fixture.focus?.pan ?? 0} min={-180} max={180} step={1}
            onChange={value => setFocus({ pan: value })} />
          <LookNumber label="Neigung (°)" value={fixture.focus?.tilt ?? 0} min={-90} max={90} step={1}
            onChange={value => setFocus({ tilt: value })} />
          <LookNumber label="Strahl (°)" value={beam} min={10} max={120} step={1}
            onChange={value => setFocus({ beam: value })} />
        </div>
        {fixture.barnDoorsAttached && <div className="barn-door-flaps">
          <p>Flügelblenden (°)</p>
          <div className="lighting-fields">
            {([
              ['top', 'Oben'],
              ['bottom', 'Unten'],
              ['stageLeft', 'Bühne links'],
              ['stageRight', 'Bühne rechts'],
            ] as const).map(([key, label]) =>
              <LookNumber key={key} label={label} value={flaps[key]} min={0} max={90} step={1}
                onChange={value => setFocus({ barnDoors: { ...flaps, [key]: value } satisfies BarnDoorFlaps })} />)}
          </div>
        </div>}
      </fieldset>}
      {!canEditFocus && <p className="muted">Ausrichtung gehört zum Hang (Spielstätte).</p>}
    </div>
  </>;
}

function LookNumber({ label, value, min, max, step, onChange }: {
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
