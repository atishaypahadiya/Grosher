// What the resolver needs from a store that core cannot compute itself:
// which shelf locations belong to each department (via the fixtures), and
// the category table in the shape the resolve context takes.

import type { Category, StoreGraph } from "@grosher/core";
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

/** category id → its shelf location (one each) */
export function categoryLocations(categories: Category[]): Record<string, string> {
  return Object.fromEntries(categories.map((c) => [c.id, c.locationId]));
}

/** the compact option list the LLM providers send: id and the name on the sign */
export const llmOptions = (categories: Category[]) => categories.map((c) => ({ id: c.id, name: c.name }));
