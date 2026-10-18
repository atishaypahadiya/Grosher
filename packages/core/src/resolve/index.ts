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
export * from "./sign.ts";

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
  /**
   * A prebuilt index over a larger catalog (the app's 47,000-row file, built in a worker) searched before
   * `catalog`'s own index; `catalog` then holds only the rows that change (base rows, pending entries).
   */
  index?: CandidateIndex;
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
/**
 * The index in flat, transferable parts: strings arrays and typed arrays
 * (postings in CSR form). Structured-clones into IndexedDB, transfers
 * from a worker, and `CandidateIndex.fromParts` rebuilds the index in
 * tens of milliseconds instead of the second a build takes.
 */
export interface IndexParts {
  version: 1;
  texts: string[];
  labels: string[];
  /** per form: index of its stop in the catalog array */
  stopIdx: Int32Array;
  gramKeys: string[];
  gramOffsets: Int32Array;
  gramData: Int32Array;
  wordKeys: string[];
  wordOffsets: Int32Array;
  wordData: Int32Array;
  gramCount: Uint8Array;
}

/** the buffers to hand postMessage so the parts move instead of copying */
export const transferablesOf = (p: IndexParts): ArrayBuffer[] => [p.stopIdx, p.gramOffsets, p.gramData, p.wordOffsets, p.wordData, p.gramCount].map((a) => a.buffer as ArrayBuffer);

/** cyrb53 over ids, names and aliases: the cache key of an index */
export function catalogHash(catalog: Stop[]): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const mix = (str: string) => {
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
  };
  for (const s of catalog) {
    mix(s.id);
    mix("\u0001");
    mix(s.name);
    mix("\u0001");
    for (const a of s.aliases ?? []) {
      mix(a);
      mix("\u0002");
    }
    mix(s.locationIds.join(","));
    mix("\n");
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${catalog.length}-${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

/** CSR postings: the ids with the key `k` are data[offsets[k] .. offsets[k+1]) */
interface Postings {
  ids: Map<string, number>;
  offsets: Int32Array;
  data: Int32Array;
}

function csr(keys: string[], lists: number[][]): Postings {
  const offsets = new Int32Array(lists.length + 1);
  let total = 0;
  lists.forEach((l, k) => {
    offsets[k] = total;
    total += l.length;
  });
  offsets[lists.length] = total;
  const data = new Int32Array(total);
  lists.forEach((l, k) => data.set(l, offsets[k]));
  return { ids: new Map(keys.map((key, k) => [key, k])), offsets, data };
}

export class CandidateIndex {
  private readonly texts: string[];
  private readonly labels: string[];
  private readonly stopIdx: Int32Array;
  private readonly catalog: Stop[];
  private readonly byText = new Map<string, number>();
  private readonly grams: Postings;
  private readonly words: Postings;
  /** per form: how many distinct trigrams it has */
  private readonly gramCount: Uint8Array;

  constructor(catalog: Stop[], parts?: IndexParts) {
    this.catalog = catalog;
    const p = parts ?? CandidateIndex.build(catalog);
    this.texts = p.texts;
    this.labels = p.labels;
    this.stopIdx = p.stopIdx;
    this.gramCount = p.gramCount;
    this.grams = { ids: new Map(p.gramKeys.map((k, i) => [k, i])), offsets: p.gramOffsets, data: p.gramData };
    this.words = { ids: new Map(p.wordKeys.map((k, i) => [k, i])), offsets: p.wordOffsets, data: p.wordData };
    // the first form with a text wins a tie (the package catalog comes before pending entries)
    for (let i = 0; i < this.texts.length; i++) if (!this.byText.has(this.texts[i])) this.byText.set(this.texts[i], i);
  }

  /** an index from parts built elsewhere (a worker, the cache) */
  static fromParts(catalog: Stop[], parts: IndexParts): CandidateIndex {
    if (parts.version !== 1 || parts.stopIdx.length !== parts.texts.length) throw new Error("index parts do not fit");
    return new CandidateIndex(catalog, parts);
  }

  /** the slow part, ~1 s for 47,000 items: every comparable form of every label, and the postings */
  static build(catalog: Stop[]): IndexParts {
    const texts: string[] = [];
    const labels: string[] = [];
    const stopIdx: number[] = [];
    const counts: number[] = [];
    const gramKeys: string[] = [];
    const gramLists: number[][] = [];
    const gramId = new Map<string, number>();
    const wordKeys: string[] = [];
    const wordLists: number[][] = [];
    const wordId = new Map<string, number>();
    catalog.forEach((stop, si) => {
      const seen = new Set<string>();
      for (const label of [stop.name, stop.id.replace(/[-_]+/g, " "), ...(stop.aliases ?? [])]) {
        for (const f of forms(label)) {
          if (seen.has(f)) continue; // one item's own repeat forms ("Eggs" and its alias "eggs") count once
          seen.add(f);
          const i = texts.length;
          texts.push(f);
          labels.push(label);
          stopIdx.push(si);
          let n = 0;
          for (const gram of trigramCounts(f).keys()) {
            n++;
            let g = gramId.get(gram);
            if (g === undefined) {
              g = gramKeys.length;
              gramId.set(gram, g);
              gramKeys.push(gram);
              gramLists.push([]);
            }
            gramLists[g].push(i);
          }
          counts.push(Math.min(255, n));
          for (const t of new Set(singularize(f).split(" ").filter(Boolean))) {
            let w = wordId.get(t);
            if (w === undefined) {
              w = wordKeys.length;
              wordId.set(t, w);
              wordKeys.push(t);
              wordLists.push([]);
            }
            wordLists[w].push(i);
          }
        }
      }
    });
    const g = csr(gramKeys, gramLists);
    const w = csr(wordKeys, wordLists);
    return { version: 1, texts, labels, stopIdx: Int32Array.from(stopIdx), gramKeys, gramOffsets: g.offsets, gramData: g.data, wordKeys, wordOffsets: w.offsets, wordData: w.data, gramCount: Uint8Array.from(counts) };
  }

  /** the parts, for a cache or a postMessage (the typed arrays are the live ones: transfer only after the last use here) */
  toParts(): IndexParts {
    const keysOf = (p: Postings) => {
      const keys = new Array<string>(p.ids.size);
      for (const [k, i] of p.ids) keys[i] = k;
      return keys;
    };
    return { version: 1, texts: this.texts, labels: this.labels, stopIdx: this.stopIdx, gramKeys: keysOf(this.grams), gramOffsets: this.grams.offsets, gramData: this.grams.data, wordKeys: keysOf(this.words), wordOffsets: this.words.offsets, wordData: this.words.data, gramCount: this.gramCount };
  }

  get size() {
    return this.texts.length;
  }

  private candidate(i: number): Candidate {
    return { stop: this.catalog[this.stopIdx[i]], text: this.texts[i], label: this.labels[i] };
  }

  exact(text: string): Candidate | undefined {
    const i = this.byText.get(text);
    return i === undefined ? undefined : this.candidate(i);
  }

  /** the best candidate for one query form by max(trigram Dice, edit similarity, token containment); null below `threshold` */
  best(q: string, threshold: number): { c: Candidate; sim: number } | null {
    if (!q) return null;
    // trigrams as a set (repeats are rare in product names): Dice = 2·shared / (|q| + |form|)
    const qGrams = [...trigramCounts(q).keys()];
    const shared = new Map<number, number>();
    for (const gram of qGrams) {
      const g = this.grams.ids.get(gram);
      if (g === undefined) continue;
      const end = this.grams.offsets[g + 1];
      for (let k = this.grams.offsets[g]; k < end; k++) {
        const i = this.grams.data[k];
        shared.set(i, (shared.get(i) ?? 0) + 1);
      }
    }
    let best: { i: number; sim: number } | null = null;
    const consider = (i: number, sim: number) => {
      if (sim >= threshold && (!best || sim > best.sim)) best = { i, sim };
    };
    for (const [i, sh] of shared) {
      const text = this.texts[i];
      if (text === q) {
        consider(i, 1);
        continue;
      }
      let sim = (2 * sh) / (qGrams.length + this.gramCount[i]);
      // edit similarity rescues short typos ("egs" → "eggs") that trigrams undersell; only worth computing near the length
      if (sim < threshold + 0.05 && Math.abs(text.length - q.length) <= 4) sim = Math.max(sim, 1 - damerauLevenshtein(q, text) / Math.max(q.length, text.length));
      consider(i, sim);
    }
    // token containment: the query's words inside a candidate, or a multi-word candidate inside the query
    const qt = singularize(q).split(" ").filter(Boolean);
    if (qt.length) {
      const seen = new Set<number>();
      for (const t of new Set(qt)) {
        const w = this.words.ids.get(t);
        if (w === undefined) continue;
        const end = this.words.offsets[w + 1];
        for (let k = this.words.offsets[w]; k < end; k++) {
          const i = this.words.data[k];
          if (seen.has(i)) continue;
          seen.add(i);
          consider(i, tokenSimilarityTokens(qt, singularize(this.texts[i]).split(" ").filter(Boolean)));
        }
      }
    }
    return best ? { c: this.candidate((best as { i: number }).i), sim: (best as { sim: number }).sim } : null;
  }
}

const INDEX_CACHE = new WeakMap<Stop[], CandidateIndex>();

/** the index for a catalog array, built once per array (synchronously: the app primes big ones from a worker) */
export function candidates(catalog: Stop[]): CandidateIndex {
  let idx = INDEX_CACHE.get(catalog);
  if (!idx) {
    idx = new CandidateIndex(catalog);
    INDEX_CACHE.set(catalog, idx);
  }
  return idx;
}

/** register an index built elsewhere for this catalog array, so `candidates()` never builds it here */
export function primeIndex(catalog: Stop[], index: CandidateIndex): void {
  INDEX_CACHE.set(catalog, index);
}

/** is there an index for this array already? */
export const hasIndex = (catalog: Stop[]) => INDEX_CACHE.has(catalog);

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

export function exactLayer(query: string, cands: CandidateIndex | CandidateIndex[], now = Date.now()): ResolveResult | null {
  const list = Array.isArray(cands) ? cands : [cands];
  for (const q of forms(query)) {
    for (const idx of list) {
      const hit = idx.exact(q);
      if (hit) return fromStop(query, hit.stop, "exact", 1, hit.label, now);
    }
  }
  return null;
}

export function fuzzyLayer(query: string, cands: CandidateIndex | CandidateIndex[], threshold: number, now = Date.now()): ResolveResult | null {
  const list = Array.isArray(cands) ? cands : [cands];
  let best: { c: Candidate; sim: number } | null = null;
  for (const q of forms(query)) {
    for (const idx of list) {
      const b = idx.best(q, threshold);
      if (b && (!best || b.sim > best.sim)) best = b;
    }
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

export function resolveItem(query: string, ctx: ResolveContext, own = candidates(ctx.catalog), catCands = categoryCandidates(ctx.categories)): ResolveResult {
  const cands = ctx.index ? [ctx.index, own] : own;
  const threshold = ctx.fuzzyThreshold ?? 0.72;
  const now = ctx.now ?? Date.now();
  // An exact item wins, unless the shopper's own memory is about that very item: a memory row exists only
  // because they said "Got it" or placed it, and a seeded catalog can be wrong about a shelf. Then memory
  // for anything else; then a sign that names the query outright ("strawberries" is the berries sign
  // before it is a fuzzy "strawberry bagel"); then fuzzy items, a near-identical category spelling, and
  // the model last.
  const sameItem = (a: ResolveResult, b: ResolveResult) => normalize(a.canonicalName) === normalize(b.canonicalName) || a.locationIds[0] === b.locationIds[0];
  const layers: (() => ResolveResult | null)[] = [
    () => {
      const ex = exactLayer(query, cands, now);
      const mem = ex && memoryLayer(query, ctx.memory, now);
      return mem && mem.confidence >= FALLTHROUGH && sameItem(mem, ex) ? mem : ex;
    },
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
  const own = candidates(ctx.catalog);
  const catCands = categoryCandidates(ctx.categories);
  return queries.map((q) => resolveItem(q, ctx, own, catCands));
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
