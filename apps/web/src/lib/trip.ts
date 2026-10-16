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
}

export function startTrip(router: Router, stops: Stop[]): TripState {
  const positionNodeId = router.graph.store.entranceId;
  return {
    original: stops,
    remaining: stops,
    got: [],
    skipped: [],
    positionNodeId,
    walkedM: 0,
    route: router.solve({ stops }),
    startedAt: Date.now(),
    visited: [positionNodeId],
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
  const remaining = t.remaining.filter((s) => s.id !== stop.id);
  return {
    ...t,
    remaining,
    got: [...t.got, stop],
    positionNodeId: leg.nodeId,
    walkedM: t.walkedM + leg.distanceM,
    route: router.reroute(remaining, leg.nodeId),
    visited: [...t.visited, ...leg.path.slice(1)],
    doneAt: remaining.length === 0 ? Date.now() : t.doneAt,
  };
}

/** Item is not on the shelf: drop it and route on from where we stand. */
export function skipStop(router: Router, t: TripState): TripState {
  const stop = nextStop(t);
  if (!stop) return t;
  const remaining = t.remaining.filter((s) => s.id !== stop.id);
  return {
    ...t,
    remaining,
    skipped: [...t.skipped, stop],
    route: router.reroute(remaining, t.positionNodeId),
    doneAt: remaining.length === 0 ? Date.now() : t.doneAt,
  };
}

export function addItem(router: Router, t: TripState, stop: Stop): TripState {
  if (t.remaining.some((s) => s.id === stop.id) || t.got.some((s) => s.id === stop.id)) return t;
  const remaining = [...t.remaining, stop];
  const original = t.original.some((s) => s.id === stop.id) ? t.original : [...t.original, stop];
  return { ...t, original, remaining, route: router.reroute(remaining, t.positionNodeId), doneAt: undefined };
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
  };
}

export function fromSnapshot(router: Router, catalog: Stop[], snap: TripSnapshot | null): TripState | null {
  if (!snap) return null;
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const pick = (ids: string[]) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  if (!router.graph.nodes.has(snap.positionNodeId)) return null;
  const remaining = pick(snap.remaining);
  try {
    return {
      original: pick(snap.original),
      remaining,
      got: pick(snap.got),
      skipped: pick(snap.skipped),
      positionNodeId: snap.positionNodeId,
      walkedM: snap.walkedM,
      route: router.reroute(remaining, snap.positionNodeId),
      startedAt: snap.startedAt ?? Date.now(),
      doneAt: snap.doneAt,
      visited: snap.visited ?? [snap.positionNodeId],
    };
  } catch {
    return null;
  }
}
