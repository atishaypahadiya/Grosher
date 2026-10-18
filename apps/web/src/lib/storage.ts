// localStorage with every access guarded: private windows and cleared site
// data make it throw or come back empty, and the app must work regardless.
// Values are versioned and validated (persist.ts): a corrupt or unknown one is
// quarantined and the caller gets its fallback, so stored state never crashes a render.

import { quarantineLocal, unwrap, wrap } from "./persist.ts";

export function load<T>(key: string, fallback: T): T {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantineLocal(key, raw, "not JSON");
    return fallback;
  }
  const r = unwrap<T>(key, parsed);
  if (!r.ok) {
    quarantineLocal(key, raw, r.reason);
    return fallback;
  }
  if (r.upgraded) save(key, r.data);
  return r.data;
}

export function save(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(wrap(key, value)));
  } catch {
    // ignore: storage unavailable
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore: storage unavailable
  }
}
