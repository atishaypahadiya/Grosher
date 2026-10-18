// Aisle signs: what a vision model is asked to read off a photo of one, the
// answer's schema and parser (shared by the worker and the app's direct
// Ollama path), and matchSign(), which feeds the words it read through the
// category layer so a sign becomes the store's shelf categories with
// confidences. Survey mode is the caller (apps/web/src/survey).

import type { Category } from "../types.ts";
import { CandidateIndex, CATEGORY_EXACT, CATEGORY_FUZZY, categoryCandidates, exactLayer, fuzzyLayer } from "./index.ts";
import { normalize } from "./text.ts";

export const SIGN_DEFAULT_MODEL = "qwen2.5vl:7b";

export const SIGN_PROMPT = `This is a photo of an aisle sign in a grocery store.
Read every line of text on the sign exactly as printed, top to bottom: the aisle number and each product line.
Do not guess, translate, correct or add words that are not on the sign. Ignore price tags and shelf labels.
Reply with JSON only: {"words":["<line 1>","<line 2>"]}. An empty list if there is no readable sign.`;

export const SIGN_SCHEMA = {
  type: "object",
  properties: { words: { type: "array", items: { type: "string" }, maxItems: 24 } },
  required: ["words"],
} as const;

/** the model's output budget: a sign has a dozen short lines */
export const SIGN_MAX_TOKENS = 200;

/** The model's answer (a JSON string or the parsed object) → the sign's lines, trimmed, capped, deduped. */
export function parseSignWords(raw: unknown): string[] {
  let o = raw;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      throw new Error("sign reading is not JSON");
    }
  }
  const words = (o as { words?: unknown })?.words;
  if (!Array.isArray(words)) throw new Error("sign reading has no words");
  const out: string[] = [];
  for (const w of words) {
    if (typeof w !== "string") continue;
    const s = w.replace(/\s+/g, " ").trim().slice(0, 60);
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= 24) break;
  }
  return out;
}

export interface SignMatch {
  categoryId: string;
  name: string;
  /** the sign group it hangs under in the reference taxonomy */
  group: string;
  department: string;
  confidence: number;
  /** the fragment of the sign that matched */
  word: string;
}

export interface SignGroupMatch {
  /** the sign group of the reference taxonomy ("Asian · Indian · Mediterranean") */
  group: string;
  /** its departments, most categories first */
  department: string;
  confidence: number;
  word: string;
}

export interface SignReading {
  /** the aisle number printed on the sign ("12" → "12"), when there is one */
  aisleNumber?: string;
  matches: SignMatch[];
  /** words that name no category but one of a sign group's headings ("Indian Foods" → Asian · Indian · Mediterranean) */
  groups: SignGroupMatch[];
  /** fragments that named no category */
  unmatched: string[];
}

/** a line as the sign prints it, cut into its product names: "Cereal & Breakfast · Coffee / Tea" → 4 */
export function signFragments(line: string): string[] {
  return line
    .split(/\s*(?:·|•|\/|\||&|,|;|\+|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/** words a sign adds to a heading that no category carries: "Indian Foods" reads as "Indian" */
const GENERIC = /\s+(?:foods?|products?|supplies|items|needs|essentials|section|department|dept\.?)$/i;
const stripGeneric = (s: string) => s.replace(GENERIC, "").trim();

const AISLE_RE = /^(?:aisle|isle|pasillo)?\s*#?\s*([a-z]?\d{1,3}[a-z]?)$/i;

/**
 * A sign's words → the categories they name, through the category layer's own matching (exact name or
 * alias at .79, near-identical spelling from .6). One match per category, the best; sign order kept.
 */
const GROUP_CACHE = new WeakMap<Category[], CandidateIndex>();
/** the sign groups' headings as candidates: "Asian · Indian · Mediterranean" → asian, indian, mediterranean */
function groupCandidates(categories: Category[]): CandidateIndex {
  let idx = GROUP_CACHE.get(categories);
  if (!idx) {
    const groups = [...new Set(categories.map((c) => c.group))];
    idx = new CandidateIndex(groups.map((g) => ({ id: g, name: g, locationIds: [], aliases: g.split(/\s*·\s*/) })));
    GROUP_CACHE.set(categories, idx);
  }
  return idx;
}

export function matchSign(words: string[], categories: Category[]): SignReading {
  const cands = categoryCandidates(categories);
  const groupCands = groupCandidates(categories);
  const groups = new Map<string, SignGroupMatch>();
  const byId = new Map(categories.map((c) => [c.id, c]));
  const matches = new Map<string, SignMatch>();
  const unmatched: string[] = [];
  let aisleNumber: string | undefined;
  for (const line of words) {
    const bare = line.trim();
    const num = bare.match(AISLE_RE);
    if (num) {
      aisleNumber ??= num[1].toUpperCase();
      continue;
    }
    // the whole line first ("Paper Towels"), then its fragments ("Cereal & Breakfast")
    const parts = [bare, ...signFragments(bare)]
      .flatMap((p) => [p, stripGeneric(p)])
      .filter((p, i, a) => p && a.findIndex((q) => normalize(q) === normalize(p)) === i);
    let any = false;
    for (const part of parts) {
      if (!normalize(part) || /^\d+$/.test(normalize(part))) continue;
      const hit = exactLayer(part, cands) ?? fuzzyLayer(part, cands, CATEGORY_FUZZY);
      const cat = hit?.stopId ? byId.get(hit.stopId) : undefined;
      if (!hit || !cat) continue;
      any = true;
      const confidence = hit.source === "exact" ? CATEGORY_EXACT : Math.min(CATEGORY_EXACT, Math.max(0.6, 0.6 + ((hit.confidence - 0.6) / 0.35) * (CATEGORY_EXACT - 0.6)));
      const prev = matches.get(cat.id);
      if (!prev || confidence > prev.confidence) matches.set(cat.id, { categoryId: cat.id, name: cat.name, group: cat.group, department: cat.department, confidence: Math.round(confidence * 1000) / 1000, word: part });
      // a whole line that matched needs no fragments
      if (part === bare) break;
    }
    if (any) continue;
    // no category: a heading of a sign group, at the bottom of the likely band
    for (const part of parts) {
      const g = exactLayer(part, groupCands) ?? fuzzyLayer(part, groupCands, CATEGORY_FUZZY);
      if (!g?.stopId) continue;
      any = true;
      const confidence = g.source === "exact" ? 0.6 : 0.5;
      const prev = groups.get(g.stopId);
      if (!prev || confidence > prev.confidence) groups.set(g.stopId, { group: g.stopId, department: majorityDepartment(categories, g.stopId), confidence, word: part });
      break;
    }
    if (!any) unmatched.push(bare);
  }
  return { aisleNumber, matches: [...matches.values()], groups: [...groups.values()], unmatched };
}

function majorityDepartment(categories: Category[], group: string): string {
  const n = new Map<string, number>();
  for (const c of categories) if (c.group === group) n.set(c.department, (n.get(c.department) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "dry";
}
