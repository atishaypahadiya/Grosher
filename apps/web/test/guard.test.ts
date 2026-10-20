// The off-list guard's detector on synthetic walks (a tick a second): a normal walk never nudges; wandering
// and stopping short (browsing) do; a long wait at a counter does not; nor a checkout queue; arriving and
// standing there a long time offers help instead; without a motion sensor it goes by time, leniently; the
// trip's first minute and a close-up's arrival are quiet; Gentle nudges once a leg, Strict sooner and twice.

import { describe, expect, test } from "vitest";
import { grosher } from "@grosher/stores";
import { backOnRoute, detourLine, GUARD, guardTick, initialGuard, legSteps, MotionTracker, stopKind, type GuardMode, type GuardShow, type GuardState, type LegPlan } from "../src/lib/guard.ts";

const W = { strideM: GUARD.strideM, speedMps: GUARD.speedMps };
const CADENCE = 1.8; // steps a second, walking

interface Phase {
  /** seconds */
  s: number;
  walk: boolean;
  animating?: boolean;
}

/** run a leg's phases a second at a time, after `t0` seconds of trip; every show, and the final state */
function run(leg: LegPlan, phases: Phase[], o: { mode?: GuardMode; t0?: number; motion?: boolean; state?: GuardState } = {}) {
  const mode = o.mode ?? "gentle";
  const t0 = (o.t0 ?? 120) * 1000;
  let state = o.state ?? initialGuard(0);
  let steps = 0;
  let now = t0;
  const shows: (NonNullable<GuardShow> & { at: number })[] = [];
  for (const p of phases)
    for (let i = 0; i < p.s; i++) {
      now += 1000;
      if (p.walk) steps += CADENCE;
      const r = guardTick(state, { now, steps: o.motion === false ? null : Math.floor(steps), stationary: !p.walk, animating: !!p.animating }, leg, mode, W);
      state = r.state;
      if (r.show) shows.push({ ...r.show, at: (now - t0) / 1000 });
    }
  return { shows, state, now, steps };
}

const shelf = (m: number, key = "a"): LegPlan => ({ key, distanceM: m, kind: "shelf", toCheckout: false, item: "Salsa" });
const walkFor = (m: number) => Math.ceil(legSteps(shelf(m), W) / CADENCE);

describe("the detector", () => {
  test("a normal walk to the shelf, a look, and on: no nudge", () => {
    const { shows } = run(shelf(40), [
      { s: walkFor(40), walk: true },
      { s: 25, walk: false },
    ]);
    expect(shows).toEqual([]);
  });

  test("wandering: far more steps than the leg, no check-off: the guard, once", () => {
    const leg = shelf(30);
    const { shows } = run(leg, [{ s: 140, walk: true }]);
    expect(shows).toHaveLength(1);
    expect(shows[0]).toMatchObject({ kind: "guard", reason: "wandering", item: "Salsa", aheadM: 30 });
    // after 1.8 × the leg's steps + 30, not before
    const threshold = GUARD.wanderFactor * legSteps(leg, W) + GUARD.wanderExtraSteps;
    expect(shows[0].at).toBeGreaterThanOrEqual(Math.floor(threshold / CADENCE));
    expect(shows[0].at).toBeLessThanOrEqual(Math.ceil(threshold / CADENCE) + 1);
  });

  test("browsing on the way: stopped long, well short of the stop: the guard", () => {
    const { shows } = run(shelf(50), [
      { s: 10, walk: true },
      { s: 100, walk: false },
    ]);
    expect(shows).toHaveLength(1);
    expect(shows[0]).toMatchObject({ kind: "guard", reason: "browsing" });
    expect(shows[0].at).toBeGreaterThan(10 + GUARD.browseStationaryMs / 1000 - 1);
  });

  test("a long wait at the deli counter, inside its allowance: nothing", () => {
    const leg: LegPlan = { key: "deli", distanceM: 25, kind: "counter", toCheckout: false, item: "Sliced turkey" };
    const { shows } = run(leg, [
      { s: walkFor(25), walk: true },
      { s: 170, walk: false },
    ]);
    expect(shows).toEqual([]);
  });

  test("the queue at checkout: nothing, however long", () => {
    const leg: LegPlan = { key: "co", distanceM: 30, kind: "checkout", toCheckout: true, item: null };
    expect(run(leg, [{ s: 600, walk: false }]).shows).toEqual([]);
    expect(run(leg, [{ s: 600, walk: true }]).shows).toEqual([]);
  });

  test("arrived and standing there a long time: help (can't find it?), not the guard", () => {
    const leg = shelf(30);
    const { shows } = run(leg, [
      { s: walkFor(30), walk: true },
      { s: 75, walk: false },
    ]);
    expect(shows).toHaveLength(1);
    expect(shows[0]).toMatchObject({ kind: "help", item: "Salsa" });
    // after the shelf's dwell and the extra, not before
    expect(shows[0].at).toBeGreaterThanOrEqual(walkFor(30) + (GUARD.dwellS.shelf * 1000 + GUARD.helpExtraMs) / 1000);
  });

  test("without a motion sensor: time only, lenient (2.5 × the expected leg and 2 min over)", () => {
    const leg = shelf(30); // 25 s walking + 20 s dwell = 45 s expected
    const { shows } = run(leg, [{ s: 300, walk: true }], { motion: false });
    expect(shows).toHaveLength(1);
    expect(shows[0]).toMatchObject({ kind: "guard", reason: "time" });
    expect(shows[0].at).toBeGreaterThanOrEqual(45 + 120);
    // a normal stop takes nowhere near that
    expect(run(leg, [{ s: 120, walk: true }], { motion: false }).shows).toEqual([]);
  });

  test("the trip's first minute is quiet; the nudge waits for it", () => {
    const { shows } = run(shelf(10), [{ s: 70, walk: true }], { t0: 0 });
    expect(shows).toHaveLength(1);
    expect(shows[0].at).toBeGreaterThanOrEqual(GUARD.quietStartMs / 1000);
  });

  test("while a close-up arrives the guard waits", () => {
    const { shows } = run(shelf(10), [
      { s: 40, walk: true, animating: true },
      { s: 5, walk: true },
    ]);
    expect(shows).toHaveLength(1);
    expect(shows[0].at).toBeGreaterThan(40);
  });

  test("Gentle nudges once a leg; Back on route keeps it quiet; Strict nudges sooner and twice", () => {
    const leg = shelf(30);
    const gentle = run(leg, [{ s: 400, walk: true }]);
    expect(gentle.shows).toHaveLength(1);
    const strict = run(leg, [{ s: 400, walk: true }], { mode: "strict" });
    expect(strict.shows).toHaveLength(2);
    expect(strict.shows[0].at).toBeLessThan(gentle.shows[0].at);
    expect(strict.shows[0].at).toBeLessThan(gentle.shows[0].at * GUARD.strictScale + 2);
    // Back on route in Gentle: the rest of the leg is quiet
    const first = run(leg, [{ s: 80, walk: true }]);
    expect(first.shows).toHaveLength(1);
    const back = backOnRoute(first.state, first.now, Math.floor(first.steps), "gentle");
    const after = run(leg, [{ s: 300, walk: true }], { state: back, t0: first.now / 1000 });
    expect(after.shows).toEqual([]);
    // a new leg starts afresh
    const next = run(shelf(30, "b"), [{ s: 140, walk: true }], { state: after.state, t0: after.now / 1000 });
    expect(next.shows).toHaveLength(1);
  });

  test("Off: nothing at all", () => {
    expect(run(shelf(30), [{ s: 400, walk: true }], { mode: "off" }).shows).toEqual([]);
  });

  test("the checkout line counts detours and the time off route, nothing it cannot measure", () => {
    const r = run(shelf(30), [{ s: 200, walk: true }]);
    expect(r.state.detours).toBe(1);
    const done = guardTick(r.state, { now: r.now + 1000, steps: Math.floor(r.steps), stationary: false, animating: false }, null, "gentle", W).state;
    expect(done.offRouteMs).toBeGreaterThan(60_000);
    expect(detourLine(done.detours, done.offRouteMs)).toMatch(/^1 detour · off-route \d+ min$/);
    expect(detourLine(2, 3 * 60_000)).toBe("2 detours · off-route 3 min");
    expect(detourLine(0, 0)).toBeUndefined();
  });
});

describe("stops and motion", () => {
  test("each stop's kind, for its allowance", () => {
    const { store, categories } = grosher;
    const at = (cat: string) => stopKind(store, categories.find((c) => c.id === cat)!.locationId);
    expect(at("sushi")).toBe("foodhall");
    expect(at("hot-bar")).toBe("foodhall");
    expect(at("bulk-pulses")).toBe("bulk");
    expect(at("cereal")).toBe("shelf");
    expect(stopKind(store, null)).toBe("checkout");
    const counters = categories.filter((c) => ["counter", "foodhall", "pharmacy"].includes(stopKind(store, c.locationId)));
    expect(counters.length).toBeGreaterThan(8);
  });

  test("standing still: no step for a few seconds and the accelerometer quiet; walking is not", () => {
    const m = new MotionTracker();
    for (let t = 0; t < 6000; t += 20) m.sample(t, 0, 0, 9.81 + Math.sin(t / 7) * 0.02);
    expect(m.stationary(6000)).toBe(true);
    m.step(5000);
    expect(m.stationary(6000)).toBe(false);
    const w = new MotionTracker();
    for (let t = 0; t < 6000; t += 20) w.sample(t, 0, 0, 9.81 + Math.sin(t / 90) * 2.5);
    expect(w.stationary(6000)).toBe(false);
  });
});
