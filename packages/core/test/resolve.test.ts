import { test } from "node:test";
import assert from "node:assert/strict";
import type { Stop } from "../src/index.ts";
import { confirmMemory, demoteMemory, placeMemory, resolveItem, resolveList, suggestFromMemory, toStop, pendingEntry } from "../src/resolve/index.ts";
import { damerauLevenshtein, forms, similarity, singularize, stripQuantity } from "../src/resolve/text.ts";

const catalog: Stop[] = [
  { id: "milk", name: "Milk", locationIds: ["DAIRY-10"], tags: ["chilled", "heavy"] },
  { id: "eggs", name: "Eggs", locationIds: ["DAIRY-8"], tags: ["fragile", "chilled"] },
  { id: "yogurt", name: "Greek yogurt", locationIds: ["DAIRY-11"], tags: ["chilled"], aliases: ["yogurt", "yoghurt"] },
  { id: "tp", name: "Toilet paper", locationIds: ["A8-20"], aliases: ["toilet roll", "bath tissue", "charmin"] },
  { id: "cereal", name: "Cereal", locationIds: ["A3-8"], aliases: ["cheerios"] },
  { id: "tortillas", name: "Tortillas", locationIds: ["BAKERY-25"] },
];
const ctx = {
  catalog,
  categories: [
    { id: "milk-alternatives", name: "Milk alternatives", group: "Dairy", aisle: "DAIRY", side: "L" as const, bays: [3, 4] as [number, number], locationId: "DAIRY-L3", department: "dairy", tags: ["chilled" as const], aliases: ["almond milk", "plant milk"] }, // "oat milk" stays an llm case here
    { id: "cereal", name: "Cereal", group: "Cereal · Breakfast", aisle: "A10", side: "L" as const, bays: [1, 8] as [number, number], locationId: "A10-L1", department: "dry", aliases: ["cheerios", "corn flakes"] },
    { id: "toilet-paper", name: "Toilet paper", group: "Paper", aisle: "A23", side: "L" as const, bays: [1, 8] as [number, number], locationId: "A23-L1", department: "household", aliases: ["tp", "bath tissue"] },
  ],
  memory: [{ name: "ghee", locationId: "A1-20", lastConfirmed: 1, confirms: 2, confidence: 0.9 }],
  // the clock is frozen just after the memory was confirmed, so no time decay applies
  now: 10,
  llm: new Map([
    ["oat milk", { category: "milk-alternatives", subcategory: "plant milk", tags: ["chilled" as const], confidence: 0.65 }],
    ["birthday card", null],
  ]),
};

test("text: quantities, plurals, similarity", () => {
  assert.equal(stripQuantity("Toilet paper 12 pack"), "toilet paper");
  assert.equal(stripQuantity("milk 1 gallon"), "milk");
  assert.equal(singularize("tortillas berries boxes"), "tortilla berry box");
  assert.ok(forms("Eggs").includes("egg"));
  assert.equal(damerauLevenshtein("cerael", "cereal"), 1);
  assert.ok(similarity("bananna", "banana") > 0.8);
  assert.ok(similarity("oat milk", "milk") < 0.72, "oat milk must not fuzzy-match milk");
});

test("layers: exact, fuzzy, memory, llm, unknown, and fall-through order", () => {
  assert.equal(resolveItem("EGGS", ctx).source, "exact");
  assert.equal(resolveItem("egg", ctx).source, "exact");
  assert.equal(resolveItem("Toilet paper 12 pack", ctx).source, "exact");
  assert.equal(resolveItem("Charmin", ctx).stopId, "tp");
  const yog = resolveItem("yoghurts", ctx);
  assert.equal(yog.source, "exact");
  assert.equal(yog.stopId, "yogurt");
  const branded = resolveItem("Chobani greek yogurt", ctx); // a multi-word catalog name inside the query
  assert.equal(branded.source, "fuzzy");
  assert.equal(branded.stopId, "yogurt");
  assert.equal(resolveItem("oat milk", { catalog }).source, "unknown"); // a single word with a modifier is not
  const fuzzy = resolveItem("tortila", ctx);
  assert.equal(fuzzy.source, "fuzzy");
  assert.equal(fuzzy.stopId, "tortillas");
  assert.ok(fuzzy.confidence >= 0.6 && fuzzy.confidence < 1);
  const mem = resolveItem("Ghee", ctx);
  assert.equal(mem.source, "memory");
  assert.deepEqual(mem.locationIds, ["A1-20"]);
  const llm = resolveItem("oat milk", ctx);
  assert.equal(llm.source, "llm");
  assert.deepEqual(llm.locationIds, ["DAIRY-L3"]); // the category's one slot
  assert.deepEqual(llm.tags, ["chilled"]);
  assert.equal(llm.subcategory, "plant milk");
  assert.equal(resolveItem("birthday card", ctx).source, "unknown");
  assert.equal(resolveItem("zxqv", ctx).source, "unknown");
});

test("a demoted memory falls through; a pending llm entry resolves exactly but keeps its source", () => {
  const demoted = demoteMemory(demoteMemory(ctx.memory, "ghee"), "ghee"); // 0.9 → 0.3
  assert.equal(resolveItem("ghee", { ...ctx, memory: demoted }).source, "unknown");
  const pending = pendingEntry(resolveItem("oat milk", ctx))!;
  assert.equal(pending.source, "llm");
  const r = resolveItem("oat milk", { catalog: [...catalog, pending] });
  assert.equal(r.source, "llm");
  assert.equal(r.confidence, pending.confidence); // the guess band carries over until a Got it lifts it
  assert.ok(r.confidence < 0.5 && r.confidence >= 0.3);
  assert.equal(toStop(r)!.source, "llm");
  assert.equal(toStop(resolveItem("nope", ctx)), null);
});

test("memory updates: confirm raises toward 1, demote lowers, place replaces", () => {
  let m = confirmMemory([], "ghee", "A1-20", 5);
  assert.equal(m[0].confidence, 0.8);
  m = confirmMemory(m, "Ghee", "A1-20", 6);
  assert.equal(m[0].confirms, 2);
  assert.ok(Math.abs(m[0].confidence - 0.86) < 1e-9); // 30% of the gap
  assert.equal(m[0].lastConfirmed, 6);
  m = demoteMemory(m, "ghee", 7);
  assert.ok(Math.abs(m[0].confidence - 0.56) < 1e-9);
  assert.equal(m[0].misses, 1);
  assert.equal(m[0].lastMissed, 7);
  m = placeMemory(m, "ghee", "A2-8", 7);
  assert.equal(m.length, 1);
  assert.equal(m[0].locationId, "A2-8");
  assert.equal(m[0].confidence, 0.9);
  assert.equal(resolveList(["milk", "ghee"], { ...ctx, memory: m })[1].locationIds[0], "A2-8");
});

test("decay applies on read: a memory confirmed 150 days ago resolves at .7, a catalog entry confirmed long ago at the floor", () => {
  const DAY = 86_400_000;
  const memory = [{ name: "ghee", locationId: "A1-20", lastConfirmed: 0, confirms: 3, confidence: 0.9 }];
  assert.ok(Math.abs(resolveItem("ghee", { catalog: [], memory, now: 150 * DAY }).confidence - 0.7) < 1e-9);
  assert.equal(resolveItem("ghee", { catalog: [], memory, now: 10 * DAY }).confidence, 0.9);
  const stale = [{ id: "s", name: "Saffron", locationIds: ["A1-20"], confidence: 0.95, lastConfirmed: 0 }];
  assert.ok(Math.abs(resolveItem("saffron", { catalog: stale, now: 400 * DAY }).confidence - 0.4) < 1e-9);
  assert.equal(resolveItem("saffron", { catalog: stale, now: 1 }).confidence, 0.95);
});

import { parseLlmResults } from "../src/resolve/llmPrompt.ts";

test("parseLlmResults: maps by item, drops unknown categories, bands confidence, capitalises names", () => {
  const rows = parseLlmResults(
    { results: [{ name: "oat milk", cat: "dairy", sub: "plant milk cartons extra", conf: 0.9, tags: ["chilled", "heavy", "bogus"] }, { name: "ghee", cat: "international", conf: 0.5 }, { name: "x", cat: null }] },
    ["oat milk", "ghee", "x", "never answered"],
    ["dairy", "dry"],
  );
  assert.equal(rows.length, 4);
  assert.equal(rows[0].canonicalName, "Oat milk");
  assert.equal(rows[0].subcategory, "plant milk cartons");
  assert.deepEqual(rows[0].tags, ["chilled", "heavy"]); // the model's valid tags win
  assert.deepEqual(parseLlmResults({ results: [{ name: "oat milk", cat: "dairy", sub: "", conf: 0.9, tags: [] }] }, ["oat milk"], ["dairy"])[0].tags, undefined); // none given: the llm layer fills them from the category
  assert.ok(Math.abs(rows[0].confidence - 0.68) < 1e-9);
  assert.equal(rows[1].category, null);
  assert.equal(rows[3].category, null);
});

test("brand memory: typed forms are remembered and offered for shorter or variant queries", () => {
  let m = confirmMemory([], "Greek yogurt", "DAIRY-11", 10, ["chilled"], "Chobani greek yogurt");
  assert.deepEqual(m[0].typedForms, ["Chobani greek yogurt"]);
  m = confirmMemory(m, "greek yogurt", "DAIRY-11", 11, undefined, "chobani greek yogurt"); // same form, normalised: no duplicate
  assert.equal(m[0].typedForms!.length, 1);
  m = placeMemory(m, "Greek yogurt", "DAIRY-8", 12, undefined, "Chobani yoghurt 4 pack");
  assert.deepEqual(m[0].typedForms, ["Chobani greek yogurt", "Chobani yoghurt 4 pack"]);
  assert.equal(suggestFromMemory("yogurt", m)?.text, "Chobani greek yogurt"); // fullest containing form
  assert.equal(suggestFromMemory("greek yoghurt", m)?.text, "Chobani greek yogurt"); // variant spelling
  assert.equal(suggestFromMemory("Chobani greek yogurt", m), null); // already the full form
  assert.equal(suggestFromMemory("chobani", m)?.text, "Chobani yoghurt 4 pack"); // both exact and equally recent: the fuller form
  assert.equal(suggestFromMemory("milk", m), null);
  // a typed form also resolves through the memory layer
  assert.equal(resolveItem("Chobani yoghurt 4 pack", { catalog: [], memory: m, now: 13 }).source, "memory");
  assert.equal(toStop({ ...resolveItem("x", { catalog: [], memory: m }), locationIds: ["A1-8"], query: "x" })!.query, "x");
});

import { CandidateIndex, catalogHash, hasIndex, primeIndex, transferablesOf } from "../src/resolve/index.ts";

test("index parts round-trip: the same answers after structured clone; the hash tracks content; a prebuilt index is searched before the small one", () => {
  const big = new CandidateIndex(catalog);
  const parts = structuredClone(big.toParts());
  const again = CandidateIndex.fromParts(catalog, parts);
  for (const q of ["milk", "egs", "toilet rol", "greek yogurt", "tp"]) {
    assert.deepEqual(again.exact(q)?.stop.id, big.exact(q)?.stop.id, q);
    assert.deepEqual(again.best(q, 0.72)?.c.stop.id, big.best(q, 0.72)?.c.stop.id, q);
  }
  assert.equal(transferablesOf(parts).length, 6);
  assert.equal(catalogHash(catalog), catalogHash([...catalog]));
  assert.notEqual(catalogHash(catalog), catalogHash([...catalog, { id: "x", name: "X", locationIds: ["A1-L1"] }]));
  assert.notEqual(catalogHash(catalog), catalogHash(catalog.map((s) => (s.id === "milk" ? { ...s, aliases: ["moo"] } : s))));
  // the app: a big prebuilt index plus a small catalog of pending rows
  const pending: Stop[] = [{ id: "mem:ghee", name: "Ghee", locationIds: ["A7-L11"], source: "memory" }];
  primeIndex(catalog, again);
  assert.ok(hasIndex(catalog));
  const r = resolveList(["milk", "ghee", "egs"], { catalog: pending, index: again });
  assert.deepEqual(r.map((x) => [x.source, x.stopId]), [["exact", "milk"], ["memory", "mem:ghee"], ["fuzzy", "eggs"]]);
});
