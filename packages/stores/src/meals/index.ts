// Cook mode's data, its own entry point (@grosher/stores/meals) so the app loads it with the meal sheet, never in
// the first bundle: the dish table and the ingredients it buys.
export { INGREDIENTS, INGREDIENT_BY_KEY } from "./ingredients.ts";
export { DISHES, DISH_BY_ID } from "./dishes.ts";
