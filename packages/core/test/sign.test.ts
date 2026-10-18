import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Category } from "../src/index.ts";
import { matchSign, parseSignWords, signFragments } from "../src/index.ts";

const raw = JSON.parse(readFileSync(new URL("../../stores/demo/categories.json", import.meta.url), "utf8"));
const categories: Category[] = Array.isArray(raw) ? raw : raw.categories;

test("a sign's lines become the categories they name, with the aisle number", () => {
  const r = matchSign(["Aisle 12", "Cereal & Breakfast", "Coffee · Tea", "Hot Cocoa"], categories);
  assert.equal(r.aisleNumber, "12");
  assert.deepEqual(
    r.matches.map((m) => m.name),
    ["Cereal", "Ground & whole bean coffee", "Tea", "Hot cocoa & drink mixes"],
  );
  assert.ok(r.matches.every((m) => m.confidence >= 0.6 && m.confidence <= 0.79));
  assert.deepEqual(r.unmatched, []);
});

test("a heading that names a sign group, not a category, lands as a group; nonsense stays unmatched", () => {
  const r = matchSign(["7", "Indian Foods", "Atta & Rice", "Rollback"], categories);
  assert.equal(r.aisleNumber, "7");
  assert.deepEqual(r.groups.map((g) => g.group), ["Asian · Indian · Mediterranean"]);
  assert.ok(r.matches.some((m) => m.name === "Rice"));
  assert.deepEqual(r.unmatched, ["Rollback"]);
});

test("one match per category, the best; a misread within a letter still matches", () => {
  const r = matchSign(["Paper Towels", "PAPER TOWELS", "Bath Tisue"], categories);
  assert.equal(r.matches.filter((m) => m.name === "Paper towels").length, 1);
  assert.ok(r.matches.some((m) => m.name === "Toilet paper"));
});

test("fragments and the model's answer", () => {
  assert.deepEqual(signFragments("Chips / Snacks & Dips · Salsa"), ["Chips", "Snacks", "Dips", "Salsa"]);
  assert.deepEqual(parseSignWords('{"words":[" Aisle 12 ","Cereal","cereal",3,""]}'), ["Aisle 12", "Cereal"]);
  assert.throws(() => parseSignWords("I see a sign"), /not JSON/);
  assert.throws(() => parseSignWords({ text: "x" }), /no words/);
});

test("cold comes from the shelf's category, not the answer: shelf-stable oat milk is ambient, the dairy case chilled", async () => {
  const { resolveItem, withStorage } = await import("../src/index.ts");
  // a name only the model places: it picks the shelf-stable milk category and says chilled
  const ctx = { catalog: [], categories, llm: new Map([["zorbo oat drink", { category: "shelf-milk", confidence: 0.68, tags: ["chilled" as const] }]]), locations: new Set(categories.map((c) => c.locationId)) };
  const shelf = resolveItem("zorbo oat drink", ctx);
  assert.equal(shelf.locationIds[0], "A17-R11");
  assert.deepEqual(shelf.tags, []); // the model said chilled; the drinks aisle is ambient
  // "oat milk" itself: the Milk alternatives sign names it, the dairy case, chilled
  assert.deepEqual(resolveItem("oat milk", ctx).tags, ["chilled"]);
  const base = { query: "oat milk", confidence: 0.9, source: "exact" as const, canonicalName: "Oat milk", tags: ["fragile" as const] };
  assert.deepEqual(withStorage({ ...base, locationIds: ["DAIRY-L5"] }, ctx).tags, ["fragile", "chilled"]);
  // a department id answer places nothing in a store with categories (it used to land in dry goods)
  const dept = resolveItem("sunglasses", { ...ctx, llm: new Map([["sunglasses", { category: "dry", confidence: 0.6 }]]), departmentLocations: { dry: ["A1-L1"] } });
  assert.equal(dept.source, "unknown");
});
