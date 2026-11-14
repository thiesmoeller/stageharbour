import { createSeedSnapshot } from './seed.js';
import { parseSnapshot, serializeSnapshot, type LocalSnapshot } from './snapshot.js';
import { localDatabaseName } from './storageScope.js';

/** Unscoped name from before / and /preview/ were isolated — read once to migrate. */
const LEGACY_DB_NAME = 'stageharbour-local';
const STORE_NAME = 'snapshot';
const SNAPSHOT_KEY = 'current';
const DB_VERSION = 1;

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB-Anfrage fehlgeschlagen.'));
  });
}

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB konnte nicht geöffnet werden.'));
  });
}

/** Copy the old shared database when this deployment's scoped one is still empty. */
async function readLegacySnapshot(): Promise<LocalSnapshot | undefined> {
  if (localDatabaseName() === LEGACY_DB_NAME) return undefined;
  try {
    const db = await openDb(LEGACY_DB_NAME);
    try { return await readPersisted(db); }
    finally { db.close(); }
  } catch {
    // A newer /preview/ snapshot or a missing legacy DB must not block this site.
    return undefined;
  }
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
  const db = await openDb(localDatabaseName());
  let cache = await readPersisted(db);
  if (!cache) {
    // Prefer a readable legacy snapshot over a fresh seed so people who already
    // used the shared Pages database keep their work on the first open of either site.
    cache = await readLegacySnapshot() ?? createSeedSnapshot();
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
