// Row chips on the List screen: where an item lives, in the store's words.

import { band, type Band, type Department, type ResolveResult, type ShelfLocation, type Stop, type StoreGraph } from "@grosher/core";

/** How a band reads on a chip: confirmed full, likely 80%, a guess is amber text ("probably …") at full opacity. */
export const BAND_OPACITY: Record<Band, number> = { confirmed: 1, likely: 0.8, guess: 1 };

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
  if (locs.length === 0) return { text: "Needs a place" };
  const first = locs[0];
  const dept = locationDepartment(store, first);
  const label = (loc: ShelfLocation) => (AISLE.test(loc.aisle) ? loc.aisle.toUpperCase() : titleCase(locationDepartment(store, loc)?.name ?? loc.aisle));
  let text = label(first);
  // a second place only when it reads differently ("A6 or endcap", never "A18 or a18")
  const second = locs.slice(1).map(label).find((l) => l.toLowerCase() !== text.toLowerCase());
  if (second) text = `${text} or ${second.toLowerCase()}`;
  else if (AISLE.test(first.aisle) && dept) text = `${text} · ${dept.name.toLowerCase()}`;
  // "last" (cold, picked late) is the shelf's storage: its location's tags (the category's), never the
  // aisle's or the department's; a location without a tags array leaves it to the item's own tags
  const storage = first.tags ?? stop.tags ?? [];
  if (storage.some((t) => t === "frozen" || t === "chilled")) text += " · last";
  return { text, color: dept?.color };
}

/** The List row chip for a resolution: a guess (band < .5, every fresh llm answer) reads "probably A4 · cereal"; memory hits say "yours". */
export function chipForResult(store: StoreGraph, r: ResolveResult): Chip | null {
  if (!r.locationIds.length) return null;
  const stop: Stop = { id: r.stopId ?? r.query, name: r.canonicalName, locationIds: r.locationIds, tags: r.tags };
  const base = chipFor(store, stop);
  if (band(r.confidence) === "guess") {
    const first = store.locations.find((l) => l.id === r.locationIds[0]);
    const where = first ? (AISLE.test(first.aisle) ? first.aisle.toUpperCase() : titleCase(locationDepartment(store, first)?.name ?? first.aisle)) : r.department ?? "";
    return { text: `probably ${where}${r.subcategory ? ` · ${r.subcategory}` : ""}`, color: base.color };
  }
  if (r.source === "memory") return { text: `${base.text} · yours`, color: base.color };
  // a category hit: the aisle and what the sign says there ("A7 · Dal & pulses")
  if (r.source === "category" && r.subcategory) {
    const first = store.locations.find((l) => l.id === r.locationIds[0]);
    const where = first ? (AISLE.test(first.aisle) ? first.aisle.toUpperCase() : titleCase(locationDepartment(store, first)?.name ?? first.aisle)) : "";
    return { text: `${where}${where ? " · " : ""}${r.subcategory}`, color: base.color };
  }
  return base;
}
