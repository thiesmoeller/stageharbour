import {
  defaultLightBoardState,
  type LightBoardState,
} from '../../shared/lightBoard.js';

/**
 * Mutable session board for Raumsicht SpotLights.
 * Fader UI updates React locally; the 3D tree reads this in useFrame without re-rendering, and
 * subscribes so a canvas that only draws on demand draws the new levels.
 */
export type LightBoardLive = {
  get: () => LightBoardState;
  set: (state: LightBoardState) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createLightBoardLive(initial?: LightBoardState): LightBoardLive {
  let state = initial ?? defaultLightBoardState([]);
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: next => {
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
