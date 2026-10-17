import { describe, expect, test } from "vitest";
import { Router, WalkGraph } from "@grosher/core";
import { demoSupercenter } from "@grosher/stores";
import { addRecord, mergeImported, previousOf, recordFrom } from "../src/lib/history.ts";
import { gotIt, isDone, startTrip } from "../src/lib/trip.ts";
import { vsLastLine } from "../src/components/CheckoutScreen.tsx";

const { store, catalog } = demoSupercenter;
const router = new Router(new WalkGraph(store));

describe("trip history", () => {
  test("a finished trip becomes a record; newest first; previousOf finds the one before", () => {
    let t = startTrip(router, catalog.slice(0, 3), ["ghee"]);
    while (!isDone(t)) t = gotIt(router, t);
    const r = recordFrom(store, router, t);
    expect(r.id).toBe(`t_${t.startedAt}`);
    expect(r.bought).toHaveLength(3);
    expect(r.unknown).toEqual(["ghee"]);
    expect(r.walkedM).toBeGreaterThan(0);
    expect(r.lane).toMatch(/^L\d$/);
    const older = { ...r, id: "t_1", date: r.date - 86_400_000, timeMs: r.timeMs + 180_000, walkedM: r.walkedM + 50 };
    const h = addRecord(addRecord([], r), older);
    expect(h.map((x) => x.id)).toEqual([r.id, "t_1"]);
    expect(previousOf(h, r)?.id).toBe("t_1");
    expect(previousOf(h, older)).toBeUndefined();
    expect(addRecord(h, r)).toHaveLength(2); // same id replaces
    expect(vsLastLine(r.timeMs, r.walkedM, older)).toBe("3 min faster than your last trip · 50 m less");
    expect(vsLastLine(r.timeMs, r.walkedM, undefined)).toBeUndefined();
    expect(vsLastLine(r.timeMs, r.walkedM, { ...older, timeMs: r.timeMs, walkedM: r.walkedM + 2 })).toBe("Same time as your last trip");
    expect(mergeImported([], [{ id: "x", date: 5, bought: ["a"] }, { nope: 1 }])).toHaveLength(1);
  });
});
