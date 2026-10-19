// The candidate index for a big catalog, built off the main thread. The
// main thread posts the catalog rows; this worker hashes them, returns the
// cached parts from IndexedDB when the hash matches (warm), else builds the
// index, caches the parts and returns them (cold). Parts transfer, they do
// not copy. db.ts works here: IndexedDB is available to workers.

import { CandidateIndex, catalogHash, transferablesOf, type IndexParts, type Stop } from "@grosher/core";
import { dbGet, dbSet } from "./db.ts";

export interface IndexRequest {
  storeId: string;
  catalog: Stop[];
  /** the catalog's known identity (a bundle's catalogKey): used as the cache hash instead of hashing the rows */
  key?: string;
}

export interface IndexReply {
  hash: string;
  source: "cache" | "built";
  parts: IndexParts;
  /** ms inside the worker: the hash, the lookup, the build */
  ms: number;
}

interface Cached {
  hash: string;
  parts: IndexParts;
}

export const cacheKey = (storeId: string) => `index:${storeId}`;

self.onmessage = async (e: MessageEvent<IndexRequest>) => {
  const t0 = performance.now();
  const { storeId, catalog, key } = e.data;
  const hash = key ?? catalogHash(catalog);
  const cached = await dbGet<Cached | null>(cacheKey(storeId), null);
  if (cached && cached.hash === hash && cached.parts?.version === 1 && cached.parts.stopIdx.length === cached.parts.texts.length) {
    const reply: IndexReply = { hash, source: "cache", parts: cached.parts, ms: performance.now() - t0 };
    (self as unknown as Worker).postMessage(reply, transferablesOf(cached.parts));
    return;
  }
  const parts = CandidateIndex.build(catalog);
  // the cache gets its own copy: the live arrays transfer to the main thread right after
  await dbSet(cacheKey(storeId), { hash, parts: structuredClone(parts) } satisfies Cached);
  const reply: IndexReply = { hash, source: "built", parts, ms: performance.now() - t0 };
  (self as unknown as Worker).postMessage(reply, transferablesOf(parts));
};
