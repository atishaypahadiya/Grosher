// The Bulk & pulses zone (Grosher x 50–68, y 2–8) as a recipe for the shelf kit: what stands where, what
// is in every bin, what every label says. Pure data: the texture generator (scripts/gen-hero-textures.mjs)
// reads it in Node to draw the label and header atlases, and the zone (zone.ts) assembles geometry from it.
// Every product is a fictional Grosher house-brand item; no real brands.

/** A grain or powder as it looks in a bin, a sack or a jar: a shape cell of the grains atlas and a tint. */
export interface Grain {
  id: string;
  shape: GrainShape;
  /** multiplied over the shape cell's near-white albedo */
  tint: string;
}

/** The grains atlas: one 256 px cell per shape, near-white albedo with shading, plus a normal map. */
export const GRAIN_SHAPES = ["round", "roundBig", "split", "kidney", "long", "short", "tiny", "flake", "powder", "granular", "oval", "crescent", "blob", "drop", "bean", "cluster"] as const;
export type GrainShape = (typeof GRAIN_SHAPES)[number];

export const GRAINS: Record<string, Grain> = {
  moong: { id: "moong", shape: "round", tint: "#7FA046" },
  moongDal: { id: "moongDal", shape: "split", tint: "#E9C85A" },
  masoor: { id: "masoor", shape: "split", tint: "#E0763A" },
  chanaDal: { id: "chanaDal", shape: "split", tint: "#E3B23C" },
  toor: { id: "toor", shape: "split", tint: "#D9A23A" },
  rajma: { id: "rajma", shape: "kidney", tint: "#8E2A24" },
  urad: { id: "urad", shape: "round", tint: "#2E2A28" },
  kabuli: { id: "kabuli", shape: "roundBig", tint: "#D8B98A" },
  kalaChana: { id: "kalaChana", shape: "roundBig", tint: "#6B4A2E" },
  basmati: { id: "basmati", shape: "long", tint: "#F3EEE2" },
  sona: { id: "sona", shape: "short", tint: "#F1EBDD" },
  brownRice: { id: "brownRice", shape: "long", tint: "#B48A5A" },
  redRice: { id: "redRice", shape: "short", tint: "#9A4A3A" },
  quinoa: { id: "quinoa", shape: "tiny", tint: "#E6D6B4" },
  poha: { id: "poha", shape: "flake", tint: "#EFE6D2" },
  millet: { id: "millet", shape: "tiny", tint: "#D9B45A" },
  barley: { id: "barley", shape: "short", tint: "#CDB283" },
  oats: { id: "oats", shape: "flake", tint: "#E2CFA6" },
  atta: { id: "atta", shape: "powder", tint: "#D9C29A" },
  besan: { id: "besan", shape: "powder", tint: "#E8C760" },
  riceFlour: { id: "riceFlour", shape: "powder", tint: "#F4F1EA" },
  ragi: { id: "ragi", shape: "powder", tint: "#8C5E48" },
  maida: { id: "maida", shape: "powder", tint: "#F6F4EE" },
  sooji: { id: "sooji", shape: "granular", tint: "#EBCB7E" },
  jowar: { id: "jowar", shape: "powder", tint: "#E6DCC4" },
  almondFlour: { id: "almondFlour", shape: "powder", tint: "#E3CBA7" },
  cornFlour: { id: "cornFlour", shape: "granular", tint: "#F0C850" },
  almond: { id: "almond", shape: "oval", tint: "#A86A3E" },
  cashew: { id: "cashew", shape: "crescent", tint: "#EAD7B0" },
  walnut: { id: "walnut", shape: "blob", tint: "#B88B5A" },
  pistachio: { id: "pistachio", shape: "oval", tint: "#B9B07A" },
  peanut: { id: "peanut", shape: "oval", tint: "#C99A62" },
  pumpkin: { id: "pumpkin", shape: "oval", tint: "#5E7A3E" },
  sunflower: { id: "sunflower", shape: "tiny", tint: "#8A8478" },
  chia: { id: "chia", shape: "tiny", tint: "#5A5752" },
  flax: { id: "flax", shape: "tiny", tint: "#7A4E2E" },
  raisin: { id: "raisin", shape: "blob", tint: "#4A2A26" },
  goldenRaisin: { id: "goldenRaisin", shape: "blob", tint: "#C08A3A" },
  date: { id: "date", shape: "oval", tint: "#5A3020" },
  apricot: { id: "apricot", shape: "blob", tint: "#E08A3A" },
  fig: { id: "fig", shape: "blob", tint: "#7A5A42" },
  cranberry: { id: "cranberry", shape: "blob", tint: "#A8283A" },
  prune: { id: "prune", shape: "blob", tint: "#3A2430" },
  mango: { id: "mango", shape: "flake", tint: "#F0A830" },
  coconut: { id: "coconut", shape: "flake", tint: "#F4EEE0" },
  granola: { id: "granola", shape: "cluster", tint: "#FFFFFF" },
  trailMix: { id: "trailMix", shape: "cluster", tint: "#E8DCCB" },
  muesli: { id: "muesli", shape: "flake", tint: "#D8BE92" },
  chocChips: { id: "chocChips", shape: "drop", tint: "#4A2C20" },
  coffee: { id: "coffee", shape: "bean", tint: "#4A3024" },
  bananaChips: { id: "bananaChips", shape: "flake", tint: "#F0D28A" },
  roastedChana: { id: "roastedChana", shape: "roundBig", tint: "#C8904A" },
  makhana: { id: "makhana", shape: "roundBig", tint: "#F4EEE2" },
  wheat: { id: "wheat", shape: "long", tint: "#D8B46A" },
};

/** A packaged product template of the shelf kit. */
export type ProductKind = "pouch" | "kraft" | "jar" | "tin";

export interface BinItem {
  /** shown on the bin's tag and the products' labels */
  name: string;
  grain: keyof typeof GRAINS;
}

export interface Section {
  /** the Grosher category this section is (one location each, see packages/stores/scripts/grosher-taxonomy.ts) */
  category: string;
  /** the header board, uppercase as it reads */
  header: string;
  /** the label band colour of its house-brand packs */
  band: string;
  /** nine gravity bins, three per bay, west to east; their items are also the packaged products below */
  bins: BinItem[];
}

/** The wall shelving, west to east: five sections of three 1.2 m bays (x 50–68). */
export const SECTIONS: Section[] = [
  {
    category: "bulk-pulses",
    header: "PULSES & DALS",
    band: "#C8862E",
    bins: [
      { name: "Toor Dal", grain: "toor" },
      { name: "Moong Dal", grain: "moongDal" },
      { name: "Whole Moong", grain: "moong" },
      { name: "Masoor Dal", grain: "masoor" },
      { name: "Chana Dal", grain: "chanaDal" },
      { name: "Rajma", grain: "rajma" },
      { name: "Urad Dal", grain: "urad" },
      { name: "Kabuli Chana", grain: "kabuli" },
      { name: "Kala Chana", grain: "kalaChana" },
    ],
  },
  {
    category: "bulk-rice-grains",
    header: "RICE & GRAINS",
    band: "#7E8E4A",
    bins: [
      { name: "Basmati Rice", grain: "basmati" },
      { name: "Sona Masoori", grain: "sona" },
      { name: "Brown Rice", grain: "brownRice" },
      { name: "Red Rice", grain: "redRice" },
      { name: "Quinoa", grain: "quinoa" },
      { name: "Poha", grain: "poha" },
      { name: "Bajra Millet", grain: "millet" },
      { name: "Pearl Barley", grain: "barley" },
      { name: "Rolled Oats", grain: "oats" },
    ],
  },
  {
    category: "bulk-flours",
    header: "FLOURS & ATTA",
    band: "#B5623E",
    bins: [
      { name: "Whole Wheat Atta", grain: "atta" },
      { name: "Besan", grain: "besan" },
      { name: "Rice Flour", grain: "riceFlour" },
      { name: "Ragi Flour", grain: "ragi" },
      { name: "Maida", grain: "maida" },
      { name: "Sooji", grain: "sooji" },
      { name: "Jowar Flour", grain: "jowar" },
      { name: "Almond Flour", grain: "almondFlour" },
      { name: "Makki Atta", grain: "cornFlour" },
    ],
  },
  {
    category: "bulk-nuts-seeds",
    header: "NUTS & SEEDS",
    band: "#8A5A3A",
    bins: [
      { name: "Almonds", grain: "almond" },
      { name: "Cashews", grain: "cashew" },
      { name: "Walnuts", grain: "walnut" },
      { name: "Pistachios", grain: "pistachio" },
      { name: "Peanuts", grain: "peanut" },
      { name: "Pumpkin Seeds", grain: "pumpkin" },
      { name: "Sunflower Seeds", grain: "sunflower" },
      { name: "Chia Seeds", grain: "chia" },
      { name: "Flax Seeds", grain: "flax" },
    ],
  },
  {
    category: "bulk-dried-fruit",
    header: "DRIED FRUIT",
    band: "#8E3A4A",
    bins: [
      { name: "Raisins", grain: "raisin" },
      { name: "Golden Raisins", grain: "goldenRaisin" },
      { name: "Medjool Dates", grain: "date" },
      { name: "Apricots", grain: "apricot" },
      { name: "Figs", grain: "fig" },
      { name: "Cranberries", grain: "cranberry" },
      { name: "Prunes", grain: "prune" },
      { name: "Mango Slices", grain: "mango" },
      { name: "Coconut Chips", grain: "coconut" },
    ],
  },
];

/** The island's scoop bins (the "bulk-snacks" category), west to east, on its north face. */
export const SCOOP_BINS: BinItem[] = [
  { name: "House Granola", grain: "granola" },
  { name: "Trail Mix", grain: "trailMix" },
  { name: "Muesli", grain: "muesli" },
  { name: "Chocolate Chips", grain: "chocChips" },
  { name: "Coffee Beans", grain: "coffee" },
  { name: "Banana Chips", grain: "bananaChips" },
  { name: "Roasted Chana", grain: "roastedChana" },
  { name: "Makhana", grain: "makhana" },
  { name: "Yogurt Raisins", grain: "coconut" },
  { name: "Masala Peanuts", grain: "peanut" },
];
export const SCOOP_CATEGORY = "bulk-snacks";
export const SCOOP_HEADER = "SCOOP BINS";

/** The centerpiece's open sacks, and what each holds. */
export const SACKS: BinItem[] = [
  { name: "Toor Dal", grain: "toor" },
  { name: "Masoor Dal", grain: "masoor" },
  { name: "Rajma", grain: "rajma" },
  { name: "Whole Moong", grain: "moong" },
];

export const HEADERS = [...SECTIONS.map((s) => s.header), SCOOP_HEADER];

export const WEIGHTS: Record<ProductKind, string[]> = {
  pouch: ["500 g", "1 kg"],
  kraft: ["2 kg", "5 kg"],
  jar: ["250 g", "400 g"],
  tin: ["500 g", "750 g"],
};

/** One cell of the labels atlas: a product label (pouch, kraft bag, jar or tin) or a bin's tag. */
export interface LabelCell {
  kind: ProductKind | "tag";
  name: string;
  band: string;
  weight: string;
}

/**
 * The labels atlas, 1024 × 1024: 48 product labels (8 × 6 cells of 128 × 128: per section a pouch, a kraft bag,
 * a jar and a tin label for some of its items) and 64 bin tags (8 × 8 cells of 128 × 32, the bottom 256 px).
 */
export const LABEL_COLS = 8;
export const LABEL_ROWS = 6;
export const TAG_COLS = 8;
export const TAG_ROWS = 8;
export const TAG_H = 32;

export function labelCells(): { labels: LabelCell[]; tags: LabelCell[] } {
  const labels: LabelCell[] = [];
  SECTIONS.forEach((s, si) => {
    // nine labels a section (45), the rest for the scoop-bin snacks: every kind in turn
    s.bins.forEach((b, i) => labels.push({ kind: (["pouch", "kraft", "jar", "tin"] as const)[(i + si) % 4], name: b.name, band: s.band, weight: "" }));
  });
  for (const b of SCOOP_BINS.slice(0, LABEL_COLS * LABEL_ROWS - labels.length)) labels.push({ kind: "pouch", name: b.name, band: "#5E6A3A", weight: "" });
  for (const l of labels) {
    const w = WEIGHTS[l.kind as ProductKind];
    l.weight = w[(l.name.length + l.band.length) % w.length];
  }
  const tags: LabelCell[] = [...SECTIONS.flatMap((s) => s.bins.map((b) => ({ kind: "tag" as const, name: b.name, band: s.band, weight: "" }))), ...SCOOP_BINS.map((b) => ({ kind: "tag" as const, name: b.name, band: "#5E6A3A", weight: "" }))];
  return { labels, tags };
}

/** atlas UV rectangle [u0, v0, u1, v1] (v up, three's convention) of product label `i` or bin tag `i` */
export function labelRect(i: number): [number, number, number, number] {
  const c = i % LABEL_COLS;
  const r = Math.floor(i / LABEL_COLS);
  const u0 = c / LABEL_COLS;
  const v1 = 1 - r * (128 / 1024);
  return [u0, v1 - 128 / 1024, u0 + 1 / LABEL_COLS, v1];
}
export function tagRect(i: number): [number, number, number, number] {
  const c = i % TAG_COLS;
  const r = Math.floor(i / TAG_COLS);
  const top = 768 + r * TAG_H; // px from the top
  return [c / TAG_COLS, 1 - (top + TAG_H) / 1024, (c + 1) / TAG_COLS, 1 - top / 1024];
}

/** The header atlas, 1024 × 512: one 1024 × 80 board per header, top to bottom. */
export const HEADER_ROW_PX = 80;
export function headerRect(i: number): [number, number, number, number] {
  const top = i * HEADER_ROW_PX + 4;
  return [0, 1 - (top + HEADER_ROW_PX - 8) / 512, 1, 1 - top / 512];
}
