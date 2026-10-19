// Carrying a catalog from one store to another: product names and aliases are the same at every store, and
// items point at categories through their locations, so an item moves to the new store's shelf for the same
// category (CLAUDE.md "How to map a new store"). A re-home table moves the rows the old store had to shelve
// somewhere wrong (Grosher's beer, wine and spirits, which Walmart grocery kept with the bar mixers).

import type { Category, Stop } from "@grosher/core";

/** item id → {old category: new category} */
export type Rehome = Record<string, Record<string, string>>;

export function carryCatalog(items: Stop[], from: Category[], to: Category[], rehome: Rehome = {}): Stop[] {
  const catOfLoc = new Map(from.map((c) => [c.locationId, c.id]));
  const locOfCat = new Map(to.map((c) => [c.id, c.locationId]));
  const out: Stop[] = [];
  for (const s of items) {
    const moved = rehome[s.id];
    const locs = [
      ...new Set(
        s.locationIds.flatMap((l) => {
          const cat = catOfLoc.get(l);
          const target = cat ? locOfCat.get(moved?.[cat] ?? cat) : undefined;
          return target ? [target] : [];
        }),
      ),
    ];
    // an item whose every shelf is gone has no place in the new store: dropped, never left pointing at old ids
    if (locs.length) out.push({ ...s, locationIds: locs });
  }
  return out;
}
