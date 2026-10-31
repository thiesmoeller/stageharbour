import { createSeedSnapshot } from './seed.js';
import { parseSnapshot, serializeSnapshot, type LocalSnapshot } from './snapshot.js';

const DB_NAME = 'stageharbour-local';
const STORE_NAME = 'snapshot';
const SNAPSHOT_KEY = 'current';
const DB_VERSION = 1;

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB-Anfrage fehlgeschlagen.'));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB konnte nicht geöffnet werden.'));
  });
}

async function readPersisted(db: IDBDatabase): Promise<LocalSnapshot | undefined> {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const raw = await idbRequest(tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY));
  if (raw === undefined) return undefined;
  return parseSnapshot(raw);
}

async function writePersisted(db: IDBDatabase, snapshot: LocalSnapshot): Promise<void> {
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await idbRequest(tx.objectStore(STORE_NAME).put(serializeSnapshot(snapshot), SNAPSHOT_KEY));
}

export type LocalStore = {
  getSnapshot(): LocalSnapshot;
  replaceSnapshot(snapshot: LocalSnapshot): Promise<void>;
  resetToSeed(): Promise<LocalSnapshot>;
  mutate(update: (draft: LocalSnapshot) => void): Promise<LocalSnapshot>;
};

export async function openLocalStore(): Promise<LocalStore> {
  const db = await openDb();
  let cache = await readPersisted(db);
  if (!cache) {
    cache = createSeedSnapshot();
    await writePersisted(db, cache);
  }

  async function persist(next: LocalSnapshot): Promise<LocalSnapshot> {
    const saved = serializeSnapshot(next);
    cache = saved;
    await writePersisted(db, saved);
    return saved;
  }

  return {
    getSnapshot() {
      return structuredClone(cache!);
    },
    async replaceSnapshot(snapshot) {
      await persist(parseSnapshot(snapshot));
    },
    async resetToSeed() {
      return persist(createSeedSnapshot());
    },
    async mutate(update) {
      const draft = structuredClone(cache!);
      update(draft);
      return persist(draft);
    },
  };
}
