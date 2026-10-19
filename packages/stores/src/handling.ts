// Handling tags a store decides by the shelf: "heavy" (about 2 kg or more for the typical unit on that shelf:
// a case of water, a 10 lb bag of rice, a jug of detergent, a melon; the solver picks it early) and "bulky"
// (big and light: paper towels, toilet paper, diapers; it rides under or on top of the cart, no route
// penalty). A store that sets them on its categories (Grosher) rewrites every carried row by its category,
// so a row's own "heavy" from the source catalog never survives on a shelf that is not heavy. The one
// item-level exception: a multipack or case of cans or bottles, when the name says so.

import type { Category, ItemTag } from "@grosher/core";

export const HANDLING_TAGS: readonly ItemTag[] = ["heavy", "bulky"];

/** "Multipack", "Variety Case", "Water 24-pack" (6 or more) */
export const MULTIPACK = /\bmulti-?pack\b|\bvariety (?:pack|case)\b|\bcase\b|\b(?:[6-9]|[1-9]\d)\s*-?\s*(?:pack|pk|ct|count|cans|bottles)\b/i;

/** the shelves where a multipack is cans or bottles (heavy as a pack, light alone) */
export const MULTIPACK_SHELVES = new Set([
  "canned-vegetables", "canned-tomatoes", "canned-beans", "canned-fruit", "soup", "broth-stock", "chili-canned-meals", "canned-meat-fish",
  "energy-drinks", "coconut-water-functional", "protein-shakes-ready", "bottled-coffee", "hispanic-drinks", "kombucha-probiotic", "mixers", "refrigerated-juice",
]);

/** an item's tags with heavy / bulky taken from its shelf's category (plus heavy for a multipack of cans or bottles) */
export function handlingTags(tags: ItemTag[] | undefined, category: Category | undefined, name: string): ItemTag[] {
  const own = (tags ?? []).filter((t) => !HANDLING_TAGS.includes(t));
  const shelf = (category?.tags ?? []).filter((t) => HANDLING_TAGS.includes(t));
  const pack = category && !shelf.includes("heavy") && MULTIPACK_SHELVES.has(category.id) && MULTIPACK.test(name) ? (["heavy"] as ItemTag[]) : [];
  return [...own, ...shelf, ...pack];
}
