const memory = new Map<string, ArrayBuffer>();
const DB_NAME = 'stageharbour-blobs';
const STORE = 'blobs';

function openBlobs(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Blob-Speicher konnte nicht geöffnet werden.'));
  });
}

export async function putLocalBlob(key: string, bytes: ArrayBuffer): Promise<void> {
  const copy = bytes.slice(0);
  memory.set(key, copy);
  if (typeof indexedDB === 'undefined') return;
  const db = await openBlobs();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(copy, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Blob konnte nicht gespeichert werden.'));
    });
  } finally { db.close(); }
}

export async function getLocalBlob(key: string): Promise<ArrayBuffer | undefined> {
  const cached = memory.get(key);
  if (cached) return cached;
  if (typeof indexedDB === 'undefined') return undefined;
  const db = await openBlobs();
  try {
    const stored = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as ArrayBuffer | undefined);
      request.onerror = () => reject(request.error ?? new Error('Blob konnte nicht gelesen werden.'));
    });
    if (stored) memory.set(key, stored);
    return stored;
  } finally { db.close(); }
}
