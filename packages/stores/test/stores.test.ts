import { test } from "node:test";
import assert from "node:assert/strict";
import { WalkGraph, Router } from "@grosher/core";
import { STORES, demoSupercenter } from "../src/index.ts";

for (const { store, catalog } of STORES) {
  test(`${store.storeId}: every shelf location is reachable from the entrance and reaches the exit`, () => {
    const g = new WalkGraph(store);
    const router = new Router(g);
    const fromEntrance = g.dijkstra(store.entranceId).dist;
    assert.ok(g.locationNode.size > 0, "store has no shelf locations");
    for (const [loc, node] of g.locationNode) {
      assert.ok(Number.isFinite(fromEntrance.get(node)), `unreachable: ${loc}`);
      assert.ok(Number.isFinite(router.dist(node, store.exitId)), `no way out from: ${loc}`);
    }
    for (const lane of store.checkoutIds) {
      assert.ok(Number.isFinite(router.dist(lane, store.exitId)), `checkout ${lane} cannot reach exit`);
    }
  });

  test(`${store.storeId}: catalog references only known locations, ids unique`, () => {
    const locIds = new Set(store.locations.map((l) => l.id));
    const seen = new Set<string>();
    for (const item of catalog) {
      assert.ok(!seen.has(item.id), `duplicate catalog id ${item.id}`);
      seen.add(item.id);
      assert.ok(item.locationIds.length > 0, `${item.id} has no locations`);
      for (const id of item.locationIds) assert.ok(locIds.has(id), `${item.id}: unknown location ${id}`);
    }
  });
}

for (const bundle of STORES) {
  test(`${bundle.store.storeId}: the full catalog loads, references only known locations, ids unique, origins tagged`, async () => {
    const full = await bundle.loadCatalog();
    assert.ok(full.length > bundle.catalog.length, "the full catalog is larger than the base rows");
    assert.deepEqual(full.slice(0, bundle.catalog.length), bundle.catalog, "base rows come first");
    const locIds = new Set(bundle.store.locations.map((l) => l.id));
    const seen = new Set<string>();
    const origins = new Map<string, number>();
    for (const item of full) {
      assert.ok(!seen.has(item.id), `duplicate catalog id ${item.id}`);
      seen.add(item.id);
      assert.ok(item.locationIds.length > 0, `${item.id} has no locations`);
      for (const id of item.locationIds) assert.ok(locIds.has(id), `${item.id}: unknown location ${id}`);
      const o = (item as { origin?: string }).origin ?? "base";
      origins.set(o, (origins.get(o) ?? 0) + 1);
    }
    assert.equal(origins.get("base"), bundle.catalog.length);
    assert.ok((origins.get("instacart") ?? 0) > 40_000, `instacart rows: ${origins.get("instacart")}`);
    assert.ok((origins.get("seeded") ?? 0) > 2_000, `seeded rows: ${origins.get("seeded")}`);
    assert.equal(await bundle.loadCatalog(), full, "cached");
  });
}

import { fixtureProblems, isSimplePolygon, segmentOverlapsPolygon } from "../src/geometry.ts";

test("geometry helpers", () => {
  const sq: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.ok(isSimplePolygon(sq));
  assert.ok(!isSimplePolygon([[0, 0], [2, 2], [2, 0], [0, 2]]), "bow-tie is not simple");
  assert.ok(!isSimplePolygon([[0, 0], [1, 1]]));
  assert.ok(segmentOverlapsPolygon([-1, 1], [3, 1], sq), "crossing");
  assert.ok(segmentOverlapsPolygon([1, 1], [5, 5], sq), "endpoint inside");
  assert.ok(!segmentOverlapsPolygon([-1, 3], [3, 3], sq), "clear");
});

for (const { store } of STORES) {
  test(`${store.storeId}: fixtures are simple closed polygons clear of every corridor edge, with known departments`, () => {
    assert.ok((store.fixtures ?? []).length > 0, "store has no fixtures");
    assert.ok((store.departments ?? []).length > 0, "store has no departments");
    assert.deepEqual(fixtureProblems(store), []);
    for (const f of store.fixtures ?? []) assert.ok(f.department, `${f.id} has no department`);
  });
}

import { fixtureForLocation, fixtureParams, offsetForBay, slotFor } from "../src/slots.ts";

test("slots: demo locations map to a fixture, bay, face and shelf; bays count from the front", () => {
  const { store } = demoSupercenter;
  const loc = store.locations.find((l) => l.id === "A3-L16")!; // hot sauce & salsa: bays 16–20 on the left of A3
  const slot = slotFor(store, loc)!;
  assert.ok(slot, "no slot");
  assert.equal(slot.params.kind, "gondola");
  assert.equal(slot.params.bays, Math.round(30.4 / 1.22));
  assert.equal(slot.params.shelves, 5);
  assert.ok(slot.bay >= 16 && slot.bay <= 20, `bay ${slot.bay}`); // the category's own bay run
  assert.equal(slot.face, "east"); // side L picks the block west of the corridor, which presents its east face
  assert.equal(slot.shelf, loc.shelf);
  assert.ok(slot.heightM > 0.15 && slot.heightM < 1.8);
  assert.ok(slot.rect.w > 0 && slot.rect.h > 0);
  // a cold wall location on a horizontal fixture
  const dairy = slotFor(store, store.locations.find((l) => l.id === "DAIRY-L1")!)!;
  assert.equal(dairy.params.kind, "coldcase");
  assert.equal(dairy.params.shelves, 4);
  assert.ok(["north", "south"].includes(dairy.face));
  // moving to bay 1 puts the location near the front end of its edge
  const off = offsetForBay(store, loc, 1)!;
  assert.ok(off > 29 && off <= 32, `offset ${off}`);
  for (const f of store.fixtures ?? []) {
    const p = fixtureParams(f, store.departments);
    assert.ok(p.bays >= 1 && p.shelves >= 1 && p.depth > 0);
  }
});

import { departmentLocations } from "../src/resolveContext.ts";

test("departmentLocations: every demo location belongs to one department", () => {
  const { store } = demoSupercenter;
  const dl = departmentLocations(store);
  const all = Object.values(dl).flat();
  assert.equal(new Set(all).size, store.locations.length);
  assert.ok(dl.dairy.includes("DAIRY-L1"));
  assert.ok(dl.dry.includes("A10-L1"));
  assert.ok(dl.frozen.includes("A20-L1"));
  assert.ok(dl.pharmacy.includes("A28-L1"));
});

import { categoryLocations, llmOptions } from "../src/resolveContext.ts";

test("categories: every category has its own location on its aisle and side, every location has exactly one category", () => {
  const { store, categories } = demoSupercenter;
  assert.ok(categories.length >= 290 && categories.length <= 320, `${categories.length} categories`);
  const seen = new Set<string>();
  const locs = new Map(store.locations.map((l) => [l.id, l]));
  for (const c of categories) {
    assert.ok(!seen.has(c.id), `duplicate category ${c.id}`);
    seen.add(c.id);
    const l = locs.get(c.locationId);
    assert.ok(l, `${c.id}: no location ${c.locationId}`);
    assert.equal(l!.aisle, c.aisle);
    assert.equal(l!.side, c.side);
    assert.ok(c.bays[0] >= 1 && c.bays[1] >= c.bays[0], `${c.id}: bays ${c.bays}`);
    assert.ok(store.departments!.some((d) => d.id === c.department), `${c.id}: department ${c.department}`);
    const f = fixtureForLocation(store, l!);
    assert.equal(f?.department, c.department, `${c.id}: sits against a ${f?.department} fixture`);
  }
  const byLoc = new Map<string, number>();
  for (const c of categories) byLoc.set(c.locationId, (byLoc.get(c.locationId) ?? 0) + 1);
  assert.equal(byLoc.size, store.locations.length, "a location without a category");
  assert.ok([...byLoc.values()].every((n) => n === 1), "a location with two categories");
  assert.equal(categoryLocations(categories)["milk"], "DAIRY-L1");
  assert.deepEqual(llmOptions(categories)[0], { id: categories[0].id, name: categories[0].name });
  // the walls and the near general-merchandise aisles are all there
  for (const aisle of ["PRODUCE", "DAIRY", "MEAT", "DELI", "BAKERY", "PHARMACY", "A1", "A22", "A26", "A27", "A30"]) assert.ok(categories.some((c) => c.aisle === aisle), aisle);
  assert.ok(categories.some((c) => c.id === "atta-flours" && c.aisle === "A7"));
});
