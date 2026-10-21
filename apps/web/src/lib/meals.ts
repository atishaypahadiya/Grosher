// Cook mode (components/MealSheet): typed dishes → a reviewed shopping list → the current list. The dish table and
// the ingredients are @grosher/stores', the arithmetic @grosher/core's; this file is the I/O: the local model (one
// call a dish, straight to Ollama on the Mac in dev or through the worker's POST /dishes, never a cloud model), the
// answer cache in IndexedDB, and the merge into the list.
//
// Sources, in order: the table (exact, then the resolver's similarity), the cache (`dish:<normalised name>:2`, the
// model's lines for two servings as it gave them, validated again on every use), the model. A dish the model cannot
// answer (the Mac asleep, a timeout, nothing usable) is "unanswered": the sheet says so and the rest stand.

import {
  aggregate,
  checkModelIngredients,
  DISH_MAX,
  DISH_MAX_TOKENS,
  dishSchema,
  dishSystemPrompt,
  dishUserMessage,
  matchDish,
  normalize,
  parseDishAnswer,
  parseDishJson,
  splitDishes,
  stripQuantity,
  singularize,
  type Checked,
  type DishReply,
  type IngredientInfo,
  type ModelIngredient,
  type PlannedDish,
  type ShoppingLine,
} from "@grosher/core";
import { DISHES, INGREDIENTS } from "@grosher/stores";
import { dbGet, dbSet } from "./db.ts";
import type { ResolverSettings } from "./settings.ts";

/** one dish straight to Ollama: ~10 s warm on an M-series Mac; a cold load of the model on top */
export const DISH_TIMEOUT_MS = 45_000;
/** the worker asks for each dish in turn, up to its own 80 s deadline */
export const DISHES_TIMEOUT_MS = 90_000;

export interface DishAsker {
  name: ResolverSettings["provider"];
  /** every dish answered or null; never rejects */
  ask(dishes: string[]): Promise<DishReply[]>;
}

const none = (dishes: string[]): DishReply[] => dishes.map((dish) => ({ dish, ingredients: null }));

async function post(fetchImpl: typeof fetch, url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function dishAskerFor(s: ResolverSettings, fetchImpl: typeof fetch = (...a) => fetch(...a)): DishAsker {
  if (s.provider === "worker") {
    const base = s.workerUrl.replace(/\/$/, "");
    return {
      name: "worker",
      async ask(dishes) {
        try {
          const body = (await post(fetchImpl, `${base}/dishes`, { dishes }, DISHES_TIMEOUT_MS)) as { results?: { dish?: unknown; ingredients?: unknown }[] };
          const rows = Array.isArray(body.results) ? body.results : [];
          return dishes.map((dish, k) => {
            const r = rows.find((x) => x?.dish === dish) ?? rows[k];
            return { dish, ingredients: r ? parseDishAnswer({ ingredients: r.ingredients }) : null };
          });
        } catch {
          return none(dishes);
        }
      },
    };
  }
  const base = s.ollamaUrl.replace(/\/$/, "");
  return {
    name: "ollama",
    async ask(dishes) {
      const out: DishReply[] = [];
      for (const dish of dishes) {
        try {
          const body = (await post(
            fetchImpl,
            `${base}/api/chat`,
            {
              model: s.model,
              stream: false,
              think: false,
              keep_alive: "24h",
              format: dishSchema(),
              options: { temperature: 0, num_predict: DISH_MAX_TOKENS },
              messages: [
                { role: "system", content: dishSystemPrompt() },
                { role: "user", content: dishUserMessage(dish) },
              ],
            },
            DISH_TIMEOUT_MS,
          )) as { message?: { content?: string } };
          out.push({ dish, ingredients: parseDishAnswer(parseDishJson(body.message?.content ?? "")) });
        } catch {
          // unreachable: the rest would fail the same way
          return [...out, ...none(dishes.slice(out.length))];
        }
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------- the cache

/** the model's lines for a dish at two servings, keyed by the dish's normalised name */
export const dishKey = (dish: string) => `dish:${normalize(dish)}:2`;

export interface CachedDish {
  dish: string;
  ingredients: ModelIngredient[];
  at: number;
}

export const cachedDish = (dish: string) => dbGet<CachedDish | null>(dishKey(dish), null);
export const cacheDish = (dish: string, ingredients: ModelIngredient[]) => dbSet(dishKey(dish), { dish, ingredients, at: Date.now() } satisfies CachedDish);

// ---------------------------------------------------------------- the plan

export type DishStatus =
  /** from the dish table */
  | "table"
  /** the model's answer, now or from the cache */
  | "model"
  /** being asked */
  | "asking"
  /** the model could not answer: by hand, or later */
  | "unanswered";

export interface DishState {
  query: string;
  /** the table's name, or what was typed */
  name: string;
  status: DishStatus;
  /** a model answer's validation: what was dropped or clamped */
  checked?: Checked;
}

export const isDish = (s: string) => !!matchDish(s, DISHES).dish;
export const parseDishes = (text: string) => splitDishes(text, isDish).slice(0, 12);

/** what the table knows at once, and which dishes are left for the cache or the model */
export function tableFirst(queries: string[]): { states: DishState[]; planned: PlannedDish[]; unknown: string[] } {
  const states: DishState[] = [];
  const planned: PlannedDish[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const m = matchDish(q, DISHES);
    const id = m.dish?.id ?? `q:${normalize(q)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (m.dish) {
      states.push({ query: q, name: m.dish.name, status: "table" });
      planned.push({ query: q, name: m.dish.name, source: "table", items: m.dish.items });
    } else {
      const name = q.trim().replace(/^./, (c) => c.toUpperCase());
      states.push({ query: q, name, status: "asking" });
      unknown.push(q);
    }
  }
  return { states, planned, unknown };
}

/** a model answer for one dish, validated, as a planned dish and its state */
export function fromModel(query: string, lines: ModelIngredient[]): { state: DishState; planned: PlannedDish; adHoc: IngredientInfo[] } | null {
  const checked = checkModelIngredients(lines, INGREDIENTS);
  if (!checked.items.length) return null;
  const name = query.trim().replace(/^./, (c) => c.toUpperCase());
  return { state: { query, name, status: "model", checked }, planned: { query, name, source: "model", items: checked.items }, adHoc: checked.adHoc };
}

/**
 * The unknown dishes: the cache first, then one request to the model for the rest (at most DISH_MAX); every answer
 * is cached. `onUpdate` gets each dish as it settles.
 */
export async function resolveUnknown(
  unknown: string[],
  asker: DishAsker,
  onUpdate: (query: string, result: ReturnType<typeof fromModel> | null) => void,
): Promise<void> {
  const ask: string[] = [];
  for (const q of unknown) {
    const hit = await cachedDish(q).catch(() => null);
    const r = hit ? fromModel(q, hit.ingredients) : null;
    if (r) onUpdate(q, r);
    else ask.push(q);
  }
  if (!ask.length) return;
  const batch = ask.slice(0, DISH_MAX);
  for (const q of ask.slice(DISH_MAX)) onUpdate(q, null);
  const replies = await asker.ask(batch);
  for (const [k, q] of batch.entries()) {
    const lines = replies[k]?.ingredients ?? null;
    const r = lines ? fromModel(q, lines) : null;
    if (r && lines) void cacheDish(q, lines).catch(() => {});
    onUpdate(q, r);
  }
}

export const planLines = (planned: PlannedDish[], people: number, adHoc: IngredientInfo[]): ShoppingLine[] => aggregate(planned, people, INGREDIENTS, adHoc);

// ---------------------------------------------------------------- into the list

const itemKey = (s: string) => singularize(stripQuantity(s));

/**
 * The reviewed lines into the current list: a plain item already there for the same thing ("onions") gives way to
 * the line with its quantity ("Onions × 6"); an item with a quantity of its own stays, and the line is not added twice.
 */
export function mergeIntoList(current: string[], lines: string[]): string[] {
  const out = [...current];
  for (const line of lines) {
    const k = itemKey(line);
    if (!k) continue;
    const at = out.findIndex((n) => itemKey(n) === k);
    if (at < 0) out.push(line);
    else if (normalize(out[at]) === k || singularize(normalize(out[at])) === k) out[at] = line;
  }
  return out;
}
