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

const rows: string[][] = [["stops", "solver", "list order (m)", "grosher (m)", "saved", "saved p10–p90", "≈ min saved", "solve p50 (ms)", "solve max (ms)"]];
const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};
const range = (saved: number[]) => `${(pct(saved, 0.1) * 100).toFixed(0)}–${(pct(saved, 0.9) * 100).toFixed(0)}%`;
const r = rng(42);
for (const n of [5, 8, 10, 12, 13, 18, 25, 30]) {
  const trials = n <= 13 ? 30 : 10;
  let naive = 0;
  let opt = 0;
  const times: number[] = [];
  const saved: number[] = []; // per list: 1 − route / list order
  let solver = "";
  for (let t = 0; t < trials; t++) {
    const stops = sample(n, r);
    const listOrder = router.routeForOrder(stops).distanceM;
    naive += listOrder;
    const route = router.solve({ stops });
    opt += route.distanceM;
    saved.push(1 - route.distanceM / listOrder);
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
    range(saved),
    ((naive - opt) / trials / WALK_MPS / 60).toFixed(1),
    times[Math.floor(times.length / 2)].toFixed(1),
    times[times.length - 1].toFixed(1),
  ]);
}

const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => row[c].length)));
for (const row of rows) console.log(row.map((cell, c) => cell.padStart(widths[c])).join("  "));
console.log(`\nDemo store, averages over random lists. Distances are walking only (penalties excluded).`);

// 14 stops on its own seed (the table's shared stream stays untouched): the range a 14-item trip's
// "vs list in order" should land in. The project page's capture is a 14-item list.
{
  const r14 = rng(1414);
  const saved: number[] = [];
  for (let t = 0; t < 30; t++) {
    const stops = sample(14, r14);
    saved.push(1 - router.solve({ stops }).distanceM / router.routeForOrder(stops).distanceM);
  }
  const mean = saved.reduce((a, b) => a + b, 0) / saved.length;
  console.log(`14 stops, 30 random lists: saved mean ${(mean * 100).toFixed(0)}%, p10–p90 ${range(saved)}, min–max ${(pct(saved, 0) * 100).toFixed(0)}–${(pct(saved, 1) * 100).toFixed(0)}%`);
}
