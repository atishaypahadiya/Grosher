// Cook mode's model eval, shared by scripts/eval-dishes.ts and test/meals-model.test.ts: scores a recording of the
// local model's answers for the dishes of fixtures/dishes-unseen.json (missing core ingredients, what validation
// dropped or clamped).

import { readFileSync } from "node:fs";
import { checkModelIngredients, parseDishAnswer, parseDishJson, type Checked } from "@grosher/core";
import { INGREDIENTS } from "../src/meals/index.ts";

export interface Recording {
  model: string;
  recordedAt: string;
  /** dishes asked at once */
  concurrency: number;
  totalMs: number;
  calls: { dish: string; ms: number; outputTokens: number | null; generationMs: number | null; content: string }[];
}

interface DishScore {
  dish: string;
  answered: boolean;
  ingredients: number;
  missing: string[];
  checked: Checked | null;
}

export const fixture = JSON.parse(readFileSync(new URL("./fixtures/dishes-unseen.json", import.meta.url), "utf8")) as { dishes: { dish: string; core: string[][] }[] };

export function scoreRecording(rec: Recording) {
  const out: DishScore[] = [];
  for (const call of rec.calls) {
    const { dish } = call;
    const lines = parseDishAnswer(parseDishJson(call.content));
    const core = fixture.dishes.find((d) => d.dish === dish)?.core ?? [];
    if (!lines) {
      out.push({ dish, answered: false, ingredients: 0, missing: core.map((c) => c[0]), checked: null });
      continue;
    }
    const names = lines.map((i) => i.name.toLowerCase());
    const missing = core.filter((alts) => !alts.some((alt) => names.some((n) => n.includes(alt.toLowerCase())))).map((c) => c[0]);
    out.push({ dish, answered: true, ingredients: lines.length, missing, checked: checkModelIngredients(lines, INGREDIENTS) });
  }
  const coreTotal = fixture.dishes.reduce((s, d) => s + d.core.length, 0);
  const missing = out.reduce((s, d) => s + d.missing.length, 0);
  return { rec, dishes: out, coreTotal, coreFound: coreTotal - missing, dropped: out.reduce((s, d) => s + (d.checked?.dropped.length ?? 0), 0), clamped: out.reduce((s, d) => s + (d.checked?.clamped.length ?? 0), 0) };
}

export function printScore(s: ReturnType<typeof scoreRecording>) {
  console.log(`\nCook mode model eval: ${s.rec.model}, recorded ${s.rec.recordedAt}, one call a dish, ${s.rec.concurrency} at once, ${(s.rec.totalMs / 1000).toFixed(1)} s for ${s.rec.calls.length}`);
  for (const d of s.dishes) {
    const ch = d.checked;
    const c = s.rec.calls.find((x) => x.dish === d.dish)!;
    console.log(`  ${d.dish.padEnd(16)} ${(c.ms / 1000).toFixed(1).padStart(5)} s ${String(c.outputTokens).padStart(4)} tok  ${d.answered ? `${d.ingredients} ingredients` : "NOT ANSWERED"}${d.missing.length ? `  missing core: ${d.missing.join(", ")}` : ""}${ch?.dropped.length ? `  dropped: ${ch.dropped.map((x) => `${x.name} (${x.reason})`).join("; ")}` : ""}${ch?.clamped.length ? `  clamped: ${ch.clamped.map((x) => `${x.name} ${x.from} → ${x.to}`).join("; ")}` : ""}`);
  }
  console.log(`  core ingredients found: ${s.coreFound} / ${s.coreTotal} (${Math.round((100 * s.coreFound) / s.coreTotal)}%), dropped ${s.dropped}, clamped ${s.clamped}\n`);
}

