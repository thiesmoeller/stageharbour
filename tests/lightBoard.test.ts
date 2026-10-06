import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { newLightLook } from '../src/shared/hangPlan.js';
import {
  boardChannelsDirty,
  channelsAllOn,
  channelsFromLook,
  defaultFixtureColor,
  defaultLightBoardState,
  lookFixturesFromChannels,
  resolveFixtureOutput,
  resolveHouseScale,
  type LightBoardState,
} from '../src/shared/lightBoard.js';

const a = randomUUID();
const b = randomUUID();

function board(patch: Partial<LightBoardState> & { channels: LightBoardState['channels'] }): LightBoardState {
  return {
    master: 1,
    houseMaster: 1,
    blackoutLevel: 1,
    ...patch,
  };
}

test('fixture output is blackout × master × level when on', () => {
  const state = board({
    master: 0.5,
    blackoutLevel: 0.8,
    channels: { [a]: { on: true, level: 100, color: '#ff0000' } },
  });
  assert.deepEqual(resolveFixtureOutput(state, a), { intensity: 40, color: '#ff0000' });
});

test('off channel yields zero intensity regardless of level and masters', () => {
  const state = board({
    master: 1,
    blackoutLevel: 1,
    channels: { [a]: { on: false, level: 200, color: defaultFixtureColor } },
  });
  assert.equal(resolveFixtureOutput(state, a).intensity, 0);
});

test('blackout zeros every fixture and house scale', () => {
  const state = board({
    blackoutLevel: 0,
    houseMaster: 1,
    channels: { [a]: { on: true, level: 100, color: defaultFixtureColor } },
  });
  assert.equal(resolveFixtureOutput(state, a).intensity, 0);
  assert.equal(resolveHouseScale(state), 0);
});

test('house scale is blackout × houseMaster only', () => {
  assert.equal(resolveHouseScale(board({
    blackoutLevel: 0.5,
    houseMaster: 0.4,
    channels: {},
  })), 0.2);
});

test('missing channel is dark with default colour', () => {
  const out = resolveFixtureOutput(board({ channels: {} }), a);
  assert.deepEqual(out, { intensity: 0, color: defaultFixtureColor });
});

test('channelsFromLook fills missing fixtures at 100% on', () => {
  const look = newLightLook(randomUUID(), 'Warm');
  look.fixtures[a] = { intensity: 40, color: '#aabbcc' };
  const channels = channelsFromLook(look, [a, b]);
  assert.deepEqual(channels[a], { on: true, level: 40, color: '#aabbcc' });
  assert.deepEqual(channels[b], { on: true, level: 100, color: defaultFixtureColor });
});

test('lookFixturesFromChannels stores off as intensity 0', () => {
  const fixtures = lookFixturesFromChannels({
    [a]: { on: false, level: 80, color: '#112233' },
    [b]: { on: true, level: 50, color: '#445566' },
  });
  assert.deepEqual(fixtures[a], { intensity: 0, color: '#112233' });
  assert.deepEqual(fixtures[b], { intensity: 50, color: '#445566' });
});

test('boardChannelsDirty compares effective levels to the look', () => {
  const look = newLightLook(randomUUID());
  look.fixtures[a] = { intensity: 100, color: defaultFixtureColor };
  const clean = channelsFromLook(look, [a]);
  assert.equal(boardChannelsDirty(clean, look, [a]), false);
  assert.equal(boardChannelsDirty({ [a]: { on: true, level: 50, color: defaultFixtureColor } }, look, [a]), true);
  assert.equal(boardChannelsDirty({ [a]: { on: false, level: 100, color: defaultFixtureColor } }, look, [a]), true);
});

test('channelsAllOn and defaultLightBoardState start ready for focus', () => {
  assert.deepEqual(channelsAllOn([a])[a], { on: true, level: 100, color: defaultFixtureColor });
  const state = defaultLightBoardState([a]);
  assert.equal(state.master, 1);
  assert.equal(state.houseMaster, 1);
  assert.equal(state.blackoutLevel, 1);
  assert.equal(state.channels[a]!.on, true);
});
