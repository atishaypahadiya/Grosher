// The reconcile pass: a catalog of items against the store's signs. Pure.
// Used by the seed, the Instacart import and the merge; see CLAUDE.md,
// "Store data".

import { normalize, singularize, type Category, type ItemTag, type Stop } from "@grosher/core";

/** the dedupe key, the resolver's own normalisation: lowercase, punctuation out, every word singular */
export const catalogKey = (s: string) => singularize(normalize(s));
const norm = catalogKey;

export type CatalogRow = Stop & { origin?: "instacart" | "seeded"; category?: string };

/** a hand-kept base row: no origin and no generating category; never touched by reconcile */
export const isBaseRow = (s: Stop) => !(s as CatalogRow).origin && !(s as CatalogRow).category;

/**
 * Reconcile the finished catalog against the signs. The model lists generic
 * products under neighbouring categories ("Butter" in baking, "Cilantro" in
 * Hispanic foods) and the first category seeded claims the name, so the
 * right shelf, seeded later, ends up second. When one or more categories
 * name an item (its name or an alias equals the sign's name, an alias or the
 * id's words, or the item's words all sit inside the sign's name), those
 * slots are its locations and the others go; an alias that is another sign's
 * name goes too (a cookie is not "peanut butter"). Pure, no model.
 */
export function reconcile(items: Stop[], cats: Category[]): { relocated: number; locationsDropped: number; aliasesDropped: number } {
  const catByLoc = new Map(cats.map((c) => [c.locationId, c]));
  const labelIndex = new Map<string, Set<string>>();
  const labelsOf = (c: Category) => [c.name, c.id.replace(/-/g, " "), ...(c.aliases ?? [])];
  for (const c of cats) for (const l of labelsOf(c)) labelIndex.set(norm(l), (labelIndex.get(norm(l)) ?? new Set()).add(c.id));
  const tokensOf = (s: string) => norm(s).split(" ").filter((t) => t && t !== "and");
  const names = (c: Category, item: Stop) => {
    // the item's name votes, never its aliases: a merged "evaporated milk" alias must not keep Milk on the baking aisle
    const key = norm(item.name);
    if (labelsOf(c).some((l) => norm(l) === key)) return 2;
    // containment only for multi-word names: "Frozen pizza" sits inside "Frozen pizza & appetizers", but a
    // lone "Milk" inside "Evaporated & condensed milk" is a different product
    const ct = new Set(tokensOf(c.name));
    const it = tokensOf(item.name);
    return it.length >= 2 && it.every((t) => ct.has(t)) ? 1 : 0;
  };
  // duplicates by the resolver's key (earlier runs keyed differently): merge into the first, keep its id
  const byKey = new Map<string, Stop>();
  const isBase = isBaseRow;
  const firstIndex = new Map<string, number>();
  items.forEach((s, i) => {
    const k = norm(s.name);
    if (!firstIndex.has(k)) firstIndex.set(k, i);
  });
  for (let i = items.length - 1; i >= 0; i--) {
    const k = norm(items[i].name);
    const first = firstIndex.get(k)!;
    if (first < i) {
      const keep = items[first];
      if (isBase(keep)) {
        items.splice(i, 1); // base rows are hand-kept: the seeded duplicate goes, the base row stays as written
        continue;
      }
      keep.locationIds = [...new Set([...keep.locationIds, ...items[i].locationIds])];
      keep.aliases = [...new Set([...(keep.aliases ?? []), ...(items[i].aliases ?? []), items[i].name].filter((a) => norm(a) !== k))];
      if (items[i].tags?.length) keep.tags = [...new Set([...(keep.tags ?? []), ...items[i].tags!])] as ItemTag[];
      items.splice(i, 1);
    }
    byKey.set(k, items[first < i ? first : i]);
  }
  const nameOwner = new Map<string, Stop>();
  for (const it of items) nameOwner.set(norm(it.name), it);
  let relocated = 0;
  let locationsDropped = 0;
  let aliasesDropped = 0;
  for (const item of items) {
    if (isBase(item)) continue; // hand-kept: never relocated, never stripped
    const before = [...new Set(item.locationIds)];
    // categories that name the item outright, whether or not they generated it
    const named = new Map<string, number>();
    for (const id of labelIndex.get(norm(item.name)) ?? []) named.set(cats.find((c) => c.id === id)!.locationId, 3);
    for (const loc of before) {
      const c = catByLoc.get(loc);
      const n = c ? names(c, item) : 0;
      if (n) named.set(loc, Math.max(named.get(loc) ?? 0, n));
    }
    if (named.size) {
      const after = [...named.entries()].sort((a, b) => b[1] - a[1] || before.indexOf(a[0]) - before.indexOf(b[0])).map(([loc]) => loc);
      if (after[0] !== before[0]) relocated++;
      locationsDropped += before.filter((l) => !after.includes(l)).length;
      item.locationIds = after;
    } else item.locationIds = before;
    // frozen / chilled are properties of the shelf: keep them only when a kept shelf has them
    if (item.tags?.some((t) => t === "frozen" || t === "chilled")) {
      const shelfTags = new Set(item.locationIds.flatMap((l) => catByLoc.get(l)?.tags ?? []));
      const tags = item.tags.filter((t) => (t !== "frozen" && t !== "chilled") || shelfTags.has(t));
      item.tags = tags.length ? tags : undefined;
    }
    if (item.aliases?.length) {
      const own = new Set(item.locationIds.map((l) => catByLoc.get(l)?.id).filter(Boolean) as string[]);
      const kept = item.aliases.filter((a) => {
        const k = norm(a);
        if (k === norm(item.name)) return false;
        const owners = labelIndex.get(k);
        if (owners && ![...owners].some((o) => own.has(o))) return false; // another sign's name
        const other = nameOwner.get(k);
        return !other || other === item || other.locationIds[0] === item.locationIds[0]; // another item's name on another shelf
      });
      aliasesDropped += item.aliases.length - kept.length;
      item.aliases = kept.length ? kept : undefined;
    }
  }
  return { relocated, locationsDropped, aliasesDropped };
}

