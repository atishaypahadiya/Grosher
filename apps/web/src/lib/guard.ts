// The off-list guard: a gentle nudge when the shopper drifts off their route mid-trip, and help, not a
// nudge, when they have reached the stop but cannot find the item. No indoor positioning: per leg (from the
// last check-off to the next stop) it compares the steps taken and the time spent with what the leg should
// take, and watches whether the shopper is moving. Pure: the trip screen's hook (useGuard.ts) feeds it the
// phone's steps and motion (survey mode's step detector), the demo walk (demoWalk.ts) a scripted trace, the
// tests synthetic ones. Nothing here is stored or sent anywhere; the trip keeps only two counts.
//
//   wandering      steps since the leg began > 1.8 × the leg's steps + 30, no check-off          → the guard
//   browsing       stationary > 90 s while still under 60% of the leg's steps (stopped short)    → the guard
//   at the stop    about the leg's steps, then stationary past the stop's dwell + 40 s           → help
//   no motion      time only, lenient: > 2.5 × the expected leg and > expected + 2 min           → the guard
//
// Never: in the trip's first minute; while a close-up arrival or walk plays; at a service counter, the food
// hall or the pharmacy within its dwell allowance; on the leg to checkout; more than once a leg in Gentle.

import type { StoreGraph } from "@grosher/core";
import { slotFor } from "@grosher/stores";
import { locationDepartment } from "./chips.ts";

/** Every threshold, in one place, to tune from real walks. Strict scales the ones marked × by `strictScale`. */
export const GUARD = {
  /** the trip's first minute is quiet (finding a cart, the doors) */
  quietStartMs: 60_000,
  /** the shopper's walk when survey mode has not calibrated this phone */
  strideM: 0.72,
  speedMps: 1.2,
  /** seconds a stop of each kind takes once there */
  dwellS: { shelf: 20, bulk: 60, counter: 180, foodhall: 180, pharmacy: 180, checkout: 0 } as Record<StopKind, number>,
  /** × wandering: steps > wanderFactor × leg steps + wanderExtraSteps */
  wanderFactor: 1.8,
  wanderExtraSteps: 30,
  /** × browsing: stationary this long while under browseStepFraction of the leg's steps */
  browseStationaryMs: 90_000,
  browseStepFraction: 0.6,
  /** arrived: at least this fraction of the leg's steps; help after the dwell plus helpExtraMs (×), stationary */
  arrivedStepFraction: 0.85,
  helpExtraMs: 40_000,
  /** without motion: elapsed > noMotionFactor × expected and > expected + noMotionExtraMs (×) */
  noMotionFactor: 2.5,
  noMotionExtraMs: 120_000,
  /** stationary: no step for this long and the accelerometer quiet (std of |a| over the window under this) */
  stationaryNoStepMs: 4_000,
  stationaryStd: 0.35,
  motionWindowMs: 2_000,
  /** Strict: the × thresholds at this fraction, and a second nudge a leg */
  strictScale: 0.7,
  nudgesPerLeg: { gentle: 1, strict: 2 },
} as const;

export type GuardMode = "off" | "gentle" | "strict";
export const GUARD_MODES: GuardMode[] = ["off", "gentle", "strict"];
export type StopKind = "shelf" | "bulk" | "counter" | "foodhall" | "pharmacy" | "checkout";

const FOOD_HALL = new Set(["hotbar", "soups", "saladbar", "pizza", "sushi", "rotisserie", "cafe", "seating"]);
const COUNTERS = new Set(["deli", "meat", "seafood", "cheese", "bakery", "service", "winebar"]);

/** What kind of stop a location is, for its dwell allowance: from the department of the fixture it is on. */
export function stopKind(store: StoreGraph, locationId: string | undefined | null): StopKind {
  if (!locationId) return "checkout";
  const loc = store.locations.find((l) => l.id === locationId);
  if (!loc) return "shelf";
  const dept = slotFor(store, loc)?.fixture.department ?? locationDepartment(store, loc)?.id ?? "";
  if (dept === "bulk" || loc.aisle === "BULK") return "bulk";
  if (dept === "pharmacy") return "pharmacy";
  if (FOOD_HALL.has(dept)) return "foodhall";
  if (COUNTERS.has(dept)) return "counter";
  if (dept === "checkout") return "checkout";
  return "shelf";
}

/** One leg's numbers: how far, how many steps, how long it should take. */
export interface LegPlan {
  /** changes when the next stop changes (a check-off, a skip, an add that re-solves) */
  key: string;
  distanceM: number;
  kind: StopKind;
  /** the leg to checkout (no stop): never nudged */
  toCheckout: boolean;
  item: string | null;
}

export interface Walker {
  strideM: number;
  speedMps: number;
}

export const legSteps = (leg: LegPlan, w: Walker) => leg.distanceM / w.strideM;
export const legExpectedMs = (leg: LegPlan, w: Walker) => (leg.distanceM / w.speedMps) * 1000 + GUARD.dwellS[leg.kind] * 1000;

/** What the detector knows of the trip so far. */
export interface GuardState {
  tripStartedAt: number;
  leg: {
    key: string;
    startedAt: number;
    /** steps at the leg's start (or at a Strict re-arm) */
    stepsAt: number;
    /** when the shopper last stopped moving (null: moving) */
    stillSince: number | null;
    nudges: number;
    /** Back on route in Gentle: quiet until the next leg */
    quiet: boolean;
    helped: boolean;
    /** when the leg went off route (wandering or browsing), until it came back */
    offSince: number | null;
  } | null;
  detours: number;
  offRouteMs: number;
}

export const initialGuard = (tripStartedAt: number): GuardState => ({ tripStartedAt, leg: null, detours: 0, offRouteMs: 0 });

export interface GuardInput {
  now: number;
  /** steps since the trip began; null without a motion sensor */
  steps: number | null;
  /** the shopper is standing still (meaningless without a sensor) */
  stationary: boolean;
  /** a close-up arrival or walk is playing */
  animating: boolean;
}

export type GuardShow = { kind: "guard"; reason: "wandering" | "browsing" | "time"; item: string | null; aheadM: number } | { kind: "help"; item: string | null } | null;

/**
 * One tick: the state after it, and what to show (null: nothing new). A new leg (its key changed) closes
 * the old one's off-route time and starts afresh.
 */
export function guardTick(s: GuardState, input: GuardInput, leg: LegPlan | null, mode: GuardMode, walker: Walker): { state: GuardState; show: GuardShow } {
  const { now } = input;
  let state = s;
  const steps = input.steps ?? 0;
  if (!leg) return { state: closeLeg(state, now), show: null };
  if (!state.leg || state.leg.key !== leg.key) {
    state = closeLeg(state, now);
    state = { ...state, leg: { key: leg.key, startedAt: now, stepsAt: steps, stillSince: input.stationary ? now : null, nudges: 0, quiet: false, helped: false, offSince: null } };
  }
  const L = state.leg!;
  const stillSince = input.steps === null ? null : input.stationary ? (L.stillSince ?? now) : null;
  state = { ...state, leg: { ...L, stillSince } };
  if (mode === "off" || leg.toCheckout || leg.kind === "checkout") return { state, show: null };

  const k = mode === "strict" ? GUARD.strictScale : 1;
  const legS = legSteps(leg, walker);
  const expected = legExpectedMs(leg, walker);
  const elapsed = now - state.leg!.startedAt;
  const taken = steps - state.leg!.stepsAt;
  const still = stillSince === null ? 0 : now - stillSince;

  // off route: the conditions themselves (counted for the checkout line even when no nudge may show)
  let reason: "wandering" | "browsing" | "time" | null = null;
  if (input.steps !== null) {
    if (taken > k * (GUARD.wanderFactor * legS + GUARD.wanderExtraSteps)) reason = "wandering";
    else if (still > k * GUARD.browseStationaryMs && taken < GUARD.browseStepFraction * legS) reason = "browsing";
  } else if (elapsed > GUARD.noMotionFactor * expected && elapsed > expected + k * GUARD.noMotionExtraMs) reason = "time";
  // within a counter's, the food hall's or the pharmacy's dwell allowance, waiting is the point
  const allowance = (leg.kind === "counter" || leg.kind === "foodhall" || leg.kind === "pharmacy") && elapsed < expected;
  if (allowance) reason = null;
  const off = state.leg!.offSince;
  if (reason && off === null) state = { ...state, leg: { ...state.leg!, offSince: now } };
  // back on it (walking on after browsing): the interval closes
  if (!reason && off !== null) state = { ...state, offRouteMs: state.offRouteMs + (now - off), leg: { ...state.leg!, offSince: null } };

  const quietNow = now - state.tripStartedAt < GUARD.quietStartMs || input.animating;
  // arrived, standing there a long time: help, not the guard (lost and wandering are different problems)
  const arrived = input.steps !== null && taken >= GUARD.arrivedStepFraction * legS;
  if (!quietNow && arrived && !reason && !state.leg!.helped && still > GUARD.dwellS[leg.kind] * 1000 + k * GUARD.helpExtraMs) {
    return { state: { ...state, leg: { ...state.leg!, helped: true } }, show: { kind: "help", item: leg.item } };
  }
  const limit = GUARD.nudgesPerLeg[mode];
  if (!quietNow && reason && !state.leg!.quiet && state.leg!.nudges < limit) {
    state = { ...state, detours: state.detours + 1, leg: { ...state.leg!, nudges: state.leg!.nudges + 1 } };
    return { state, show: { kind: "guard", reason, item: leg.item, aheadM: Math.round(leg.distanceM) } };
  }
  return { state, show: null };
}

/** "Back on route": close the off-route time; Gentle stays quiet this leg, Strict re-arms from here. */
export function backOnRoute(s: GuardState, now: number, steps: number | null, mode: GuardMode): GuardState {
  if (!s.leg) return s;
  const offRouteMs = s.offRouteMs + (s.leg.offSince !== null ? now - s.leg.offSince : 0);
  return { ...s, offRouteMs, leg: { ...s.leg, offSince: null, quiet: mode !== "strict", stepsAt: mode === "strict" ? (steps ?? s.leg.stepsAt) : s.leg.stepsAt, startedAt: mode === "strict" ? now : s.leg.startedAt, stillSince: null } };
}

function closeLeg(s: GuardState, now: number): GuardState {
  if (!s.leg) return s;
  return { ...s, offRouteMs: s.offRouteMs + (s.leg.offSince !== null ? now - s.leg.offSince : 0), leg: null };
}

/** "2 detours · off-route 3 min": only when there were any; nothing we cannot measure. */
export function detourLine(detours: number, offRouteMs: number): string | undefined {
  if (!detours) return undefined;
  const min = Math.round(offRouteMs / 60_000);
  return `${detours} ${detours === 1 ? "detour" : "detours"}${min >= 1 ? ` · off-route ${min} min` : ""}`;
}

/**
 * Standing still or moving, from the accelerometer: no step for a few seconds and |a| quiet over the last two.
 * Keeps only the last window's magnitudes, in memory.
 */
export class MotionTracker {
  private window: { t: number; m: number }[] = [];
  private lastStep = -Infinity;
  step(t: number) {
    this.lastStep = t;
  }
  sample(t: number, x: number, y: number, z: number) {
    this.window.push({ t, m: Math.hypot(x, y, z) });
    while (this.window.length && t - this.window[0].t > GUARD.motionWindowMs) this.window.shift();
  }
  stationary(now: number): boolean {
    if (now - this.lastStep < GUARD.stationaryNoStepMs) return false;
    const n = this.window.length;
    if (n < 4) return true;
    const mean = this.window.reduce((a, s) => a + s.m, 0) / n;
    const std = Math.sqrt(this.window.reduce((a, s) => a + (s.m - mean) ** 2, 0) / n);
    return std < GUARD.stationaryStd;
  }
}
