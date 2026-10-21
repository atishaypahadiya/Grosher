// Cook mode's model call, shared by every provider (the app's direct Ollama path in dev, the resolver Worker in
// production) and the eval: the system prompt, the JSON schema Ollama's structured output enforces (format = schema),
// the token budget and the parser. Local model only: nothing here talks to a cloud model.
//
// One model call per dish (the app sends the dishes the table does not know in one request; the Worker asks for them
// one at a time): asked for several in one answer, qwen3:8b wrote the first dish and closed the JSON. Ingredients are
// for TWO servings; the app scales.

import { UNITS, type ModelIngredient } from "./plan.ts";

/** dishes in one request from the app */
export const DISH_MAX = 6;
export const DISH_MAX_CHARS = 60;
/** a dish's ingredient list is cut off here (schema and parser) */
export const DISH_MAX_INGREDIENTS = 20;

export const dishSystemPrompt = () =>
  [
    "You are a cook writing the shopping list for one dish: every ingredient that goes into it, for exactly 2 servings of a normal home portion.",
    "List the ingredients of the traditional, everyday version of the dish, and only those: nothing from other dishes, no sides unless the dish is served on them.",
    "Each ingredient once, by its plain name as a grocery shop sells it, without brands, and never water.",
    "Units: g or ml for things weighed or measured, piece for whole vegetables, fruit and eggs, clove for garlic, bunch for leafy herbs, tsp or tbsp for spices and oil.",
    "pantryStaple is true only for salt, sugar, cooking oil and common dried spices; optional is true only for garnishes.",
    // measured on qwen3:8b: indented JSON is ~45 tokens an ingredient, one line ~26. The example shows the format
    // only: with real ingredient names in the prompt, they turned up in unrelated dishes (basmati rice in a ratatouille)
    'Write the JSON on one single line with no line breaks or indentation, like {"ingredients":[{"name":"…","quantity":1,"unit":"g","optional":false,"pantryStaple":false}]}; names keep their normal spaces.',
  ].join(" ");

export const dishUserMessage = (dish: string) => `Dish: ${dish}`;

/** the structured-output schema for one dish: its ingredients, each with a unit from the fixed list */
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
          quantity: { type: "number" },
          unit: { type: "string", enum: [...UNITS] },
          optional: { type: "boolean" },
          pantryStaple: { type: "boolean" },
        },
        required: ["name", "quantity", "unit", "optional", "pantryStaple"],
      },
    },
  },
  required: ["ingredients"],
});

/** output tokens for one dish: up to 20 ingredients at ~26 tokens each, plus the frame; a cut-off answer keeps its whole ingredients */
export const DISH_MAX_TOKENS = 40 + 26 * DISH_MAX_INGREDIENTS;

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

/** one dish's answer (parsed JSON) → its ingredient lines, or null when it is not an answer */
export function parseDishAnswer(raw: unknown): ModelIngredient[] | null {
  const list = (raw as { ingredients?: unknown })?.ingredients;
  if (!Array.isArray(list)) return null;
  return list
    .slice(0, DISH_MAX_INGREDIENTS)
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .map((i) => ({ name: String(i.name ?? ""), quantity: Number(i.quantity), unit: String(i.unit ?? ""), optional: i.optional === true, pantryStaple: i.pantryStaple === true }));
}

/** what a provider answers for each dish asked: its lines, or null (not answered: the model was unreachable, or said nothing usable) */
export interface DishReply {
  dish: string;
  ingredients: ModelIngredient[] | null;
}
