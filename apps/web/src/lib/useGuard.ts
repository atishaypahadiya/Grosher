// The off-list guard on a trip: the detector (guard.ts) ticked once a second with the shopper's steps and
// whether they are standing still, from the phone's accelerometer (survey mode's step detector) or, in a
// demo, a scripted walk (demoWalk.ts). The motion stays in memory, in this hook, for this trip: only the two
// counts (detours, time off route) leave it, onto the trip for the checkout line.

import { useEffect, useRef, useState } from "react";
import type { StoreGraph } from "@grosher/core";
import { StepDetector } from "../survey/steps.ts";
import { backOnRoute, GUARD, guardTick, initialGuard, MotionTracker, stopKind, type GuardMode, type GuardShow, type GuardState, type LegPlan, type Walker } from "./guard.ts";
import { nextLeg, nextStop, type TripState } from "./trip.ts";
import { load } from "./storage.ts";

/** What the detector reads each second: a clock, the steps so far (null: no motion sensor), standing still. */
export interface GuardFeed {
  now(): number;
  steps(): number | null;
  stationary(): boolean;
  /** a scripted feed moves its walk on, and may answer the card or check the stop off; the real one has none */
  advance?(leg: LegPlan | null, shown: GuardShow): "back" | "gotit" | null;
  stop(): void;
}

/** a sensor that has sent nothing this long after the trip started is not there: time only */
const NO_MOTION_MS = 3000;

/** The phone's accelerometer: steps (survey mode's detector) and standing still (guard.ts MotionTracker). */
export function motionFeed(): GuardFeed {
  const steps = new StepDetector();
  const motion = new MotionTracker();
  const started = Date.now();
  let seen = false;
  const on = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    seen = true;
    const t = Date.now();
    motion.sample(t, a.x, a.y, a.z);
    const s = steps.push(t, a.x, a.y, a.z);
    if (s !== null) motion.step(s);
  };
  if (typeof window !== "undefined") window.addEventListener("devicemotion", on);
  return {
    now: () => Date.now(),
    steps: () => (seen ? steps.count : Date.now() - started > NO_MOTION_MS ? null : 0),
    stationary: () => motion.stationary(Date.now()),
    stop: () => {
      if (typeof window !== "undefined") window.removeEventListener("devicemotion", on);
    },
  };
}

/** The shopper's walk: survey mode's calibration on this phone (grosher.calibration), else the defaults. */
export function walkerFromCalibration(): Walker {
  const c = load<{ strideM: number | null; paceMps: number } | null>("grosher.calibration", null);
  return { strideM: c?.strideM ?? GUARD.strideM, speedMps: c?.paceMps ?? GUARD.speedMps };
}

/** The leg the shopper is on: to the next stop, or to checkout. */
export function legOf(store: StoreGraph, trip: TripState): LegPlan | null {
  const leg = nextLeg(trip);
  const done = trip.got.length + trip.skipped.length;
  if (leg) return { key: `${done}:${leg.stopId}`, distanceM: leg.distanceM, kind: stopKind(store, leg.locationId), toCheckout: false, item: nextStop(trip)?.name ?? null };
  const co = trip.route.legs[0];
  return co ? { key: `${done}:checkout`, distanceM: co.distanceM, kind: "checkout", toCheckout: true, item: null } : null;
}

export interface GuardApi {
  /** the card on screen, if any */
  show: GuardShow;
  /** Back on route: close; Gentle stays quiet this leg */
  back: () => void;
  /** I'm grabbing something, Not here, Tell me where, the close button: the card goes */
  dismiss: () => void;
}

/**
 * Run the guard for a trip. `feed` is made once per trip (sensors or the demo); `animating` holds it while
 * a close-up arrives; `onCounts` puts the detours and the time off route on the trip when they change.
 */
export function useGuard(o: { store: StoreGraph; trip: TripState; mode: GuardMode; animating: boolean; feed: GuardFeed | null; onCounts: (detours: number, offRouteMs: number) => void; onGotIt?: () => void; walker?: Walker }): GuardApi {
  const { store, trip, mode, animating, feed } = o;
  const state = useRef<GuardState>(initialGuard(trip.startedAt));
  const walker = useRef<Walker>(o.walker ?? walkerFromCalibration());
  const [show, setShow] = useState<GuardShow>(null);
  const live = useRef({ trip, animating, mode, show, onCounts: o.onCounts, onGotIt: o.onGotIt });
  live.current = { trip, animating, mode, show, onCounts: o.onCounts, onGotIt: o.onGotIt };
  const back = () => {
    if (feed) {
      const before = state.current;
      state.current = backOnRoute(before, feed.now(), feed.steps(), live.current.mode);
      if (state.current.offRouteMs !== before.offRouteMs) live.current.onCounts(state.current.detours, state.current.offRouteMs);
    }
    setShow(null);
  };
  const backRef = useRef(back);
  backRef.current = back;
  // a new trip starts the counts afresh (a restored one keeps its own)
  useEffect(() => {
    state.current = { ...initialGuard(trip.startedAt), detours: trip.detours ?? 0, offRouteMs: trip.offRouteMs ?? 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.startedAt]);
  useEffect(() => {
    if (!feed || mode === "off") return;
    const id = window.setInterval(() => {
      const { trip: t, animating: anim, mode: m, show: open, onCounts, onGotIt } = live.current;
      const leg = legOf(store, t);
      const before = state.current;
      const r = guardTick(before, { now: feed.now(), steps: feed.steps(), stationary: feed.stationary(), animating: anim }, leg, m, walker.current);
      state.current = r.state;
      // a card already up stays; a new leg takes an old card down
      if (open && before.leg && r.state.leg?.key !== before.leg.key) setShow(null);
      else if (r.show && !open) setShow(r.show);
      if (r.state.detours !== before.detours || r.state.offRouteMs !== before.offRouteMs) onCounts(r.state.detours, r.state.offRouteMs);
      const act = feed.advance?.(leg, open ?? r.show);
      if (act === "back") backRef.current();
      else if (act === "gotit") onGotIt?.();
    }, 1000);
    return () => window.clearInterval(id);
  }, [feed, mode, store]);
  return {
    show,
    back,
    dismiss: () => setShow(null),
  };
}
