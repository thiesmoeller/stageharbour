import { setApiTransport, type ApiTransport } from '../api.js';
import { isLocalMode } from './mode.js';
import { openLocalStore, type LocalStore } from './store.js';
import { createLocalTransport } from './transport.js';

/** Call once LocalTransport exists; no-op when not in local mode. */
export function installLocalModeWhenReady(transport: ApiTransport): void {
  if (!isLocalMode()) return;
  setApiTransport(transport);
}

let localStore: LocalStore | undefined;
let localModeReady: Promise<void> = Promise.resolve();

if (isLocalMode()) {
  localModeReady = (async () => {
    const store = await openLocalStore();
    localStore = store;
    installLocalModeWhenReady(createLocalTransport(store));
  })();
}

/** Resolves after IndexedDB store + LocalTransport are installed (or immediately when not local). */
export function awaitLocalMode(): Promise<void> {
  return localModeReady;
}

/** Active IndexedDB-backed store. Throws if not in local mode or boot has not finished. */
export function getLocalStore(): LocalStore {
  if (!isLocalMode()) throw new Error('LocalStore is only available in local mode.');
  if (!localStore) throw new Error('LocalStore is not ready yet. Await awaitLocalMode() first.');
  return localStore;
}
