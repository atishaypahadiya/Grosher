// Cook mode (components/MealSheet): typed dishes → a reviewed shopping list → the current list. The dish table and
// the ingredients are @grosher/stores', the arithmetic @grosher/core's; this file is the I/O: the local model (one
// call a dish, straight to Ollama on the Mac in dev or through the worker's POST /dishes, never a cloud model), the
// answer cache in IndexedDB, and the merge into the list.
//
// Sources, in order: the table (exact, then the resolver's similarity), the cache (`dish:<normalised name>:2`, the
// model's lines for two servings as it gave them, validated again on every use, and stamped with the dish table's
// hash: an answer from another version of the table is dropped), the model. The table always wins: a dish it knows
// never reads the cache, and its old cached answer is deleted. A dish the model cannot
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
  type Checked,
  type IngredientInfo,
  type ModelIngredient,
  type PlannedDish,
  type ShoppingLine,
} from "@grosher/core";
import { DISH_TABLE_HASH, DISHES, INGREDIENTS } from "@grosher/stores/meals";
import { dbGet, dbSet } from "./db.ts";
import type { ResolverSettings } from "./settings.ts";

/** one dish, a ceiling: ~4 s warm on the Mac (qwen3:8b, the compact format), longer while it shares the GPU with
 *  other dishes; through the worker its own 40 s ceiling plus the Funnel */
export const DISH_TIMEOUT_MS = 45_000;
/** dishes asked at once: Ollama's slots on the Mac (OLLAMA_NUM_PARALLEL); the rest wait their turn here */
export const DISH_CONCURRENCY = 3;

export interface DishAsker {
  name: ResolverSettings["provider"];
  /** one dish's lines, or null (unreachable, a timeout, nothing usable); never rejects. `signal` cancels it */
  askOne(dish: string, signal?: AbortSignal): Promise<ModelIngredient[] | null>;
}

async function post(fetchImpl: typeof fetch, url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DISH_TIMEOUT_MS);
  const stop = () => ctl.abort();
  signal?.addEventListener("abort", stop);
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

export function dishAskerFor(s: ResolverSettings, fetchImpl: typeof fetch = (...a) => fetch(...a)): DishAsker {
  if (s.provider === "worker") {
    const base = s.workerUrl.replace(/\/$/, "");
    return {
      name: "worker",
      // one dish a request, so each arrives on its own and a slow one holds up no other
      async askOne(dish, signal) {
        try {
          const body = (await post(fetchImpl, `${base}/dishes`, { dishes: [dish] }, signal)) as { results?: { ingredients?: unknown }[] };
          const r = Array.isArray(body.results) ? body.results[0] : null;
          return r ? parseDishAnswer({ ingredients: r.ingredients }) : null;
        } catch {
          return null;
        }
      },
    };
  }
  const base = s.ollamaUrl.replace(/\/$/, "");
  return {
    name: "ollama",
    async askOne(dish, signal) {
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
          signal,
        )) as { message?: { content?: string } };
        return parseDishAnswer(parseDishJson(body.message?.content ?? ""));
      } catch {
        return null;
      }
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
  /** the dish table it was asked against (`DISH_TABLE_HASH`); missing on answers from before the stamp */
  table?: string;
}

/** a cached answer, if it was asked against this dish table; one from another table is deleted and not used */
export async function cachedDish(dish: string, table = DISH_TABLE_HASH): Promise<CachedDish | null> {
  const hit = await dbGet<CachedDish | null>(dishKey(dish), null);
  if (hit && hit.table !== table) {
    await dbSet(dishKey(dish), undefined);
    return null;
  }
  return hit;
}
export const cacheDish = (dish: string, ingredients: ModelIngredient[], table = DISH_TABLE_HASH) => dbSet(dishKey(dish), { dish, ingredients, at: Date.now(), table } satisfies CachedDish);
/** a dish the table answers needs no cached model answer: the table always wins, and the old answer goes */
export const forgetCached = (dishes: string[]) => Promise.all(dishes.map((d) => dbSet(dishKey(d), undefined))).then(() => {});

// ---------------------------------------------------------------- the plan

export type DishStatus =
  /** from the dish table */
  | "table"
  /** the model's answer, now or from the cache */
  | "model"
  /** being asked (or waiting its turn) */
  | "asking"
  /** the model could not answer: by hand, or later */
  | "unanswered"
  /** the shopper stopped it */
  | "cancelled";

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

export type DishOutcome = ReturnType<typeof fromModel> | "unanswered" | "cancelled";

export interface UnknownRun {
  /** stop asking for one dish: off the queue, or its request aborted; it settles as "cancelled" */
  cancel(query: string): void;
  /** stop them all (the sheet closed, or the dishes changed): nothing settles after this */
  cancelAll(): void;
  /** every dish settled */
  done: Promise<void>;
}

/**
 * The unknown dishes: the cache first, then the model, DISH_CONCURRENCY at a time, each settling on its own as it
 * arrives (`onSettle`), so a slow dish holds up no other. Every answer is cached. At most DISH_MAX are asked; any
 * beyond settle unanswered at once.
 */
export function startUnknown(unknown: string[], asker: DishAsker, onSettle: (query: string, outcome: DishOutcome) => void): UnknownRun {
  const ctls = new Map<string, AbortController>();
  const cancelled = new Set<string>();
  let stopped = false;
  const settle = (q: string, o: DishOutcome) => {
    if (!stopped) onSettle(q, o);
  };
  const queue: string[] = [];
  const one = async (q: string) => {
    const hit = await cachedDish(q).catch(() => null);
    const cached = hit ? fromModel(q, hit.ingredients) : null;
    if (cached) return settle(q, cached);
    if (cancelled.has(q)) return;
    const ctl = new AbortController();
    ctls.set(q, ctl);
    const lines = await asker.askOne(q, ctl.signal);
    ctls.delete(q);
    if (cancelled.has(q)) return;
    const r = lines ? fromModel(q, lines) : null;
    if (r && lines) void cacheDish(q, lines).catch(() => {});
    settle(q, r ?? "unanswered");
  };
  const asked = unknown.slice(0, DISH_MAX);
  for (const q of unknown.slice(DISH_MAX)) settle(q, "unanswered");
  queue.push(...asked);
  const worker = async () => {
    for (let q = queue.shift(); q !== undefined; q = queue.shift()) if (!cancelled.has(q)) await one(q);
  };
  const done = Promise.all(Array.from({ length: Math.min(DISH_CONCURRENCY, asked.length) }, worker)).then(() => {});
  return {
    cancel(q) {
      if (cancelled.has(q)) return;
      cancelled.add(q);
      ctls.get(q)?.abort();
      settle(q, "cancelled");
    },
    cancelAll() {
      stopped = true;
      for (const q of asked) cancelled.add(q);
      for (const c of ctls.values()) c.abort();
    },
    done,
  };
}

export const planLines = (planned: PlannedDish[], people: number, adHoc: IngredientInfo[]): ShoppingLine[] => aggregate(planned, people, INGREDIENTS, adHoc);
