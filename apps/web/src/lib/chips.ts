// Row chips on the List screen: where an item lives, in the store's words.

import type { Department, ResolveResult, ShelfLocation, Stop, StoreGraph } from "@grosher/core";

const AISLE = /^A\d+$/i;

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** The department of a shelf location, through the fixture that carries the same aisle code. */
export function locationDepartment(store: StoreGraph, loc: ShelfLocation | undefined): Department | undefined {
  if (!loc) return undefined;
  const fixture = store.fixtures?.find((f) => f.aisle === loc.aisle && f.department);
  return fixture ? store.departments?.find((d) => d.id === fixture.department) : undefined;
}

export interface Chip {
  text: string;
  color?: string;
}

/** "A1 · dry goods", "Dairy · last", "A6 or endcap", "Bakery". */
export function chipFor(store: StoreGraph, stop: Stop): Chip {
  const locs = stop.locationIds.map((id) => store.locations.find((l) => l.id === id)).filter((l): l is ShelfLocation => !!l);
  if (locs.length === 0) return { text: "Not placed yet" };
  const first = locs[0];
  const dept = locationDepartment(store, first);
  const label = (loc: ShelfLocation) => (AISLE.test(loc.aisle) ? loc.aisle.toUpperCase() : titleCase(locationDepartment(store, loc)?.name ?? loc.aisle));
  let text = label(first);
  if (locs.length > 1) text = `${text} or ${label(locs[1]).toLowerCase()}`;
  else if (AISLE.test(first.aisle) && dept) text = `${text} · ${dept.name.toLowerCase()}`;
  if ((stop.tags ?? []).some((t) => t === "frozen" || t === "chilled")) text += " · last";
  return { text, color: dept?.color };
}

/** The List row chip for a resolution: llm guesses read "probably A4 · cereal"; memory hits say "yours". */
export function chipForResult(store: StoreGraph, r: ResolveResult): Chip | null {
  if (!r.locationIds.length) return null;
  const stop: Stop = { id: r.stopId ?? r.query, name: r.canonicalName, locationIds: r.locationIds, tags: r.tags };
  const base = chipFor(store, stop);
  if (r.source === "llm") {
    const first = store.locations.find((l) => l.id === r.locationIds[0]);
    const where = first ? (AISLE.test(first.aisle) ? first.aisle.toUpperCase() : titleCase(locationDepartment(store, first)?.name ?? first.aisle)) : r.department ?? "";
    return { text: `probably ${where}${r.subcategory ? ` · ${r.subcategory}` : ""}`, color: base.color };
  }
  if (r.source === "memory") return { text: `${base.text} · yours`, color: base.color };
  return base;
}
