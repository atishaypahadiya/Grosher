// Cook mode's data, its own entry point (@grosher/stores/meals) so the app loads it with the meal sheet, never in
// the first bundle: the dish table and the ingredients it buys, and the table's hash.
import { DISHES } from "./dishes.ts";
import { INGREDIENTS } from "./ingredients.ts";

export { INGREDIENTS, INGREDIENT_BY_KEY } from "./ingredients.ts";
export { DISHES, DISH_BY_ID } from "./dishes.ts";

/**
 * cyrb53 over the dish table and the ingredients (names, aliases, lines, how each is sold): the version a cached
 * model answer is stamped with. Any change to the table (a dish added, an alias, a quantity) drops every cached
 * model answer, so a dish the table now knows is never answered by an older guess, and the rest are asked again.
 */
export const DISH_TABLE_HASH = (() => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const text = JSON.stringify([DISHES, INGREDIENTS]);
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
})();
