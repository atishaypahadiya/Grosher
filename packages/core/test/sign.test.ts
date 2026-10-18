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
