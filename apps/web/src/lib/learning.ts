// Per-store learning state: pending catalog entries (what the LLM resolved),
// the llm answer cache (including "not placeable"), and the shopper's item
// memory. Persisted in IndexedDB; exported with the store package.

import { categoryCandidates, categoryLayer, LLM_ANSWERS_VERSION, normalize, type Category, type ItemMemory, type LlmGuess, type Stop } from "@grosher/core";
import { dbGet, dbSet } from "./db.ts";

export interface Learning {
  pending: Stop[];
  llm: [string, LlmGuess | null][];
  memory: ItemMemory[];
  /** what the stored model answers mean (core LLM_ANSWERS_VERSION); absent = 1, department ids */
  llmVersion?: number;
}

export const EMPTY_LEARNING: Learning = { pending: [], llm: [], memory: [], llmVersion: LLM_ANSWERS_VERSION };
const key = (storeId: string) => `learning:${storeId}`;

export const loadLearning = (storeId: string) => dbGet<Learning>(key(storeId), EMPTY_LEARNING);
export const saveLearning = (storeId: string, l: Learning) => dbSet(key(storeId), l);

/** Package catalog plus pending entries, package first so a real entry always wins. */
export function mergedCatalog(catalog: Stop[], pending: Stop[]): Stop[] {
  const ids = new Set(catalog.map((s) => s.id));
  return [...catalog, ...pending.filter((s) => !ids.has(s.id))];
}

export interface RevalidateReport {
  /** saved guesses re-placed through their category / left to ask (no location on this map) */
  pendingRemapped: string[];
  pendingAsk: string[];
  memoryRemapped: string[];
  /** memory rows kept as they are, but pointing nowhere on this map: they resolve as "needs a place" */
  memoryAsk: string[];
  /** model answers naming a category this store does not have: dropped, so the item is asked again */
  llmDropped: string[];
  /** model guesses saved under an older answer version and confirmed at most once: asked again */
  guessesRequeued: string[];
  /** memory rows that only mirror such a guess (one "Got it" on the trip): removed, they were never placed */
  memoryFromGuess: string[];
}

/**
 * The learning state against the active map, on every load: a saved location the map no longer has (a map
 * regenerated or edited since) is re-placed through the category its shelf name names, else its item asks
 * again. Nothing the shopper made is deleted; their lists are names and are never touched.
 */
export function revalidateLearning(saved: Learning, ref: { locations: ReadonlySet<string>; categories: Category[]; departments?: string[] }, now = Date.now()): { learning: Learning; report: RevalidateReport; changed: boolean } {
  let l = saved;
  const report: RevalidateReport = { pendingRemapped: [], pendingAsk: [], memoryRemapped: [], memoryAsk: [], llmDropped: [], guessesRequeued: [], memoryFromGuess: [] };
  // answers from an older prompt (version 1 named departments, and an aisle picked by department landed
  // non-grocery items in dry goods): unconfirmed or once-confirmed model guesses are asked again under the
  // current prompt, with the memory rows a single "Got it" made of them; twice-confirmed ones stay
  if ((l.llmVersion ?? 1) < LLM_ANSWERS_VERSION) {
    const requeued = l.pending.filter((p) => p.source === "llm" && (p.confirms ?? 0) < 2);
    const keys = new Set(requeued.map((p) => normalize(p.name)));
    const loc = new Map(requeued.map((p) => [normalize(p.name), new Set(p.locationIds)]));
    report.guessesRequeued = requeued.map((p) => p.name);
    const memoryKept = l.memory.filter((m) => {
      const k = normalize(m.name);
      const mirror = keys.has(k) && (m.confirms ?? 0) <= 1 && (loc.get(k)?.has(m.locationId) || !ref.locations.has(m.locationId));
      if (mirror) report.memoryFromGuess.push(m.name);
      return !mirror;
    });
    l = { pending: l.pending.filter((p) => !requeued.includes(p)), memory: memoryKept, llm: [], llmVersion: LLM_ANSWERS_VERSION };
  }
  const cats = categoryCandidates(ref.categories);
  const place = (names: (string | undefined)[]): string | null => {
    for (const n of names) {
      if (!n) continue;
      const hit = categoryLayer(n, cats, now, "exact");
      const loc = hit?.locationIds.find((x) => ref.locations.has(x));
      if (loc) return loc;
    }
    return null;
  };
  const pending = l.pending.map((p) => {
    const known = p.locationIds.filter((x) => ref.locations.has(x));
    if (known.length === p.locationIds.length) return p;
    if (known.length) return { ...p, locationIds: known };
    const loc = place([p.subcategory, p.name]);
    (loc ? report.pendingRemapped : report.pendingAsk).push(p.name);
    return { ...p, locationIds: loc ? [loc] : [] };
  });
  const memory = l.memory.map((m) => {
    if (ref.locations.has(m.locationId)) return m;
    const loc = place([m.name]);
    if (!loc) {
      report.memoryAsk.push(m.name);
      return m;
    }
    report.memoryRemapped.push(m.name);
    // a re-placed memory is a guess again until the shopper confirms it
    return { ...m, locationId: loc, confidence: Math.min(m.confidence, 0.49) };
  });
  // with categories, only a category id is an answer (a department id places nothing any more)
  const known = new Set(ref.categories.length ? ref.categories.map((c) => c.id) : (ref.departments ?? []));
  const llm = l.llm.filter(([q, g]) => {
    if (!g || known.has(g.category)) return true;
    report.llmDropped.push(q);
    return false;
  });
  const versioned = l.llmVersion !== undefined && l.llmVersion !== saved.llmVersion;
  const changed = versioned || report.pendingRemapped.length + report.pendingAsk.length + report.memoryRemapped.length + report.llmDropped.length > 0;
  return { learning: changed ? { pending, memory, llm, llmVersion: LLM_ANSWERS_VERSION } : l, report, changed };
}
