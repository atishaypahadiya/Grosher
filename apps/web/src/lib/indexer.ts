// Builds the candidate index for the store's full catalog without blocking
// the list screen: in a Web Worker, with the typed-array parts cached in
// IndexedDB under the catalog's content hash, so the second visit pays a
// lookup, not a build. Where there is no Worker (jsdom) the index builds
// here, synchronously, as before.

import { CandidateIndex, catalogHash, primeIndex, type Stop } from "@grosher/core";
import type { IndexReply, IndexRequest } from "./indexWorker.ts";

export interface IndexResult {
  index: CandidateIndex;
  source: "cache" | "built" | "sync";
  /** wall time on the main thread from request to usable index */
  ms: number;
  /** ms spent in the worker (hash + lookup, or hash + build) */
  workerMs: number;
  hash: string;
}

declare global {
  interface Window {
    /** dev / Playwright readout of the last index build */
    __grosherIndex?: { source: IndexResult["source"]; ms: number; workerMs: number; hash: string; forms: number };
  }
}

const DEV = !!(import.meta.env as { DEV?: boolean }).DEV;

export function buildCandidateIndex(storeId: string, catalog: Stop[]): Promise<IndexResult> {
  const t0 = performance.now();
  const done = (r: IndexResult) => {
    primeIndex(catalog, r.index);
    if (typeof window !== "undefined") window.__grosherIndex = { source: r.source, ms: Math.round(r.ms), workerMs: Math.round(r.workerMs), hash: r.hash, forms: r.index.size };
    if (DEV) console.info(`[index] ${catalog.length} items · ${r.index.size} forms · ${r.source} · ${Math.round(r.ms)} ms (worker ${Math.round(r.workerMs)} ms)`);
    return r;
  };
  if (typeof Worker === "undefined") {
    const index = new CandidateIndex(catalog);
    return Promise.resolve(done({ index, source: "sync", ms: performance.now() - t0, workerMs: 0, hash: catalogHash(catalog) }));
  }
  return new Promise<IndexResult>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./indexWorker.ts", import.meta.url), { type: "module" });
    } catch {
      const index = new CandidateIndex(catalog);
      resolve(done({ index, source: "sync", ms: performance.now() - t0, workerMs: 0, hash: catalogHash(catalog) }));
      return;
    }
    worker.onmessage = (e: MessageEvent<IndexReply>) => {
      worker.terminate();
      try {
        const index = CandidateIndex.fromParts(catalog, e.data.parts);
        resolve(done({ index, source: e.data.source, ms: performance.now() - t0, workerMs: e.data.ms, hash: e.data.hash }));
      } catch {
        const index = new CandidateIndex(catalog);
        resolve(done({ index, source: "sync", ms: performance.now() - t0, workerMs: e.data.ms, hash: e.data.hash }));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      const index = new CandidateIndex(catalog);
      resolve(done({ index, source: "sync", ms: performance.now() - t0, workerMs: 0, hash: catalogHash(catalog) }));
    };
    worker.postMessage({ storeId, catalog } satisfies IndexRequest);
  });
}
