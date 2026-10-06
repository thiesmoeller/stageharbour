import { useEffect, useState } from 'react';
import {
  builtInFixtureTypes, focusTowardPoint, openBarnDoors, patchFixtureFocus, patchFixtureLabel, patchFixtureType,
  type BarnDoorFlaps, type BuiltInFixtureTypeId, type HangPlan, type LightingFixture,
} from '../../shared/hangPlan.js';
import { trussHangWorld, type Truss } from '../../shared/truss.js';

const FIXTURE_TYPE_IDS = Object.keys(builtInFixtureTypes) as BuiltInFixtureTypeId[];

/** Selected fixture: hang aim, type and barn doors (levels live on the light board). */
export function FixtureControlOverlay({ fixture, hangPlan, trusses, stageWidth, stageDepth, canEditFocus, focusAimMode, onFocusAimMode, onHangPlanChange, onClose }: {
  fixture: LightingFixture;
  hangPlan: HangPlan;
  trusses: readonly Truss[];
  stageWidth: number;
  stageDepth: number;
  canEditFocus?: boolean;
  focusAimMode?: boolean;
  onFocusAimMode?: (on: boolean) => void;
  onHangPlanChange?: (plan: HangPlan) => void;
  onClose: () => void;
}) {
  const type = builtInFixtureTypes[fixture.typeId];
  const beam = fixture.focus?.beam ?? type.defaultBeam;
  const flaps = fixture.focus?.barnDoors ?? openBarnDoors;

  function setFocus(patch: Partial<NonNullable<LightingFixture['focus']>>) {
    if (!onHangPlanChange) return;
    onHangPlanChange(patchFixtureFocus(hangPlan, fixture.id, { ...fixture.focus, ...patch }));
  }

  function setType(typeId: BuiltInFixtureTypeId) {
    if (!onHangPlanChange) return;
    onHangPlanChange(patchFixtureType(hangPlan, fixture.id, typeId));
  }

  function setBarnDoorsAttached(barnDoorsAttached: boolean) {
    if (!onHangPlanChange || !type.barnDoorsCapable) return;
    onHangPlanChange({
      fixtures: hangPlan.fixtures.map(item => item.id === fixture.id
        ? { ...item, barnDoorsAttached }
        : item),
    });
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

  return <div className="fixture-desk" data-testid="fixture-desk" role="region" aria-label={`${fixture.label} steuern`}>
    <div className="fixture-desk-head">
      <strong>{fixture.label}</strong>
      <button type="button" className="quiet" onClick={onClose} aria-label="Schließen">×</button>
    </div>
    {canEditFocus ? <fieldset className="fixture-focus">
      <legend>Ausrichtung &amp; Klappen (Hang)</legend>
      <p className="muted">Venue-Default · selten umhängen · typisch nur zielen / Flügelblenden. Pegel im Lichtpult.</p>
      <label>Bezeichnung
        <input aria-label={`${fixture.label} Bezeichnung`} maxLength={120} value={fixture.label}
          onChange={event => onHangPlanChange?.(patchFixtureLabel(hangPlan, fixture.id, event.target.value))} />
      </label>
      <label>Gerätetyp
        <select aria-label={`${fixture.label} Gerätetyp`} value={fixture.typeId}
          onChange={event => setType(event.target.value as BuiltInFixtureTypeId)}>
          {FIXTURE_TYPE_IDS.map(id => <option key={id} value={id}>{builtInFixtureTypes[id].label}</option>)}
        </select>
      </label>
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
      {type.barnDoorsCapable && <label className="fixture-barn-attach">
        <input type="checkbox" checked={fixture.barnDoorsAttached}
          onChange={event => setBarnDoorsAttached(event.target.checked)} />
        Flügelblenden montiert
      </label>}
      {fixture.barnDoorsAttached && <div className="barn-door-flaps">
        <p>Flügelblenden (°)</p>
        <div className="barn-door-sliders">
          {([
            ['top', 'Oben'],
            ['bottom', 'Unten'],
            ['stageLeft', 'Bühne links'],
            ['stageRight', 'Bühne rechts'],
          ] as const).map(([key, label]) =>
            <label key={key} className="barn-door-fader">{label}
              <input type="range" min={0} max={90} step={1} value={flaps[key]}
                aria-label={`${fixture.label} Flügelblende ${label}`}
                onChange={event => setFocus({ barnDoors: { ...flaps, [key]: Number(event.target.value) } satisfies BarnDoorFlaps })} />
              <span>{flaps[key]}°</span>
            </label>)}
        </div>
      </div>}
    </fieldset> : <p className="muted">Gerätetyp und Ausrichtung gehören zum Hang (Spielstätte).</p>}
  </div>;
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
