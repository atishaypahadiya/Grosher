// Per-store learning state: pending catalog entries (what the LLM resolved),
// the llm answer cache (including "not placeable"), and the shopper's item
// memory. Persisted in IndexedDB; exported with the store package.

import type { ItemMemory, LlmGuess, Stop } from "@grosher/core";
import { dbGet, dbSet } from "./db.ts";

export interface Learning {
  pending: Stop[];
  llm: [string, LlmGuess | null][];
  memory: ItemMemory[];
}

export const EMPTY_LEARNING: Learning = { pending: [], llm: [], memory: [] };
const key = (storeId: string) => `learning:${storeId}`;

export const loadLearning = (storeId: string) => dbGet<Learning>(key(storeId), EMPTY_LEARNING);
export const saveLearning = (storeId: string, l: Learning) => dbSet(key(storeId), l);

/** Package catalog plus pending entries, package first so a real entry always wins. */
export function mergedCatalog(catalog: Stop[], pending: Stop[]): Stop[] {
  const ids = new Set(catalog.map((s) => s.id));
  return [...catalog, ...pending.filter((s) => !ids.has(s.id))];
}
