import { describe, expect, test } from "vitest";
import { Router, WalkGraph } from "@grosher/core";
import { demoSupercenter } from "@grosher/stores";
import { addItem, aislesNeverEntered, fromSnapshot, gotIt, isDone, nextStop, skipStop, startTrip, summarize, toSnapshot } from "../src/lib/trip.ts";

const { store, catalog } = demoSupercenter;
const router = new Router(new WalkGraph(store));
const byId = (id: string) => catalog.find((s) => s.id === id)!;
const list = ["milk", "bananas", "rice", "icecream", "bread"].map(byId);

describe("trip", () => {
  test("got-it walks the trip to checkout and the walked distance matches a valid route", () => {
    let t = startTrip(router, list);
    expect(t.positionNodeId).toBe(store.entranceId);
    const firstPlan = t.route.distanceM;
    const visited: string[] = [];
    while (!isDone(t)) {
      visited.push(nextStop(t)!.id);
      t = gotIt(router, t);
    }
    expect(visited.sort()).toEqual(list.map((s) => s.id).sort());
    expect(t.route.legs.map((l) => l.label)).toEqual(["Checkout", "Exit"]);
    const s = summarize(router, t);
    // Following the plan without deviation walks exactly the planned distance.
    expect(s.totalM).toBeCloseTo(firstPlan, 6);
    expect(s.baselineM).toBeCloseTo(router.routeForOrder(list).distanceM, 6);
    expect(s.savedM).toBeGreaterThanOrEqual(0);
  });

  test("skip drops the stop without walking and reroutes from where we stand", () => {
    const t0 = gotIt(router, startTrip(router, list));
    const skipped = nextStop(t0)!;
    const t1 = skipStop(router, t0);
    expect(t1.remaining.map((s) => s.id)).not.toContain(skipped.id);
    expect(t1.skipped[0].id).toBe(skipped.id);
    expect(t1.walkedM).toBe(t0.walkedM);
    expect(t1.positionNodeId).toBe(t0.positionNodeId);
    expect(t1.route.legs[0].path[0]).toBe(t0.positionNodeId);
    // skipped items do not count against the baseline
    const done = [...Array(t1.remaining.length)].reduce((t) => gotIt(router, t), t1);
    const s = summarize(router, done);
    expect(s.baselineM).toBeCloseTo(router.routeForOrder(list.filter((x) => x.id !== skipped.id)).distanceM, 6);
  });

  test("add item mid-trip joins the remaining stops; duplicates are ignored", () => {
    const t0 = gotIt(router, startTrip(router, list));
    const t1 = addItem(router, t0, byId("coffee"));
    expect(t1.remaining.map((s) => s.id)).toContain("coffee");
    expect(t1.original.at(-1)?.id).toBe("coffee");
    expect(t1.route.order).toContain("coffee");
    expect(addItem(router, t1, byId("coffee"))).toBe(t1);
    expect(addItem(router, t1, t1.got[0])).toBe(t1);
  });

  test("snapshot round-trips through ids", () => {
    const t0 = addItem(router, gotIt(router, startTrip(router, list)), byId("coffee"));
    const t1 = fromSnapshot(router, catalog, JSON.parse(JSON.stringify(toSnapshot(t0))))!;
    expect(t1.remaining.map((s) => s.id)).toEqual(t0.remaining.map((s) => s.id));
    expect(t1.walkedM).toBe(t0.walkedM);
    expect(t1.route.costM).toBeCloseTo(t0.route.costM, 6);
    expect(fromSnapshot(router, catalog, null)).toBeNull();
    expect(fromSnapshot(router, catalog, { ...toSnapshot(t0), positionNodeId: "nope" })).toBeNull();
  });
});

describe("trip timing and coverage", () => {
  test("timestamps, visited nodes and aisles never entered", () => {
    let t = startTrip(router, list);
    expect(t.startedAt).toBeGreaterThan(0);
    expect(t.doneAt).toBeUndefined();
    expect(t.visited).toEqual([store.entranceId]);
    while (!isDone(t)) t = gotIt(router, t);
    expect(t.doneAt).toBeGreaterThanOrEqual(t.startedAt);
    expect(t.visited.length).toBeGreaterThan(5);
    const { never, total } = aislesNeverEntered(store, t);
    expect(total).toBe(12);
    expect(never.length).toBeLessThan(total);
    expect(never).not.toContain("A1"); // rice lives in A1
    const snap = fromSnapshot(router, catalog, JSON.parse(JSON.stringify(toSnapshot(t))))!;
    expect(snap.startedAt).toBe(t.startedAt);
    expect(snap.visited).toEqual(t.visited);
  });
});
