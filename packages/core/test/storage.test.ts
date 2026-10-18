// Cold is storage: chilled / frozen belong to the shelf (the category at an item's location), never to the
// item's words, its aisle or its department. Shelf-stable milk, plant milk on an ambient shelf and drinks
// are ambient; the dairy case, the freezer aisles, meat and deli cold cases are cold; hot food is not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { demoSupercenter } from "@grosher/stores";
import { Router, WalkGraph, tagsForDepartment, type Stop } from "../src/index.ts";

const { store, categories } = demoSupercenter;
const isCold = (tags: readonly string[] | undefined) => (tags ?? []).some((t) => t === "chilled" || t === "frozen");

// the categories the demo treats as cold, spelled out: a change here is a decision, not a side effect
const COLD = ["bacon-sausage", "beef", "block-specialty-cheese", "butter-margarine", "chicken", "cream-creamer", "cut-fruit-juice", "cut-vegetables", "dairy-free-cheese", "deli-cheese", "deli-meat", "eggs", "frozen-appetizers", "frozen-bowls-indian", "frozen-bread-dough", "frozen-breakfast", "frozen-chicken", "frozen-desserts", "frozen-dinners", "frozen-fruit", "frozen-fruit-bars", "frozen-indian-breads", "frozen-international", "frozen-meat", "frozen-pasta-entrees", "frozen-pizza", "frozen-potatoes", "frozen-rice-grains", "frozen-sandwiches", "frozen-seafood", "frozen-turkey-ham", "frozen-vegetables", "frozen-veggie-protein", "halal-meat", "hot-dogs", "hummus-dips", "ice", "ice-cream", "ice-cream-bars", "kombucha-probiotic", "liquid-egg", "lunch-meat", "lunchables-snack-kits", "marinated-meat", "milk", "milk-alternatives", "paneer-indian-dairy", "party-trays", "plant-protein", "pork", "prepared-salads", "pudding-jello", "refrigerated-dough", "refrigerated-juice", "refrigerated-pasta", "seafood", "sherbet-sorbet", "shredded-cheese", "sour-cream-dips", "turkey-lamb", "whipped-cream", "yogurt"];

test("the cold categories are exactly the fridge and freezer ones", () => {
  assert.deepEqual(categories.filter((c) => isCold(c.tags)).map((c) => c.id).sort(), COLD);
  const byId = new Map(categories.map((c) => [c.id, c]));
  // ambient: shelf-stable milk and plant milk on the drinks shelf, every drink, coconut and evaporated milk
  for (const id of ["shelf-milk", "coconut-milk-curry", "evaporated-condensed", "creamer-shelf"]) assert.equal(isCold(byId.get(id)!.tags), false, id);
  for (const c of categories.filter((c) => c.department === "drinks")) assert.equal(isCold(c.tags), false, c.id);
  // the dairy case's plant milk is chilled; hot food is not cold
  assert.equal(isCold(byId.get("milk-alternatives")!.tags), true);
  assert.equal(isCold(byId.get("rotisserie")!.tags), false);
});

test("every shelf carries its category's storage, so the map and the categories agree", () => {
  const locs = new Map(store.locations.map((l) => [l.id, l]));
  for (const c of categories) {
    const loc = locs.get(c.locationId)!;
    assert.ok(Array.isArray(loc.tags), `${loc.id} has a tags array`);
    assert.equal(isCold(loc.tags), isCold(c.tags), `${loc.id} (${c.name})`);
  }
});

test("the solver takes cold from the shelf: a stop tagged chilled on an ambient shelf costs no cold penalty", () => {
  const router = new Router(new WalkGraph(store));
  const shelfOat: Stop = { id: "oat", name: "Oat milk", locationIds: ["A17-R11"], tags: ["chilled", "heavy"] }; // shelf-stable, A17 drinks
  const caseOat: Stop = { id: "oat2", name: "Oat milk", locationIds: ["DAIRY-L5"] }; // the dairy case, no tags of its own
  const { stops } = router.placeable([shelfOat, caseOat]);
  assert.deepEqual(stops[0].tags, ["heavy"]);
  assert.deepEqual(stops[1].tags, ["chilled"]);
  // ambient stops only: whatever the order, nothing is "cold before ambient"
  const chips: Stop = { id: "chips", name: "Chips", locationIds: [categories.find((c) => c.id === "potato-chips")!.locationId] };
  assert.equal(router.routeForOrder([shelfOat, chips]).penaltyM, 0);
  // the real cold item first, an ambient one after: penalised
  assert.ok(router.routeForOrder([caseOat, chips]).penaltyM > 0);
});

test("a department never implies cold (a model answer with no tags of its own)", () => {
  for (const d of ["dairy", "meat", "deli", "frozen", "drinks"]) assert.equal(isCold(tagsForDepartment(d)), false, d);
  assert.deepEqual(tagsForDepartment("produce"), ["produce"]);
});
