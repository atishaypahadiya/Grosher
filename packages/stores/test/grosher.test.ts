// Grosher, our own designed market (design/store-grosher.md): the plan holds, every shelf and counter is
// reachable, every category has a place, storage is pinned, and the hero lists route the same way until a map
// edit changes them (the snapshot shows the diff). Regenerate the snapshot after a deliberate map change:
//   UPDATE_SNAPSHOTS=1 node --test test/grosher.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Router, WalkGraph, isStorageTag, resolveItem, toStop, type Fixture, type StoreGraph } from "@grosher/core";
import { demoSupercenter, grosher, STORES, DEFAULT_STORE } from "../src/index.ts";
import { fixtureForLocation, fixtureParams } from "../src/slots.ts";

const { store, categories } = grosher;
const catOfLoc = new Map(categories.map((c) => [c.locationId, c]));

test("Grosher is the default store; the demo Supercenter stays loadable", () => {
  assert.equal(DEFAULT_STORE, grosher);
  assert.equal(STORES[0].store.storeId, "grosher");
  assert.equal(store.name, "Grosher");
  assert.ok(STORES.includes(demoSupercenter));
});

test("the graph is connected: every node is reached from the entrance and reaches the exit", () => {
  const g = new WalkGraph(store);
  const router = new Router(g);
  const fromEntrance = g.dijkstra(store.entranceId).dist;
  for (const n of store.nodes) {
    assert.ok(Number.isFinite(fromEntrance.get(n.id)), `unreachable node ${n.id}`);
    assert.ok(Number.isFinite(router.dist(n.id, store.exitId)), `no way out from ${n.id}`);
  }
  // the lanes are the only way to the exit: one-way west, then the front walkway
  assert.deepEqual(store.checkoutIds, ["LANE1", "LANE2", "LANE3", "LANE4", "LANE5", "LANE6", "LANE7", "LANE8", "EXPRESS", "SELF"]);
  const exitIn = store.edges.filter((e) => e.to === store.exitId);
  assert.ok(exitIn.length === 1 && exitIn[0].oneWay, "one door out");
});

const rect = (f: Fixture) => {
  const xs = f.polygon.map((p) => p[0]);
  const ys = f.polygon.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

test("no fixture overlaps another; every fixture is inside the building, cut corner included", () => {
  const fx = store.fixtures!;
  const inside = ([x, y]: [number, number]) => x >= 0 && x <= 85 && y >= 0 && y <= 70 && !(x > 75 && y < x - 75); // the cut runs (75,0) → (85,10)
  for (const f of fx) for (const p of f.polygon) assert.ok(inside(p), `${f.id} pokes out of the building at ${p}`);
  for (let i = 0; i < fx.length; i++) {
    for (let j = i + 1; j < fx.length; j++) {
      const a = rect(fx[i]);
      const b = rect(fx[j]);
      const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-6 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-6;
      assert.ok(!overlap, `${fx[i].id} overlaps ${fx[j].id}`);
    }
  }
  assert.deepEqual(store.outline, [[0, 0], [75, 0], [85, 10], [85, 70], [0, 70]]);
});

test("every shelf and counter is reachable: each one that sells something has a location in front of it", () => {
  const served = new Set(store.locations.map((l) => fixtureForLocation(store, l)?.id));
  // checkout counters, seating, end caps and the wine bar's three inner sides sell nothing on the map
  const quiet = (f: Fixture) => f.department === "checkout" || f.department === "seating" || /-cap[EW]$/.test(f.id) || /^f-winebar-[nse]$/.test(f.id);
  for (const f of store.fixtures!) if (!quiet(f)) assert.ok(served.has(f.id), `${f.id} (${f.department}) has no location in front of it`);
});

test("every category is placed: all 298 of the demo's plus Grosher's own, one per location, against its department", () => {
  const ids = new Set(categories.map((c) => c.id));
  for (const c of demoSupercenter.categories) assert.ok(ids.has(c.id), `${c.id} has no Grosher shelf`);
  for (const id of ["papad", "cookware", "kitchen-utensils", "beer", "cold-beer", "red-wine", "white-wine", "sparkling-wine", "spirits", "bulk-pulses", "bulk-rice-grains", "bulk-nuts-seeds", "bulk-dried-fruit", "bulk-flours", "bouquets", "plants", "hot-bar", "salad-bar", "soups", "sushi", "pizza", "cafe-coffee", "cafe-juice"]) assert.ok(ids.has(id), id);
  assert.equal(categories.length, 324);
  assert.equal(new Set(categories.map((c) => c.locationId)).size, categories.length, "two categories share a location");
  assert.equal(store.locations.length, categories.length, "a location without a category");
  for (const c of categories) {
    const loc = store.locations.find((l) => l.id === c.locationId)!;
    assert.equal(loc.aisle, c.aisle);
    assert.equal(fixtureForLocation(store, loc)?.department, c.department, `${c.id} does not sit against its own department`);
  }
});

test("the plan: entrance and exit on the west wall, produce under the skylight, dairy on the far wall, aisle 1 by produce", () => {
  const node = (id: string) => store.nodes.find((n) => n.id === id)!;
  assert.deepEqual([node("ENTRANCE").x, node("EXIT").x], [0, 0]);
  assert.ok(Math.abs(node("ENTRANCE").y - 4) <= 2 && Math.abs(node("EXIT").y - 64) <= 1);
  const sky = store.skylights![0].polygon;
  for (const f of store.fixtures!.filter((x) => x.id.startsWith("f-island"))) {
    const r = rect(f);
    assert.ok(r.x0 >= sky[0][0] && r.x1 <= sky[1][0] && r.y0 >= sky[0][1] && r.y1 <= sky[2][1], `${f.id} outside the skylight`);
  }
  assert.equal(store.fixtures!.filter((f) => f.id.startsWith("f-island")).length, 8);
  // dairy is on the east wall, diagonally opposite the entrance: farther than anything west of the cross aisle
  assert.ok(rect(store.fixtures!.find((f) => f.id === "f-dairy")!).x0 >= 76);
  const g = new WalkGraph(store);
  const d = g.dijkstra(store.entranceId).dist;
  const walk = (cat: string) => d.get(g.locationNode.get(categories.find((c) => c.id === cat)!.locationId)!)!;
  for (const other of ["seafood", "pharmacy-counter", "bananas", "bulk-pulses", "cereal", "dish-soap", "dog-food", "frozen-vegetables", "beer"]) assert.ok(walk("milk") > walk(other), `milk is nearer than ${other}`);
  const y = (aisle: string) => store.edges.find((e) => e.id === store.locations.find((l) => l.aisle === aisle)!.edgeId)!;
  const yOf = (aisle: string) => store.nodes.find((n) => n.id === y(aisle).from)!.y;
  for (let k = 1; k < 10; k++) assert.ok(yOf(`A${k}`) < yOf(`A${k + 1}`), `aisle ${k} is north of aisle ${k + 1}`);
  // every centre run has an end cap at both ends
  for (let k = 0; k <= 10; k++) assert.ok(store.fixtures!.some((f) => f.id === `f-run${k}-capW`) && store.fixtures!.some((f) => f.id === `f-run${k}-capE`), `run ${k} end caps`);
  // the fixture kinds the overview needs
  const kind = (id: string) => fixtureParams(store.fixtures!.find((f) => f.id === id)!, store.departments).kind;
  assert.deepEqual([kind("f-seafood"), kind("f-dairy"), kind("f-frozen-coffin1"), kind("f-bulk-wall"), kind("f-hotbar"), kind("f-winebar-w")], ["servicecase", "coldcase", "coffin", "bins", "servicecase", "counter"]);
});

// ------------------------------------------------------------------ storage, pinned
const STORAGE_OF = (tag: string) => categories.filter((c) => c.tags?.includes(tag as never)).map((c) => c.id).sort();
const COLD = [
  "bacon-sausage", "beef", "block-specialty-cheese", "butter-margarine", "chicken", "cold-beer", "cream-creamer", "cut-fruit-juice", "cut-vegetables",
  "dairy-free-cheese", "deli-cheese", "deli-meat", "eggs", "halal-meat", "hot-dogs", "hummus-dips", "kombucha-probiotic", "liquid-egg", "lunch-meat",
  "lunchables-snack-kits", "marinated-meat", "milk", "milk-alternatives", "paneer-indian-dairy", "party-trays", "plant-protein", "pork", "prepared-salads",
  "pudding-jello", "refrigerated-dough", "refrigerated-juice", "refrigerated-pasta", "salad-bar", "seafood", "shredded-cheese", "sour-cream-dips", "sushi",
  "turkey-lamb", "whipped-cream", "yogurt",
];
const HOT = ["hot-bar", "rotisserie", "soups"];

test("storage is pinned: hot (rotisserie, hot bar, soups), cold (fresh counters, dairy, cheese, cut fruit, sushi, salad bar, cold beer), frozen", () => {
  assert.deepEqual(STORAGE_OF("hot"), HOT);
  assert.deepEqual(STORAGE_OF("chilled"), COLD);
  const frozen = STORAGE_OF("frozen");
  assert.equal(frozen.length, 25);
  assert.ok(frozen.every((id) => categories.find((c) => c.id === id)!.aisle === "FROZEN"), "every frozen category is in the frozen runs");
  // never from a name: beer, wine and the café are ambient, and so are greens, herbs, mushrooms and the pizza counter
  for (const id of ["beer", "red-wine", "white-wine", "sparkling-wine", "spirits", "cafe-coffee", "cafe-juice", "salad-greens", "fresh-herbs", "mushrooms-sprouts", "pizza", "shelf-milk"]) assert.deepEqual((categories.find((c) => c.id === id)!.tags ?? []).filter(isStorageTag), [], id);
  // every location carries its category's storage
  for (const c of categories) assert.deepEqual(store.locations.find((l) => l.id === c.locationId)!.tags ?? [], c.tags ?? [], c.id);
});

// ------------------------------------------------------------------ hero lists: resolution, solve time, route snapshots
const SNAPSHOT = new URL("./fixtures/grosher-hero-routes.json", import.meta.url);

test("hero lists: every item placed offline on its shelf, solved in time, routes as snapshotted", async () => {
  const catalog = await grosher.loadCatalog();
  const ctx = { catalog, categories, locations: new Set(store.locations.map((l) => l.id)) };
  const router = new Router(new WalkGraph(store));
  const out: Record<string, unknown> = {};
  for (const list of grosher.lists!) {
    const results = list.items.map((q) => resolveItem(q, ctx));
    for (const r of results) assert.ok(r.locationIds.length && r.source !== "llm", `${list.name}: "${r.query}" not placed offline (${r.source})`);
    const stops = results.map(toStop).filter((s) => !!s);
    router.solve({ stops }); // warm the per-node caches the way the app does on the list screen
    const t0 = performance.now();
    const route = router.solve({ stops });
    const ms = performance.now() - t0;
    assert.ok(ms < 100, `${list.name}: solve took ${ms.toFixed(1)} ms`);
    const inOrder = router.routeForOrder(stops);
    assert.ok(route.distanceM < inOrder.distanceM, `${list.name}: the route is not shorter than the list in order`);
    console.log(`  ${list.name.padEnd(22)} ${stops.length} stops · route ${route.distanceM.toFixed(0)} m vs list order ${inOrder.distanceM.toFixed(0)} m (${(100 * (1 - route.distanceM / inOrder.distanceM)).toFixed(0)}% shorter) · ${route.solver} ${ms.toFixed(1)} ms`);
    const nameOf = (id: string) => stops.find((s) => s.id === id)!.name;
    out[list.id] = {
      items: results.map((r) => `${r.query} → ${catOfLoc.get(r.locationIds[0])?.id} (${r.source})`),
      order: route.order.map(nameOf),
      lane: route.legs.find((l) => l.label === "Checkout")?.nodeId,
      routeM: Math.round(route.distanceM),
      listOrderM: Math.round(inOrder.distanceM),
    };
  }
  const json = JSON.stringify(out, null, 2) + "\n";
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(SNAPSHOT)) writeFileSync(SNAPSHOT, json);
  assert.deepEqual(out, JSON.parse(readFileSync(SNAPSHOT, "utf8")), "a hero route changed: if the map edit was deliberate, UPDATE_SNAPSHOTS=1");
});

test("nothing points at the demo: Grosher's locations, categories and catalog use only Grosher ids", async () => {
  const ids = new Set(store.locations.map((l) => l.id));
  const demoOnly = new Set(demoSupercenter.store.locations.map((l) => l.id).filter((id) => !ids.has(id)));
  for (const s of await grosher.loadCatalog()) for (const l of s.locationIds) assert.ok(ids.has(l) && !demoOnly.has(l), `${s.id} → ${l}`);
  const shapeOk = (g: StoreGraph) => g.storeId === "grosher" && g.version >= 1;
  assert.ok(shapeOk(store));
});
