import type { StoreGraph } from "@grosher/core";

/** Shopping pace with a cart, metres per second. Matches the core bench. */
export const WALK_MPS = 1.0;

export function metres(m: number): string {
  return `${Math.round(m)} m`;
}

/** "about 4 min" / "under a minute" at shopping pace. */
export function minutes(m: number): string {
  const min = m / WALK_MPS / 60;
  if (min < 1) return "under a minute";
  return `about ${min.toFixed(min < 10 ? 1 : 0)} min`;
}

const SIDE: Record<string, string> = { L: "left", R: "right" };

/** "A12, left, section 100" style description of a shelf location. */
export function describeLocation(store: StoreGraph, locationId: string | undefined): string {
  const loc = store.locations.find((l) => l.id === locationId);
  if (!loc) return "";
  const parts = [loc.aisle];
  if (loc.side) parts.push(SIDE[loc.side] ?? loc.side);
  if (loc.bay) parts.push(`section ${loc.bay}`);
  return parts.join(", ");
}
