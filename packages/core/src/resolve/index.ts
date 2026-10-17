// Item resolution: a typed item string → shelf locations, in layers.
//
//   a. exact: case / punctuation / quantity / plural-insensitive match on
//      catalog ids, names and aliases
//   b. fuzzy: trigram + Damerau–Levenshtein across names and aliases
//   c. memory: the shopper's own history for this store
//   d. llm: a cached department guess (fetched by the app) → that
//      department's locations
//   e. unknown
//
// First hit wins unless its confidence is below 0.6, then the next layer is
// tried; the llm layer is last, so its guess stands even when weak. Pure: no
// I/O, no async. The app owns fetching and caching.

import type { Department, ItemTag, Stop } from "../types.ts";
import { forms, normalize, similarity, singularize } from "./text.ts";

export { normalize, stripQuantity, singularize, similarity, forms } from "./text.ts";

export type ResolveSource = "exact" | "fuzzy" | "memory" | "llm" | "unknown";

export interface ResolveResult {
  query: string;
  locationIds: string[];
  confidence: number;
  source: ResolveSource;
  canonicalName: string;
  tags: ItemTag[];
  /** the catalog entry matched, when one was */
  stopId?: string;
  /** llm guess detail for the chip: "cereal" */
  department?: string;
  subcategory?: string;
  /** fuzzy: what it matched, for the chip tooltip */
  matched?: string;
}

/** Per-store, per-shopper history of where an item was found. */
export interface ItemMemory {
  name: string; // as typed, normalised on compare
  locationId: string;
  brand?: string;
  lastConfirmed: number; // ms epoch
  confirms: number;
  /** 0..1; "Got it" raises it toward 1, "Not here" lowers it by 0.3 */
  confidence: number;
  tags?: ItemTag[];
}

/** What the LLM layer knows: one guess per normalised query, or null when it could not place it. */
export interface LlmGuess {
  department: string;
  subcategory?: string;
  tags?: ItemTag[];
  confidence: number; // 0.5..0.7
  canonicalName?: string;
}

export interface ResolveContext {
  catalog: Stop[];
  departments?: Department[];
  /** department id → location ids (the app derives it from fixtures) */
  departmentLocations?: Record<string, string[]>;
  memory?: ItemMemory[];
  /** normalised query → guess (null = asked and not placeable) */
  llm?: Map<string, LlmGuess | null>;
  /** tuned on the fixture; default .72 */
  fuzzyThreshold?: number;
}

export const FALLTHROUGH = 0.6;
export const MAX_LLM_LOCATIONS = 6;

const MEMORY_MATCH = 0.9;

interface Candidate {
  stop: Stop;
  text: string; // normalised singular form
  label: string; // what it was (name or alias)
}

function candidates(catalog: Stop[]): Candidate[] {
  const out: Candidate[] = [];
  for (const stop of catalog) {
    const labels = [stop.name, stop.id.replace(/[-_]+/g, " "), ...(stop.aliases ?? [])];
    for (const label of labels) {
      for (const f of forms(label)) out.push({ stop, text: f, label });
    }
  }
  return out;
}

const result = (query: string, partial: Omit<ResolveResult, "query">): ResolveResult => ({ query, ...partial });

function fromStop(query: string, stop: Stop, source: ResolveSource, confidence: number, matched?: string): ResolveResult {
  // a pending entry keeps its origin so the UI can show it as a guess
  const src: ResolveSource = stop.source === "llm" ? "llm" : stop.source === "memory" ? "memory" : source;
  return result(query, {
    locationIds: stop.locationIds,
    confidence: Math.min(confidence, stop.confidence ?? 1),
    source: src,
    canonicalName: stop.name,
    tags: stop.tags ?? [],
    stopId: stop.id,
    department: stop.department,
    subcategory: stop.subcategory,
    matched,
  });
}

// ---------------------------------------------------------------- layers

export function exactLayer(query: string, cands: Candidate[]): ResolveResult | null {
  const qs = forms(query);
  for (const q of qs) {
    const hit = cands.find((c) => c.text === q);
    if (hit) return fromStop(query, hit.stop, "exact", 1, hit.label);
  }
  return null;
}

export function fuzzyLayer(query: string, cands: Candidate[], threshold: number): ResolveResult | null {
  const qs = forms(query);
  let best: { c: Candidate; sim: number } | null = null;
  for (const q of qs) {
    for (const c of cands) {
      // token containment: "greek yogurt" ⊇ "yogurt"; the shorter must be most of the longer
      const sim = Math.max(similarity(q, c.text), tokenSimilarity(q, c.text));
      if (!best || sim > best.sim) best = { c, sim };
    }
  }
  if (!best || best.sim < threshold) return null;
  const confidence = 0.6 + ((best.sim - threshold) / (1 - threshold)) * 0.35;
  return fromStop(query, best.c.stop, "fuzzy", Math.min(0.95, confidence), best.c.label);
}

/**
 * Token containment, one way only: every token of the *query* appears in the
 * candidate ("yogurt" ⊂ "greek yogurt"). A query with extra words ("oat milk"
 * vs "milk") gets nothing here: the modifier is the whole point.
 */
function tokenSimilarity(query: string, cand: string): number {
  const tq = singularize(query).split(" ").filter(Boolean);
  const tc = singularize(cand).split(" ").filter(Boolean);
  if (!tq.length || !tc.length || tq.length > tc.length) return 0;
  if (!tq.every((t) => tc.includes(t))) return 0;
  return 0.6 + 0.4 * (tq.length / tc.length);
}

export function memoryLayer(query: string, memory: ItemMemory[] | undefined): ResolveResult | null {
  if (!memory?.length) return null;
  const qs = forms(query);
  let best: { m: ItemMemory; sim: number } | null = null;
  for (const m of memory) {
    for (const mf of forms(m.name)) {
      for (const q of qs) {
        const sim = similarity(q, mf);
        if (!best || sim > best.sim) best = { m, sim };
      }
    }
  }
  if (!best || best.sim < MEMORY_MATCH) return null;
  return result(query, {
    locationIds: [best.m.locationId],
    confidence: Math.max(0, Math.min(1, best.m.confidence)),
    source: "memory",
    canonicalName: best.m.name,
    tags: best.m.tags ?? [],
    matched: best.m.brand,
  });
}

export function llmLayer(query: string, ctx: ResolveContext): ResolveResult | null {
  const guess = ctx.llm?.get(normalize(query));
  if (!guess) return null;
  const locs = (ctx.departmentLocations?.[guess.department] ?? []).slice(0, MAX_LLM_LOCATIONS);
  if (!locs.length) return null;
  return result(query, {
    locationIds: locs,
    confidence: Math.max(0.5, Math.min(0.7, guess.confidence)),
    source: "llm",
    canonicalName: guess.canonicalName ?? titleCase(query),
    tags: guess.tags ?? [],
    department: guess.department,
    subcategory: guess.subcategory,
  });
}

const titleCase = (s: string) => normalize(s).replace(/\b\p{L}/gu, (c) => c.toUpperCase());

// ---------------------------------------------------------------- pipeline

export function resolveItem(query: string, ctx: ResolveContext, cands = candidates(ctx.catalog)): ResolveResult {
  const threshold = ctx.fuzzyThreshold ?? 0.72;
  const layers: (() => ResolveResult | null)[] = [
    () => exactLayer(query, cands),
    () => fuzzyLayer(query, cands, threshold),
    () => memoryLayer(query, ctx.memory),
    () => llmLayer(query, ctx),
  ];
  let weak: ResolveResult | null = null;
  for (const layer of layers) {
    const r = layer();
    if (!r) continue;
    if (r.confidence >= FALLTHROUGH) return r;
    if (!weak || r.confidence > weak.confidence) weak = r;
  }
  // The llm layer is last: a weak guess from it still beats "unknown" (the UI shows it as a guess).
  if (weak?.source === "llm") return weak;
  // nothing confident: an unknown, but keep the best weak guess's name so the UI can show it
  return result(query, {
    locationIds: [],
    confidence: weak?.confidence ?? 0,
    source: "unknown",
    canonicalName: weak?.canonicalName ?? titleCase(query),
    tags: [],
    department: weak?.department,
    subcategory: weak?.subcategory,
  });
}

export function resolveList(queries: string[], ctx: ResolveContext): ResolveResult[] {
  const cands = candidates(ctx.catalog);
  return queries.map((q) => resolveItem(q, ctx, cands));
}

/** A resolved item as a routable stop. Unknowns have no locations and are not routable. */
export function toStop(r: ResolveResult): Stop | null {
  if (!r.locationIds.length) return null;
  return {
    id: r.stopId ?? `q:${normalize(r.query).replace(/\s+/g, "-")}`,
    name: r.canonicalName,
    locationIds: r.locationIds,
    tags: r.tags.length ? r.tags : undefined,
    confidence: r.confidence,
    source: r.source === "llm" ? "llm" : r.source === "memory" ? "memory" : undefined,
  };
}

/** The pending catalog entry to cache an LLM resolution under, so it resolves offline next time. */
export function pendingEntry(r: ResolveResult): Stop | null {
  if (r.source !== "llm" || !r.locationIds.length) return null;
  return {
    id: `llm:${normalize(r.query).replace(/\s+/g, "-")}`,
    name: r.canonicalName,
    aliases: [r.query],
    locationIds: r.locationIds,
    tags: r.tags.length ? r.tags : undefined,
    confidence: 0.6,
    source: "llm",
    department: r.department,
    subcategory: r.subcategory,
  };
}

// ---------------------------------------------------------------- memory updates

/** "Got it": confirm count +1, confidence moves half-way to 1. */
export function confirmMemory(memory: ItemMemory[], name: string, locationId: string, now = Date.now(), tags?: ItemTag[]): ItemMemory[] {
  const key = normalize(name);
  const i = memory.findIndex((m) => normalize(m.name) === key);
  if (i < 0) return [...memory, { name, locationId, lastConfirmed: now, confirms: 1, confidence: 0.8, tags }];
  const m = memory[i];
  const next: ItemMemory = { ...m, locationId, lastConfirmed: now, confirms: m.confirms + 1, confidence: Math.min(1, m.confidence + (1 - m.confidence) * 0.5), tags: tags ?? m.tags };
  return memory.map((x, k) => (k === i ? next : x));
}

/** "Not here": confidence −0.3; below the fall-through the next trip re-asks. */
export function demoteMemory(memory: ItemMemory[], name: string): ItemMemory[] {
  const key = normalize(name);
  return memory.map((m) => (normalize(m.name) === key ? { ...m, confidence: Math.max(0, m.confidence - 0.3) } : m));
}

/** "Pick aisle" / "Tell me where": a confirmed placement by the shopper. */
export function placeMemory(memory: ItemMemory[], name: string, locationId: string, now = Date.now(), tags?: ItemTag[]): ItemMemory[] {
  const key = normalize(name);
  const rest = memory.filter((m) => normalize(m.name) !== key);
  return [...rest, { name, locationId, lastConfirmed: now, confirms: 1, confidence: 0.9, tags }];
}
