import {
  defaultLightBoardState,
  type LightBoardState,
} from '../../shared/lightBoard.js';

/**
 * Mutable session board for Raumsicht SpotLights.
 * Fader UI updates React locally; the 3D tree reads this in useFrame without re-rendering Pascal.
 */
export type LightBoardLive = {
  get: () => LightBoardState;
  set: (state: LightBoardState) => void;
};

export function createLightBoardLive(initial?: LightBoardState): LightBoardLive {
  let state = initial ?? defaultLightBoardState([]);
  return {
    get: () => state,
    set: next => { state = next; },
  };
}
