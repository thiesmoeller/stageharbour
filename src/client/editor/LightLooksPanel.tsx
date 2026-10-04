import { useEffect, useState } from 'react';
import {
  builtInFixtureTypes, newLightLook, type HangPlan, type LightLook, type LightLookFixtureState,
  type LightingFixture,
} from '../../shared/hangPlan.js';

export type LightLooksPatch = {
  lightLooks: LightLook[];
  activeLightLookId?: string;
};

export function LightLooksPanel({ looks = [], activeLookId, hangPlan, selectedFixtureId, onSelectFixture, onChange }: {
  looks?: LightLook[];
  activeLookId?: string;
  hangPlan: HangPlan;
  selectedFixtureId?: string | null;
  onSelectFixture?: (id: string | null) => void;
  onChange?: (patch: LightLooksPatch) => void;
}) {
  const fixtures = hangPlan.fixtures;
  if (!fixtures.length) return null;
  const active = looks.find(look => look.id === activeLookId) ?? looks[0];
  const activeId = active?.id;

  function commit(nextLooks: LightLook[], nextActiveId?: string) {
    onChange?.({
      lightLooks: nextLooks,
      activeLightLookId: nextActiveId ?? (nextLooks.some(look => look.id === activeLookId) ? activeLookId : nextLooks[0]?.id),
    });
  }

  function selectLook(id: string) {
    onChange?.({ lightLooks: looks, activeLightLookId: id });
  }

  function addLook() {
    const look = newLightLook(crypto.randomUUID(), `Look ${looks.length + 1}`);
    commit([...looks, look], look.id);
  }

  function renameLook(id: string, name: string) {
    commit(looks.map(look => look.id === id ? { ...look, name } : look), activeLookId);
  }

  function patchFixture(fixtureId: string, patch: Partial<LightLookFixtureState>) {
    if (!active) return;
    const prior = active.fixtures[fixtureId];
    const nextState: LightLookFixtureState = {
      intensity: prior?.intensity ?? 100,
      color: prior?.color ?? '#ffe0b3',
      ...patch,
    };
    const next: LightLook = {
      ...active,
      fixtures: { ...active.fixtures, [fixtureId]: nextState },
    };
    commit(looks.map(look => look.id === active.id ? next : look), active.id);
  }

  return <details className="lighting-panel light-looks-panel" data-testid="light-looks-panel">
    <summary>Lichtlook{active ? ` · ${active.name}` : ''}</summary>
    <div className="lighting-controls">
      <p>{onChange
        ? 'Looks = Intensität und Farbe je Scheinwerfer (kein grandMA). Ausrichtung gehört zum Hang auf der Spielstätte.'
        : 'Gespeicherter Lichtlook · nur Ansicht.'}</p>
      <fieldset disabled={!onChange}>
        <div className="light-looks-toolbar">
          <label>Aktiver Look
            <select aria-label="Aktiver Lichtlook" value={activeId ?? ''} onChange={event => selectLook(event.target.value)}>
              {!looks.length && <option value="">Kein Look</option>}
              {looks.map(look => <option key={look.id} value={look.id}>{look.name}</option>)}
            </select>
          </label>
          <button type="button" className="quiet" onClick={addLook}>Look hinzufügen</button>
        </div>
        {active && <label>Name<input aria-label="Lichtlook umbenennen" value={active.name}
          onChange={event => renameLook(active.id, event.target.value)} /></label>}
        {active && <div className="light-look-fixtures">
          {fixtures.map(fixture => <FixtureLookRow key={fixture.id} fixture={fixture}
            state={active.fixtures[fixture.id]}
            selected={fixture.id === selectedFixtureId}
            onSelect={() => onSelectFixture?.(fixture.id === selectedFixtureId ? null : fixture.id)}
            onChange={patch => patchFixture(fixture.id, patch)} />)}
        </div>}
        {!active && <p className="muted">Noch kein Lichtlook — „Look hinzufügen“ anlegen.</p>}
      </fieldset>
    </div>
  </details>;
}

function FixtureLookRow({ fixture, state, selected, onSelect, onChange }: {
  fixture: LightingFixture;
  state?: LightLookFixtureState;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<LightLookFixtureState>) => void;
}) {
  const defaults = builtInFixtureTypes[fixture.typeId];
  const intensity = state?.intensity ?? 100;
  const color = state?.color ?? '#ffe0b3';
  return <div className={`light-look-fixture${selected ? ' is-selected' : ''}`} data-testid={`light-look-fixture-${fixture.id}`}>
    <button type="button" className="quiet fixture-pick" onClick={onSelect} aria-pressed={selected}>
      <strong>{fixture.label}</strong> · {defaults.label}
    </button>
    <div className="lighting-fields">
      <LookNumber label="Intensität (%)" value={intensity} min={0} max={200} step={1} onChange={value => onChange({ intensity: value })} />
      <label>Farbe<input type="color" aria-label={`${fixture.label} Farbe`} value={color}
        onChange={event => onChange({ color: event.target.value })} /></label>
    </div>
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
