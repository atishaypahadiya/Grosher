import type { StoreGraph } from "@grosher/core";
import { locationDepartment } from "./chips.ts";

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

/** mm:ss, or h:mm:ss past an hour. For the Doto timers. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Rounded minutes as a plain number string, for Doto metrics. */
export const minutesNum = (m: number) => String(Math.max(1, Math.round(m / WALK_MPS / 60)));

const SIDE: Record<string, string> = { L: "left", R: "right" };

/** "A12, left, section 100" style description of a shelf location. */
/** "A4, left" on a numbered aisle; a wall or counter by its department's name ("Body care, left", not "BODYCARE") */
export function describeLocation(store: StoreGraph, locationId: string | undefined): string {
  const loc = store.locations.find((l) => l.id === locationId);
  if (!loc) return "";
  const parts = [/^A\d+$/i.test(loc.aisle) ? loc.aisle : locationDepartment(store, loc)?.name ?? loc.aisle];
  if (loc.side) parts.push(SIDE[loc.side] ?? loc.side);
  if (loc.bay) parts.push(`section ${loc.bay}`);
  return parts.join(", ");
}

/** A checkout node as the shopper reads it: "lane 4" (the demo's L3), "lane 1" (LANE1), "express lane", "self-checkout". */
export function laneName(nodeId: string | null | undefined): string | null {
  if (!nodeId) return null;
  if (/^self/i.test(nodeId)) return "self-checkout";
  if (/^express/i.test(nodeId)) return "express lane";
  const named = nodeId.match(/^LANE(\d+)$/i);
  if (named) return `lane ${Number(named[1])}`;
  return `lane ${nodeId.replace(/^L/, "").replace(/^(\d+)$/, (m) => String(Number(m) + 1))}`;
}
