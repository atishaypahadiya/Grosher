// A tiny async key-value store on IndexedDB (one object store, "kv"), with an
// in-memory fallback where IndexedDB is missing (tests, private windows that
// block it). Values are JSON-serialisable.

const DB = "grosher";
const STORE = "kv";
const mem = new Map<string, unknown>();

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function dbGet<T>(key: string, fallback: T): Promise<T> {
  const db = await open();
  if (!db) return (mem.has(key) ? (mem.get(key) as T) : fallback);
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result === undefined ? fallback : (req.result as T));
    req.onerror = () => resolve(fallback);
  });
}

export async function dbSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) {
    mem.set(key, value);
    return;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** tests */
export function dbClearMemoryFallback() {
  mem.clear();
}
