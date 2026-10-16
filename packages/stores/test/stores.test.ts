import { test } from "node:test";
import assert from "node:assert/strict";
import { WalkGraph, Router } from "@grosher/core";
import { STORES } from "../src/index.ts";

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
