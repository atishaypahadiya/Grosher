// 60-item resolution fixture against the demo store: typos, plurals,
// quantities, brands, the shopper's memory, llm guesses (mocked), and
// things a grocery store does not sell. Prints the hit rate per layer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { demoSupercenter, departmentLocations } from "@grosher/stores";
import { resolveList, type ItemMemory, type LlmGuess, type ResolveSource } from "../src/resolve/index.ts";

interface Case {
  q: string;
  source: ResolveSource;
  stop?: string;
  location?: string;
  department?: string;
}
interface Fixture {
  memory: ItemMemory[];
  llm: Record<string, LlmGuess | null>;
  cases: Case[];
}

function load(name: string): Fixture {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Fixture;
}

/** Runs a fixture, prints the per-layer table, returns the misses. */
function run(label: string, fixture: Fixture): string[] {
  const { store, catalog } = demoSupercenter;
  const deptLocs = departmentLocations(store);
  // the fixture's clock is frozen: its memory rows were confirmed at t = 1, so "now" is t = 2 and no decay applies
  const ctx = { catalog, departments: store.departments, departmentLocations: deptLocs, memory: fixture.memory, llm: new Map(Object.entries(fixture.llm)), now: 2 };
  const results = resolveList(fixture.cases.map((c) => c.q), ctx);
  const layers: ResolveSource[] = ["exact", "fuzzy", "memory", "llm", "unknown"];
  const stats = Object.fromEntries(layers.map((l) => [l, { expected: 0, hit: 0, got: 0 }])) as Record<ResolveSource, { expected: number; hit: number; got: number }>;
  const misses: string[] = [];
  fixture.cases.forEach((c, i) => {
    const r = results[i];
    stats[c.source].expected++;
    stats[r.source].got++;
    let ok = r.source === c.source;
    if (ok && c.stop) ok = r.stopId === c.stop;
    if (ok && c.location) ok = r.locationIds[0] === c.location;
    if (ok && c.department) ok = r.department === c.department && r.locationIds.every((id) => deptLocs[c.department!].includes(id));
    // llm guesses live in .5–.7 (the layer is last, a weak guess still stands); every other hit must clear the fall-through
    if (ok && c.source !== "unknown") ok = r.locationIds.length > 0 && r.confidence >= (c.source === "llm" ? 0.3 : 0.6);
    if (ok && c.source === "unknown") ok = r.locationIds.length === 0;
    if (ok) stats[c.source].hit++;
    else misses.push(`${JSON.stringify(c.q)}: expected ${c.source}${c.stop ? `/${c.stop}` : ""} got ${r.source}${r.stopId ? `/${r.stopId}` : ""} (${r.confidence.toFixed(2)})`);
  });
  const n = fixture.cases.length;
  const rows = layers.map((l) => `${l.padEnd(8)} ${String(stats[l].hit).padStart(3)}/${String(stats[l].expected).padEnd(3)} ${((100 * stats[l].hit) / Math.max(1, stats[l].expected)).toFixed(0).padStart(4)}%   routed as ${l}: ${stats[l].got}`);
  const total = layers.reduce((s, l) => s + stats[l].hit, 0);
  console.log(["", `${label}`, "layer     hit/exp   rate", ...rows, `${"all".padEnd(8)} ${String(total).padStart(3)}/${n}   ${((100 * total) / n).toFixed(0).padStart(4)}%`, ...misses.map((m) => `  miss  ${m}`), ""].join("\n"));
  return misses;
}

test("tuned fixture: 60 items, every layer, no misses", () => {
  const fixture = load("resolution.json");
  assert.equal(fixture.cases.length, 60);
  assert.deepEqual(run("tuned set (resolution.json)", fixture), []);
});

// The held-out set reports; it never gates the build and the thresholds are never tuned on it.
test("held-out fixture: 30 items, report only", () => {
  const fixture = load("resolution-heldout.json");
  assert.equal(fixture.cases.length, 30);
  run("held-out set (resolution-heldout.json)", fixture);
});
