import type { LightLook, LightLookFixtureState } from './hangPlan.js';

/** Default warm Scheinwerfer colour when a look has no entry. */
export const defaultFixtureColor = '#ffe0b3';

/**
 * Session channel for one Scheinwerfer on the preview board.
 * Not a cue / playback — levels live until “In Look speichern”.
 */
export type LightBoardChannel = {
  on: boolean;
  /** 0–200, same scale as light-look intensity. */
  level: number;
  color: string;
};

/**
 * Session light board state for Raumsicht preview.
 * Output priority (product language): blackout × master × (on ? level : 0).
 */
export type LightBoardState = {
  /** 0–1 overall fixture master. */
  master: number;
  /** 0–1 scales Grundlicht (front/back/ambient). */
  houseMaster: number;
  /** 1 = full output, 0 = blackout (may animate). */
  blackoutLevel: number;
  channels: Readonly<Record<string, LightBoardChannel>>;
};

export type FixtureBoardOutput = {
  intensity: number;
  color: string;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampLevel(value: number): number {
  return Math.max(0, Math.min(200, value));
}

/** Fixture output for SpotLights / mesh glow. Off or blackout → intensity 0. */
export function resolveFixtureOutput(
  board: LightBoardState,
  fixtureId: string,
): FixtureBoardOutput {
  const channel = board.channels[fixtureId];
  const color = channel?.color ?? defaultFixtureColor;
  if (!channel || !channel.on) return { intensity: 0, color };
  const intensity = clamp01(board.blackoutLevel) * clamp01(board.master) * clampLevel(channel.level);
  return { intensity, color };
}

/** Scale factor for Grundlicht (theatre fill). Blackout dims the house too. */
export function resolveHouseScale(board: LightBoardState): number {
  return clamp01(board.blackoutLevel) * clamp01(board.houseMaster);
}

/** Build channels from a light look (missing fixtures → on at 100%). */
export function channelsFromLook(
  look: LightLook | undefined,
  fixtureIds: readonly string[],
): Record<string, LightBoardChannel> {
  const next: Record<string, LightBoardChannel> = {};
  for (const id of fixtureIds) {
    const state = look?.fixtures[id];
    next[id] = {
      on: true,
      level: clampLevel(state?.intensity ?? 100),
      color: state?.color ?? defaultFixtureColor,
    };
  }
  return next;
}

/** All fixtures on at full — typical setup / focus start. */
export function channelsAllOn(fixtureIds: readonly string[]): Record<string, LightBoardChannel> {
  return Object.fromEntries(fixtureIds.map(id => [id, {
    on: true,
    level: 100,
    color: defaultFixtureColor,
  } satisfies LightBoardChannel]));
}

/** Snapshot board channels into light-look fixture states (for “In Look speichern”). */
export function lookFixturesFromChannels(
  channels: Readonly<Record<string, LightBoardChannel>>,
): Record<string, LightLookFixtureState> {
  const fixtures: Record<string, LightLookFixtureState> = {};
  for (const [id, channel] of Object.entries(channels)) {
    fixtures[id] = {
      intensity: channel.on ? clampLevel(channel.level) : 0,
      color: channel.color,
    };
  }
  return fixtures;
}

/** True when board levels/colours differ from the look (or look missing an on channel). */
export function boardChannelsDirty(
  channels: Readonly<Record<string, LightBoardChannel>>,
  look: LightLook | undefined,
  fixtureIds: readonly string[],
): boolean {
  for (const id of fixtureIds) {
    const channel = channels[id];
    if (!channel) continue;
    const state = look?.fixtures[id];
    const lookLevel = state?.intensity ?? 100;
    const lookColor = state?.color ?? defaultFixtureColor;
    const effective = channel.on ? channel.level : 0;
    if (effective !== lookLevel || channel.color !== lookColor) return true;
  }
  return false;
}

export function defaultLightBoardState(
  fixtureIds: readonly string[],
  look?: LightLook,
): LightBoardState {
  return {
    master: 1,
    houseMaster: 1,
    blackoutLevel: 1,
    channels: look ? channelsFromLook(look, fixtureIds) : channelsAllOn(fixtureIds),
  };
}
