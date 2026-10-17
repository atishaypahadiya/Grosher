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

import type { Category, Department, ItemTag, Stop } from "../types.ts";
import { damerauLevenshtein, forms, normalize, similarity, singularize, trigramCounts } from "./text.ts";
import { confirmed, decayed, missed } from "../confidence.ts";

export { normalize, stripQuantity, singularize, similarity, forms } from "./text.ts";
export * from "./llmPrompt.ts";

export type ResolveSource = "exact" | "fuzzy" | "memory" | "category" | "llm" | "unknown";

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
  /** the canonical name the item mapped to ("Greek yogurt") */
  name: string;
  locationId: string;
  brand?: string;
  lastConfirmed: number; // ms epoch
  lastMissed?: number;
  confirms: number;
  misses?: number;
  /** 0..1 under the rules in confidence.ts: "Got it" 30% of the gap toward 1, "Not here" −0.3 (floor 0.05), time decay on read */
  confidence: number;
  tags?: ItemTag[];
  /** every exact string the shopper typed for it ("Chobani greek yogurt"), most recent last */
  typedForms?: string[];
  lastUsed?: number;
}

const TYPED_CAP = 8;
function addTyped(forms: string[] | undefined, typed: string | undefined): string[] | undefined {
  const t = typed?.trim();
  if (!t) return forms;
  // the same form keeps its first spelling and moves to the end
  const same = (forms ?? []).find((f) => normalize(f) === normalize(t));
  const rest = (forms ?? []).filter((f) => normalize(f) !== normalize(t));
  return [...rest, same ?? t].slice(-TYPED_CAP);
}

export interface Suggestion {
  /** the remembered full form to offer ("Chobani greek yogurt") */
  text: string;
  memory: ItemMemory;
}

/**
 * Brand memory: when a shorter or variant form is typed, offer the fullest
 * remembered typed form whose words contain the query ("yogurt" →
 * "Chobani greek yogurt"). Memory only, never the LLM. Nothing is offered
 * when the query already is that form.
 */
export function suggestFromMemory(query: string, memory: ItemMemory[] | undefined): Suggestion | null {
  const q = normalize(query);
  if (!q || !memory?.length) return null;
  const qTokens = singularize(q).split(" ").filter(Boolean);
  // rank: exact word matches before spelling variants, then most recently used, then the fuller form
  let best: { text: string; m: ItemMemory; key: [number, number, number] } | null = null;
  const better = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  for (const m of memory) {
    for (const form of [...(m.typedForms ?? []), m.name]) {
      const f = normalize(form);
      if (f === q) continue;
      const fTokens = singularize(f).split(" ").filter(Boolean);
      if (fTokens.length <= qTokens.length) continue;
      const exact = qTokens.every((t) => fTokens.includes(t));
      const contained = exact || qTokens.every((t) => fTokens.some((ft) => similarity(ft, t) >= 0.85));
      if (!contained) continue;
      const key: [number, number, number] = [exact ? 1 : 0, m.lastUsed ?? m.lastConfirmed, fTokens.length];
      if (!best || better(key, best.key) > 0) best = { text: form, m, key };
    }
  }
  return best ? { text: best.text, memory: best.m } : null;
}

/** What the LLM layer knows: one guess per normalised query, or null when it could not place it. */
export interface LlmGuess {
  /** the shelf category the model chose (Category.id) */
  category: string;
  subcategory?: string;
  tags?: ItemTag[];
  confidence: number; // 0.5..0.7 on the wire
  canonicalName?: string;
}

export interface ResolveContext {
  catalog: Stop[];
  departments?: Department[];
  /** the store's shelf categories: the category layer matches their names and aliases, the llm layer picks among them */
  categories?: Category[];
  /** department id → location ids (the app derives it from fixtures); only a fallback when a guess names no category */
  departmentLocations?: Record<string, string[]>;
  memory?: ItemMemory[];
  /** normalised query → guess (null = asked and not placeable) */
  llm?: Map<string, LlmGuess | null>;
  /** tuned on the fixture; default .72 */
  fuzzyThreshold?: number;
  /** ms epoch for time decay (confidence.ts); default Date.now() */
  now?: number;
}

export const FALLTHROUGH = 0.6;
export const MAX_LLM_LOCATIONS = 6;

const MEMORY_MATCH = 0.9;

export interface Candidate {
  stop: Stop;
  text: string; // normalised singular form
  label: string; // what it was (name or alias)
}

/**
 * Every comparable form of every catalog label, indexed once: exact forms by
 * text, trigram postings for the fuzzy shortlist, word postings for token
 * containment. A catalog of 8,000 items has ~80,000 forms; scoring each one
 * against each query was fine at 30 items and is not now. Cached per catalog
 * array, so the app rebuilds it only when the catalog changes.
 */
export class CandidateIndex {
  readonly list: Candidate[] = [];
  private readonly byText = new Map<string, Candidate>();
  private readonly tri = new Map<string, number[]>();
  private readonly word = new Map<string, number[]>();
  private readonly grams: Map<string, number>[] = [];
  private readonly gramTotal: number[] = [];
  private readonly tokens: string[][] = [];

  constructor(catalog: Stop[]) {
    for (const stop of catalog) {
      const labels = [stop.name, stop.id.replace(/[-_]+/g, " "), ...(stop.aliases ?? [])];
      for (const label of labels) for (const f of forms(label)) this.add({ stop, text: f, label });
    }
  }

  private add(c: Candidate) {
    const i = this.list.length;
    this.list.push(c);
    if (!this.byText.has(c.text)) this.byText.set(c.text, c); // the first (the package catalog comes before pending entries) wins a tie
    const g = trigramCounts(c.text);
    this.grams.push(g);
    let total = 0;
    for (const [gram, n] of g) {
      total += n;
      const post = this.tri.get(gram);
      if (post) post.push(i);
      else this.tri.set(gram, [i]);
    }
    this.gramTotal.push(total);
    const toks = singularize(c.text).split(" ").filter(Boolean);
    this.tokens.push(toks);
    for (const t of new Set(toks)) {
      const post = this.word.get(t);
      if (post) post.push(i);
      else this.word.set(t, [i]);
    }
  }

  get size() {
    return this.list.length;
  }

  exact(text: string): Candidate | undefined {
    return this.byText.get(text);
  }

  /** the best candidate for one query form by max(trigram Dice, edit similarity, token containment); null below `threshold` */
  best(q: string, threshold: number): { c: Candidate; sim: number } | null {
    if (!q) return null;
    const qg = trigramCounts(q);
    let qTotal = 0;
    for (const n of qg.values()) qTotal += n;
    // shared trigram counts over the postings: the fuzzy shortlist
    const shared = new Map<number, number>();
    for (const [gram, n] of qg) {
      const post = this.tri.get(gram);
      if (!post) continue;
      for (const i of post) shared.set(i, Math.min(n, this.grams[i].get(gram) ?? 0) + (shared.get(i) ?? 0));
    }
    let best: { c: Candidate; sim: number } | null = null;
    const consider = (i: number, sim: number) => {
      if (sim >= threshold && (!best || sim > best.sim)) best = { c: this.list[i], sim };
    };
    for (const [i, sh] of shared) {
      const text = this.list[i].text;
      if (text === q) {
        consider(i, 1);
        continue;
      }
      const dice = (2 * sh) / (qTotal + this.gramTotal[i]);
      let sim = dice;
      // edit similarity rescues short typos ("egs" → "eggs") that trigrams undersell; only worth computing near the length
      if (sim < threshold + 0.05 && Math.abs(text.length - q.length) <= 4) sim = Math.max(sim, 1 - damerauLevenshtein(q, text) / Math.max(q.length, text.length));
      consider(i, sim);
    }
    // token containment: the query's words inside a candidate, or a multi-word candidate inside the query
    const qt = singularize(q).split(" ").filter(Boolean);
    if (qt.length) {
      const seen = new Set<number>();
      for (const t of new Set(qt)) {
        for (const i of this.word.get(t) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          consider(i, tokenSimilarityTokens(qt, this.tokens[i]));
        }
      }
    }
    return best;
  }
}

const INDEX_CACHE = new WeakMap<Stop[], CandidateIndex>();

/** the index for a catalog array, built once per array */
export function candidates(catalog: Stop[]): CandidateIndex {
  let idx = INDEX_CACHE.get(catalog);
  if (!idx) {
    idx = new CandidateIndex(catalog);
    INDEX_CACHE.set(catalog, idx);
  }
  return idx;
}

const result = (query: string, partial: Omit<ResolveResult, "query">): ResolveResult => ({ query, ...partial });

function fromStop(query: string, stop: Stop, source: ResolveSource, confidence: number, matched?: string, now = Date.now()): ResolveResult {
  // a pending entry keeps its origin so the UI can show it as a guess
  const src: ResolveSource = stop.source === "llm" ? "llm" : stop.source === "memory" ? "memory" : source;
  return result(query, {
    locationIds: stop.locationIds,
    confidence: Math.min(confidence, decayed(stop, now)),
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

export function exactLayer(query: string, cands: CandidateIndex, now = Date.now()): ResolveResult | null {
  for (const q of forms(query)) {
    const hit = cands.exact(q);
    if (hit) return fromStop(query, hit.stop, "exact", 1, hit.label, now);
  }
  return null;
}

export function fuzzyLayer(query: string, cands: CandidateIndex, threshold: number, now = Date.now()): ResolveResult | null {
  let best: { c: Candidate; sim: number } | null = null;
  for (const q of forms(query)) {
    const b = cands.best(q, threshold);
    if (b && (!best || b.sim > best.sim)) best = b;
  }
  if (!best) return null;
  const confidence = 0.6 + ((best.sim - threshold) / (1 - threshold)) * 0.35;
  return fromStop(query, best.c.stop, "fuzzy", Math.min(0.95, confidence), best.c.label, now);
}

/**
 * Token containment. The query inside the candidate ("yogurt" ⊂ "greek
 * yogurt") always counts. The candidate inside the query counts only when
 * the candidate has at least two words ("greek yogurt" ⊂ "chobani greek
 * yogurt"): a single word with a modifier in front of it ("oat milk" vs
 * "milk") is a different product, and the modifier is the whole point.
 */
function tokenSimilarityTokens(tq: string[], tc: string[]): number {
  if (!tq.length || !tc.length) return 0;
  if (tq.length <= tc.length) {
    if (!tq.every((t) => tc.includes(t))) return 0;
    return 0.6 + 0.4 * (tq.length / tc.length);
  }
  if (tc.length < 2 || !tc.every((t) => tq.includes(t))) return 0;
  return 0.6 + 0.4 * (tc.length / tq.length);
}

export function memoryLayer(query: string, memory: ItemMemory[] | undefined, now = Date.now()): ResolveResult | null {
  if (!memory?.length) return null;
  const qs = forms(query);
  let best: { m: ItemMemory; sim: number } | null = null;
  for (const m of memory) {
    for (const label of [m.name, ...(m.typedForms ?? [])]) {
      for (const mf of forms(label)) {
        for (const q of qs) {
          const sim = similarity(q, mf);
          if (!best || sim > best.sim) best = { m, sim };
        }
      }
    }
  }
  if (!best || best.sim < MEMORY_MATCH) return null;
  return result(query, {
    locationIds: [best.m.locationId],
    confidence: decayed(best.m, now),
    source: "memory",
    canonicalName: best.m.name,
    tags: best.m.tags ?? [],
    matched: best.m.brand,
  });
}

/** Categories as match candidates: the name, the id's words and the aliases, like a catalog entry. */
const CATEGORY_INDEX_CACHE = new WeakMap<Category[], CandidateIndex>();

export function categoryCandidates(categories: Category[] | undefined): CandidateIndex {
  if (!categories?.length) return new CandidateIndex([]);
  let idx = CATEGORY_INDEX_CACHE.get(categories);
  if (!idx) {
    idx = new CandidateIndex(categories.map((c) => ({ id: c.id, name: c.name, locationIds: [c.locationId], aliases: c.aliases, tags: c.tags, department: c.department, subcategory: c.name })));
    CATEGORY_INDEX_CACHE.set(categories, idx);
  }
  return idx;
}

/** likely band: an exact category name or alias is .79, a near-identical spelling scales from .6 */
export const CATEGORY_EXACT = 0.79;
/**
 * Category names and aliases are short and many ("birthday cake", "bath tissue"): the item threshold
 * would turn "birthday card" into cakes. A category matches exactly, by token containment, or at a
 * near-identical spelling only.
 */
export const CATEGORY_FUZZY = 0.9;

/**
 * The category layer: the query names a shelf category rather than a product
 * ("cereal", "tp", "atta"). Its one slot, at likely confidence: the aisle is
 * right, the exact product is not known.
 */
export function categoryLayer(query: string, cands: CandidateIndex, now = Date.now(), mode: "exact" | "fuzzy" | "both" = "both"): ResolveResult | null {
  if (!cands.size) return null;
  const hit = (mode !== "fuzzy" ? exactLayer(query, cands, now) : null) ?? (mode !== "exact" ? fuzzyLayer(query, cands, CATEGORY_FUZZY, now) : null);
  if (!hit) return null;
  const confidence = hit.source === "exact" ? CATEGORY_EXACT : 0.6 + ((hit.confidence - 0.6) / 0.35) * (CATEGORY_EXACT - 0.6);
  return { ...hit, source: "category", confidence: Math.min(CATEGORY_EXACT, Math.max(0.6, confidence)), stopId: undefined, subcategory: hit.canonicalName, canonicalName: titleCase(query) };
}

export function llmLayer(query: string, ctx: ResolveContext): ResolveResult | null {
  const guess = ctx.llm?.get(normalize(query));
  if (!guess) return null;
  const cat = ctx.categories?.find((c) => c.id === guess.category);
  const locs = cat ? [cat.locationId] : (ctx.departmentLocations?.[guess.category] ?? []).slice(0, MAX_LLM_LOCATIONS);
  if (!locs.length) return null;
  return result(query, {
    locationIds: locs,
    confidence: llmConfidence(guess.confidence),
    source: "llm",
    canonicalName: guess.canonicalName ?? titleCase(query),
    tags: guess.tags?.length ? guess.tags : (cat?.tags ?? []),
    department: cat?.department ?? guess.category,
    subcategory: guess.subcategory ?? cat?.name,
  });
}

const titleCase = (s: string) => normalize(s).replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** A fresh llm answer is a guess by nature: the wire's .5–.7 maps onto the guess band, .30–.49, until a "Got it" lifts it. */
export const llmConfidence = (wire: number) => Math.round((0.3 + (Math.max(0.5, Math.min(0.7, wire)) - 0.5) * 0.95) * 1000) / 1000;

// ---------------------------------------------------------------- pipeline

export function resolveItem(query: string, ctx: ResolveContext, cands = candidates(ctx.catalog), catCands = categoryCandidates(ctx.categories)): ResolveResult {
  const threshold = ctx.fuzzyThreshold ?? 0.72;
  const now = ctx.now ?? Date.now();
  // An exact item wins; then what the shopper confirmed; then a sign that names the query outright
  // ("strawberries" is the berries sign before it is a fuzzy "strawberry bagel"); then fuzzy items,
  // then a near-identical category spelling, and the model last.
  const layers: (() => ResolveResult | null)[] = [
    () => exactLayer(query, cands, now),
    () => memoryLayer(query, ctx.memory, now),
    () => categoryLayer(query, catCands, now, "exact"),
    () => fuzzyLayer(query, cands, threshold, now),
    () => categoryLayer(query, catCands, now, "fuzzy"),
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
  const catCands = categoryCandidates(ctx.categories);
  return queries.map((q) => resolveItem(q, ctx, cands, catCands));
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
    query: r.query,
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
    confidence: r.confidence, // the guess band; "Got it" lifts it from here
    source: "llm",
    department: r.department,
    subcategory: r.subcategory,
  };
}

// ---------------------------------------------------------------- memory updates

/** "Got it": confirm count +1, confidence moves half-way to 1; the typed string joins the row's forms. */
export function confirmMemory(memory: ItemMemory[], name: string, locationId: string, now = Date.now(), tags?: ItemTag[], typed?: string): ItemMemory[] {
  const key = normalize(name);
  const i = memory.findIndex((m) => normalize(m.name) === key);
  if (i < 0) return [...memory, { name, locationId, lastConfirmed: now, confirms: 1, confidence: 0.8, tags, typedForms: addTyped(undefined, typed), lastUsed: now }];
  const m = memory[i];
  const next: ItemMemory = { ...confirmed(m, now), locationId, lastUsed: now, tags: tags ?? m.tags, typedForms: addTyped(m.typedForms, typed) };
  return memory.map((x, k) => (k === i ? next : x));
}

/** "Not here": confidence −0.3 (floor 0.05), misses+1; below the fall-through the next trip re-asks. */
export function demoteMemory(memory: ItemMemory[], name: string, now = Date.now()): ItemMemory[] {
  const key = normalize(name);
  return memory.map((m) => (normalize(m.name) === key ? missed(m, now) : m));
}

/** "Pick aisle" / "Tell me where": a confirmed placement by the shopper. */
export function placeMemory(memory: ItemMemory[], name: string, locationId: string, now = Date.now(), tags?: ItemTag[], typed?: string): ItemMemory[] {
  const key = normalize(name);
  const old = memory.find((m) => normalize(m.name) === key);
  const rest = memory.filter((m) => normalize(m.name) !== key);
  return [...rest, { name, locationId, lastConfirmed: now, lastUsed: now, confirms: 1, confidence: 0.9, tags, typedForms: addTyped(old?.typedForms, typed) }];
}
