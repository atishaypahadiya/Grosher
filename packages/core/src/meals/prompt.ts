// Cook mode's model call, shared by every provider (the app's direct Ollama path in dev, the resolver Worker in
// production) and the eval: the system prompt, the JSON schema Ollama's structured output enforces (format = schema),
// the token budget and the parser. Local model only: nothing here talks to a cloud model.
//
// One model call per dish (the app sends the dishes the table does not know in one request; the Worker asks for them
// one at a time): asked for several in one answer, qwen3:8b wrote the first dish and closed the JSON. Ingredients are
// for TWO servings; the app scales.

import { UNITS, type ModelIngredient } from "./plan.ts";

/** dishes in one request from the app (the app sends one a request, so they arrive one by one) */
export const DISH_MAX = 6;
export const DISH_MAX_CHARS = 60;
/** a dish's ingredient list is cut off here (schema and parser): the dishes measured run 5–14 */
export const DISH_MAX_INGREDIENTS = 15;

export const dishSystemPrompt = () =>
  [
    "You are a cook writing the shopping list for one dish: every ingredient that goes into it, for exactly 2 servings of a normal home portion.",
    "List the ingredients of the traditional, everyday version of the dish, and only those: nothing from other dishes, no sides unless the dish is served on them.",
    "Each ingredient once, by its plain name as a grocery shop sells it, without brands, and never water.",
    "Units: g or ml for things weighed or measured, piece for whole vegetables, fruit and eggs, clove for garlic, bunch for leafy herbs, tsp or tbsp for spices and oil.",
    "Most important first, and stop when the dish is complete.",
    // measured on qwen3:8b (21 Oct 2026, ten dishes): the answer is the whole cost (thinking is off). Indented
    // objects with two flags were ~30 tokens a line, 12.5 s for a 17-line dish; this, ~10 tokens a line, 3.7 s a
    // dish. The example shows the format only: real names in it turned up in unrelated dishes (basmati rice in a
    // ratatouille). Garnish and pantry flags are gone: the model left "optional" empty for every dish, and the
    // ingredient table knows the staples.
    'Write the JSON on one single line with no line breaks or indentation, like {"ingredients":[{"name":"…","amount":"200 g"}]}; names keep their normal spaces.',
  ].join(" ");

export const dishUserMessage = (dish: string) => `Dish: ${dish}`;

/** the structured-output schema for one dish: each ingredient a name and an amount, "200 g", in a unit from the fixed list */
export const dishSchema = () => ({
  type: "object",
  properties: {
    ingredients: {
      type: "array",
      maxItems: DISH_MAX_INGREDIENTS,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "string", pattern: `^[0-9]{1,4}(\\.[0-9]{1,2})? (${UNITS.join("|")})$` },
        },
        required: ["name", "amount"],
      },
    },
  },
  required: ["ingredients"],
});

/** output tokens for one dish: 15 lines at ~13 tokens (the longest measured, 14 lines, took 165), and the frame */
export const DISH_MAX_TOKENS = 240;

/**
 * The model's text as JSON. An answer cut off by the token budget keeps every ingredient it finished: the text is
 * cut back to the end of its last whole ingredient and the brackets closed.
 */
export function parseDishJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* cut off: salvage below */
  }
  for (let end = text.lastIndexOf("}"); end > 0; end = text.lastIndexOf("}", end - 1)) {
    try {
      const v = JSON.parse(text.slice(0, end + 1) + "]}") as { ingredients?: unknown };
      if (Array.isArray(v?.ingredients)) return v;
    } catch {
      /* a shorter head */
    }
  }
  return null;
}

/** "200 g" → [200, "g"] */
const AMOUNT = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-z]+)\.?\s*$/i;

/**
 * One dish's answer (parsed JSON) → its ingredient lines, or null when it is not an answer. Reads this format
 * ({name, amount: "200 g"}) and the one before it ({name, quantity, unit, optional, pantryStaple}), which cached
 * answers and the worker's replies carry.
 */
export function parseDishAnswer(raw: unknown): ModelIngredient[] | null {
  const list = (raw as { ingredients?: unknown })?.ingredients;
  if (!Array.isArray(list)) return null;
  return list
    .slice(0, 20)
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .map((i) => {
      const m = typeof i.amount === "string" ? AMOUNT.exec(i.amount) : null;
      const quantity = m ? Number(m[1]) : Number(i.quantity);
      const unit = m ? m[2] : String(i.unit ?? "");
      return { name: String(i.name ?? ""), quantity, unit, optional: i.optional === true, pantryStaple: i.pantryStaple === true };
    });
}

/** what a provider answers for each dish asked: its lines, or null (not answered: the model was unreachable, or said nothing usable) */
export interface DishReply {
  dish: string;
  ingredients: ModelIngredient[] | null;
}
