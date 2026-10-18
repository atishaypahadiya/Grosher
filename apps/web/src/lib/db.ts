// A tiny async key-value store on IndexedDB (one object store, "kv"), with an
// in-memory fallback where IndexedDB is missing (tests, private windows that
// block it). Values are structured-clonable, versioned and validated (persist.ts):
// a value that cannot be read moves to quarantine:<key>:<time> and the caller
// gets its fallback.

import { QUARANTINE_DB, quarantineWarning, unwrap, wrap } from "./persist.ts";

const DB = "grosher";
const STORE = "kv";
const mem = new Map<string, unknown>();

let connection: Promise<IDBDatabase | null> | null = null;

/** one connection, reopened after the error plate's reset deletes the database (versionchange closes it) */
function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  connection ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        db.onclose = () => {
          connection = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        connection = null;
        resolve(null);
      };
    } catch {
      connection = null;
      resolve(null);
    }
  });
  return connection;
}

async function rawGet(key: string): Promise<unknown> {
  const db = await open();
  if (!db) return mem.get(key);
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function rawSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) {
    if (value === undefined) mem.delete(key);
    else mem.set(key, value);
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      if (value === undefined) tx.objectStore(STORE).delete(key);
      else tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function dbGet<T>(key: string, fallback: T): Promise<T> {
  const stored = await rawGet(key);
  if (stored === undefined) return fallback;
  const r = unwrap<T>(key, stored);
  if (!r.ok) {
    quarantineWarning(key, r.reason);
    await rawSet(`${QUARANTINE_DB}${key}:${Date.now()}`, stored);
    await rawSet(key, undefined);
    return fallback;
  }
  if (r.upgraded) await rawSet(key, wrap(key, r.data));
  return r.data;
}

export async function dbSet(key: string, value: unknown): Promise<void> {
  return rawSet(key, value === undefined ? undefined : wrap(key, value));
}

/** every key in the store (the error plate's export, tests) */
export async function dbKeys(): Promise<string[]> {
  const db = await open();
  if (!db) return [...mem.keys()];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String));
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** tests: a bare value, as a build before the envelopes wrote it */
export const dbSetRaw = (key: string, value: unknown) => rawSet(key, value);

/** tests */
export function dbClearMemoryFallback() {
  mem.clear();
}
