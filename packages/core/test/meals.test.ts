import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregate,
  amount,
  checkModelIngredients,
  ingredientFor,
  matchDish,
  parseDishJson,
  parseDishAnswer,
  purchase,
  splitDishes,
  toBase,
  unitOf,
  type Dish,
  type IngredientInfo,
  type PlannedDish,
} from "../src/index.ts";

const onion: IngredientInfo = { key: "onion", name: "Onions", category: "produce", base: "count", eachG: 150, buy: { kind: "count" }, aliases: ["onion"] };
const dal: IngredientInfo = { key: "toor-dal", name: "Toor dal", category: "pulses", base: "g", density: 0.85, buy: { kind: "pack", sizes: [500, 1000] } };
const paneer: IngredientInfo = { key: "paneer", name: "Paneer", category: "dairy", base: "g", buy: { kind: "pack", sizes: [200, 400] } };
const garlic: IngredientInfo = { key: "garlic", name: "Garlic", category: "aromatics", base: "count", eachG: 40, partsPerUnit: 12, buy: { kind: "count" } };
const ginger: IngredientInfo = { key: "ginger", name: "Ginger", category: "aromatics", base: "g", buy: { kind: "loose", step: 100 } };
const cilantro: IngredientInfo = { key: "cilantro", name: "Cilantro", category: "herbs", base: "count", bunchG: 100, buy: { kind: "count" }, aliases: ["coriander leaves"] };
const salt: IngredientInfo = { key: "salt", name: "Salt", category: "spices", base: "g", density: 1.2, pantry: true, buy: { kind: "pack", sizes: [1000] } };
const milk: IngredientInfo = { key: "milk", name: "Milk", category: "dairy", base: "ml", buy: { kind: "pack", sizes: [1000, 2000] } };
const tortillas: IngredientInfo = { key: "tortillas", name: "Tortillas", category: "bakery", base: "count", buy: { kind: "pack", sizes: [8, 16] } };
const oil: IngredientInfo = { key: "oil", name: "Cooking oil", category: "oils", base: "ml", pantry: true, buy: { kind: "pack", sizes: [1000] }, aliases: ["vegetable oil"] };
const KNOWN = [onion, dal, paneer, garlic, ginger, cilantro, salt, milk, tortillas, oil];

test("units: words normalise, odd ones do not", () => {
  assert.equal(unitOf("Tbsp"), "tbsp");
  assert.equal(unitOf("cloves"), "clove");
  assert.equal(unitOf("grams"), "g");
  assert.equal(unitOf("pcs"), "piece");
  assert.equal(unitOf("handful"), null);
  assert.equal(unitOf(3), null);
});

test("conversion into each ingredient's base unit", () => {
  assert.equal(toBase(dal, 1, "kg"), 1000);
  assert.equal(toBase(dal, 1, "cup"), 240 * 0.85);
  assert.equal(toBase(onion, 300, "g"), 2);
  assert.equal(toBase(onion, 3, "piece"), 3);
  assert.equal(toBase(garlic, 6, "clove"), 0.5);
  assert.equal(toBase(cilantro, 50, "g"), 0.5);
  assert.equal(toBase(cilantro, 2, "bunch"), 2);
  assert.equal(toBase(salt, 1, "tsp"), 6);
  assert.equal(toBase(milk, 2, "cup"), 480);
  assert.equal(toBase(milk, 1, "l"), 1000);
  // a piece of paneer has no weight: it does not convert, and says so; a piece of ginger is a 30 g knob
  assert.equal(toBase(paneer, 1, "piece"), null);
  assert.equal(toBase(ginger, 1, "piece"), 30);
  assert.equal(toBase(dal, 0, "g"), null);
  assert.equal(toBase(dal, Number.NaN, "g"), null);
});

test("rounding up to what the store sells", () => {
  assert.deepEqual(purchase(onion, 5.2), { buy: 6, label: "Onions × 6" });
  assert.deepEqual(purchase(dal, 300), { buy: 500, label: "Toor dal 500 g" });
  assert.deepEqual(purchase(dal, 600), { buy: 1000, label: "Toor dal 1 kg" });
  assert.deepEqual(purchase(dal, 1500), { buy: 2000, label: "Toor dal 2 × 1 kg" });
  assert.deepEqual(purchase(paneer, 400), { buy: 400, label: "Paneer 400 g" });
  assert.deepEqual(purchase(paneer, 500), { buy: 800, label: "Paneer 2 × 400 g" });
  assert.deepEqual(purchase(ginger, 25), { buy: 100, label: "Ginger 100 g" });
  assert.deepEqual(purchase(ginger, 130), { buy: 200, label: "Ginger 200 g" });
  assert.deepEqual(purchase(cilantro, 0.25), { buy: 1, label: "Cilantro × 1 bunch" });
  assert.deepEqual(purchase(cilantro, 1.5), { buy: 2, label: "Cilantro × 2 bunches" });
  assert.deepEqual(purchase(milk, 1200), { buy: 2000, label: "Milk 2 L" });
  assert.deepEqual(purchase(tortillas, 6), { buy: 8, label: "Tortillas pack of 8" });
  assert.deepEqual(purchase(tortillas, 20), { buy: 32, label: "Tortillas 2 packs of 16" });
  // exactly a pack is that pack, not the next one up
  assert.equal(purchase(dal, 500).buy, 500);
  assert.equal(amount(1500, "ml"), "1.5 L");
});

const dish = (name: string, items: PlannedDish["items"], source: PlannedDish["source"] = "table"): PlannedDish => ({ query: name.toLowerCase(), name, source, items });

test("aggregation: merged across dishes, scaled from two servings, rounded once at the end", () => {
  const a = dish("Dal", [{ key: "toor-dal", qty: 150, unit: "g" }, { key: "onion", qty: 1, unit: "piece" }, { key: "garlic", qty: 3, unit: "clove" }, { key: "salt", qty: 1, unit: "tsp" }]);
  const b = dish("Curry", [{ key: "onion", qty: 2, unit: "piece" }, { key: "paneer", qty: 250, unit: "g" }, { key: "garlic", qty: 4, unit: "clove" }, { key: "cilantro", qty: 0.25, unit: "bunch", optional: true }]);
  const two = aggregate([a, b], 2, KNOWN);
  const line = (k: string, lines = two) => lines.find((l) => l.key === k)!;
  assert.equal(line("onion").label, "Onions × 3");
  assert.deepEqual(line("onion").dishes, ["Dal", "Curry"]);
  assert.equal(line("garlic").label, "Garlic × 1"); // 7 cloves: one bulb, not two rounded separately
  assert.equal(line("toor-dal").label, "Toor dal 500 g");
  assert.equal(line("paneer").label, "Paneer 400 g");
  assert.equal(line("salt").pantry, true);
  assert.equal(line("onion").pantry, false);
  assert.equal(line("cilantro").optional, true);
  assert.equal(line("onion").optional, false);
  assert.equal(line("onion").estimated, false);
  // four people: everything doubles before rounding
  const four = aggregate([a, b], 4, KNOWN);
  assert.equal(line("onion", four).label, "Onions × 6");
  assert.equal(line("paneer", four).label, "Paneer 2 × 400 g"); // 500 g
  assert.equal(line("garlic", four).label, "Garlic × 2"); // 14 cloves
  assert.equal(line("toor-dal", four).need, 300);
  // one person: halves, never below one purchasable unit
  const one = aggregate([a], 1, KNOWN);
  assert.equal(line("onion", one).label, "Onions × 1");
  assert.equal(line("toor-dal", one).need, 75);
  assert.equal(line("toor-dal", one).label, "Toor dal 500 g");
});

test("aggregation: a model dish marks its lines estimated, a pantry flag needs every dish to agree", () => {
  const t = dish("Dal", [{ key: "onion", qty: 1, unit: "piece" }, { key: "salt", qty: 1, unit: "tsp" }]);
  const m = dish("Mystery", [{ key: "onion", qty: 1, unit: "piece" }, { key: "toor-dal", qty: 100, unit: "g", pantry: true }], "model");
  const out = aggregate([t, m], 2, KNOWN);
  assert.equal(out.find((l) => l.key === "onion")!.estimated, true);
  assert.equal(out.find((l) => l.key === "salt")!.estimated, false);
  assert.equal(out.find((l) => l.key === "toor-dal")!.pantry, true);
  // an unknown key is skipped, not thrown on
  assert.doesNotThrow(() => aggregate([dish("X", [{ key: "nope", qty: 1, unit: "g" }])], 2, KNOWN));
});

const DISHES: Dish[] = [
  { id: "dal-chawal", name: "Dal chawal", cuisine: "indian", aliases: ["dal rice", "daal chawal"], core: ["toor-dal"], items: [] },
  { id: "rajma-chawal", name: "Rajma chawal", cuisine: "indian", aliases: ["rajma"], core: [], items: [] },
  { id: "pasta-arrabbiata", name: "Pasta arrabbiata", cuisine: "global", aliases: ["arrabbiata", "penne arrabbiata"], core: [], items: [] },
];

test("dish matching: names, aliases, typos; nothing loose", () => {
  assert.equal(matchDish("Dal Chawal", DISHES).dish?.id, "dal-chawal");
  assert.equal(matchDish("rajma", DISHES).dish?.id, "rajma-chawal");
  assert.equal(matchDish("pasta arabiata", DISHES).how, "fuzzy");
  assert.equal(matchDish("pasta arabiata", DISHES).dish?.id, "pasta-arrabbiata");
  assert.equal(matchDish("pasta carbonara", DISHES).dish, null);
  assert.equal(matchDish("ramen", DISHES).dish, null);
  const isDish = (s: string) => !!matchDish(s, [...DISHES, { id: "mac", name: "Mac and cheese", cuisine: "global", core: [], items: [] }]).dish;
  assert.deepEqual(splitDishes("dal chawal, rajma; poha\npasta arrabbiata and garlic bread", isDish), ["dal chawal", "rajma", "poha", "pasta arrabbiata", "garlic bread"]);
  assert.deepEqual(splitDishes("mac and cheese, rajma & poha", isDish), ["mac and cheese", "rajma", "poha"]);
  assert.deepEqual(splitDishes("  dal   chawal ,, dal chawal "), ["dal chawal"]);
});

test("model answers: unknown units and empty names dropped, quantities past the bounds clamped, both reported", () => {
  const out = checkModelIngredients(
    [
      { name: "onions", quantity: 2, unit: "piece" },
      { name: "toor dal", quantity: 5, unit: "kg" }, // 5 kg of dal for two
      { name: "coriander leaves", quantity: 1, unit: "bunch", optional: true },
      { name: "salt", quantity: 1, unit: "tsp", pantryStaple: true },
      { name: "", quantity: 1, unit: "g" },
      { name: "ghee", quantity: 2, unit: "handful" },
      { name: "paneer", quantity: 0, unit: "g" },
      { name: "water", quantity: 500, unit: "ml" },
      { name: "onion", quantity: 1, unit: "piece" }, // the same ingredient again adds up
      { name: "black cardamom pods", quantity: 2, unit: "piece" },
      { name: "dried thyme", quantity: 1, unit: "tsp", pantryStaple: true },
      { name: "cooking oil", quantity: 2, unit: "tbsp", pantryStaple: false },
    ],
    KNOWN,
  );
  assert.deepEqual(out.items.map((i) => i.key), ["onion", "toor-dal", "cilantro", "salt", "adhoc:black cardamom pod", "adhoc:dried thyme", "oil"]);
  assert.deepEqual(out.items[0], { key: "onion", qty: 3, unit: "piece", optional: false, pantry: false });
  assert.deepEqual(out.dropped.map((d) => d.name), ["(no name)", "ghee", "paneer"]);
  assert.match(out.dropped[1].reason, /unknown unit/);
  assert.deepEqual(out.clamped, [{ name: "Toor dal", from: "5 kg", to: "400 g" }]);
  assert.equal(toBase(dal, out.items[1].qty, out.items[1].unit), 400);
  assert.equal(out.items[3].pantry, true);
  assert.equal(out.items[2].optional, true);
  assert.equal(out.adHoc[0].name, "Black cardamom pods");
  // pantry is the table's word for what it knows, the model's for the rest; a spoonful of something unknown is a small jar
  assert.equal(out.items[6].pantry, true);
  assert.equal(out.items[5].pantry, true);
  assert.equal(purchase(out.adHoc[1], 3).label, "Dried thyme 50 g");
});

test("ingredient names: aliases and near spellings, never a loose guess", () => {
  assert.equal(ingredientFor("Coriander Leaves", KNOWN)?.key, "cilantro");
  assert.equal(ingredientFor("Onions", KNOWN)?.key, "onion");
  assert.equal(ingredientFor("toor daal", KNOWN)?.key, "toor-dal");
  assert.equal(ingredientFor("tofu", KNOWN), null);
});

test("the model's JSON: one dish's ingredient lines, anything else null", () => {
  const raw = { ingredients: [{ name: "x", quantity: "2", unit: "g", optional: true }, "junk", { name: "y" }] };
  assert.deepEqual(parseDishAnswer(raw), [
    { name: "x", quantity: 2, unit: "g", optional: true, pantryStaple: false },
    { name: "y", quantity: Number.NaN, unit: "", optional: false, pantryStaple: false },
  ]);
  assert.equal(parseDishAnswer("nonsense"), null);
  assert.equal(parseDishAnswer({ ingredients: "no" }), null);
});

test("a cut-off answer keeps the ingredients it finished", () => {
  const whole = JSON.stringify({ ingredients: [{ name: "x", quantity: 1, unit: "g", optional: false, pantryStaple: false }, { name: "y", quantity: 2, unit: "g", optional: false, pantryStaple: false }] });
  assert.deepEqual(parseDishJson(whole), JSON.parse(whole));
  const cut = whole.slice(0, whole.indexOf('"y"') + 12); // inside the second ingredient
  assert.deepEqual(parseDishAnswer(parseDishJson(cut))?.map((i) => i.name), ["x"]);
  assert.equal(parseDishJson('{"ingred'), null);
});
