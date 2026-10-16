import { test } from "node:test";
import assert from "node:assert/strict";
import { Router, WalkGraph, type Stop } from "../src/index.ts";
import { DEMO_ITEMS, makeDemoStore } from "../src/fixtures/demoStore.ts";

const router = new Router(new WalkGraph(makeDemoStore()));

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
function sample(n: number, seed: number): Stop[] {
  const r = rng(seed);
  const pool = [...DEMO_ITEMS];
  const out: Stop[] = [];
  while (out.length < n) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}
function* permutations<T>(xs: T[]): Generator<T[]> {
  if (xs.length <= 1) return yield xs;
  for (let i = 0; i < xs.length; i++)
    for (const p of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...p];
}

test("graph: every shelf location is reachable from the entrance and reaches the exit", () => {
  const g = router.graph;
  const fromEntrance = g.dijkstra(g.store.entranceId).dist;
  for (const [loc, node] of g.locationNode) {
    assert.ok(Number.isFinite(fromEntrance.get(node)), `unreachable: ${loc}`);
    assert.ok(Number.isFinite(router.dist(node, g.store.exitId)), `no way out from: ${loc}`);
  }
});

test("held-karp matches brute force (incl. penalties and multi-location items)", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const stops = sample(6, seed);
    const exact = router.solve({ stops, mode: "exact" });
    let best = Infinity;
    for (const perm of permutations(stops)) best = Math.min(best, router.routeForOrder(perm).costM);
    assert.ok(Math.abs(exact.costM - best) < 1e-6, `seed ${seed}: dp ${exact.costM} vs brute ${best}`);
  }
});

test("heuristic stays close to exact on 12 stops", () => {
  let worst = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const stops = sample(12, seed);
    const exact = router.solve({ stops, mode: "exact" }).costM;
    const heur = router.solve({ stops, mode: "heuristic" }).costM;
    assert.ok(heur >= exact - 1e-6);
    worst = Math.max(worst, heur / exact - 1);
  }
  assert.ok(worst < 0.1, `worst gap ${(worst * 100).toFixed(1)}%`);
});

test("cold items come after ambient items with default weights", () => {
  const ids = ["icecream", "rice", "milk", "cereal", "bananas", "peas", "oil"];
  const stops = DEMO_ITEMS.filter((s) => ids.includes(s.id));
  const r = router.solve({ stops });
  const cold = new Set(["icecream", "milk", "peas"]);
  const firstCold = r.order.findIndex((id) => cold.has(id));
  assert.ok(r.order.slice(firstCold).every((id) => cold.has(id)), r.order.join(" > "));
});

test("route always ends checkout -> exit, and legs are connected paths", () => {
  const r = router.solve({ stops: sample(10, 7) });
  const n = r.legs.length;
  assert.equal(r.legs[n - 2].label, "Checkout");
  assert.equal(r.legs[n - 1].nodeId, "EXIT");
  let at = "ENTRANCE";
  for (const leg of r.legs) {
    assert.equal(leg.path[0], at);
    at = leg.path[leg.path.length - 1];
    assert.equal(at, leg.nodeId);
  }
});

test("reroute from a mid-trip position with an added item", () => {
  const stops = sample(8, 3);
  const first = router.solve({ stops });
  const doneLeg = first.legs[2];
  const remaining = stops.filter((s) => !first.order.slice(0, 3).includes(s.id));
  remaining.push(DEMO_ITEMS.find((s) => s.id === "batteries")!);
  const r = router.reroute(remaining, doneLeg.nodeId);
  assert.equal(r.order.length, remaining.length);
  assert.equal(r.legs[0].path[0], doneLeg.nodeId);
});
