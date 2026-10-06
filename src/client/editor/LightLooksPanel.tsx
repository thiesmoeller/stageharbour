import {
  builtInFixtureTypes, newLightLook, type HangPlan, type LightLook,
} from '../../shared/hangPlan.js';

export type LightLooksPatch = {
  lightLooks: LightLook[];
  activeLightLookId?: string;
};

/** Look list management — intensity/colour live on the session light board. */
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

  return <details className="lighting-panel light-looks-panel" data-testid="light-looks-panel">
    <summary>Lichtlook{active ? ` · ${active.name}` : ''}</summary>
    <div className="lighting-controls">
      <p>{onChange
        ? 'Looks speichern Intensität und Farbe. Pegel stellen Sie im Lichtpult unter der Raumsicht; Ausrichtung gehört zum Hang.'
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
        {active && <ul className="light-look-fixtures" aria-label="Scheinwerfer im Look">
          {fixtures.map(fixture => {
            const state = active.fixtures[fixture.id];
            const type = builtInFixtureTypes[fixture.typeId];
            const selected = fixture.id === selectedFixtureId;
            return <li key={fixture.id} className={selected ? 'is-selected' : ''} data-testid={`light-look-fixture-${fixture.id}`}>
              <button type="button" className="quiet fixture-pick"
                aria-pressed={selected}
                onClick={() => onSelectFixture?.(fixture.id === selectedFixtureId ? null : fixture.id)}>
                <strong>{fixture.label}</strong> · {type.label}
                <span className="muted"> · {state?.intensity ?? 100} % · {state?.color ?? '#ffe0b3'}</span>
              </button>
            </li>;
          })}
        </ul>}
        {!active && <p className="muted">Noch kein Lichtlook — „Look hinzufügen“ anlegen.</p>}
      </fieldset>
    </div>
  </details>;
}
