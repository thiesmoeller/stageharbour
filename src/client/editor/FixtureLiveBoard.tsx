import { useEffect, useMemo, useState } from 'react';
import type { HangPlan, LightingFixture } from '../../shared/hangPlan.js';
import { builtInFixtureTypes } from '../../shared/hangPlan.js';

/** Session live board for Einrichten: which Scheinwerfer are on (full) vs off. Not saved. */
export function useFixtureLiveBoard(fixtures: readonly LightingFixture[]) {
  const ids = useMemo(() => fixtures.map(fixture => fixture.id), [fixtures]);
  const idKey = ids.join(',');
  const [onById, setOnById] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOnById(prior => {
      const next: Record<string, boolean> = {};
      for (const id of ids) next[id] = prior[id] ?? true;
      return next;
    });
  }, [idKey, ids]);

  function isOn(id: string) {
    return onById[id] !== false;
  }

  return {
    isOn,
    toggle(id: string) {
      setOnById(prior => ({ ...prior, [id]: !(prior[id] !== false) }));
    },
    allOn() {
      setOnById(Object.fromEntries(ids.map(id => [id, true])));
    },
    allOff() {
      setOnById(Object.fromEntries(ids.map(id => [id, false])));
    },
    /** Only these fixtures on (full) — typical solo / few-light focus. */
    solo(idsOn: readonly string[]) {
      const allow = new Set(idsOn);
      setOnById(Object.fromEntries(ids.map(id => [id, allow.has(id)])));
    },
  };
}

export type FixtureLiveBoardApi = ReturnType<typeof useFixtureLiveBoard>;

/** Switch strip: Alle an / Alle aus / Solo, plus per-fixture toggles. */
export function FixtureLiveBoard({ hangPlan, selectedFixtureId, onSelectFixture, live }: {
  hangPlan: HangPlan;
  selectedFixtureId?: string | null;
  onSelectFixture?: (id: string | null, additive?: boolean) => void;
  live: FixtureLiveBoardApi;
}) {
  const fixtures = hangPlan.fixtures;
  if (!fixtures.length) return null;
  return <div className="fixture-live-board" data-testid="fixture-live-board">
    <div className="fixture-live-board-head">
      <strong>Einrichten</strong>
      <span>Selektive Schaltung · An = voll · Hang bleibt</span>
    </div>
    <div className="fixture-live-board-actions" role="group" aria-label="Alle Scheinwerfer">
      <button type="button" className="quiet" onClick={() => live.allOn()}>Alle an</button>
      <button type="button" className="quiet" onClick={() => live.allOff()}>Alle aus</button>
      <button type="button" className="quiet" disabled={!selectedFixtureId}
        onClick={() => selectedFixtureId && live.solo([selectedFixtureId])}
        title="Nur das ausgewählte Licht an">Solo Auswahl</button>
    </div>
    <div className="fixture-live-switches" role="group" aria-label="Scheinwerfer einzeln">
      {fixtures.map(fixture => {
        const on = live.isOn(fixture.id);
        const selected = fixture.id === selectedFixtureId;
        const type = builtInFixtureTypes[fixture.typeId];
        return <button key={fixture.id} type="button"
          className={`fixture-live-switch${on ? ' is-on' : ''}${selected ? ' is-selected' : ''}`}
          aria-pressed={on}
          aria-label={`${fixture.label} ${on ? 'an' : 'aus'}`}
          title={`${fixture.label} · ${type.label}`}
          onClick={event => {
            if (event.shiftKey || event.ctrlKey || event.metaKey) {
              onSelectFixture?.(fixture.id, true);
              live.toggle(fixture.id);
              return;
            }
            onSelectFixture?.(fixture.id, false);
            live.toggle(fixture.id);
          }}
          onContextMenu={event => {
            event.preventDefault();
            onSelectFixture?.(fixture.id, false);
            live.solo([fixture.id]);
          }}>
          <span className="fixture-live-dot" aria-hidden />
          {fixture.label}
        </button>;
      })}
    </div>
    <p className="muted">Rechtsklick = Solo. Shift+Klick = umschalten ohne Solo. Ausrichtung/Klappen am Hang · Looks nur Stimmung.</p>
  </div>;
}
