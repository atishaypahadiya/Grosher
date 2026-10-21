// Cook mode's model answers, scored from the recording (test/fixtures/dishes-model.json, made by
// scripts/eval-dishes.ts against the local model): for ten dishes the table does not have, how many core
// ingredients the model left out, and what validation dropped or clamped. Reports; asserts only that the
// recording parses, every dish was answered, and validation leaves every line inside its bounds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregate, BOUNDS, toBase } from "@grosher/core";
import { INGREDIENTS, INGREDIENT_BY_KEY } from "../src/index.ts";
import { fixture, printScore, scoreRecording, type Recording } from "./dish-score.ts";

test("the recorded model answers: every dish answered, scored, and validated inside the bounds", () => {
  const rec = JSON.parse(readFileSync(new URL("./fixtures/dishes-model.json", import.meta.url), "utf8")) as Recording;
  const s = scoreRecording(rec);
  printScore(s);
  assert.equal(s.dishes.length, fixture.dishes.length);
  for (const d of s.dishes) assert.ok(d.answered, `${d.dish} was not answered`);
  // after validation nothing is past its category's bound, whatever the model said
  for (const d of s.dishes)
    for (const it of d.checked!.items) {
      const info = INGREDIENT_BY_KEY.get(it.key) ?? d.checked!.adHoc.find((a) => a.key === it.key)!;
      const b = toBase(info, it.qty, it.unit)!;
      assert.ok(b <= BOUNDS[info.category][info.base] + 1e-6, `${d.dish}: ${info.name} ${b}`);
    }
  // and the whole lot aggregates for four people without throwing
  const planned = s.dishes.map((d) => ({ query: d.dish, name: d.dish, source: "model" as const, items: d.checked!.items }));
  const lines = aggregate(planned, 4, INGREDIENTS, s.dishes.flatMap((d) => d.checked!.adHoc));
  assert.ok(lines.length > 20 && lines.every((l) => l.estimated));
});
