// The third fixture: 150 everyday items written blind (food, household,
// pharmacy, Indian staples, brands, misspellings), scored at aisle level on
// the demo Supercenter with the full offline pipeline (catalog, categories,
// no memory, no model). It prints the table per source and per kind and
// never asserts: the targets (≥ 85% without the model, ≥ 95% with it, see
// packages/stores/scripts/eval-everyday.ts for the second) are reported,
// not tuned against.

import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoSupercenter, departmentLocations } from "@grosher/stores";
import { resolveList, type ResolveResult, type ResolveSource } from "../src/resolve/index.ts";

interface Case {
  q: string;
  aisle: string | string[];
  kind: string;
}

export interface EverydayReport {
  total: number;
  correct: number;
  bySource: Record<string, { got: number; correct: number }>;
  byKind: Record<string, { total: number; correct: number }>;
  misses: string[];
}

/** score results at aisle level: the first location's aisle must be one the case names */
export function scoreEveryday(cases: Case[], results: ResolveResult[], aisleOf: (locationId: string) => string | undefined): EverydayReport {
  const bySource: EverydayReport["bySource"] = {};
  const byKind: EverydayReport["byKind"] = {};
  const misses: string[] = [];
  let correct = 0;
  cases.forEach((c, i) => {
    const r = results[i];
    const want = Array.isArray(c.aisle) ? c.aisle : [c.aisle];
    const got = r.locationIds.length ? aisleOf(r.locationIds[0]) : undefined;
    const ok = !!got && want.includes(got);
    const s = (bySource[r.source] ??= { got: 0, correct: 0 });
    s.got++;
    const k = (byKind[c.kind] ??= { total: 0, correct: 0 });
    k.total++;
    if (ok) {
      correct++;
      s.correct++;
      k.correct++;
    } else misses.push(`${JSON.stringify(c.q)} (${c.kind}): wanted ${want.join("|")}, got ${got ?? "nothing"} via ${r.source}${r.canonicalName ? ` "${r.canonicalName}"` : ""} (${r.confidence.toFixed(2)})`);
  });
  return { total: cases.length, correct, bySource, byKind, misses };
}

export function printEveryday(label: string, rep: EverydayReport): void {
  const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(0).padStart(3)}%`;
  const order: ResolveSource[] = ["exact", "fuzzy", "memory", "category", "llm", "unknown"];
  const lines = [
    "",
    label,
    "source     routed  correct   rate",
    ...order.filter((s) => rep.bySource[s]).map((s) => `${s.padEnd(10)} ${String(rep.bySource[s].got).padStart(5)}  ${String(rep.bySource[s].correct).padStart(7)}   ${pct(rep.bySource[s].correct, rep.bySource[s].got)}`),
    `${"all".padEnd(10)} ${String(rep.total).padStart(5)}  ${String(rep.correct).padStart(7)}   ${pct(rep.correct, rep.total)}`,
    "",
    "kind        items  correct   rate",
    ...Object.entries(rep.byKind).map(([k, v]) => `${k.padEnd(10)} ${String(v.total).padStart(5)}  ${String(v.correct).padStart(7)}   ${pct(v.correct, v.total)}`),
    ...rep.misses.map((m) => `  miss  ${m}`),
    "",
  ];
  console.log(lines.join("\n"));
}

export const everydayCases = (): Case[] => (JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "resolution-everyday.json"), "utf8")) as { cases: Case[] }).cases;

test("everyday fixture: 150 items at aisle level without the model, report only", async () => {
  const { store, categories } = demoSupercenter;
  const catalog = await demoSupercenter.loadCatalog(); // the full file, not the base rows
  const cases = everydayCases();
  const results = resolveList(
    cases.map((c) => c.q),
    { catalog, categories, departments: store.departments, departmentLocations: departmentLocations(store), now: 2 },
  );
  const aisleOf = (id: string) => store.locations.find((l) => l.id === id)?.aisle;
  const rep = scoreEveryday(cases, results, aisleOf);
  printEveryday(`everyday set (resolution-everyday.json), no model · catalog ${catalog.length} items, ${categories.length} categories`, rep);
});
