// Trip history: one record per finished trip, per store, in IndexedDB.

import type { Router, StoreGraph } from "@grosher/core";
import { dbGet, dbSet } from "./db.ts";
import { aislesNeverEntered, elapsedMs, summarize, type TripState } from "./trip.ts";

export interface TripRecord {
  id: string; // the trip's startedAt, so a trip is recorded once
  storeId: string;
  date: number; // doneAt
  bought: string[];
  skipped: string[];
  unknown: string[];
  walkedM: number;
  baselineM: number;
  savedM: number;
  timeMs: number;
  lane: string | null;
  aislesNever: number;
  aislesTotal: number;
}

export const key = (storeId: string) => `history:${storeId}`;
export const loadHistory = (storeId: string) => dbGet<TripRecord[]>(key(storeId), []);
export const saveHistory = (storeId: string, h: TripRecord[]) => dbSet(key(storeId), h);

export function recordFrom(store: StoreGraph, router: Router, trip: TripState): TripRecord {
  const s = summarize(router, trip);
  const never = aislesNeverEntered(store, trip);
  return {
    id: `t_${trip.startedAt}`,
    storeId: store.storeId,
    date: trip.doneAt ?? Date.now(),
    bought: trip.got.map((x) => x.name),
    skipped: trip.skipped.map((x) => x.name),
    unknown: [...trip.unplaced],
    walkedM: s.totalM,
    baselineM: s.baselineM,
    savedM: s.savedM,
    timeMs: elapsedMs(trip),
    lane: trip.route.legs.find((l) => l.label === "Checkout")?.nodeId ?? null,
    aislesNever: never.never.length,
    aislesTotal: never.total,
  };
}

/** Newest first; a record with the same id replaces the old one. */
export function addRecord(history: TripRecord[], r: TripRecord): TripRecord[] {
  return [r, ...history.filter((h) => h.id !== r.id)].sort((a, b) => b.date - a.date);
}

/** The trip before `r` at the same store, for "vs your last trip". */
export function previousOf(history: TripRecord[], r: TripRecord): TripRecord | undefined {
  return history.filter((h) => h.id !== r.id && h.date < r.date).sort((a, b) => b.date - a.date)[0];
}

export function mergeImported(history: TripRecord[], incoming: unknown): TripRecord[] {
  if (!Array.isArray(incoming)) return history;
  let out = history;
  for (const raw of incoming) {
    const r = raw as Partial<TripRecord>;
    if (!r || typeof r.id !== "string" || typeof r.date !== "number" || !Array.isArray(r.bought)) continue;
    out = addRecord(out, {
      id: r.id,
      storeId: r.storeId ?? "",
      date: r.date,
      bought: r.bought.filter((s): s is string => typeof s === "string"),
      skipped: Array.isArray(r.skipped) ? r.skipped.filter((s): s is string => typeof s === "string") : [],
      unknown: Array.isArray(r.unknown) ? r.unknown.filter((s): s is string => typeof s === "string") : [],
      walkedM: r.walkedM ?? 0,
      baselineM: r.baselineM ?? 0,
      savedM: r.savedM ?? 0,
      timeMs: r.timeMs ?? 0,
      lane: r.lane ?? null,
      aislesNever: r.aislesNever ?? 0,
      aislesTotal: r.aislesTotal ?? 0,
    });
  }
  return out;
}
