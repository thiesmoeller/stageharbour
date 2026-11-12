import { useEffect, useMemo, useRef, useState } from 'react';
import {
  newLightLook, type HangPlan, type LightLook, type LightingFixture,
  builtInFixtureTypes, patchFixtureLabel,
} from '../../shared/hangPlan.js';
import {
  boardChannelsDirty,
  channelsFromLook,
  defaultFixtureColor,
  lookFixturesFromChannels,
  resolveFixtureOutput,
  resolveHouseScale,
  type LightBoardChannel,
  type LightBoardState,
} from '../../shared/lightBoard.js';
import type { LightLooksPatch } from './LightLooksPanel.js';
import type { LightBoardLive } from './lightBoardLive.js';

/** Animate blackoutLevel toward a target (session only). */
function useBlackoutAnim(initial = 1, onLevel?: (level: number) => void) {
  const [level, setLevel] = useState(initial);
  const levelRef = useRef(initial);
  const anim = useRef<number | null>(null);
  const onLevelRef = useRef(onLevel);
  onLevelRef.current = onLevel;
  levelRef.current = level;
  function publish(next: number) {
    setLevel(next);
    onLevelRef.current?.(next);
  }
  function go(target: number, ms: number) {
    if (anim.current) cancelAnimationFrame(anim.current);
    if (ms <= 0) { publish(target); return; }
    const start = performance.now();
    const from = levelRef.current;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      publish(from + (target - from) * t);
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

/**
 * Session light board: masters, blackout, per-fixture on/level/colour.
 * When `live` is set, levels are written there for useFrame SpotLight updates
 * so StageView need not re-render on every fader tick.
 */
export function useLightBoard(
  fixtures: readonly LightingFixture[],
  activeLook?: LightLook,
  live?: LightBoardLive,
) {
  const ids = useMemo(() => fixtures.map(fixture => fixture.id), [fixtures]);
  const idKey = ids.join(',');
  const [master, setMasterState] = useState(1);
  const [houseMaster, setHouseMasterState] = useState(1);
  const [channels, setChannels] = useState<Record<string, LightBoardChannel>>({});
  const seeded = useRef(false);
  const liveRef = useRef(live);
  liveRef.current = live;
  const masterRef = useRef(master);
  masterRef.current = master;
  const houseRef = useRef(houseMaster);
  houseRef.current = houseMaster;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const blackoutLevelRef = useRef(1);

  function pushLive(
    blackoutLevel = blackoutLevelRef.current,
    nextChannels = channelsRef.current,
    nextMaster = masterRef.current,
    nextHouse = houseRef.current,
  ) {
    liveRef.current?.set({
      master: nextMaster,
      houseMaster: nextHouse,
      blackoutLevel,
      channels: nextChannels,
    });
  }

  const blackout = useBlackoutAnim(1, level => {
    blackoutLevelRef.current = level;
    pushLive(level);
  });

  const lookId = activeLook?.id;

  useEffect(() => {
    if (!ids.length) return;
    if (!seeded.current) {
      seeded.current = true;
      const seededChannels = channelsFromLook(activeLook, ids);
      setChannels(seededChannels);
      channelsRef.current = seededChannels;
      pushLive(1, seededChannels, 1, 1);
      return;
    }
    setChannels(prior => {
      const next: Record<string, LightBoardChannel> = {};
      for (const id of ids) {
        next[id] = prior[id] ?? { on: true, level: 100, color: defaultFixtureColor };
      }
      channelsRef.current = next;
      pushLive(blackoutLevelRef.current, next);
      return next;
    });
  // blackoutLevelRef / pushLive are stable enough; activeLook only for first seed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, ids]);

  const dirty = boardChannelsDirty(channels, activeLook, ids);

  const state: LightBoardState = {
    master,
    houseMaster,
    blackoutLevel: blackout.level,
    channels,
  };

  function setMaster(value: number) {
    masterRef.current = value;
    setMasterState(value);
    pushLive(blackoutLevelRef.current, channelsRef.current, value, houseRef.current);
  }

  function setHouseMaster(value: number) {
    houseRef.current = value;
    setHouseMasterState(value);
    pushLive(blackoutLevelRef.current, channelsRef.current, masterRef.current, value);
  }

  function patchChannel(id: string, patch: Partial<LightBoardChannel>) {
    setChannels(prior => {
      const base = prior[id] ?? { on: true, level: 100, color: defaultFixtureColor };
      const next = { ...prior, [id]: { ...base, ...patch } };
      channelsRef.current = next;
      pushLive(blackoutLevelRef.current, next);
      return next;
    });
  }

  return {
    state,
    dirty,
    master,
    houseMaster,
    setMaster,
    setHouseMaster,
    blackout,
    isOn(id: string) {
      return channels[id]?.on !== false;
    },
    level(id: string) {
      return channels[id]?.level ?? 100;
    },
    color(id: string) {
      return channels[id]?.color ?? defaultFixtureColor;
    },
    setLevel(id: string, level: number) {
      patchChannel(id, { level });
    },
    setColor(id: string, color: string) {
      patchChannel(id, { color });
    },
    toggle(id: string) {
      setChannels(prior => {
        const base = prior[id] ?? { on: true, level: 100, color: defaultFixtureColor };
        const next = { ...prior, [id]: { ...base, on: !base.on } };
        channelsRef.current = next;
        pushLive(blackoutLevelRef.current, next);
        return next;
      });
    },
    allOn() {
      setChannels(prior => {
        const next = Object.fromEntries(ids.map(id => {
          const base = prior[id] ?? { on: true, level: 100, color: defaultFixtureColor };
          return [id, { ...base, on: true }];
        }));
        channelsRef.current = next;
        pushLive(blackoutLevelRef.current, next);
        return next;
      });
    },
    allOff() {
      setChannels(prior => {
        const next = Object.fromEntries(ids.map(id => {
          const base = prior[id] ?? { on: true, level: 100, color: defaultFixtureColor };
          return [id, { ...base, on: false }];
        }));
        channelsRef.current = next;
        pushLive(blackoutLevelRef.current, next);
        return next;
      });
    },
    solo(idsOn: readonly string[]) {
      const allow = new Set(idsOn);
      setChannels(prior => {
        const next = Object.fromEntries(ids.map(id => {
          const base = prior[id] ?? { on: true, level: 100, color: defaultFixtureColor };
          return [id, { ...base, on: allow.has(id) }];
        }));
        channelsRef.current = next;
        pushLive(blackoutLevelRef.current, next);
        return next;
      });
    },
    loadLook() {
      const next = channelsFromLook(activeLook, ids);
      channelsRef.current = next;
      setChannels(next);
      setMaster(1);
      blackout.restoreFast();
      pushLive(1, next, 1, houseRef.current);
    },
    saveToLook(looks: readonly LightLook[], onChange?: (patch: LightLooksPatch) => void) {
      if (!onChange) return;
      let list = [...looks];
      let active = activeLook ?? list.find(look => look.id === lookId) ?? list[0];
      if (!active) {
        active = newLightLook(crypto.randomUUID(), 'Look 1');
        list = [active];
      }
      const next: LightLook = {
        ...active,
        fixtures: {
          ...active.fixtures,
          ...lookFixturesFromChannels(channels),
        },
      };
      onChange({
        lightLooks: list.map(look => look.id === next.id ? next : look),
        activeLightLookId: next.id,
      });
    },
    fixtureOutput(id: string) {
      return resolveFixtureOutput(state, id);
    },
    houseScale() {
      return resolveHouseScale(state);
    },
  };
}

export type LightBoardApi = ReturnType<typeof useLightBoard>;

/** Owns board React state so fader ticks do not re-render the 3D StageView. */
export function LightBoardHost({ hangPlan, live, activeLook, selectedFixtureId, onSelectFixture, looks, canSaveLook, onLightLooksChange, onHangPlanChange }: {
  hangPlan: HangPlan;
  live: LightBoardLive;
  activeLook?: LightLook;
  selectedFixtureId?: string | null;
  onSelectFixture?: (id: string | null, additive?: boolean) => void;
  looks: readonly LightLook[];
  canSaveLook?: boolean;
  onLightLooksChange?: (patch: LightLooksPatch) => void;
  onHangPlanChange?: (plan: HangPlan) => void;
}) {
  const board = useLightBoard(hangPlan.fixtures, activeLook, live);
  return <LightBoardPanel
    hangPlan={hangPlan}
    board={board}
    selectedFixtureId={selectedFixtureId}
    onSelectFixture={onSelectFixture}
    looks={looks}
    activeLook={activeLook}
    canSaveLook={canSaveLook}
    onLoadLook={() => board.loadLook()}
    onSaveLook={() => board.saveToLook(looks, onLightLooksChange)}
    onHangPlanChange={onHangPlanChange}
  />;
}

/** Preview panel under the 3D view — session faders, not a console. */
export function LightBoardPanel({ hangPlan, board, selectedFixtureId, onSelectFixture, looks, activeLook, canSaveLook, onSaveLook, onLoadLook, onHangPlanChange }: {
  hangPlan: HangPlan;
  board: LightBoardApi;
  selectedFixtureId?: string | null;
  onSelectFixture?: (id: string | null, additive?: boolean) => void;
  looks: readonly LightLook[];
  activeLook?: LightLook;
  canSaveLook?: boolean;
  onSaveLook?: () => void;
  onLoadLook?: () => void;
  onHangPlanChange?: (plan: HangPlan) => void;
}) {
  const fixtures = hangPlan.fixtures;
  if (!fixtures.length) return null;
  const blacked = board.blackout.level < 0.02;
  const lookHint = activeLook
    ? `${activeLook.name}${board.dirty ? ' · geändert' : ''}`
    : 'Vorschau · Rechtsklick = Solo';
  const canRename = !!onHangPlanChange;
  return <div className="light-board" data-testid="light-board" role="region" aria-label="Lichtpult Vorschau"
    title="Vorschau · Rechtsklick = Solo · Bezeichnung am Hang · In Look speichern schreibt Intensität/Farbe">
    <div className="light-board-channels" role="group" aria-label="Scheinwerfer Fader">
      {fixtures.map(fixture => {
        const on = board.isOn(fixture.id);
        const level = board.level(fixture.id);
        const selected = fixture.id === selectedFixtureId;
        const typeLabel = builtInFixtureTypes[fixture.typeId].label;
        return <div key={fixture.id}
          className={`light-board-channel${on ? ' is-on' : ''}${selected ? ' is-selected' : ''}`}
          data-testid={`light-board-channel-${fixture.id}`}>
          <button type="button" className="light-board-on"
            aria-pressed={on}
            aria-label={`${fixture.label} ${on ? 'an' : 'aus'}`}
            onClick={event => {
              if (event.shiftKey || event.ctrlKey || event.metaKey) {
                onSelectFixture?.(fixture.id, true);
                board.toggle(fixture.id);
                return;
              }
              onSelectFixture?.(fixture.id, false);
              board.toggle(fixture.id);
            }}
            onContextMenu={event => {
              event.preventDefault();
              onSelectFixture?.(fixture.id, false);
              board.solo([fixture.id]);
            }} />
          <label className="light-board-channel-fader">
            <span className="sr-only">{fixture.label} Intensität</span>
            <input type="range" min={0} max={200} step={1} value={level}
              aria-label={`${fixture.label} Intensität`}
              onChange={event => board.setLevel(fixture.id, Number(event.target.value))}
              onFocus={() => onSelectFixture?.(fixture.id, false)} />
            <span>{level} %</span>
          </label>
          <input type="color" value={board.color(fixture.id)} aria-label={`${fixture.label} Farbe`}
            onChange={event => board.setColor(fixture.id, event.target.value)} />
          {canRename
            ? <input className="light-board-name" type="text" maxLength={120} value={fixture.label}
              aria-label={`${fixture.label} Bezeichnung`}
              title={`${fixture.label} · ${typeLabel}`}
              onFocus={() => onSelectFixture?.(fixture.id, false)}
              onChange={event => onHangPlanChange(patchFixtureLabel(hangPlan, fixture.id, event.target.value))} />
            : <button type="button" className="quiet light-board-label"
              aria-pressed={selected}
              title={`${fixture.label} · ${typeLabel}`}
              onClick={() => onSelectFixture?.(selected ? null : fixture.id, false)}>
              {fixture.label}
            </button>}
          <span className="light-board-type">{typeLabel}</span>
        </div>;
      })}
    </div>
    <div className="light-board-sep" aria-hidden="true" />
    <div className="light-board-masters" role="group" aria-label="Master">
      <label className="light-board-master">
        <span className="light-board-master-title">Master</span>
        <input type="range" min={0} max={100} step={1} value={Math.round(board.master * 100)}
          aria-label="Scheinwerfer Master"
          onChange={event => board.setMaster(Number(event.target.value) / 100)} />
        <span>{Math.round(board.master * 100)} %</span>
      </label>
      <label className="light-board-master">
        <span className="light-board-master-title">Grundlicht</span>
        <input type="range" min={0} max={100} step={1} value={Math.round(board.houseMaster * 100)}
          aria-label="Grundlicht Master"
          onChange={event => board.setHouseMaster(Number(event.target.value) / 100)} />
        <span>{Math.round(board.houseMaster * 100)} %</span>
      </label>
    </div>
    <div className="light-board-sep" aria-hidden="true" />
    <div className="light-board-cmds">
      <div className="light-board-actions" role="group" aria-label="Blackout und Schaltung">
        <button type="button" className={`quiet${blacked ? ' is-latched' : ''}`} aria-pressed={blacked}
          onClick={() => blacked ? board.blackout.restoreFast() : board.blackout.blackoutFast()}>
          {blacked ? 'Auf' : 'Blackout'}
        </button>
        <button type="button" className="quiet" onClick={() => board.blackout.blackoutSlow()}>BO langsam</button>
        <button type="button" className="quiet" onClick={() => board.allOn()}>Alle an</button>
        <button type="button" className="quiet" onClick={() => board.allOff()}>Alle aus</button>
        <button type="button" className="quiet" disabled={!selectedFixtureId}
          onClick={() => selectedFixtureId && board.solo([selectedFixtureId])}
          title="Nur das ausgewählte Licht an">Solo</button>
      </div>
      <div className="light-board-sep light-board-sep-h" aria-hidden="true" />
      <div className="light-board-look" role="group" aria-label="Look laden und speichern">
        <button type="button" className="quiet" onClick={onLoadLook ?? (() => board.loadLook())}
          disabled={!activeLook && !looks.length}>Look laden</button>
        <button type="button" className="quiet" disabled={!canSaveLook || !board.dirty}
          onClick={onSaveLook}>In Look speichern{board.dirty ? ' ·' : ''}</button>
        <span className="muted light-board-look-name">{lookHint}</span>
      </div>
    </div>
  </div>;
}
