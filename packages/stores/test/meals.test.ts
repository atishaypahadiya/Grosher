// Cook mode's data: the dish table and the ingredients it buys. Every dish lists its core ingredients, every
// quantity converts and sits inside its category's bounds for two servings, no alias names two dishes, and every
// ingredient's list line is placed on a Grosher shelf offline (no model), so a table dish always routes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, BOUNDS, matchDish, purchase, resolveItem, splitDishes, toBase, type PlannedDish } from "@grosher/core";
import { grosher } from "../src/index.ts";
import { DISHES, INGREDIENTS, INGREDIENT_BY_KEY } from "../src/meals/index.ts";

test("the dish table: about eighty dishes, about half Indian home staples", () => {
  assert.ok(DISHES.length >= 80, `${DISHES.length} dishes`);
  const indian = DISHES.filter((d) => d.cuisine === "indian").length;
  assert.ok(indian >= DISHES.length * 0.4 && indian <= DISHES.length * 0.6, `${indian} of ${DISHES.length} Indian`);
  assert.equal(new Set(DISHES.map((d) => d.id)).size, DISHES.length, "ids are unique");
  assert.equal(new Set(INGREDIENTS.map((i) => i.key)).size, INGREDIENTS.length, "ingredient keys are unique");
});

test("every dish: its core ingredients listed and not optional, every quantity converts and is inside the bounds", () => {
  for (const d of DISHES) {
    assert.ok(d.core.length >= 1, `${d.id} names its core`);
    assert.ok(d.items.length >= 3, `${d.id} has ${d.items.length} ingredients`);
    for (const k of d.core) {
      const it = d.items.find((i) => i.key === k);
      assert.ok(it, `${d.id}: core ${k} is not listed`);
      assert.ok(!it.optional, `${d.id}: core ${k} is optional`);
    }
    assert.equal(new Set(d.items.map((i) => i.key)).size, d.items.length, `${d.id} lists an ingredient twice`);
    for (const it of d.items) {
      const info = INGREDIENT_BY_KEY.get(it.key);
      assert.ok(info, `${d.id}: unknown ingredient ${it.key}`);
      const base = toBase(info, it.qty, it.unit);
      assert.ok(base !== null && base > 0, `${d.id}: ${it.qty} ${it.unit} of ${it.key} does not convert`);
      assert.ok(base <= BOUNDS[info.category][info.base], `${d.id}: ${it.key} ${base} ${info.base} is past the ${info.category} bound`);
    }
    // a plate for two: the food that is not pantry weighs between 150 g and 3.5 kg
    let grams = 0;
    for (const it of d.items) {
      const info = INGREDIENT_BY_KEY.get(it.key)!;
      if (info.pantry) continue;
      const b = toBase(info, it.qty, it.unit)!;
      grams += info.base === "g" ? b : info.base === "ml" ? b * (info.density ?? 1) : b * (info.eachG ?? (info.bunchG ?? 100));
    }
    assert.ok(grams >= 150 && grams <= 3500, `${d.id}: ${Math.round(grams)} g for two`);
  }
});

test("dish names and aliases: each finds its own dish, none finds another", () => {
  for (const d of DISHES)
    for (const n of [d.name, ...(d.aliases ?? [])]) {
      const m = matchDish(n, DISHES);
      assert.equal(m.dish?.id, d.id, `"${n}" (${d.id}) matched ${m.dish?.id}`);
    }
});

test("every ingredient's list line is placed on a Grosher shelf offline", async () => {
  const catalog = await grosher.loadCatalog();
  const ctx = { catalog, categories: grosher.categories, locations: new Set(grosher.store.locations.map((l) => l.id)) };
  for (const i of INGREDIENTS)
    for (const need of [1, 600, 2500]) {
      const line = purchase(i, i.base === "count" ? Math.ceil(need / 600) : need).label;
      const r = resolveItem(line, ctx);
      assert.ok(r.locationIds.length && r.source !== "llm" && r.source !== "unknown", `"${line}" not placed (${r.source})`);
    }
});

test("the example: dal chawal, rajma, poha, pasta arrabbiata for two", () => {
  const isDish = (s: string) => !!matchDish(s, DISHES).dish;
  const planned: PlannedDish[] = splitDishes("dal chawal, rajma, poha, pasta arrabbiata", isDish).map((q) => {
    const d = matchDish(q, DISHES).dish!;
    return { query: q, name: d.name, source: "table", items: d.items };
  });
  const lines = aggregate(planned, 2, INGREDIENTS);
  const buy = lines.filter((l) => !l.pantry && !l.optional).map((l) => l.label);
  const pantry = lines.filter((l) => l.pantry).map((l) => l.label);
  assert.deepEqual(buy, [
    "Green chilies × 6", "Lemons × 1", "Onions × 4", "Tomatoes × 5", "Curry leaves × 1 bunch", "Garlic × 1", "Ginger 100 g",
    "Basmati rice 1 kg", "Penne pasta 500 g", "Poha 500 g", "Rajma 500 g", "Toor dal 500 g", "Ghee 200 g", "Canned tomatoes 400 g", "Peanuts 200 g",
  ]);
  assert.deepEqual(lines.filter((l) => l.optional).map((l) => l.label), ["Potatoes × 1", "Cilantro × 1 bunch", "Parsley × 1 bunch", "Parmesan 100 g"]);
  assert.ok(pantry.includes("Salt 1 kg") && pantry.includes("Turmeric 100 g") && pantry.includes("Cooking oil 1 L"));
  assert.deepEqual(lines.find((l) => l.key === "onion")!.dishes, ["Dal chawal", "Rajma chawal", "Poha"]);
  // four people: the same dishes, twice the need
  const four = aggregate(planned, 4, INGREDIENTS);
  assert.equal(four.find((l) => l.key === "onion")!.label, "Onions × 8");
  assert.equal(four.find((l) => l.key === "basmati")!.label, "Basmati rice 1 kg");
  assert.equal(four.find((l) => l.key === "toor-dal")!.label, "Toor dal 500 g");
});
