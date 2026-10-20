// ?demo=walk: the off-list guard shown on a desk. It loads the "Friday night in" hero list, starts the trip
// and replays a scripted walk through it, six times faster than life: the steps and the standing still the
// phone would sense (at the guard's default stride), a check-off at each stop after its dwell. One leg has a deliberate detour (the guard
// fires; the demo taps Back on route after a few seconds), and the food hall's sushi counter has a long
// wait inside its allowance (the guard correctly stays quiet). What happened goes to window.__grosherGuardDemo
// for the CI check (scripts/guard-demo.mjs). A "demo walk" badge shows while it plays.

import { GUARD, type GuardShow, type LegPlan } from "./guard.ts";
import type { GuardFeed } from "./useGuard.ts";

export const demoWalkOn = () => typeof location !== "undefined" && new URLSearchParams(location.search).get("demo") === "walk";
export const DEMO_LIST = "Friday night in";
/** simulated seconds per real second (?speed=N overrides it, 1–30: the CI checks run it faster) */
export const DEMO_SPEED = (() => {
  const q = typeof location !== "undefined" ? Number(new URLSearchParams(location.search).get("speed")) : NaN;
  return Number.isFinite(q) && q >= 1 ? Math.min(30, q) : 6;
})();
/** the leg (0-based) with the detour: wandering well past the guard's threshold before it heads for the stop */
export const DEMO_DETOUR_LEG = 2;
const detourSteps = (legSteps: number) => GUARD.wanderFactor * legSteps + GUARD.wanderExtraSteps + 40;
/** the long wait at a counter or the food hall: inside its allowance (dwell + the walk) */
const COUNTER_WAIT_S = 150;
/** seconds (real) the guard's card stays up before the demo taps Back on route */
const CARD_REAL_S = 4;
const CADENCE = 1.8;

export interface DemoEvent {
  t: number;
  leg: number;
  item: string | null;
  kind: LegPlan["kind"];
  event: "leg" | "detour" | "arrive" | "guard" | "help" | "back" | "gotit";
  reason?: string;
}

export class DemoWalk implements GuardFeed {
  private readonly realStart = Date.now();
  private readonly simStart = Date.now();
  private stepCount = 0;
  private still = false;
  private legKey = "";
  private legIndex = -1;
  private phase: "detour" | "walk" | "dwell" = "walk";
  private left = 0;
  private dwellUntil = 0;
  private cardSince: number | null = null;
  readonly events: DemoEvent[] = [];

  constructor() {
    if (typeof window !== "undefined") (window as Window & { __grosherGuardDemo?: DemoEvent[] }).__grosherGuardDemo = this.events;
  }
  now() {
    return this.simStart + (Date.now() - this.realStart) * DEMO_SPEED;
  }
  steps() {
    return Math.floor(this.stepCount);
  }
  stationary() {
    return this.still;
  }
  stop() {}

  private log(event: DemoEvent["event"], leg: LegPlan, reason?: string) {
    this.events.push({ t: Math.round((this.now() - this.simStart) / 1000), leg: this.legIndex, item: leg.item, kind: leg.kind, event, reason });
  }

  /** a real second: DEMO_SPEED seconds of the walk */
  advance(leg: LegPlan | null, shown: GuardShow): "back" | "gotit" | null {
    if (!leg || leg.toCheckout) return null;
    if (leg.key !== this.legKey) {
      this.legKey = leg.key;
      this.legIndex++;
      this.left = leg.distanceM / GUARD.strideM;
      this.phase = this.legIndex === DEMO_DETOUR_LEG ? "detour" : "walk";
      if (this.phase === "detour") this.left = detourSteps(leg.distanceM / GUARD.strideM);
      this.cardSince = null;
      this.log("leg", leg);
      if (this.phase === "detour") this.log("detour", leg);
    }
    // the guard's card: noted, then answered after a few seconds
    if (shown) {
      if (this.cardSince === null) {
        this.cardSince = Date.now();
        this.log(shown.kind, leg, shown.kind === "guard" ? shown.reason : undefined);
      } else if (shown.kind === "guard" && Date.now() - this.cardSince > CARD_REAL_S * 1000) {
        this.log("back", leg);
        return "back";
      }
    }
    const dt = DEMO_SPEED;
    if (this.phase === "detour" || this.phase === "walk") {
      this.still = false;
      this.stepCount += CADENCE * dt;
      this.left -= CADENCE * dt;
      if (this.left <= 0) {
        if (this.phase === "detour") {
          // back to the route: now the leg itself
          this.phase = "walk";
          this.left = leg.distanceM / GUARD.strideM;
        } else {
          this.phase = "dwell";
          this.still = true;
          const counter = leg.kind === "counter" || leg.kind === "foodhall";
          this.dwellUntil = this.now() + (counter ? COUNTER_WAIT_S : GUARD.dwellS[leg.kind]) * 1000;
          this.log("arrive", leg);
        }
      }
      return null;
    }
    this.still = true;
    if (this.now() >= this.dwellUntil) {
      this.log("gotit", leg);
      return "gotit";
    }
    return null;
  }
}
