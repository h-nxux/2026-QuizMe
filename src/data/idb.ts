// Minimal promise wrapper over IndexedDB. When IndexedDB is unavailable (some private modes),
// every call resolves with empty results and the app keeps working from memory for the session.
import type { Collection } from '../domain/types';

const DB_NAME = 'quizme';
const DB_VERSION = 1;
export const STORES: (Collection | 'meta')[] = ['decks', 'cards', 'logs', 'settings', 'meta'];

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        STORES.forEach(name => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbAvailable() {
  return (await open()) !== null;
}

export async function getAll<T>(store: string): Promise<T[]> {
  const db = await open();
  if (!db) return [];
  return new Promise(resolve => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => resolve([]);
  });
}

export async function putMany(store: string, items: unknown[]) {
  if (!items.length) return;
  const db = await open();
  if (!db) return;
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  items.forEach(item => os.put(item));
  await done(tx);
}

export async function clearStores(stores: string[]) {
  const db = await open();
  if (!db) return;
  const tx = db.transaction(stores, 'readwrite');
  stores.forEach(s => tx.objectStore(s).clear());
  await done(tx);
}
