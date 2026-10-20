// Trip state: what is left, where the shopper is, what has been walked.
// Every change re-solves the remaining stops from the current position.
// Pure functions over a Router so the flow is testable without React.

import type { Route, RouteLeg, Router, Stop, StoreGraph } from "@grosher/core";

export interface TripState {
  /** planned list in typed order, with mid-trip additions appended */
  original: Stop[];
  remaining: Stop[];
  got: Stop[];
  skipped: Stop[];
  /** last checked-off node; the entrance until the first item */
  positionNodeId: string;
  walkedM: number;
  /** route for the remaining stops from positionNodeId */
  route: Route;
  /** ms epoch */
  startedAt: number;
  doneAt?: number;
  /** every node walked through so far, in order (for "aisles never entered") */
  visited: string[];
  /** shelf node of each collected stop, in order */
  doneNodeIds: string[];
  /** typed names the catalog could not place; asked about on the checkout screen */
  unplaced: string[];
  /** the off-list guard's two counts for this trip (lib/guard.ts): nudges shown, time off route; nothing else */
  detours?: number;
  offRouteMs?: number;
}

/**
 * Route `remaining` from `from`. A stop the map cannot place (its locations are not on this map: a saved
 * answer from an older one) leaves `remaining` for `unplaced`, so the trip routes everything else, never
 * waits on it, and checkout asks where it was.
 */
function routed(router: Router, remaining: Stop[], from: string, unplaced: string[]): { remaining: Stop[]; route: Route; unplaced: string[] } {
  const route = router.reroute(remaining, from);
  if (!route.unplaced?.length) return { remaining, route, unplaced };
  const out = new Set(route.unplaced);
  const names = remaining.filter((s) => out.has(s.id)).map((s) => s.name);
  return { remaining: remaining.filter((s) => !out.has(s.id)), route, unplaced: [...unplaced, ...names.filter((n) => !unplaced.includes(n))] };
}

export function startTrip(router: Router, stops: Stop[], unplaced: string[] = []): TripState {
  const positionNodeId = router.graph.store.entranceId;
  const r = routed(router, stops, positionNodeId, unplaced);
  return {
    original: stops,
    remaining: r.remaining,
    got: [],
    skipped: [],
    positionNodeId,
    walkedM: 0,
    route: r.route,
    startedAt: Date.now(),
    visited: [positionNodeId],
    doneNodeIds: [],
    unplaced: r.unplaced,
  };
}

export function nextLeg(t: TripState): RouteLeg | undefined {
  return t.route.legs.find((l) => l.stopId !== null);
}

export function nextStop(t: TripState): Stop | undefined {
  const leg = nextLeg(t);
  return leg ? t.remaining.find((s) => s.id === leg.stopId) : undefined;
}

export const isDone = (t: TripState) => t.remaining.length === 0;

export function gotIt(router: Router, t: TripState): TripState {
  const leg = nextLeg(t);
  const stop = nextStop(t);
  if (!leg || !stop) return t;
  const r = routed(router, t.remaining.filter((s) => s.id !== stop.id), leg.nodeId, t.unplaced);
  return {
    ...t,
    ...r,
    got: [...t.got, stop],
    positionNodeId: leg.nodeId,
    walkedM: t.walkedM + leg.distanceM,
    visited: [...t.visited, ...leg.path.slice(1)],
    doneNodeIds: [...t.doneNodeIds, leg.nodeId],
    doneAt: r.remaining.length === 0 ? Date.now() : t.doneAt,
  };
}

/** Item is not on the shelf: drop it and route on from where we stand. */
export function skipStop(router: Router, t: TripState): TripState {
  const stop = nextStop(t);
  if (!stop) return t;
  const r = routed(router, t.remaining.filter((s) => s.id !== stop.id), t.positionNodeId, t.unplaced);
  return {
    ...t,
    ...r,
    skipped: [...t.skipped, stop],
    doneAt: r.remaining.length === 0 ? Date.now() : t.doneAt,
  };
}

export function addItem(router: Router, t: TripState, stop: Stop): TripState {
  if (t.remaining.some((s) => s.id === stop.id) || t.got.some((s) => s.id === stop.id)) return t;
  const original = t.original.some((s) => s.id === stop.id) ? t.original : [...t.original, stop];
  const r = routed(router, [...t.remaining, stop], t.positionNodeId, t.unplaced);
  return { ...t, ...r, original, doneAt: r.remaining.length === 0 ? (t.doneAt ?? Date.now()) : undefined };
}

export const elapsedMs = (t: TripState, now = Date.now()) => (t.doneAt ?? now) - t.startedAt;

/** Aisles (A1, A2, …) the shopper never walked into, counting the route still ahead as walked. */
export function aislesNeverEntered(store: StoreGraph, t: TripState): { never: string[]; total: number } {
  const aisleOf = new Map<string, string[]>(); // aisle -> virtual node ids of its locations
  for (const loc of store.locations) {
    if (!/^A\d+$/i.test(loc.aisle)) continue;
    aisleOf.set(loc.aisle, [...(aisleOf.get(loc.aisle) ?? []), `loc:${loc.id}`]);
  }
  const walked = new Set<string>([...t.visited, ...t.route.legs.flatMap((l) => l.path)]);
  const never = [...aisleOf].filter(([, nodes]) => !nodes.some((n) => walked.has(n))).map(([a]) => a);
  never.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return { never, total: aisleOf.size };
}

export interface TripSummary {
  walkedM: number;
  /** remaining route: stops still to visit, then checkout and exit */
  toGoM: number;
  totalM: number;
  /** walking the collected items in typed order, entrance to exit */
  baselineM: number;
  savedM: number;
}

export function summarize(router: Router, t: TripState): TripSummary {
  const toGoM = t.route.legs.reduce((s, l) => s + l.distanceM, 0);
  const totalM = t.walkedM + toGoM;
  const collected = new Set(t.got.map((s) => s.id));
  const order = t.original.filter((s) => collected.has(s.id));
  const baselineM = router.routeForOrder(order).distanceM;
  return { walkedM: t.walkedM, toGoM, totalM, baselineM, savedM: baselineM - totalM };
}

// ---- persistence: ids only, routes are recomputed on restore

export interface TripSnapshot {
  original: string[];
  remaining: string[];
  got: string[];
  skipped: string[];
  positionNodeId: string;
  walkedM: number;
  startedAt?: number;
  doneAt?: number;
  visited?: string[];
  doneNodeIds?: string[];
  unplaced?: string[];
  detours?: number;
  offRouteMs?: number;
}

export function toSnapshot(t: TripState): TripSnapshot {
  const ids = (xs: Stop[]) => xs.map((s) => s.id);
  return {
    original: ids(t.original),
    remaining: ids(t.remaining),
    got: ids(t.got),
    skipped: ids(t.skipped),
    positionNodeId: t.positionNodeId,
    walkedM: t.walkedM,
    startedAt: t.startedAt,
    doneAt: t.doneAt,
    visited: t.visited,
    doneNodeIds: t.doneNodeIds,
    unplaced: t.unplaced,
    detours: t.detours,
    offRouteMs: t.offRouteMs,
  };
}

export function fromSnapshot(router: Router, catalog: Stop[], snap: TripSnapshot | null): TripState | null {
  if (!snap) return null;
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const pick = (ids: string[]) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  if (!router.graph.nodes.has(snap.positionNodeId)) return null;
  try {
    const r = routed(router, pick(snap.remaining), snap.positionNodeId, snap.unplaced ?? []);
    return {
      original: pick(snap.original),
      remaining: r.remaining,
      got: pick(snap.got),
      skipped: pick(snap.skipped),
      positionNodeId: snap.positionNodeId,
      walkedM: snap.walkedM,
      route: r.route,
      startedAt: snap.startedAt ?? Date.now(),
      doneAt: snap.doneAt,
      visited: snap.visited ?? [snap.positionNodeId],
      doneNodeIds: snap.doneNodeIds ?? [],
      unplaced: r.unplaced,
      detours: snap.detours,
      offRouteMs: snap.offRouteMs,
    };
  } catch {
    return null;
  }
}
