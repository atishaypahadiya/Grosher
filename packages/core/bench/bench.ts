// Benchmark: Grosher route vs walking the list in the order it was typed.
// Run: npm run bench

import { Router, WalkGraph, type Stop } from "../src/index.ts";
import { demoSupercenter } from "@grosher/stores";

const { store: DEMO_STORE, catalog: DEMO_ITEMS } = demoSupercenter;

const router = new Router(new WalkGraph(DEMO_STORE));
const WALK_MPS = 1.0; // shopping pace with a cart, m/s (rough)

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
function sample(n: number, r: () => number): Stop[] {
  const pool = [...DEMO_ITEMS];
  const out: Stop[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

const rows: string[][] = [["stops", "solver", "list order (m)", "grosher (m)", "saved", "≈ min saved", "solve p50 (ms)", "solve max (ms)"]];
const r = rng(42);
for (const n of [5, 8, 10, 12, 13, 18, 25, 30]) {
  const trials = n <= 13 ? 30 : 10;
  let naive = 0;
  let opt = 0;
  const times: number[] = [];
  let solver = "";
  for (let t = 0; t < trials; t++) {
    const stops = sample(n, r);
    naive += router.routeForOrder(stops).distanceM;
    const route = router.solve({ stops });
    opt += route.distanceM;
    times.push(route.solveMs);
    solver = route.solver;
  }
  times.sort((a, b) => a - b);
  rows.push([
    String(n),
    solver,
    (naive / trials).toFixed(0),
    (opt / trials).toFixed(0),
    `${((1 - opt / naive) * 100).toFixed(0)}%`,
    ((naive - opt) / trials / WALK_MPS / 60).toFixed(1),
    times[Math.floor(times.length / 2)].toFixed(1),
    times[times.length - 1].toFixed(1),
  ]);
}

const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => row[c].length)));
for (const row of rows) console.log(row.map((cell, c) => cell.padStart(widths[c])).join("  "));
console.log(`\nDemo store, averages over random lists. Distances are walking only (penalties excluded).`);
