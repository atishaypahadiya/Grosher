import { beforeEach, describe, expect, test } from "vitest";
import { Router, WalkGraph } from "@grosher/core";
import { demoSupercenter } from "@grosher/stores";
import { bannerText, detectReset, editorHashFor, loadResetState, parseEditorFocus, resetVisible, saveResetState, tripMisses } from "../src/lib/reset.ts";
import { gotIt, nextStop, skipStop, startTrip, type TripState } from "../src/lib/trip.ts";

const { store, catalog } = demoSupercenter;
const router = new Router(new WalkGraph(store));
const byId = (id: string) => catalog.find((s) => s.id === id)!;
const aisleOf = (locationId: string) => store.locations.find((l) => l.id === locationId)!.aisle;

/** walk a trip, skipping the stops whose names are listed */
function run(ids: string[], skip: Set<string>): TripState {
  let t = startTrip(router, ids.map(byId));
  while (t.remaining.length) t = skip.has(nextStop(t)!.id) ? skipStop(router, t) : gotIt(router, t);
  return t;
}

beforeEach(() => localStorage.clear());

describe("reset detection", () => {
  test("three Not heres in one aisle flag that aisle, whatever the share", () => {
    // three catalog items on the same aisle, plus enough others to keep the share under 25%
    const groups = new Map<string, string[]>();
    for (const s of catalog) groups.set(aisleOf(s.locationIds[0]), [...(groups.get(aisleOf(s.locationIds[0])) ?? []), s.id]);
    const [aisle, trio] = [...groups.entries()].find(([, ids]) => ids.length >= 3)!;
    const others = catalog.filter((s) => aisleOf(s.locationIds[0]) !== aisle).slice(0, 12).map((s) => s.id);
    const t = run([...trio.slice(0, 3), ...others], new Set(trio.slice(0, 3)));
    const flag = detectReset(store, t)!;
    expect(flag).toMatchObject({ reason: "aisle", aisle, misses: 3, placed: 15 });
    expect(flag.items).toHaveLength(3);
    expect(flag.id).toBe(`t_${t.startedAt}`);
    expect(bannerText(store, flag)).toMatch(/^Demo Supercenter may have moved things · 3 misses on \w+day$/);
  });

  test("a quarter of the placed items missing flags the trip; fewer does not", () => {
    const ids = ["milk", "bananas", "rice", "icecream"];
    expect(detectReset(store, run(ids, new Set(["milk"])))).toMatchObject({ reason: "share", misses: 1, placed: 4 }); // 25%
    const five = [...ids, "bread"];
    expect(detectReset(store, run(five, new Set(["milk"])))).toBeNull(); // 20%
    expect(detectReset(store, run(five, new Set()))).toBeNull();
  });

  test("an item found on another aisle than the map's first choice counts as relocated", () => {
    const milk = byId("milk");
    const elsewhere = store.locations.find((l) => l.aisle !== aisleOf(milk.locationIds[0]))!;
    const t: TripState = { ...startTrip(router, [milk]), remaining: [], got: [milk], doneNodeIds: [`loc:${elsewhere.id}`] };
    expect(tripMisses(store, t)).toEqual([{ name: milk.name, aisle: aisleOf(milk.locationIds[0]), kind: "relocated" }]);
    expect(detectReset(store, t)?.reason).toBe("share");
    // same aisle, other shelf: not a miss
    const sameAisle = store.locations.find((l) => l.aisle === aisleOf(milk.locationIds[0]) && l.id !== milk.locationIds[0]);
    if (sameAisle) expect(tripMisses(store, { ...t, doneNodeIds: [`loc:${sameAisle.id}`] })).toEqual([]);
  });

  test("the flag stays dismissed until a later trip raises a new one; the editor hand-off round-trips", () => {
    const flag = { id: "t_1", storeId: store.storeId, date: 0, reason: "aisle" as const, aisle: "A4", items: ["Paneer", "Ghee, fresh"], misses: 4, placed: 8 };
    saveResetState(store.storeId, { flag, dismissedId: null });
    expect(resetVisible(loadResetState(store.storeId))).toBe(true);
    saveResetState(store.storeId, { flag, dismissedId: "t_1" });
    expect(resetVisible(loadResetState(store.storeId))).toBe(false);
    expect(resetVisible({ flag: { ...flag, id: "t_2" }, dismissedId: "t_1" })).toBe(true);
    const hash = editorHashFor(flag);
    expect(hash.startsWith("#/edit?")).toBe(true);
    expect(parseEditorFocus(hash)).toEqual({ aisle: "A4", items: ["Paneer", "Ghee", "fresh"], misses: 4, date: 0 });
    expect(parseEditorFocus("#/edit")).toBeNull();
  });
});
