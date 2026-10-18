// Reset detection: after a trip, did the store move things? Pure over a
// finished TripState; the flag lives in localStorage per store and stays
// dismissed until a later trip raises a new one.
//
//   flag when ≥ 3 misses land in the same aisle ("Not here", or found on a
//   different shelf than the map's first choice), or when ≥ 25% of the
//   trip's placed items missed

import type { StoreGraph } from "@grosher/core";
import type { TripState } from "./trip.ts";
import { load, save } from "./storage.ts";

export const RESET_AISLE_MISSES = 3;
export const RESET_MISS_SHARE = 0.25;

export interface TripMiss {
  name: string;
  /** the aisle the map said (the first candidate's), null when it has none */
  aisle: string | null;
  kind: "notHere" | "relocated";
}

export interface ResetFlag {
  /** the trip's id (t_<startedAt>): one flag per trip, so a dismissal holds until the next flagged trip */
  id: string;
  storeId: string;
  date: number;
  reason: "aisle" | "share";
  /** the aisle with the most misses, when any miss had one */
  aisle: string | null;
  items: string[];
  misses: number;
  placed: number;
}

const aisleOf = (store: StoreGraph, locationId: string | undefined) => (locationId ? (store.locations.find((l) => l.id === locationId)?.aisle ?? null) : null);

/** every stop the map got wrong this trip, with the aisle it pointed at */
export function tripMisses(store: StoreGraph, trip: TripState): TripMiss[] {
  const out: TripMiss[] = [];
  for (const s of trip.skipped) out.push({ name: s.name, aisle: aisleOf(store, s.locationIds[0]), kind: "notHere" });
  trip.got.forEach((s, i) => {
    const node = trip.doneNodeIds[i];
    const used = node?.startsWith("loc:") ? node.slice(4) : undefined;
    if (used && s.locationIds.length && used !== s.locationIds[0] && aisleOf(store, used) !== aisleOf(store, s.locationIds[0])) {
      out.push({ name: s.name, aisle: aisleOf(store, s.locationIds[0]), kind: "relocated" });
    }
  });
  return out;
}

export function detectReset(store: StoreGraph, trip: TripState): ResetFlag | null {
  const placed = trip.got.length + trip.skipped.length;
  if (!placed) return null;
  const misses = tripMisses(store, trip);
  if (!misses.length) return null;
  const byAisle = new Map<string, number>();
  for (const m of misses) if (m.aisle) byAisle.set(m.aisle, (byAisle.get(m.aisle) ?? 0) + 1);
  const top = [...byAisle.entries()].sort((a, b) => b[1] - a[1])[0];
  const reason: ResetFlag["reason"] | null = top && top[1] >= RESET_AISLE_MISSES ? "aisle" : misses.length / placed >= RESET_MISS_SHARE ? "share" : null;
  if (!reason) return null;
  return {
    id: `t_${trip.startedAt}`,
    storeId: store.storeId,
    date: trip.doneAt ?? Date.now(),
    reason,
    aisle: top?.[0] ?? null,
    items: [...new Set(misses.map((m) => m.name))],
    misses: misses.length,
    placed,
  };
}

/** "Demo Supercenter may have moved things · 4 misses on Thursday" */
export function bannerText(store: StoreGraph, flag: ResetFlag): string {
  const day = new Date(flag.date).toLocaleDateString(undefined, { weekday: "long" });
  return `${store.name ?? "The store"} may have moved things · ${flag.misses} ${flag.misses === 1 ? "miss" : "misses"} on ${day}`;
}

// ---------------------------------------------------------------- storage

export interface ResetState {
  flag: ResetFlag | null;
  dismissedId: string | null;
}

const key = (storeId: string) => `grosher.reset.${storeId}`;

export function loadResetState(storeId: string): ResetState {
  const o = load<Partial<ResetState> | null>(key(storeId), null);
  return { flag: o?.flag ?? null, dismissedId: o?.dismissedId ?? null };
}

export function saveResetState(storeId: string, s: ResetState): void {
  save(key(storeId), s);
}

export const resetVisible = (s: ResetState) => !!s.flag && s.flag.id !== s.dismissedId;

// ---------------------------------------------------------------- editor hand-off

export interface EditorFocus {
  aisle: string | null;
  items: string[];
  misses: number;
  date: number;
}

/** "#/edit?aisle=A4&items=Paneer,Ghee&misses=4&date=…" */
export function editorHashFor(flag: ResetFlag): string {
  const q = new URLSearchParams();
  if (flag.aisle) q.set("aisle", flag.aisle);
  q.set("items", flag.items.join(","));
  q.set("misses", String(flag.misses));
  q.set("date", String(flag.date));
  return `#/edit?${q.toString()}`;
}

export function parseEditorFocus(hash: string): EditorFocus | null {
  const i = hash.indexOf("?");
  if (!hash.startsWith("#/edit") || i < 0) return null;
  const q = new URLSearchParams(hash.slice(i + 1));
  if (!q.has("items") && !q.has("aisle")) return null;
  return {
    aisle: q.get("aisle"),
    items: (q.get("items") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    misses: Number(q.get("misses") ?? 0),
    date: Number(q.get("date") ?? Date.now()),
  };
}
