// What the resolver needs from a store that core cannot compute itself:
// which shelf locations belong to each department (via the fixtures).

import type { StoreGraph } from "@grosher/core";
import { fixtureForLocation } from "./slots.ts";

export function departmentLocations(store: StoreGraph): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const loc of store.locations) {
    const f = fixtureForLocation(store, loc);
    const dept = f?.department;
    if (!dept) continue;
    (out[dept] ??= []).push(loc.id);
  }
  return out;
}
