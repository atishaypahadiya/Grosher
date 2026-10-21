// Cook mode: dishes in, a shopping list out. Pure: the data (the dish table, the ingredients and how each is sold)
// lives in @grosher/stores, the model's answers come from the app, and everything here is arithmetic.
//
//   dishes ──match (exact, then the resolver's fuzzy similarity)──▶ table dishes      unknown dishes ──▶ the model
//   each dish's ingredients (per 2 servings) ──scale by people / 2──▶ base units (g, ml or pieces, the ingredient's own)
//   ──merge the same ingredient across dishes──▶ ──round up to what the store sells (whole packs, pieces, bunches)──▶ lines
//
// Every model ingredient is validated: a name and a known unit or it is dropped; a quantity outside its category's
// bounds for two servings is clamped to them; both are reported, never silent.

import { normalize, similarity, singularize } from "../resolve/text.ts";

/** the units a recipe line may use */
export const UNITS = ["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "piece", "clove", "bunch", "can", "slice", "pinch"] as const;
export type RawUnit = (typeof UNITS)[number];

/** what an ingredient is measured in once it is in the cart */
export type Base = "g" | "ml" | "count";

export const MEAL_CATEGORIES = ["produce", "herbs", "aromatics", "grains", "pulses", "dairy", "protein", "eggs", "spices", "oils", "condiments", "canned", "bakery", "frozen", "nuts", "sweet", "other"] as const;
export type MealCategory = (typeof MEAL_CATEGORIES)[number];

/** how the store sells it */
export type BuyRule =
  /** by the piece: "Onions × 6" */
  | { kind: "count" }
  /** in packs of these sizes (in the base unit): "Toor dal 500 g", "Paneer 2 × 200 g" */
  | { kind: "pack"; sizes: number[] }
  /** loose, by weight, in steps: "Carrots 500 g" */
  | { kind: "loose"; step: number };

export interface IngredientInfo {
  key: string;
  /** how it reads on the list (and resolves on the shelf): "Toor dal", "Onions" */
  name: string;
  category: MealCategory;
  aliases?: string[];
  /** salt, oil, the common spices: "You probably have", unticked */
  pantry?: boolean;
  base: Base;
  /** grams in one piece (count ↔ g) */
  eachG?: number;
  /** grams per millilitre (ml ↔ g) */
  density?: number;
  /** pieces per buying unit when a recipe counts something smaller: garlic cloves per bulb, bread slices per loaf */
  partsPerUnit?: number;
  /** grams in one bunch (herbs, leafy greens sold by the bunch) */
  bunchG?: number;
  buy: BuyRule;
}

export interface DishIngredient {
  key: string;
  qty: number;
  unit: RawUnit;
  optional?: boolean;
}

export interface Dish {
  id: string;
  name: string;
  aliases?: string[];
  cuisine: "indian" | "global";
  /** the ingredients without which it is not this dish (the coverage test checks they are listed) */
  core: string[];
  /** for two servings */
  items: DishIngredient[];
}

/** upper bounds for two servings, per category, in each base unit (a model answer past them is clamped) */
export const BOUNDS: Record<MealCategory, Record<Base, number>> = {
  produce: { g: 1500, ml: 500, count: 12 },
  herbs: { g: 150, ml: 100, count: 3 },
  aromatics: { g: 150, ml: 60, count: 4 },
  grains: { g: 600, ml: 750, count: 12 },
  pulses: { g: 400, ml: 500, count: 3 },
  dairy: { g: 800, ml: 1200, count: 6 },
  protein: { g: 900, ml: 500, count: 8 },
  eggs: { g: 600, ml: 300, count: 12 },
  spices: { g: 40, ml: 60, count: 6 },
  oils: { g: 550, ml: 600, count: 2 },
  condiments: { g: 400, ml: 400, count: 4 },
  canned: { g: 1600, ml: 1600, count: 4 },
  bakery: { g: 800, ml: 0, count: 12 },
  frozen: { g: 800, ml: 800, count: 6 },
  nuts: { g: 200, ml: 250, count: 4 },
  sweet: { g: 300, ml: 300, count: 4 },
  other: { g: 1000, ml: 1000, count: 12 },
};

const ML: Partial<Record<RawUnit, number>> = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 240, pinch: 0.4 };
const G: Partial<Record<RawUnit, number>> = { g: 1, kg: 1000 };
/** grams per millilitre when an ingredient does not say (a spoon of spice is light, a cup of rice heavy) */
/** grams in "a piece" when an ingredient sold by weight does not say (a knob of ginger, a pod or a stick of spice) */
const EACH: Partial<Record<MealCategory, number>> = { aromatics: 30, spices: 1, herbs: 10, produce: 150 };
const DENSITY: Partial<Record<MealCategory, number>> = { spices: 0.5, grains: 0.8, pulses: 0.85, sweet: 0.85, nuts: 0.6, dairy: 1.03, oils: 0.92, condiments: 1.1, canned: 1 };

/** normalise a unit word ("Tbsp", "cloves", "grams", "pcs") to a RawUnit, or null */
export function unitOf(word: unknown): RawUnit | null {
  if (typeof word !== "string") return null;
  const w = word.trim().toLowerCase().replace(/\.$/, "");
  const map: Record<string, RawUnit> = {
    g: "g", gm: "g", gms: "g", gram: "g", grams: "g", kg: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg",
    ml: "ml", millilitre: "ml", milliliter: "ml", millilitres: "ml", milliliters: "ml", l: "l", litre: "l", liter: "l", litres: "l", liters: "l",
    tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", cup: "cup", cups: "cup",
    piece: "piece", pieces: "piece", pcs: "piece", pc: "piece", whole: "piece", each: "piece", unit: "piece", units: "piece", "": "piece", count: "piece",
    clove: "clove", cloves: "clove", bunch: "bunch", bunches: "bunch", can: "can", cans: "can", tin: "can", tins: "can", slice: "slice", slices: "slice", pinch: "pinch", pinches: "pinch",
  };
  return map[w] ?? null;
}

/** a recipe quantity in the ingredient's base unit; null when the units cannot meet (grams of something sold only by the bunch with no weight) */
export function toBase(info: IngredientInfo, qty: number, unit: RawUnit): number | null {
  if (!(qty > 0) || !Number.isFinite(qty)) return null;
  const density = info.density ?? DENSITY[info.category] ?? 1;
  const asG = (): number | null => {
    if (G[unit]) return qty * G[unit]!;
    if (ML[unit]) return qty * ML[unit]! * density;
    if (unit === "piece") return info.eachG || EACH[info.category] ? qty * (info.eachG ?? EACH[info.category]!) : null;
    if (unit === "clove") return info.eachG && info.partsPerUnit ? (qty * info.eachG) / info.partsPerUnit : qty * 5;
    if (unit === "bunch") return info.bunchG ? qty * info.bunchG : null;
    if (unit === "can") return qty * 400;
    if (unit === "slice") return info.eachG && info.partsPerUnit ? (qty * info.eachG) / info.partsPerUnit : qty * 30;
    return null;
  };
  if (info.base === "g") return asG();
  if (info.base === "ml") {
    if (ML[unit]) return qty * ML[unit]!;
    if (G[unit]) return (qty * G[unit]!) / density;
    if (unit === "can") return qty * 400;
    if (unit === "piece" && info.eachG) return (qty * info.eachG) / density;
    return null;
  }
  // count
  if (unit === "piece") return qty;
  if (unit === "clove" || unit === "slice") return qty / (info.partsPerUnit ?? 1);
  if (unit === "bunch") return info.bunchG && info.eachG ? (qty * info.bunchG) / info.eachG : qty;
  if (unit === "can") return qty;
  const g = asG();
  if (g === null) return null;
  if (info.bunchG && !info.eachG) return g / info.bunchG;
  return info.eachG ? g / info.eachG : null;
}

/** "1000 g" → "1 kg", "500 ml" → "500 ml", "1500 ml" → "1.5 L" */
export function amount(v: number, base: Base): string {
  if (base === "g") return v >= 1000 ? `${+(v / 1000).toFixed(2)} kg` : `${Math.round(v)} g`;
  if (base === "ml") return v >= 1000 ? `${+(v / 1000).toFixed(2)} L` : `${Math.round(v)} ml`;
  return `${Math.round(v)}`;
}

/** what to buy for a base quantity: whole packs, whole pieces, bunches or loose weight, and how it reads */
export function purchase(info: IngredientInfo, need: number): { buy: number; label: string } {
  const r = info.buy;
  if (r.kind === "count") {
    const n = Math.max(1, Math.ceil(need - 1e-9));
    const word = info.bunchG && !info.eachG ? (n === 1 ? " bunch" : " bunches") : "";
    return { buy: n, label: `${info.name} × ${n}${word}` };
  }
  if (r.kind === "loose") {
    const v = Math.max(r.step, Math.ceil((need - 1e-9) / r.step) * r.step);
    return { buy: v, label: `${info.name} ${amount(v, info.base)}` };
  }
  const sizes = [...r.sizes].sort((a, b) => a - b);
  // packs of a count read "Tortillas pack of 8"; packs of a weight or a volume "Toor dal 500 g"
  const size = (v: number) => (info.base === "count" ? `pack of ${v}` : amount(v, info.base));
  const fit = sizes.find((s) => s >= need - 1e-9);
  if (fit !== undefined) return { buy: fit, label: `${info.name} ${size(fit)}` };
  const big = sizes[sizes.length - 1];
  const n = Math.ceil((need - 1e-9) / big);
  return { buy: n * big, label: info.base === "count" ? `${info.name} ${n} packs of ${big}` : `${info.name} ${n} × ${amount(big, info.base)}` };
}

// ---------------------------------------------------------------- matching dishes and ingredients

const key = (s: string) => singularize(normalize(s));

export interface DishMatch {
  query: string;
  dish: Dish | null;
  how: "exact" | "fuzzy" | null;
  score: number;
}

/** one typed dish against the table: a name or an alias outright, else the resolver's similarity at .8 or more */
export function matchDish(query: string, dishes: Dish[]): DishMatch {
  const q = key(query);
  if (!q) return { query, dish: null, how: null, score: 0 };
  for (const d of dishes) if ([d.name, d.id, ...(d.aliases ?? [])].some((n) => key(n) === q)) return { query, dish: d, how: "exact", score: 1 };
  let best: Dish | null = null;
  let score = 0;
  for (const d of dishes)
    for (const n of [d.name, ...(d.aliases ?? [])]) {
      const s = similarity(q, key(n));
      if (s > score) [best, score] = [d, s];
    }
  return score >= 0.8 ? { query, dish: best, how: "fuzzy", score } : { query, dish: null, how: null, score };
}

/**
 * split what was typed into dishes: commas, semicolons and new lines always; "and" / "&" only when the whole phrase
 * is not a dish itself ("mac and cheese" stays one, "rajma and poha" is two), which `isDish` decides
 */
export function splitDishes(text: string, isDish: (s: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/[,;\n]/)) {
    const c = chunk.trim();
    if (!c) continue;
    if (/\s(and|&)\s/i.test(c) && !isDish(c)) out.push(...c.split(/\s+(?:and|&)\s+/i).map((s) => s.trim()));
    else out.push(c);
  }
  return [...new Set(out.filter((s) => s.length > 1).map((s) => s.replace(/\s+/g, " ")))].slice(0, 12);
}

/** an ingredient name (the model's free text) against the known ingredients: exact on a name or alias, then similarity ≥ .85 */
export function ingredientFor(name: string, known: IngredientInfo[]): IngredientInfo | null {
  const q = key(name);
  if (!q) return null;
  for (const i of known) if ([i.name, i.key, ...(i.aliases ?? [])].some((n) => key(n) === q)) return i;
  let best: IngredientInfo | null = null;
  let score = 0;
  for (const i of known)
    for (const n of [i.name, ...(i.aliases ?? [])]) {
      const s = similarity(q, key(n));
      if (s > score) [best, score] = [i, s];
    }
  return score >= 0.85 ? best : null;
}

/** an ingredient nobody listed: its own name, "other", measured in what the recipe used, sold loose or by the piece */
export function adHocIngredient(name: string, unit: RawUnit): IngredientInfo {
  // "thyme bunch", "garlic cloves": the unit word is the unit's, not the name's
  const clean = name.trim().replace(/\s+/g, " ").replace(/\s+(bunch(es)?|sprigs?|stalks?|cloves?|pieces?|pcs)$/i, "") || name.trim();
  const display = clean.replace(/^./, (c) => c.toUpperCase());
  const k = `adhoc:${key(clean)}`;
  // measured by the spoon: a spice or a flavouring, bought as a small jar
  if (unit === "tsp" || unit === "tbsp" || unit === "pinch") return { key: k, name: display, category: "spices", base: "g", density: 0.6, buy: { kind: "pack", sizes: [50] } };
  if (unit === "bunch") return { key: k, name: display, category: "herbs", base: "count", bunchG: 50, buy: { kind: "count" } };
  const base: Base = G[unit] ? "g" : ML[unit] ? "ml" : "count";
  return { key: k, name: display, category: "other", base, buy: base === "count" ? { kind: "count" } : { kind: "loose", step: base === "g" ? 100 : 250 } };
}

// ---------------------------------------------------------------- the model's answers, validated

export interface ModelIngredient {
  name: string;
  quantity: number;
  unit: string;
  optional?: boolean;
  pantryStaple?: boolean;
}

export interface Checked {
  items: (DishIngredient & { pantry?: boolean })[];
  dropped: { name: string; reason: string }[];
  clamped: { name: string; from: string; to: string }[];
  /** ingredients the table does not know, made up from the answer (their own name, category "other") */
  adHoc: IngredientInfo[];
}

/**
 * A model's ingredient list for one dish (for two servings), against the known ingredients and the bounds: a line
 * with no name, no known unit or no positive quantity is dropped; one past its category's bound is clamped to it.
 */
export function checkModelIngredients(lines: ModelIngredient[], known: IngredientInfo[]): Checked {
  const out: Checked = { items: [], dropped: [], clamped: [], adHoc: [] };
  // each ingredient once, in its base unit: "egg yolk" and "egg white" are both eggs, and add up
  const acc = new Map<string, { info: IngredientInfo; base: number; optional: boolean; pantry: boolean }>();
  for (const l of lines.slice(0, 30)) {
    const name = typeof l?.name === "string" ? l.name.trim().slice(0, 60) : "";
    if (!name) {
      out.dropped.push({ name: "(no name)", reason: "no name" });
      continue;
    }
    if (/^(water|hot water|cold water|ice water|warm water|garnish|garnishes|to taste)$/i.test(name)) continue; // never bought
    const unit = unitOf(l.unit);
    const qty = Number(l.quantity);
    if (!unit) {
      out.dropped.push({ name, reason: `unknown unit "${String(l.unit).slice(0, 20)}"` });
      continue;
    }
    if (!(qty > 0) || !Number.isFinite(qty)) {
      out.dropped.push({ name, reason: "no quantity" });
      continue;
    }
    const info = ingredientFor(name, known) ?? adHocIngredient(name, unit);
    const base = toBase(info, qty, unit);
    if (base === null) {
      out.dropped.push({ name, reason: `${unit} does not convert for ${info.name}` });
      continue;
    }
    const adHoc = info.key.startsWith("adhoc:");
    const a = acc.get(info.key);
    if (a) {
      a.base += base;
      a.optional &&= !!l.optional;
      continue;
    }
    if (adHoc) out.adHoc.push(info);
    // pantry: the table's word for an ingredient it knows (the model called butter and flour staples), the model's for one it does not
    acc.set(info.key, { info, base, optional: !!l.optional, pantry: adHoc ? !!l.pantryStaple : !!info.pantry });
  }
  for (const { info, base, optional, pantry } of acc.values()) {
    const max = BOUNDS[info.category][info.base];
    if (base > max) out.clamped.push({ name: info.name, from: amount(base, info.base), to: amount(max, info.base) });
    const unit: RawUnit = info.base === "g" ? "g" : info.base === "ml" ? "ml" : "piece";
    out.items.push({ key: info.key, qty: Math.min(base, max), unit, optional, pantry });
  }
  return out;
}

// ---------------------------------------------------------------- aggregation

export interface PlannedDish {
  /** what was typed */
  query: string;
  /** the dish's name (the table's, or what was typed for a model answer) */
  name: string;
  source: "table" | "model";
  items: (DishIngredient & { pantry?: boolean })[];
}

export interface ShoppingLine {
  key: string;
  name: string;
  /** the list line: "Onions × 6", "Paneer 400 g" */
  label: string;
  /** the summed need in the base unit, before rounding up */
  need: number;
  base: Base;
  /** what is bought, in the base unit (whole packs, pieces, bunches) */
  buy: number;
  /** the dishes it is for */
  dishes: string[];
  pantry: boolean;
  /** an ingredient of a model-sourced dish: an estimate in the guess band */
  estimated: boolean;
  optional: boolean;
  category: MealCategory;
}

/** every dish's ingredients scaled to the party, merged, and rounded up to what the store sells */
export function aggregate(planned: PlannedDish[], people: number, known: IngredientInfo[], extra: IngredientInfo[] = []): ShoppingLine[] {
  const byKey = new Map([...known, ...extra].map((i) => [i.key, i]));
  const scale = Math.max(1, Math.min(20, Math.round(people))) / 2;
  const acc = new Map<string, { info: IngredientInfo; need: number; dishes: string[]; pantry: boolean; estimated: boolean; optional: boolean }>();
  for (const d of planned)
    for (const it of d.items) {
      const info = byKey.get(it.key);
      if (!info) continue;
      const base = toBase(info, it.qty * scale, it.unit);
      if (base === null) continue;
      const a = acc.get(info.key) ?? { info, need: 0, dishes: [], pantry: true, estimated: false, optional: true };
      a.need += base;
      if (!a.dishes.includes(d.name)) a.dishes.push(d.name);
      // pantry only when every dish calls it pantry; optional only when every dish calls it optional
      a.pantry &&= !!(it.pantry ?? info.pantry);
      a.optional &&= !!it.optional;
      a.estimated ||= d.source === "model";
      acc.set(info.key, a);
    }
  const order = new Map(MEAL_CATEGORIES.map((c, i) => [c, i]));
  return [...acc.values()]
    .map(({ info, need, dishes, pantry, estimated, optional }) => {
      const p = purchase(info, need);
      return { key: info.key, name: info.name, label: p.label, need, base: info.base, buy: p.buy, dishes, pantry, estimated, optional, category: info.category };
    })
    .sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) || a.name.localeCompare(b.name));
}
