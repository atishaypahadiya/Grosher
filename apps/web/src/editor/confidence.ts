// The editor's confidence view: what the map knows per shelf location, from
// the catalog entries and the shopper's memory rows that point at it. Pure.

import { band, daysSinceConfirmed, decayed, DECAY_AFTER_MS, type Band, type ConfidenceRecord, type ItemMemory, type Stop, type StoreGraph } from "@grosher/core";

export interface LocationMark {
  /** the weakest band among the entries at this location */
  band: Band;
  misses: number;
  /** any entry not confirmed in 90 days, or in the guess band */
  stale: boolean;
  entries: number;
}

export interface BandCounts {
  confirmed: number;
  likely: number;
  guess: number;
  stale: number;
  total: number;
}

const STALE_DAYS = DECAY_AFTER_MS / 86_400_000;

export const isStale = (r: ConfidenceRecord, now: number) => {
  const days = daysSinceConfirmed(r, now);
  return band(decayed(r, now)) === "guess" || (days !== null && days > STALE_DAYS);
};

const ORDER: Band[] = ["guess", "likely", "confirmed"];
const weaker = (a: Band, b: Band) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);

/** location id → mark, for every location at least one entry points at */
export function locationMarks(store: StoreGraph, catalog: Stop[], memory: ItemMemory[], now = Date.now()): Map<string, LocationMark> {
  const marks = new Map<string, LocationMark>();
  const add = (id: string, r: ConfidenceRecord) => {
    if (!store.locations.some((l) => l.id === id)) return;
    const b = band(decayed(r, now));
    const m = marks.get(id);
    marks.set(id, {
      band: m ? weaker(m.band, b) : b,
      misses: (m?.misses ?? 0) + (r.misses ?? 0),
      stale: (m?.stale ?? false) || isStale(r, now),
      entries: (m?.entries ?? 0) + 1,
    });
  };
  for (const s of catalog) for (const id of s.locationIds) add(id, s);
  for (const r of memory) add(r.locationId, r);
  return marks;
}

/** how many entries sit in each band, and how many are stale */
export function bandCounts(catalog: Stop[], memory: ItemMemory[], now = Date.now()): BandCounts {
  const out: BandCounts = { confirmed: 0, likely: 0, guess: 0, stale: 0, total: 0 };
  for (const r of [...catalog, ...memory]) {
    out[band(decayed(r, now))]++;
    if (isStale(r, now)) out.stale++;
    out.total++;
  }
  return out;
}
