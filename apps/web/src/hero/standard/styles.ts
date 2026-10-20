// What every category's goods look like in a standard close-up: the pack they come in (a shape from the shelf
// kit, kit/products.ts STANDARD_TEMPLATES), the colour of their Grosher house label's band, and, for what is
// sold loose (produce, the service counters' trays), what lies in the crate or on the tray. Pure data: the
// texture generator draws each category's label at its pack's aspect from it, the zone builder stocks
// shelves with it.

import type { StandardStyle } from "../kit/products.ts";

/** first match wins: a word in the category's id, then its department */
const BY_WORD: [RegExp, StandardStyle][] = [
  [/k-cups|tea$|hot-cocoa|coffee-filters|food-coloring|baking-essentials|bouillon|gravy-dry|cotton-swabs|toothbrushes|razors|family-planning|thermometers|smoking|first-aid|eye-ear|travel-sizes|hair-accessories|batteries|kids-medicine|cold-flu|allergy|pain-relief|digestive|sleep-aids|diabetes|foot-care|feminine|baby-health|mens-grooming/, "smallbox"],
  [/cereal|granola$|breakfast-bars|toaster|pancake|biscuits|crackers|graham|cookies(?!-bakery)|international-biscuits|snack-cakes|rice-crispy|mac-and-cheese|boxed-meals|baking-mixes|frosting|pie-filling|croutons|breading|rice-mixes|protein-bars|snack-packs|fruit-snacks|kids-fruit|lunchables|disposable-plates|trash-bags|food-storage|baby-wipes|pasta(?!-sauce)|gluten-free-pasta|asian-instant|ramen|papad|indian-ready|tortillas|hispanic-tortillas|seaweed/, "cereal"],
  [/chips|cheese-puffs|pretzels|popcorn|veggie-chips|indian-snacks|hispanic-snacks|gummy|hard-candy|seasonal-candy|rice-cakes|jerky|dog-treats|cat-treats/, "bag"],
  [/ground-coffee|nuts$|dried-fruit|seeds|sugar$|rice$|asian-rice|dried-beans|dal-lentils|chocolate-bars|premium-chocolate|indian-sweets|gum$|protein-powder|baby-food|dog-supplies|small-pet|sponges|kitchen-towels/, "pouch"],
  [/flour|atta|basmati|charcoal|cat-litter|dog-food|cat-food/, "sack"],
  [/canned|soup|broth|chili-canned|coconut-milk|evaporated|pie-filling|tomatoes$|beans$/, "tin"],
  [/peanut-butter|jelly|hazelnut|honey|salsa|pickles|indian-pickles|dips-salsa|mayo|pasta-sauce|mediterranean|kosher|ghee-oils|shortening/, "jar"],
  [/spices|masala|indian-spices|seasoning|salt|hispanic-spices|extract/, "spice"],
  [/oil$|vinegar|cooking-oil|syrup|ketchup|hot-sauce|salad-dressing|marinades|bbq|asian-sauces|asian-chili|mexican-sauces|lemon-lime|creamer-shelf|bottled-coffee|cold-brew|iced-tea|sports|energy|kombucha|coconut-water|hispanic-drinks|indian-tea-drinks|protein-shakes|juice-shelf|breakfast-drinks|mixers/, "bottle"],
  [/dish-soap|cleaners|bleach|laundry|fabric-softener|stain-remover|air-fresheners|pest-control|shampoo|body-wash|hand-soap|lotion|facial-care|hair-styling|deodorant|body-spray|toothpaste|baby-bath|bottles-feeding|baby-formula|vitamins/, "plastic"],
  [/wine|spirits|sparkling-wine|wine-bar/, "wine"],
  [/bottled-water|sparkling-water|soda|diet-soda|cold-beer|beer$|cider|shelf-milk/, "case"],
  [/toilet-paper|paper-towels|facial-tissue|diapers|incontinence|mops/, "bigpack"],
  [/milk|cream-creamer|refrigerated-juice|liquid-egg/, "jug"],
  [/yogurt|sour-cream|pudding|hummus|butter|whipped|dairy-free|paneer|refrigerated-dough|refrigerated-pasta|deli-cheese|shredded-cheese/, "cup"],
  [/^eggs$/, "eggs"],
  [/block-specialty|deli-meat|lunch-meat/, "wedge"],
  [/ice-cream$|sherbet|frozen-desserts/, "pint"],
  [/ice-cream-bars|frozen-fruit-bars|frozen-(?!vegetables|fruit$|potatoes|seafood|meat|chicken|turkey)|^ice$/, "frozen"],
  [/frozen-vegetables|frozen-fruit$|frozen-potatoes|frozen-seafood|frozen-chicken|frozen-meat|frozen-turkey/, "pouch"],
  [/beef|pork|turkey-lamb|halal|marinated|chicken$|bacon|hot-dogs|plant-protein|seafood$|party-trays|prepared-salads/, "tray"],
  [/bread|buns|bagels|pita|naan|international-breads|packaged-pastries|cakes|donuts|cookies-bakery|pies/, "loaf"],
  [/cookware|utensils|storage-containers|hardware/, "carton"],
];

const BY_DEPARTMENT: Record<string, StandardStyle> = {
  breakfast: "cereal",
  baking: "carton",
  pasta: "carton",
  world: "jar",
  canned: "tin",
  snack: "bag",
  drinks: "bottle",
  household: "plastic",
  kitchen: "carton",
  babypet: "carton",
  alcohol: "wine",
  pharmacy: "smallbox",
  bodycare: "plastic",
  dairy: "cup",
  cheese: "wedge",
  frozen: "frozen",
  meat: "tray",
  seafood: "tray",
  deli: "tray",
  bakery: "loaf",
};

export function styleOf(categoryId: string, department: string): StandardStyle {
  for (const [re, style] of BY_WORD) if (re.test(categoryId)) return style;
  return BY_DEPARTMENT[department] ?? "carton";
}

/** the band on a category's house label: its department's colour family, kept warm and printable (no blue:
 * DESIGN.md §7, the store's too) */
export const BAND: Record<string, string> = {
  breakfast: "#C8862E",
  baking: "#B5623E",
  pasta: "#B8452E",
  world: "#7E5A9A",
  canned: "#9E3A2A",
  snack: "#D9772A",
  drinks: "#2E7D5E",
  household: "#7A5E4A",
  kitchen: "#5A6A3A",
  babypet: "#6A8A3A",
  alcohol: "#6E2A3A",
  pharmacy: "#2E7D5A",
  bodycare: "#8A5A8A",
  dairy: "#5E8A4A",
  cheese: "#D4A82E",
  frozen: "#4E7A62",
  meat: "#A8322E",
  seafood: "#8A5A4A",
  deli: "#8E5A2E",
  bakery: "#B87A3A",
  produce: "#5E8A3A",
  floral: "#B04A6A",
};

/** what lies loose in a crate or on a counter's tray: a grain shape (at fruit size) and a colour */
export interface Loose {
  shape: string;
  cellM: number;
  tints: string[];
}
const ROUND = "makhana";
export const LOOSE: [RegExp, Loose][] = [
  [/bananas/, { shape: "basmati", cellM: 1.3, tints: ["#E8C840", "#E0BC3A"] }],
  [/apples/, { shape: ROUND, cellM: 0.8, tints: ["#C8402E", "#8EAE3A", "#E0A030"] }],
  [/citrus/, { shape: ROUND, cellM: 0.85, tints: ["#E8902A", "#E8C840", "#8EAE3A"] }],
  [/berries/, { shape: "raisin", cellM: 0.18, tints: ["#3A2A6A", "#A8283A", "#C8402E"] }],
  [/grapes|melons/, { shape: ROUND, cellM: 0.35, tints: ["#6E9A3C", "#6A2A4A", "#E8C26A"] }],
  [/tropical/, { shape: "apricot", cellM: 1.1, tints: ["#E8A030", "#8EAE3A", "#C85A2E"] }],
  [/tomatoes|peppers/, { shape: ROUND, cellM: 0.8, tints: ["#D04A2A", "#E8C840", "#5E8A3A"] }],
  [/onions|garlic/, { shape: "apricot", cellM: 0.8, tints: ["#C89A62", "#6E3A6A", "#F0E8D8"] }],
  [/potatoes|roots/, { shape: "walnut", cellM: 0.8, tints: ["#B88A52", "#8E4A3A", "#E0A060"] }],
  [/salad|herbs|greens|cooking-veg|spinach/, { shape: "chip", cellM: 0.9, tints: ["#4E7A2E", "#6E9A3C", "#3A6A2A"] }],
  [/mushrooms/, { shape: ROUND, cellM: 0.5, tints: ["#E6DCC8", "#B89A7A"] }],
  [/cut-/, { shape: "chip", cellM: 0.5, tints: ["#E8A030", "#C8402E", "#8EAE3A"] }],
  [/seafood|sushi/, { shape: "chip", cellM: 1.4, tints: ["#F08A6A", "#F4EEE6", "#E8C0A8"] }],
  [/beef|pork|lamb|halal|meat|bacon|sausage|hot-dogs/, { shape: "chip", cellM: 1.2, tints: ["#B8322E", "#C8504A", "#E8B0A0"] }],
  [/chicken|turkey|rotisserie/, { shape: "apricot", cellM: 1.4, tints: ["#E8B884", "#C88A4A"] }],
  [/cheese/, { shape: "chip", cellM: 1.1, tints: ["#F0C850", "#F4E6B0", "#E8A030"] }],
  [/salad-bar|saladbar|prepared-salads/, { shape: "chip", cellM: 0.6, tints: ["#4E7A2E", "#D04A2A", "#E8C840"] }],
  [/hot-bar|soups|pizza/, { shape: "granola", cellM: 0.6, tints: ["#C8904A", "#B8452E", "#E8C26A"] }],
  [/bouquets|plants/, { shape: ROUND, cellM: 0.9, tints: ["#D04A6A", "#E8C840", "#F4EEE6", "#B04AA0"] }],
];
export function looseOf(categoryId: string): Loose {
  for (const [re, l] of LOOSE) if (re.test(categoryId)) return l;
  return { shape: ROUND, cellM: 0.8, tints: ["#8EAE3A", "#C8402E"] };
}

// ---------------------------------------------------------------- the standard atlases

/** The categories atlas: one 128 px cell per category, 16 a row, in the store's category order. */
export const CAT_COLS = 16;
export const CAT_CELL = 128;
export const catAtlasSize = (n: number): [number, number] => [CAT_COLS * CAT_CELL, Math.ceil(n / CAT_COLS) * CAT_CELL];
/** atlas UV rectangle (u0, v0, du, dv), v up, of category `i` of `n` */
export function catCell(i: number, n: number): [number, number, number, number] {
  const [W, H] = catAtlasSize(n);
  const c = i % CAT_COLS;
  const r = Math.floor(i / CAT_COLS);
  return [(c * CAT_CELL) / W, 1 - ((r + 1) * CAT_CELL) / H, CAT_CELL / W, CAT_CELL / H];
}

/** A sign as a header board reads it: uppercase, "AISLE 4 · " on a numbered aisle, then the sign's first
 * parts, as many as fit a board. */
export function signLabel(aisle: string, group: string): string {
  const parts = group.split("·").map((p) => p.trim().toUpperCase());
  const num = /^A(\d+)$/i.exec(aisle);
  let out = num ? `AISLE ${num[1]} · ${parts[0]}` : parts[0];
  for (const p of parts.slice(1)) {
    if ((out + " · " + p).length > 30) break;
    out += " · " + p;
  }
  return out;
}
/** every (aisle, sign) pair in the order it first appears among the categories: the signs atlas's cells */
export const signKey = (c: { aisle: string; group: string }) => `${c.aisle}|${c.group}`;
export function signKeys(categories: { aisle: string; group: string }[]): string[] {
  return [...new Set(categories.map(signKey))];
}
/** The signs atlas, 1024 × 1280: two 512 × 64 boards a row. */
export const SIGNS_ATLAS: [number, number] = [1024, 1280];
export function signCell(i: number): [number, number, number, number] {
  const c = i % 2;
  const r = Math.floor(i / 2);
  const [W, H] = SIGNS_ATLAS;
  return [(c * 512) / W, 1 - ((r + 1) * 64) / H, 512 / W, 64 / H];
}

/**
 * The products of one category on a shelf: blocks of a few facings, each block another product of the house
 * range, told apart by a tint over the label and a slightly different pack size. Linear RGB multipliers.
 */
export const VARIANTS: { tint: [number, number, number]; size: [number, number] }[] = [
  { tint: [1, 1, 1], size: [1, 1] },
  { tint: [1, 0.78, 0.6], size: [0.9, 0.94] },
  { tint: [0.74, 0.9, 0.62], size: [1.08, 1.04] },
  { tint: [1, 0.9, 0.55], size: [0.96, 0.88] },
  { tint: [0.95, 0.66, 0.62], size: [1.12, 1.06] },
  { tint: [0.78, 0.74, 0.7], size: [0.86, 0.96] },
  { tint: [1, 0.84, 0.74], size: [1.02, 1.1] },
  { tint: [0.86, 0.8, 0.56], size: [0.94, 1] },
];
