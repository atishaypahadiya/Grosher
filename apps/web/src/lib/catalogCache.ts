// The full catalog, cached when it is derived. Grosher's 47,612 rows are the demo's catalog re-shelved onto
// Grosher's categories at load time (packages/stores/src/carry.ts); doing that, then hashing the result for
// the index cache, on every load cost ~150 ms warm. A bundle with a `catalogKey` (the source catalog's hash,
// the store's shelves and re-home table, the store version: grosher/carry.json) is cached here under that key,
// rows and all, and the index is looked up by the same key (indexer.ts), so a warm load does neither.

import type { Stop } from "@grosher/core";
import type { StoreBundle } from "@grosher/stores";
import { dbGet, dbSet } from "./db.ts";

export const catalogCacheKey = (storeId: string) => `catalog:${storeId}`;

interface Cached {
  key: string;
  rows: Stop[];
}

export interface FullCatalog {
  rows: Stop[];
  /** the bundle's catalogKey, when it has one: the index is cached under it */
  key?: string;
  source: "cache" | "loaded";
}

export async function loadFullCatalog(bundle: StoreBundle): Promise<FullCatalog> {
  const key = bundle.catalogKey;
  if (!key) return { rows: await bundle.loadCatalog(), source: "loaded" };
  const storeId = bundle.store.storeId;
  const hit = await dbGet<Cached | null>(catalogCacheKey(storeId), null).catch(() => null);
  if (hit && hit.key === key && Array.isArray(hit.rows) && hit.rows.length) return { rows: hit.rows, key, source: "cache" };
  const rows = await bundle.loadCatalog();
  // written behind the first load; a failed write only means the next load derives it again
  void dbSet(catalogCacheKey(storeId), { key, rows } satisfies Cached).catch(() => {});
  return { rows, key, source: "loaded" };
}
