// The Bulk & pulses zone (Grosher x 50–68, y 2–8) as a recipe for the shelf kit: what stands where, what
// is in every bin, what every label says. Pure data: the texture generator (scripts/gen-hero-textures.mjs)
// reads it in Node to draw the grain, label and header atlases, and the zone (zone.ts) assembles geometry
// from it. Every product is a fictional Grosher house-brand item; no real brands.
//
// Studied against design/refs/pulses-store.png (kept local, not in the repo): five tiers of pine on black
// square steel, woven sacks and kraft bags low, pouches and cartons in the middle, jars, ghee tins and oil
// bottles higher up, orange clay pots stacked on top; in the middle of the floor open jute sacks with rolled
// rims, a grey stone chakki in a round wooden tray on four posts, a big dark clay pot of dried wheat.

// ---------------------------------------------------------------- grains, at their real size

/**
 * A grain shape: one 256 px cell of the grains atlas (8 × 4 cells, 2048 × 1024), drawn at its real size: the
 * cell covers `cellM` metres of a pile, so `size` (mm, length × width) comes out right at arm's length.
 * Near-white albedo; a bin, sack or jar tints it. `solid` is the low-poly grain the target bin shows in 3D.
 */
export interface GrainShape {
  id: string;
  cellM: number;
  size: [number, number];
  draw: "lens" | "oval" | "split" | "kidney" | "chickpea" | "long" | "flake" | "powder" | "granular" | "teardrop" | "crescent" | "wrinkled" | "drop" | "bean" | "cluster" | "puff";
  /** extra look: a seed coat edge on split dal, a beak on chickpeas, gloss */
  gloss?: number;
  solid?: "lens" | "oval" | "kidney" | "long" | "round";
}

export const GRAIN_SHAPES: GrainShape[] = [
  { id: "masoor", cellM: 0.06, size: [4.2, 4.2], draw: "lens", solid: "lens" },
  { id: "moongWhole", cellM: 0.06, size: [4.4, 3.3], draw: "oval", gloss: 0.6, solid: "oval" },
  { id: "splitSmall", cellM: 0.06, size: [4.8, 4.2], draw: "split", solid: "lens" },
  { id: "chanaDal", cellM: 0.09, size: [7.5, 6], draw: "split", solid: "lens" },
  { id: "rajma", cellM: 0.14, size: [15, 8], draw: "kidney", gloss: 0.7, solid: "kidney" },
  { id: "chickpea", cellM: 0.12, size: [9, 8.5], draw: "chickpea", solid: "round" },
  { id: "kalaChana", cellM: 0.1, size: [7, 6.5], draw: "chickpea", solid: "round" },
  { id: "basmati", cellM: 0.06, size: [8.5, 1.8], draw: "long", solid: "long" },
  { id: "shortGrain", cellM: 0.06, size: [5.5, 2.8], draw: "long", solid: "long" },
  { id: "quinoa", cellM: 0.04, size: [2.1, 2.1], draw: "lens", solid: "lens" },
  { id: "millet", cellM: 0.035, size: [1.9, 1.8], draw: "oval", gloss: 0.3, solid: "round" },
  { id: "poha", cellM: 0.08, size: [7, 5], draw: "flake" },
  { id: "oats", cellM: 0.08, size: [8, 6], draw: "flake" },
  { id: "barley", cellM: 0.07, size: [6, 3.6], draw: "bean", solid: "oval" },
  { id: "powder", cellM: 0.12, size: [0.2, 0.2], draw: "powder" },
  { id: "granular", cellM: 0.05, size: [0.7, 0.6], draw: "granular" },
  { id: "almond", cellM: 0.22, size: [22, 13], draw: "teardrop", solid: "oval" },
  { id: "cashew", cellM: 0.22, size: [25, 13], draw: "crescent", solid: "kidney" },
  { id: "walnut", cellM: 0.24, size: [26, 21], draw: "wrinkled", solid: "round" },
  { id: "pistachio", cellM: 0.18, size: [18, 11], draw: "oval", gloss: 0.2, solid: "oval" },
  { id: "peanut", cellM: 0.12, size: [12, 8], draw: "oval", gloss: 0.3, solid: "oval" },
  { id: "pumpkinSeed", cellM: 0.14, size: [16, 9], draw: "teardrop", solid: "oval" },
  { id: "seed", cellM: 0.05, size: [4, 2.4], draw: "teardrop", gloss: 0.5, solid: "oval" },
  { id: "raisin", cellM: 0.1, size: [9, 6.5], draw: "wrinkled", gloss: 0.4, solid: "oval" },
  { id: "date", cellM: 0.3, size: [36, 18], draw: "wrinkled", gloss: 0.6, solid: "long" },
  { id: "apricot", cellM: 0.28, size: [30, 27], draw: "wrinkled", gloss: 0.3, solid: "round" },
  { id: "chip", cellM: 0.3, size: [32, 14], draw: "flake" },
  { id: "granola", cellM: 0.2, size: [16, 12], draw: "cluster" },
  { id: "trailMix", cellM: 0.2, size: [14, 10], draw: "cluster" },
  { id: "chocDrop", cellM: 0.1, size: [9, 9], draw: "drop", gloss: 0.5, solid: "round" },
  { id: "coffee", cellM: 0.12, size: [11, 8], draw: "bean", gloss: 0.4, solid: "oval" },
  { id: "makhana", cellM: 0.2, size: [18, 17], draw: "puff", solid: "round" },
];
export type GrainShapeId = (typeof GRAIN_SHAPES)[number]["id"];
export const GRAIN_COLS = 8;
export const GRAIN_ROWS = 4;
export const shapeIndex = (id: string) => GRAIN_SHAPES.findIndex((s) => s.id === id);

/** A grain or powder as it looks in a bin, a sack or a jar: a shape and its colour. */
export interface Grain {
  id: string;
  shape: string;
  tint: string;
}

export const GRAINS: Record<string, Grain> = {
  moong: { id: "moong", shape: "moongWhole", tint: "#6E9A3C" },
  moongDal: { id: "moongDal", shape: "splitSmall", tint: "#EBCB5C" },
  masoor: { id: "masoor", shape: "masoor", tint: "#E8763A" },
  chanaDal: { id: "chanaDal", shape: "chanaDal", tint: "#E6B640" },
  toor: { id: "toor", shape: "splitSmall", tint: "#DDA43A" },
  rajma: { id: "rajma", shape: "rajma", tint: "#86241F" },
  urad: { id: "urad", shape: "moongWhole", tint: "#2C2826" },
  kabuli: { id: "kabuli", shape: "chickpea", tint: "#DDBF8E" },
  kalaChana: { id: "kalaChana", shape: "kalaChana", tint: "#6A4A2E" },
  basmati: { id: "basmati", shape: "basmati", tint: "#F4F0E6" },
  sona: { id: "sona", shape: "shortGrain", tint: "#F2EDE0" },
  brownRice: { id: "brownRice", shape: "basmati", tint: "#B88E5E" },
  redRice: { id: "redRice", shape: "shortGrain", tint: "#9C4C3C" },
  quinoa: { id: "quinoa", shape: "quinoa", tint: "#E8D8B6" },
  poha: { id: "poha", shape: "poha", tint: "#F0E8D4" },
  millet: { id: "millet", shape: "millet", tint: "#D9B45C" },
  barley: { id: "barley", shape: "barley", tint: "#D2B888" },
  oats: { id: "oats", shape: "oats", tint: "#E4D2A8" },
  atta: { id: "atta", shape: "powder", tint: "#D9C39C" },
  besan: { id: "besan", shape: "powder", tint: "#E9C962" },
  riceFlour: { id: "riceFlour", shape: "powder", tint: "#F5F2EB" },
  ragi: { id: "ragi", shape: "powder", tint: "#8E604A" },
  maida: { id: "maida", shape: "powder", tint: "#F7F5EF" },
  sooji: { id: "sooji", shape: "granular", tint: "#ECCC80" },
  jowar: { id: "jowar", shape: "powder", tint: "#E7DDC6" },
  almondFlour: { id: "almondFlour", shape: "powder", tint: "#E4CCA8" },
  cornFlour: { id: "cornFlour", shape: "granular", tint: "#F0C852" },
  almond: { id: "almond", shape: "almond", tint: "#A86A3E" },
  cashew: { id: "cashew", shape: "cashew", tint: "#ECDAB4" },
  walnut: { id: "walnut", shape: "walnut", tint: "#B88B5A" },
  pistachio: { id: "pistachio", shape: "pistachio", tint: "#C9BA86" },
  peanut: { id: "peanut", shape: "peanut", tint: "#C99A62" },
  pumpkin: { id: "pumpkin", shape: "pumpkinSeed", tint: "#5E7A3E" },
  sunflower: { id: "sunflower", shape: "seed", tint: "#8A8478" },
  chia: { id: "chia", shape: "millet", tint: "#5A5752" },
  flax: { id: "flax", shape: "seed", tint: "#7A4E2E" },
  raisin: { id: "raisin", shape: "raisin", tint: "#4A2A26" },
  goldenRaisin: { id: "goldenRaisin", shape: "raisin", tint: "#C08A3A" },
  date: { id: "date", shape: "date", tint: "#5A3020" },
  apricot: { id: "apricot", shape: "apricot", tint: "#E08A3A" },
  fig: { id: "fig", shape: "apricot", tint: "#7A5A42" },
  cranberry: { id: "cranberry", shape: "raisin", tint: "#A8283A" },
  prune: { id: "prune", shape: "apricot", tint: "#3A2430" },
  mango: { id: "mango", shape: "chip", tint: "#F0A830" },
  coconut: { id: "coconut", shape: "chip", tint: "#F4EEE0" },
  granola: { id: "granola", shape: "granola", tint: "#FFFFFF" },
  trailMix: { id: "trailMix", shape: "trailMix", tint: "#FFFFFF" },
  muesli: { id: "muesli", shape: "oats", tint: "#D8BE92" },
  chocChips: { id: "chocChips", shape: "chocDrop", tint: "#4A2C20" },
  coffee: { id: "coffee", shape: "coffee", tint: "#4A3024" },
  bananaChips: { id: "bananaChips", shape: "chip", tint: "#F0D28A" },
  roastedChana: { id: "roastedChana", shape: "kalaChana", tint: "#C8904A" },
  makhana: { id: "makhana", shape: "makhana", tint: "#F4EEE2" },
  yogurtRaisin: { id: "yogurtRaisin", shape: "chocDrop", tint: "#F6F2EA" },
  wheat: { id: "wheat", shape: "basmati", tint: "#D8B46A" },
  turmeric: { id: "turmeric", shape: "powder", tint: "#E8A21C" },
  chili: { id: "chili", shape: "powder", tint: "#B8321E" },
  coriander: { id: "coriander", shape: "granular", tint: "#9A8A52" },
  cumin: { id: "cumin", shape: "seed", tint: "#8A6A44" },
  mustard: { id: "mustard", shape: "millet", tint: "#3A2622" },
  hing: { id: "hing", shape: "powder", tint: "#E8DDBE" },
  ghee: { id: "ghee", shape: "powder", tint: "#F2D27A" },
  oilGold: { id: "oilGold", shape: "powder", tint: "#D9A82E" },
  oilAmber: { id: "oilAmber", shape: "powder", tint: "#B8741E" },
  oilPale: { id: "oilPale", shape: "powder", tint: "#EBD9A0" },
};

// ---------------------------------------------------------------- the wall: sections, bins, stock

export interface BinItem {
  /** shown on the bin's tag and the products' labels */
  name: string;
  grain: keyof typeof GRAINS;
}

/** The kit's packaged products (src/hero/kit/products.ts). Sizes in metres: width × height × depth. */
export type ProductKind = "pouchS" | "pouchM" | "pouchL" | "kraft" | "sack1" | "sack5" | "sack10" | "carton" | "jar" | "spiceJar" | "gheeTin" | "oilBottle" | "tin";

/** How each kind's label is drawn (its aspect comes from the pack's front, src/hero/kit/products.ts). */
export const LABEL_STYLE: Record<ProductKind, "pouch" | "kraft" | "sack" | "carton" | "jar" | "spice" | "ghee" | "oil" | "tin"> = {
  pouchS: "pouch",
  pouchM: "pouch",
  pouchL: "pouch",
  kraft: "kraft",
  sack1: "sack",
  sack5: "sack",
  sack10: "sack",
  carton: "carton",
  jar: "jar",
  spiceJar: "spice",
  gheeTin: "ghee",
  oilBottle: "oil",
  tin: "tin",
};

export const WEIGHTS: Record<ProductKind, string> = {
  pouchS: "250 g",
  pouchM: "500 g",
  pouchL: "1 kg",
  kraft: "1 kg",
  sack1: "1 KG",
  sack5: "5 KG",
  sack10: "10 KG",
  carton: "500 g",
  jar: "400 g",
  spiceJar: "100 g",
  gheeTin: "1 L",
  oilBottle: "500 ml",
  tin: "500 g",
};

/** A product on a tier: its kind and what it holds (name for the label, grain for what shows through). */
export interface Stock {
  kind: ProductKind;
  name: string;
  grain: keyof typeof GRAINS;
}

/** What a section stocks on each tier (bottom up; tier 3 is the gravity bins, tier 4 the top). */
export interface Section {
  /** the Grosher category this section is (one location each, see packages/stores/scripts/grosher-taxonomy.ts) */
  category: string;
  /** the header board, uppercase as it reads */
  header: string;
  /** the label band colour of its house-brand packs */
  band: string;
  /** nine gravity bins, three per bay, west to east */
  bins: BinItem[];
  /** tier 0 (floor), 1 and 2: rows of packs, front row first; the layout varies size, spacing and order */
  tiers: [Stock[], Stock[], Stock[]];
  /** tier 4, on top: clay pots stacked, and a few packs */
  top: Stock[];
}

const s = (kind: ProductKind, name: string, grain: keyof typeof GRAINS): Stock => ({ kind, name, grain });

const PULSES: BinItem[] = [
  { name: "Toor Dal", grain: "toor" },
  { name: "Moong Dal", grain: "moongDal" },
  { name: "Whole Moong", grain: "moong" },
  { name: "Masoor Dal", grain: "masoor" },
  { name: "Chana Dal", grain: "chanaDal" },
  { name: "Rajma", grain: "rajma" },
  { name: "Urad Dal", grain: "urad" },
  { name: "Kabuli Chana", grain: "kabuli" },
  { name: "Kala Chana", grain: "kalaChana" },
];
const RICE: BinItem[] = [
  { name: "Basmati Rice", grain: "basmati" },
  { name: "Sona Masoori", grain: "sona" },
  { name: "Brown Rice", grain: "brownRice" },
  { name: "Red Rice", grain: "redRice" },
  { name: "Quinoa", grain: "quinoa" },
  { name: "Poha", grain: "poha" },
  { name: "Bajra Millet", grain: "millet" },
  { name: "Pearl Barley", grain: "barley" },
  { name: "Rolled Oats", grain: "oats" },
];
const FLOURS: BinItem[] = [
  { name: "Whole Wheat Atta", grain: "atta" },
  { name: "Besan", grain: "besan" },
  { name: "Rice Flour", grain: "riceFlour" },
  { name: "Ragi Flour", grain: "ragi" },
  { name: "Maida", grain: "maida" },
  { name: "Sooji", grain: "sooji" },
  { name: "Jowar Flour", grain: "jowar" },
  { name: "Almond Flour", grain: "almondFlour" },
  { name: "Makki Atta", grain: "cornFlour" },
];
const NUTS: BinItem[] = [
  { name: "Almonds", grain: "almond" },
  { name: "Cashews", grain: "cashew" },
  { name: "Walnuts", grain: "walnut" },
  { name: "Pistachios", grain: "pistachio" },
  { name: "Peanuts", grain: "peanut" },
  { name: "Pumpkin Seeds", grain: "pumpkin" },
  { name: "Sunflower Seeds", grain: "sunflower" },
  { name: "Chia Seeds", grain: "chia" },
  { name: "Flax Seeds", grain: "flax" },
];
const FRUIT: BinItem[] = [
  { name: "Raisins", grain: "raisin" },
  { name: "Golden Raisins", grain: "goldenRaisin" },
  { name: "Medjool Dates", grain: "date" },
  { name: "Apricots", grain: "apricot" },
  { name: "Figs", grain: "fig" },
  { name: "Cranberries", grain: "cranberry" },
  { name: "Prunes", grain: "prune" },
  { name: "Mango Slices", grain: "mango" },
  { name: "Coconut Chips", grain: "coconut" },
];
const as = (kind: ProductKind, items: BinItem[]) => items.map((b) => s(kind, b.name, b.grain));

/** The wall shelving, west to east: five sections of three 1.2 m bays (x 50–68). */
export const SECTIONS: Section[] = [
  {
    category: "bulk-pulses",
    header: "PULSES & DALS",
    band: "#C8862E",
    bins: PULSES,
    tiers: [
      [...as("sack10", PULSES.slice(0, 5)), ...as("sack5", PULSES.slice(3, 9))],
      [...as("kraft", PULSES), ...as("sack1", PULSES.slice(0, 4))],
      [
        ...as("pouchM", PULSES),
        s("spiceJar", "Haldi", "turmeric"),
        s("spiceJar", "Lal Mirch", "chili"),
        s("spiceJar", "Dhania", "coriander"),
        s("spiceJar", "Jeera", "cumin"),
        s("spiceJar", "Rai", "mustard"),
        s("spiceJar", "Hing", "hing"),
      ],
    ],
    top: [s("tin", "Sambar Masala", "chili"), s("tin", "Dal Tadka Mix", "turmeric")],
  },
  {
    category: "bulk-rice-grains",
    header: "RICE & GRAINS",
    band: "#7E8E4A",
    bins: RICE,
    tiers: [
      [s("sack10", "Basmati Rice", "basmati"), s("sack10", "Sona Masoori", "sona"), s("sack10", "Brown Rice", "brownRice"), s("sack5", "Red Rice", "redRice"), s("sack5", "Basmati Rice", "basmati")],
      [...as("kraft", RICE.slice(4)), s("sack1", "Basmati Rice", "basmati"), s("sack1", "Sona Masoori", "sona"), s("sack1", "Red Rice", "redRice")],
      [s("carton", "Rolled Oats", "oats"), s("carton", "Quinoa", "quinoa"), s("carton", "Poha", "poha"), ...as("pouchL", RICE.slice(0, 4)), s("pouchS", "Bajra Millet", "millet")],
    ],
    top: [s("tin", "Pearl Barley", "barley")],
  },
  {
    category: "bulk-flours",
    header: "FLOURS & ATTA",
    band: "#B5623E",
    bins: FLOURS,
    tiers: [
      [s("sack10", "Whole Wheat Atta", "atta"), s("sack10", "Makki Atta", "cornFlour"), s("sack5", "Whole Wheat Atta", "atta"), s("sack5", "Besan", "besan"), s("sack10", "Jowar Flour", "jowar")],
      [...as("kraft", FLOURS.slice(1)), s("sack1", "Whole Wheat Atta", "atta")],
      [s("gheeTin", "Desi Ghee", "ghee"), s("gheeTin", "Cow Ghee", "ghee"), s("gheeTin", "A2 Ghee", "ghee"), s("carton", "Sooji", "sooji"), s("carton", "Besan", "besan"), s("pouchM", "Almond Flour", "almondFlour"), s("pouchM", "Rice Flour", "riceFlour")],
    ],
    top: [s("tin", "Ragi Malt", "ragi")],
  },
  {
    category: "bulk-nuts-seeds",
    header: "NUTS & SEEDS",
    band: "#8A5A3A",
    bins: NUTS,
    tiers: [
      [s("sack5", "Peanuts", "peanut"), s("sack10", "Peanuts", "peanut"), s("tin", "Almonds", "almond"), s("tin", "Cashews", "cashew"), s("sack5", "Sunflower Seeds", "sunflower")],
      [...as("jar", NUTS.slice(0, 5)), ...as("pouchM", NUTS.slice(5))],
      [
        s("oilBottle", "Groundnut Oil", "oilGold"),
        s("oilBottle", "Sesame Oil", "oilAmber"),
        s("oilBottle", "Mustard Oil", "oilGold"),
        s("oilBottle", "Coconut Oil", "oilPale"),
        s("oilBottle", "Almond Oil", "oilPale"),
        ...as("pouchS", NUTS.slice(5, 9)),
      ],
    ],
    top: [s("tin", "Mixed Nuts", "almond")],
  },
  {
    category: "bulk-dried-fruit",
    header: "DRIED FRUIT",
    band: "#8E3A4A",
    bins: FRUIT,
    tiers: [
      [s("tin", "Medjool Dates", "date"), s("kraft", "Medjool Dates", "date"), s("kraft", "Raisins", "raisin"), s("tin", "Figs", "fig"), s("sack5", "Raisins", "raisin")],
      [...as("jar", [FRUIT[0], FRUIT[3], FRUIT[4], FRUIT[6]]), ...as("pouchL", [FRUIT[1], FRUIT[2], FRUIT[5]])],
      [...as("pouchM", [FRUIT[5], FRUIT[7], FRUIT[8], FRUIT[1]]), s("carton", "Medjool Dates", "date"), s("jar", "Golden Raisins", "goldenRaisin")],
    ],
    top: [s("tin", "Dry Fruit Mix", "raisin")],
  },
];

/** The island's scoop bins (the "bulk-snacks" category), west to east. */
export const SCOOP_BINS: BinItem[] = [
  { name: "House Granola", grain: "granola" },
  { name: "Trail Mix", grain: "trailMix" },
  { name: "Muesli", grain: "muesli" },
  { name: "Chocolate Chips", grain: "chocChips" },
  { name: "Coffee Beans", grain: "coffee" },
  { name: "Banana Chips", grain: "bananaChips" },
  { name: "Roasted Chana", grain: "roastedChana" },
  { name: "Makhana", grain: "makhana" },
  { name: "Yogurt Raisins", grain: "yogurtRaisin" },
  { name: "Masala Peanuts", grain: "peanut" },
];
export const SCOOP_CATEGORY = "bulk-snacks";
export const SCOOP_HEADER = "SCOOP BINS";

/** The centerpiece's open jute sacks, and what each holds (the reference's white, green, yellow and orange). */
export const SACKS: BinItem[] = [
  { name: "Sona Masoori", grain: "sona" },
  { name: "Whole Moong", grain: "moong" },
  { name: "Toor Dal", grain: "toor" },
  { name: "Masoor Dal", grain: "masoor" },
];
/** stencils on the centerpiece sacks: fictional lots and origins, the way a mill stamps a sack */
export const SACK_STENCILS = [
  ["GROSHER", "LOT NO: 0418-02", "PACKED BY"],
  ["PRODUCE OF INDIA", "LOT NO: 1107-11", "NET WT 25 KG"],
  ["GROSHER · INDORE (M.P.)", "LOT NO: 0926-04", "GRADE A"],
  ["NAGPUR (M.H.)", "LOT NO: 0312-07", "NET WT 30 KG"],
];

export const HEADERS = [...SECTIONS.map((s) => s.header), SCOOP_HEADER];

// ---------------------------------------------------------------- the labels atlas

/** One cell of the labels atlas: a product label, or a bin's tag. */
export interface LabelCell {
  kind: ProductKind | "tag";
  name: string;
  band: string;
  weight: string;
  /** the colour of what is inside (a pouch's window, a sack's illustration) */
  tint: string;
}

/**
 * The labels atlas, 2048 × 1280: product labels in 16 × 9 cells of 128 × 128 (the top 1152 px) and bin tags in
 * 16 × 4 cells of 128 × 32 (the bottom 128 px). A label's front is drawn at its pack's aspect, squeezed into
 * the cell, so it reads true once wrapped onto the pack.
 */
export const LABEL_ATLAS: [number, number] = [2048, 1280];
export const LABEL_COLS = 16;
export const LABEL_ROWS = 9;
export const TAG_COLS = 16;
export const TAG_ROWS = 4;
export const TAG_H = 32;

const key = (k: ProductKind, name: string) => `${k}:${name}`;

export function labelCells(): { labels: LabelCell[]; tags: LabelCell[]; index: Map<string, number> } {
  const labels: LabelCell[] = [];
  const index = new Map<string, number>();
  const push = (k: ProductKind, name: string, band: string, grain: keyof typeof GRAINS) => {
    if (index.has(key(k, name))) return;
    index.set(key(k, name), labels.length);
    labels.push({ kind: k, name, band, weight: WEIGHTS[k], tint: GRAINS[grain].tint });
  };
  for (const sec of SECTIONS) for (const row of [...sec.tiers, sec.top]) for (const st of row) push(st.kind, st.name, sec.band, st.grain);
  for (const b of SCOOP_BINS) push("pouchM", b.name, "#5E6A3A", b.grain);
  if (labels.length > LABEL_COLS * LABEL_ROWS) throw new Error(`labels atlas full: ${labels.length} > ${LABEL_COLS * LABEL_ROWS}`);
  const tag = (b: BinItem, band: string): LabelCell => ({ kind: "tag", name: b.name, band, weight: "", tint: GRAINS[b.grain].tint });
  const tags: LabelCell[] = [...SECTIONS.flatMap((sec) => sec.bins.map((b) => tag(b, sec.band))), ...SCOOP_BINS.map((b) => tag(b, "#5E6A3A"))];
  return { labels, tags, index };
}
export const labelKey = key;

/** atlas UV rectangle [u0, v0, u1, v1] (v up, three's convention) of product label `i` */
export function labelRect(i: number): [number, number, number, number] {
  const [W, H] = LABEL_ATLAS;
  const c = i % LABEL_COLS;
  const r = Math.floor(i / LABEL_COLS);
  const u0 = (c * 128) / W;
  const v1 = 1 - (r * 128) / H;
  return [u0, v1 - 128 / H, u0 + 128 / W, v1];
}
export function tagRect(i: number): [number, number, number, number] {
  const [W, H] = LABEL_ATLAS;
  const c = i % TAG_COLS;
  const r = Math.floor(i / TAG_COLS);
  const top = LABEL_ROWS * 128 + r * TAG_H;
  return [(c * 128) / W, 1 - (top + TAG_H) / H, ((c + 1) * 128) / W, 1 - top / H];
}

/** The header atlas, 1024 × 512: one 1024 × 80 board per header, top to bottom. */
export const HEADER_ROW_PX = 80;
export function headerRect(i: number): [number, number, number, number] {
  const top = i * HEADER_ROW_PX + 4;
  return [0, 1 - (top + HEADER_ROW_PX - 8) / 512, 1, 1 - top / 512];
}

// ---------------------------------------------------------------- the cutouts atlas

/**
 * The cutouts atlas, 1024 × 512, RGBA (alpha-tested): the sack stencils (4 cells of 256 × 128, top-left), the
 * frayed jute fringe (a 1024 × 64 strip), and wheat ears (8 cells of 128 × 192, bottom).
 */
export const CUTOUT_ATLAS: [number, number] = [1024, 512];
export const stencilRect = (i: number): [number, number, number, number] => [(i * 256) / 1024, 1 - 128 / 512, ((i + 1) * 256) / 1024, 1];
export const fringeRect: [number, number, number, number] = [0, 1 - 192 / 512, 1, 1 - 128 / 512];
export const earRect = (i: number): [number, number, number, number] => [(i * 128) / 1024, 0, ((i + 1) * 128) / 1024, 192 / 512];
