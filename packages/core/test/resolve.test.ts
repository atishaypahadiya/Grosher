import { test } from "node:test";
import assert from "node:assert/strict";
import type { Stop } from "../src/index.ts";
import { confirmMemory, demoteMemory, placeMemory, resolveItem, resolveList, toStop, pendingEntry } from "../src/resolve/index.ts";
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
  departmentLocations: { dairy: ["DAIRY-8", "DAIRY-10", "DAIRY-11"], dry: ["A1-8", "A2-8"] },
  memory: [{ name: "ghee", locationId: "A1-20", lastConfirmed: 1, confirms: 2, confidence: 0.9 }],
  llm: new Map([
    ["oat milk", { department: "dairy", subcategory: "plant milk", tags: ["chilled" as const], confidence: 0.65 }],
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
  const fuzzy = resolveItem("tortila", ctx);
  assert.equal(fuzzy.source, "fuzzy");
  assert.equal(fuzzy.stopId, "tortillas");
  assert.ok(fuzzy.confidence >= 0.6 && fuzzy.confidence < 1);
  const mem = resolveItem("Ghee", ctx);
  assert.equal(mem.source, "memory");
  assert.deepEqual(mem.locationIds, ["A1-20"]);
  const llm = resolveItem("oat milk", ctx);
  assert.equal(llm.source, "llm");
  assert.deepEqual(llm.locationIds, ["DAIRY-8", "DAIRY-10", "DAIRY-11"]);
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
  assert.equal(r.confidence, 0.6);
  assert.equal(toStop(r)!.source, "llm");
  assert.equal(toStop(resolveItem("nope", ctx)), null);
});

test("memory updates: confirm raises toward 1, demote lowers, place replaces", () => {
  let m = confirmMemory([], "ghee", "A1-20", 5);
  assert.equal(m[0].confidence, 0.8);
  m = confirmMemory(m, "Ghee", "A1-20", 6);
  assert.equal(m[0].confirms, 2);
  assert.equal(m[0].confidence, 0.9);
  m = demoteMemory(m, "ghee");
  assert.ok(Math.abs(m[0].confidence - 0.6) < 1e-9);
  m = placeMemory(m, "ghee", "A2-8", 7);
  assert.equal(m.length, 1);
  assert.equal(m[0].locationId, "A2-8");
  assert.equal(m[0].confidence, 0.9);
  assert.equal(resolveList(["milk", "ghee"], { ...ctx, memory: m })[1].locationIds[0], "A2-8");
});

import { parseLlmResults } from "../src/resolve/llmPrompt.ts";

test("parseLlmResults: maps by item, drops foreign departments, bands confidence, capitalises names", () => {
  const rows = parseLlmResults(
    { results: [{ item: "oat milk", department: "dairy", subcategory: "milk", canonicalName: "oat milk", tags: ["chilled", "nope"], confidence: 0.9 }, { item: "ghee", department: "international", confidence: 0.5 }, { item: "x", department: null }] },
    ["oat milk", "ghee", "x", "never answered"],
    ["dairy", "dry"],
  );
  assert.equal(rows.length, 4);
  assert.equal(rows[0].canonicalName, "Oat milk");
  assert.deepEqual(rows[0].tags, ["chilled"]);
  assert.ok(Math.abs(rows[0].confidence - 0.68) < 1e-9);
  assert.equal(rows[1].department, null);
  assert.equal(rows[3].department, null);
});
