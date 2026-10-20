// Grosher's Produce zone (x 12–48, y 2–14) as a recipe for the shelf kit: what every island and every bay of
// the wet wall holds, what every chalkboard says, the juice line. Pure data: the texture generator
// (scripts/gen-hero-textures.mjs) reads it in Node to draw the chalk, packs, mounds and foliage atlases, and
// the zone (zone.ts) assembles geometry from it. Every product is a fictional Grosher house line; no brands.
//
// Studied against design/refs/produce-stainless-skylight.png and cut-fruit-case.png (kept local, not in the
// repo): a stainless open multideck down one wall (slanted shelves, a bright lip light under each, a brushed
// canopy), warm wood plank floor, black steel stands of tilted crates heaped with fruit, a tall potted plant,
// the cut fruit in clear tubs stacked two high in tidy colourful rows. There was no juice reference: the juice
// follows the brief (clear glass bottles, white numbered labels).
//
// The wall keeps the store map's categories and bays (packages/stores/scripts/grosher-taxonomy.ts): greens and
// salad kits 1–6, herbs 7–11, mushrooms and sprouts 12–17, cut vegetables 18–22, cut fruit and juice 23–28.

// ---------------------------------------------------------------- produce: how each kind is modelled

/**
 * One kind of fruit or vegetable. `model` picks the instanced template: "round" is one low-poly sphere that
 * the vertex shader turns into an apple, a lemon, a pear, a pepper or a pumpkin (fruit.ts); "banana" a bunch;
 * "head" a leafy head; "bunch" stems with leaf cards tied with twine; "pack" something in a punnet or bag
 * (its look in the packs atlas). Sizes are metres: across (x), tall (y), deep (z). Colours are sRGB hex; each
 * instance picks one of `colors` and varies it.
 */
export interface Kind {
  model: "round" | "banana" | "head" | "bunch" | "pack";
  size: [number, number, number];
  colors: string[];
  /** a second colour washed over part of each one (an apple's red over its yellow), and how much (−: from below) */
  blush?: [string, number];
  /** the stem end: its colour and how much of the top it covers (a tomato's calyx, an onion's neck) */
  pole?: [string, number];
  /** the stem-end hollow (apples, tomatoes, pumpkins), 0–0.4 */
  dimple?: number;
  /** a pointed top (onions, garlic), or both ends when negative (lemons) */
  point?: number;
  /** lobes or ribs round the middle (peppers 4, pumpkins 10) and how deep */
  ribs?: [number, number];
  /** lumpiness (potatoes, ginger) */
  lump?: number;
  /** narrowing toward the top (pears, butternut, avocados, eggplant) */
  neck?: number;
  /** a curve along the length (mangoes, chilies, cucumbers) */
  bend?: number;
  /** surface roughness: 0.2 glossy (eggplant, peppers) … 0.9 matte (potatoes, onion skins) */
  rough: number;
  /** pitted or netted skin as a normal (citrus pores, cantaloupe net): amplitude and frequency */
  bumps?: [number, number];
  /** stripes round it (watermelon, zucchini): count and how dark */
  stripes?: [number, number];
  /** too small to model one by one at this budget (cherries, sprouts): the pile's texture alone */
  loose?: boolean;
  /** the far pile: a cell of the mounds atlas (MOUNDS) */
  mound: MoundId;
  /** a "bunch" or "head": the foliage atlas cell for its leaves */
  leaf?: FoliageId;
  /** a "pack": its contents cell in the packs atlas */
  pack?: PackId;
}

/** the mounds atlas (1024 × 512, 8 × 4 cells of 128 px): fruit piles drawn at real size, near-white, tinted */
export const MOUNDS = [
  { id: "round", cellM: 0.42, size: 0.078 },
  { id: "small", cellM: 0.16, size: 0.022 },
  { id: "long", cellM: 0.6, size: 0.18 },
  { id: "lumpy", cellM: 0.42, size: 0.075 },
  { id: "big", cellM: 1.1, size: 0.2 },
  { id: "leafy", cellM: 0.5, size: 0.1 },
  { id: "punnet", cellM: 0.5, size: 0.12 },
  { id: "thin", cellM: 0.36, size: 0.1 },
] as const;
export type MoundId = (typeof MOUNDS)[number]["id"];
export const MOUND_COLS = 8;
export const MOUND_ROWS = 4;
export const moundIndex = (id: MoundId) => MOUNDS.findIndex((m) => m.id === id);

/** the foliage atlas (1024 × 1024 RGBA, 4 × 4 cells of 256 px, alpha-tested) */
export const FOLIAGE = ["palm", "dracaena", "cilantro", "parsley", "basil", "mint", "dill", "kale", "chard", "onionTops", "carrotTops", "crown", "fern", "bloomRose", "bloomDaisy", "bloomTulip"] as const;
export type FoliageId = (typeof FOLIAGE)[number];
export const foliageRect = (id: FoliageId): [number, number, number, number] => {
  const i = FOLIAGE.indexOf(id);
  const c = i % 4;
  const r = Math.floor(i / 4);
  return [c / 4, 1 - (r + 1) / 4, (c + 1) / 4, 1 - r / 4];
};

/** the packs atlas (2048 × 1280, 8 × 5 cells of 256 px): what shows through a tub, punnet or bag, and rows of
 * the wall's stock seen from a distance (a far deck's front: bottles, lettuce, herbs) */
export const PACKS = [
  // cut fruit, as in the reference: chunks and slices stacked against the plastic
  "fruitMedley", "watermelonCubes", "pineappleChunks", "mangoChunks", "cantaloupeCubes", "honeydewCubes", "kiwiSlices", "grapesMix", "berryCups", "papayaCubes", "citrusSegments", "dragonfruit",
  // cut vegetables
  "stirFry", "veggieNoodles", "dicedOnion", "broccoliFlorets", "carrotSticks", "butternutCubes",
  // punnets
  "strawberries", "blueberries", "raspberries", "blackberries", "whiteMushrooms", "babyBella", "shiitake", "oyster", "sprouts", "microgreens",
  // greens in clamshells, salad kits in bags, grapes in bags
  "spinach", "springMix", "saladKit", "grapes",
  // a far deck's row
  "bottlesRow", "headsRow", "herbsRow",
  // the chilled shelf under the juice: energy balls and bites in tubs
  "bitesCocoa", "bitesCoconut", "bitesDate", "bitesMatcha",
] as const;
export type PackId = (typeof PACKS)[number];
export const PACK_COLS = 8;
export const PACK_ROWS = 5;
export const packRect = (id: PackId): [number, number, number, number] => {
  const i = PACKS.indexOf(id);
  const c = i % PACK_COLS;
  const r = Math.floor(i / PACK_COLS);
  return [c / PACK_COLS, 1 - (r + 1) / PACK_ROWS, (c + 1) / PACK_COLS, 1 - r / PACK_ROWS];
};

const K = (k: Kind) => k;
export const KINDS = {
  apple: K({ model: "round", size: [0.08, 0.072, 0.08], colors: ["#E8C25A", "#D8B048"], blush: ["#B8242A", 0.85], pole: ["#6A4A2A", 0.05], dimple: 0.2, rough: 0.32, mound: "round" }),
  gala: K({ model: "round", size: [0.072, 0.066, 0.072], colors: ["#E8B04A"], blush: ["#C8402E", 0.7], pole: ["#6A4A2A", 0.05], dimple: 0.2, rough: 0.3, mound: "round" }),
  granny: K({ model: "round", size: [0.078, 0.07, 0.078], colors: ["#8CC04A", "#9CC854"], pole: ["#6A5A2A", 0.04], dimple: 0.2, rough: 0.28, mound: "round" }),
  pinkLady: K({ model: "round", size: [0.072, 0.07, 0.072], colors: ["#D8C058"], blush: ["#E05A6A", 0.6], pole: ["#6A4A2A", 0.05], dimple: 0.18, rough: 0.3, mound: "round" }),
  pear: K({ model: "round", size: [0.07, 0.1, 0.07], colors: ["#C8C454", "#D4C860"], blush: ["#B88A3A", 0.25], pole: ["#5A4A2A", 0.05], neck: 0.42, point: 0.1, rough: 0.45, bumps: [0.1, 70], mound: "round" }),
  orange: K({ model: "round", size: [0.08, 0.076, 0.08], colors: ["#F0882A", "#EC7C1E"], pole: ["#7A8A3A", 0.04], dimple: 0.05, rough: 0.5, bumps: [0.35, 90], mound: "round" }),
  mandarin: K({ model: "round", size: [0.06, 0.048, 0.06], colors: ["#F07A20"], pole: ["#6A7A2A", 0.05], dimple: 0.08, rough: 0.5, bumps: [0.3, 110], mound: "round" }),
  lemon: K({ model: "round", size: [0.062, 0.08, 0.062], colors: ["#F2D23A", "#ECCB2E"], point: -0.22, rough: 0.48, bumps: [0.35, 100], mound: "round" }),
  lime: K({ model: "round", size: [0.052, 0.056, 0.052], colors: ["#6EA83A", "#7AB040"], point: -0.08, rough: 0.42, bumps: [0.3, 110], mound: "round" }),
  grapefruit: K({ model: "round", size: [0.11, 0.1, 0.11], colors: ["#F0C048"], blush: ["#E88A5A", 0.4], rough: 0.5, bumps: [0.3, 70], mound: "round" }),
  peach: K({ model: "round", size: [0.07, 0.068, 0.07], colors: ["#F0B050"], blush: ["#D8443A", 0.75], dimple: 0.12, rough: 0.8, mound: "round" }),
  plum: K({ model: "round", size: [0.055, 0.055, 0.052], colors: ["#5A1E3A", "#6A2440"], dimple: 0.1, rough: 0.55, mound: "round" }),
  nectarine: K({ model: "round", size: [0.066, 0.064, 0.066], colors: ["#E8A040"], blush: ["#C2283A", 0.8], dimple: 0.1, rough: 0.35, mound: "round" }),
  apricot: K({ model: "round", size: [0.05, 0.048, 0.048], colors: ["#F0A040"], blush: ["#E06A30", 0.4], dimple: 0.1, rough: 0.7, mound: "round" }),
  pomegranate: K({ model: "round", size: [0.09, 0.085, 0.09], colors: ["#A8282A"], blush: ["#D8804A", 0.3], point: 0.12, ribs: [6, 0.03], rough: 0.45, mound: "round" }),
  cherry: K({ model: "round", size: [0.024, 0.024, 0.024], colors: ["#6A0E1A"], rough: 0.25, loose: true, mound: "small" }),
  strawberries: K({ model: "pack", size: [0.16, 0.08, 0.11], colors: ["#FFFFFF"], rough: 0.2, pack: "strawberries", mound: "punnet" }),
  blueberries: K({ model: "pack", size: [0.12, 0.06, 0.09], colors: ["#FFFFFF"], rough: 0.2, pack: "blueberries", mound: "punnet" }),
  raspberries: K({ model: "pack", size: [0.12, 0.06, 0.09], colors: ["#FFFFFF"], rough: 0.2, pack: "raspberries", mound: "punnet" }),
  blackberries: K({ model: "pack", size: [0.12, 0.06, 0.09], colors: ["#FFFFFF"], rough: 0.2, pack: "blackberries", mound: "punnet" }),
  redGrapes: K({ model: "pack", size: [0.2, 0.09, 0.14], colors: ["#9A3A5A"], rough: 0.3, pack: "grapes", mound: "small" }),
  greenGrapes: K({ model: "pack", size: [0.2, 0.09, 0.14], colors: ["#B8D27A"], rough: 0.3, pack: "grapes", mound: "small" }),
  cantaloupe: K({ model: "round", size: [0.15, 0.14, 0.15], colors: ["#C8AA72", "#BEA06A"], pole: ["#8A7A4A", 0.04], rough: 0.85, bumps: [0.7, 45], ribs: [10, 0.012], mound: "big" }),
  honeydew: K({ model: "round", size: [0.16, 0.15, 0.16], colors: ["#DCE2A8", "#E0E4B0"], rough: 0.4, mound: "big" }),
  watermelon: K({ model: "round", size: [0.26, 0.24, 0.32], colors: ["#3E6A2A"], stripes: [14, 0.55], rough: 0.35, mound: "big" }),
  avocado: K({ model: "round", size: [0.068, 0.095, 0.064], colors: ["#2E3A1E", "#3A4A22", "#4A5A26"], neck: 0.35, rough: 0.75, bumps: [0.55, 60], mound: "round" }),
  mango: K({ model: "round", size: [0.085, 0.11, 0.07], colors: ["#E8C040", "#F0B030"], blush: ["#D85A2A", 0.45], bend: 0.2, point: 0.06, rough: 0.35, mound: "round" }),
  tommyMango: K({ model: "round", size: [0.095, 0.12, 0.08], colors: ["#7A9A3A", "#C8A040"], blush: ["#C2283A", 0.7], bend: 0.16, rough: 0.35, mound: "round" }),
  pineapple: K({ model: "round", size: [0.13, 0.22, 0.13], colors: ["#B8862E", "#A87A2A"], rough: 0.7, bumps: [0.8, 30], leaf: "crown", mound: "big" }),
  papaya: K({ model: "round", size: [0.1, 0.2, 0.1], colors: ["#E8A030", "#C8B03A"], blush: ["#6E9A3A", -0.5], neck: 0.25, rough: 0.35, mound: "long" }),
  banana: K({ model: "banana", size: [0.2, 0.06, 0.12], colors: ["#F0CE3A", "#E8C832"], rough: 0.5, mound: "long" }),
  greenBanana: K({ model: "banana", size: [0.2, 0.06, 0.12], colors: ["#B8C83A"], rough: 0.5, mound: "long" }),
  plantain: K({ model: "banana", size: [0.28, 0.07, 0.14], colors: ["#C8B030", "#3A3420"], rough: 0.55, mound: "long" }),
  kiwi: K({ model: "round", size: [0.05, 0.065, 0.05], colors: ["#8A6A3A", "#7E6034"], rough: 0.95, bumps: [0.3, 120], mound: "round" }),
  coconut: K({ model: "round", size: [0.12, 0.13, 0.12], colors: ["#6A4A2E", "#5A3E26"], point: 0.08, rough: 0.95, bumps: [0.8, 50], mound: "big" }),
  tomato: K({ model: "round", size: [0.07, 0.058, 0.07], colors: ["#D8341E", "#E03C22"], pole: ["#3A6A1E", 0.1], dimple: 0.14, ribs: [5, 0.02], rough: 0.25, mound: "round" }),
  roma: K({ model: "round", size: [0.05, 0.075, 0.05], colors: ["#D0301C"], pole: ["#3A6A1E", 0.08], point: -0.06, rough: 0.25, mound: "round" }),
  bellPepper: K({ model: "round", size: [0.085, 0.09, 0.085], colors: ["#D8261A", "#F2C21E", "#3E8A2A", "#EC7A1A"], pole: ["#3A5A1E", 0.06], dimple: 0.2, ribs: [4, 0.09], neck: -0.1, rough: 0.2, mound: "round" }),
  jalapeno: K({ model: "round", size: [0.03, 0.08, 0.03], colors: ["#2E6A22"], pole: ["#4A6A2A", 0.06], point: 0.2, bend: 0.15, rough: 0.2, loose: true, mound: "thin" }),
  chili: K({ model: "round", size: [0.014, 0.08, 0.014], colors: ["#3A8A26"], point: 0.25, bend: 0.3, rough: 0.25, loose: true, mound: "thin" }),
  cucumber: K({ model: "round", size: [0.05, 0.22, 0.05], colors: ["#2E5A22", "#34622A"], stripes: [10, 0.2], bend: 0.05, rough: 0.35, bumps: [0.3, 40], mound: "long" }),
  miniCucumber: K({ model: "round", size: [0.035, 0.14, 0.035], colors: ["#3A6A2A"], stripes: [10, 0.15], rough: 0.35, bumps: [0.3, 50], mound: "long" }),
  cabbage: K({ model: "head", size: [0.17, 0.15, 0.17], colors: ["#A8C878", "#9CC06C"], rough: 0.5, mound: "leafy" }),
  redCabbage: K({ model: "head", size: [0.15, 0.14, 0.15], colors: ["#6A2A5A", "#7A3266"], rough: 0.45, mound: "leafy" }),
  corn: K({ model: "round", size: [0.05, 0.22, 0.05], colors: ["#6E9A3A", "#7EA442"], point: -0.15, stripes: [12, 0.25], rough: 0.7, mound: "long" }),
  onion: K({ model: "round", size: [0.08, 0.072, 0.08], colors: ["#C88A3A", "#B87A30"], pole: ["#8A6A3A", 0.1], point: 0.32, rough: 0.6, stripes: [16, 0.12], mound: "round" }),
  redOnion: K({ model: "round", size: [0.075, 0.068, 0.075], colors: ["#7A2A4A", "#6A2240"], pole: ["#A8784A", 0.1], point: 0.3, rough: 0.5, stripes: [16, 0.15], mound: "round" }),
  whiteOnion: K({ model: "round", size: [0.075, 0.068, 0.075], colors: ["#E8E0C8"], pole: ["#B8A880", 0.1], point: 0.3, rough: 0.5, stripes: [16, 0.08], mound: "round" }),
  garlic: K({ model: "round", size: [0.05, 0.045, 0.05], colors: ["#ECE6D6", "#E4D8D0"], blush: ["#B88AA0", 0.25], point: 0.4, ribs: [8, 0.05], rough: 0.7, mound: "round" }),
  ginger: K({ model: "round", size: [0.12, 0.04, 0.06], colors: ["#C8A06A", "#BC9460"], lump: 0.32, rough: 0.85, mound: "lumpy" }),
  turmeric: K({ model: "round", size: [0.07, 0.02, 0.02], colors: ["#C8803A"], lump: 0.25, rough: 0.8, loose: true, mound: "lumpy" }),
  shallot: K({ model: "round", size: [0.035, 0.05, 0.035], colors: ["#A8603A"], blush: ["#8A4A5A", 0.4], point: 0.35, rough: 0.6, loose: true, mound: "small" }),
  sweetOnion: K({ model: "round", size: [0.09, 0.07, 0.09], colors: ["#D8AE6A"], pole: ["#A8884A", 0.08], point: 0.25, rough: 0.6, stripes: [16, 0.1], mound: "round" }),
  springOnion: K({ model: "bunch", size: [0.08, 0.34, 0.06], colors: ["#5A9A3A"], rough: 0.5, leaf: "onionTops", mound: "thin" }),
  pearlOnion: K({ model: "round", size: [0.025, 0.025, 0.025], colors: ["#ECE6D6"], rough: 0.6, loose: true, mound: "small" }),
  potato: K({ model: "round", size: [0.085, 0.06, 0.06], colors: ["#B8905A", "#A8824E"], lump: 0.12, rough: 0.92, bumps: [0.2, 40], mound: "lumpy" }),
  yukon: K({ model: "round", size: [0.07, 0.055, 0.058], colors: ["#D8B46A", "#CCA860"], lump: 0.1, rough: 0.85, mound: "lumpy" }),
  redPotato: K({ model: "round", size: [0.055, 0.048, 0.05], colors: ["#9A3A3A", "#8A3434"], lump: 0.08, rough: 0.8, mound: "lumpy" }),
  fingerling: K({ model: "round", size: [0.08, 0.025, 0.025], colors: ["#C8A06A"], lump: 0.12, bend: 0.2, rough: 0.85, loose: true, mound: "lumpy" }),
  sweetPotato: K({ model: "round", size: [0.16, 0.06, 0.06], colors: ["#A8502E", "#9A4A2A"], lump: 0.15, rough: 0.8, point: -0.3, mound: "lumpy" }),
  carrot: K({ model: "round", size: [0.032, 0.18, 0.032], colors: ["#E8742A", "#EC7E30"], pole: ["#5A8A32", 0.04], neck: -0.55, rough: 0.6, stripes: [14, 0.08], mound: "long" }),
  beet: K({ model: "round", size: [0.07, 0.065, 0.07], colors: ["#5A1A2A", "#6A1E30"], point: -0.25, rough: 0.6, mound: "round" }),
  parsnip: K({ model: "round", size: [0.05, 0.2, 0.05], colors: ["#E8DCB8"], neck: -0.5, point: -0.4, rough: 0.7, mound: "long" }),
  turnip: K({ model: "round", size: [0.07, 0.062, 0.07], colors: ["#ECE6E0"], blush: ["#8A3A7A", 0.6], point: -0.3, rough: 0.5, mound: "round" }),
  radish: K({ model: "round", size: [0.028, 0.028, 0.028], colors: ["#C82A3A"], point: -0.3, rough: 0.3, loose: true, mound: "small" }),
  butternut: K({ model: "round", size: [0.12, 0.27, 0.12], colors: ["#E2B070", "#D8A866"], pole: ["#6A5A3A", 0.04], neck: 0.62, point: 0.08, rough: 0.55, mound: "big" }),
  zucchini: K({ model: "round", size: [0.045, 0.2, 0.045], colors: ["#2E4A1E", "#3A5A22"], pole: ["#7A8A4A", 0.04], stripes: [12, -0.25], rough: 0.35, mound: "long" }),
  eggplant: K({ model: "round", size: [0.08, 0.17, 0.08], colors: ["#2A1630", "#3A1E40"], pole: ["#3A5A2A", 0.14], neck: 0.25, rough: 0.15, mound: "long" }),
  broccoli: K({ model: "round", size: [0.13, 0.12, 0.13], colors: ["#2E5A26", "#365E2A"], lump: 0.18, bumps: [0.9, 35], rough: 0.85, dimple: -0.1, mound: "leafy" }),
  cauliflower: K({ model: "round", size: [0.15, 0.12, 0.15], colors: ["#F0E8D2"], blush: ["#5A8A3A", -0.7], lump: 0.14, bumps: [0.8, 30], rough: 0.85, mound: "leafy" }),
  pumpkin: K({ model: "round", size: [0.26, 0.2, 0.26], colors: ["#E07A22", "#E8862A"], pole: ["#5A4A2A", 0.04], dimple: 0.3, ribs: [10, 0.08], rough: 0.55, mound: "big" }),
  acorn: K({ model: "round", size: [0.12, 0.13, 0.12], colors: ["#24361E", "#2A3E22"], blush: ["#E08A2A", 0.2], dimple: 0.2, point: 0.12, ribs: [9, 0.13], rough: 0.4, mound: "big" }),
  spaghetti: K({ model: "round", size: [0.13, 0.2, 0.13], colors: ["#ECD27A", "#E8CC70"], rough: 0.4, mound: "big" }),
  kabocha: K({ model: "round", size: [0.17, 0.12, 0.17], colors: ["#2E4224"], blush: ["#8A9A5A", 0.25], dimple: 0.25, ribs: [8, 0.04], rough: 0.6, bumps: [0.3, 40], mound: "big" }),
  delicata: K({ model: "round", size: [0.07, 0.18, 0.07], colors: ["#ECD68A"], stripes: [8, 0.5], ribs: [8, 0.04], rough: 0.4, mound: "long" }),
  brussels: K({ model: "round", size: [0.03, 0.03, 0.03], colors: ["#6A9A3A"], rough: 0.6, loose: true, mound: "small" }),
  greenBeans: K({ model: "round", size: [0.01, 0.12, 0.01], colors: ["#4A8A2E"], bend: 0.2, rough: 0.4, loose: true, mound: "thin" }),
  okra: K({ model: "round", size: [0.02, 0.09, 0.02], colors: ["#5A8A32"], point: 0.4, ribs: [5, 0.12], rough: 0.6, loose: true, mound: "thin" }),
  snapPeas: K({ model: "round", size: [0.015, 0.07, 0.01], colors: ["#7AB04A"], bend: 0.2, rough: 0.4, loose: true, mound: "thin" }),
  artichoke: K({ model: "round", size: [0.09, 0.1, 0.09], colors: ["#5A7A3A", "#56743A"], blush: ["#7A4A5A", 0.2], point: 0.16, ribs: [12, 0.1], rough: 0.6, bumps: [0.6, 25], mound: "round" }),
  // the wet wall
  romaine: K({ model: "head", size: [0.12, 0.3, 0.1], colors: ["#4E8A34", "#5A9A3A", "#3E7A2E"], rough: 0.5, mound: "leafy" }),
  greenLeaf: K({ model: "head", size: [0.2, 0.2, 0.2], colors: ["#6AA03E", "#78AC46", "#5E9438"], rough: 0.5, mound: "leafy" }),
  redLeaf: K({ model: "head", size: [0.2, 0.2, 0.2], colors: ["#7A9A3A"], blush: ["#7A2A3A", 0.7], rough: 0.5, mound: "leafy" }),
  kale: K({ model: "bunch", size: [0.18, 0.36, 0.1], colors: ["#2E4A2A", "#365430"], rough: 0.6, leaf: "kale", mound: "leafy" }),
  chard: K({ model: "bunch", size: [0.18, 0.38, 0.1], colors: ["#3A6A2A"], rough: 0.5, leaf: "chard", mound: "leafy" }),
  spinach: K({ model: "pack", size: [0.18, 0.08, 0.12], colors: ["#FFFFFF"], rough: 0.2, pack: "spinach", mound: "punnet" }),
  springMix: K({ model: "pack", size: [0.18, 0.08, 0.12], colors: ["#FFFFFF"], rough: 0.2, pack: "springMix", mound: "punnet" }),
  saladKit: K({ model: "pack", size: [0.17, 0.24, 0.05], colors: ["#FFFFFF"], rough: 0.4, pack: "saladKit", mound: "punnet" }),
  cilantro: K({ model: "bunch", size: [0.12, 0.3, 0.08], colors: ["#4A8A32"], rough: 0.5, leaf: "cilantro", mound: "leafy" }),
  parsley: K({ model: "bunch", size: [0.13, 0.3, 0.08], colors: ["#3E7A2A"], rough: 0.5, leaf: "parsley", mound: "leafy" }),
  basil: K({ model: "bunch", size: [0.13, 0.26, 0.09], colors: ["#3A7A2A"], rough: 0.4, leaf: "basil", mound: "leafy" }),
  mint: K({ model: "bunch", size: [0.12, 0.26, 0.08], colors: ["#4A8A3A"], rough: 0.5, leaf: "mint", mound: "leafy" }),
  dill: K({ model: "bunch", size: [0.12, 0.32, 0.08], colors: ["#5A8A3A"], rough: 0.5, leaf: "dill", mound: "leafy" }),
} satisfies Record<string, Kind>;
export type KindId = keyof typeof KINDS;

// ---------------------------------------------------------------- the islands

/** One variety on a display: two crates wide, both tiers, under its own chalkboard. */
export interface Variety {
  name: string;
  kind: KindId;
  /** the chalkboard's price line, as it reads */
  price: string;
}

/** An island face: five varieties side by side, west to east, two crates each on each tier. */
export interface Display {
  /** the overview fixture it stands on */
  island: number;
  side: "N" | "S";
  /** the Grosher category it is (the stop's target), or null for a face with no location of its own */
  category: string | null;
  varieties: [Variety, Variety, Variety, Variety, Variety];
}

const V = (name: string, kind: KindId, price: string): Variety => ({ name, kind, price });

export const DISPLAYS: Display[] = [
  { island: 1, side: "N", category: "apples-pears", varieties: [V("Honeycrisp Apples", "apple", "$2.99 / lb"), V("Gala Apples", "gala", "$1.79 / lb"), V("Granny Smith Apples", "granny", "$1.99 / lb"), V("Pink Lady Apples", "pinkLady", "$2.49 / lb"), V("Bartlett Pears", "pear", "$1.89 / lb")] },
  { island: 1, side: "S", category: "citrus", varieties: [V("Navel Oranges", "orange", "$1.49 / lb"), V("Mandarins", "mandarin", "$2.29 / lb"), V("Lemons", "lemon", "79¢ each"), V("Limes", "lime", "4 for $1"), V("Grapefruit", "grapefruit", "$1.29 each")] },
  { island: 2, side: "N", category: "berries", varieties: [V("Strawberries", "strawberries", "$3.99 / lb"), V("Blueberries", "blueberries", "$4.49 / pint"), V("Raspberries", "raspberries", "$3.99 each"), V("Blackberries", "blackberries", "$3.49 each"), V("Cherries", "cherry", "$5.99 / lb")] },
  { island: 2, side: "S", category: null, varieties: [V("Peaches", "peach", "$2.49 / lb"), V("Plums", "plum", "$2.29 / lb"), V("Nectarines", "nectarine", "$2.49 / lb"), V("Apricots", "apricot", "$3.49 / lb"), V("Pomegranates", "pomegranate", "$2.50 each")] },
  { island: 3, side: "N", category: "grapes-melons", varieties: [V("Red Grapes", "redGrapes", "$2.99 / lb"), V("Green Grapes", "greenGrapes", "$2.99 / lb"), V("Cantaloupe", "cantaloupe", "$3.49 each"), V("Honeydew", "honeydew", "$3.99 each"), V("Watermelon", "watermelon", "$6.99 each")] },
  { island: 3, side: "S", category: null, varieties: [V("Pie Pumpkins", "pumpkin", "$3.99 each"), V("Acorn Squash", "acorn", "$1.49 / lb"), V("Spaghetti Squash", "spaghetti", "$1.29 / lb"), V("Kabocha", "kabocha", "$1.79 / lb"), V("Delicata Squash", "delicata", "$1.99 / lb")] },
  { island: 4, side: "N", category: "tropical-fruit", varieties: [V("Hass Avocados", "avocado", "$1.50 each"), V("Ataulfo Mangoes", "mango", "$1.25 each"), V("Tommy Atkins Mangoes", "tommyMango", "$1.50 each"), V("Pineapples", "pineapple", "$3.99 each"), V("Papayas", "papaya", "$1.99 / lb")] },
  { island: 4, side: "S", category: "bananas", varieties: [V("Bananas", "banana", "59¢ / lb"), V("Green Bananas", "greenBanana", "59¢ / lb"), V("Plantains", "plantain", "79¢ / lb"), V("Kiwi", "kiwi", "3 for $1"), V("Coconuts", "coconut", "$2.49 each")] },
  { island: 5, side: "N", category: "tomatoes-peppers", varieties: [V("Vine Tomatoes", "tomato", "$2.99 / lb"), V("Bell Peppers", "bellPepper", "$1.29 each"), V("Cucumbers", "cucumber", "79¢ each"), V("Green Chilies", "chili", "$2.99 / lb"), V("Green Cabbage", "cabbage", "89¢ / lb")] },
  { island: 5, side: "S", category: null, varieties: [V("Roma Tomatoes", "roma", "$1.49 / lb"), V("Sweet Corn", "corn", "3 for $2"), V("Red Cabbage", "redCabbage", "$1.29 / lb"), V("Mini Cucumbers", "miniCucumber", "$3.49 / lb"), V("Jalapeños", "jalapeno", "$1.99 / lb")] },
  { island: 6, side: "N", category: "onions-garlic", varieties: [V("Yellow Onions", "onion", "99¢ / lb"), V("Red Onions", "redOnion", "$1.29 / lb"), V("White Onions", "whiteOnion", "$1.29 / lb"), V("Garlic", "garlic", "50¢ each"), V("Ginger", "ginger", "$3.99 / lb")] },
  { island: 6, side: "S", category: null, varieties: [V("Shallots", "shallot", "$3.99 / lb"), V("Sweet Onions", "sweetOnion", "$1.49 / lb"), V("Spring Onions", "springOnion", "99¢ bunch"), V("Fresh Turmeric", "turmeric", "$7.99 / lb"), V("Pearl Onions", "pearlOnion", "$2.99 each")] },
  { island: 7, side: "N", category: "potatoes-roots", varieties: [V("Russet Potatoes", "potato", "89¢ / lb"), V("Yukon Gold Potatoes", "yukon", "$1.29 / lb"), V("Sweet Potatoes", "sweetPotato", "$1.49 / lb"), V("Carrots", "carrot", "$1.99 bunch"), V("Beets", "beet", "$2.49 / lb")] },
  { island: 7, side: "S", category: null, varieties: [V("Red Potatoes", "redPotato", "$1.49 / lb"), V("Fingerling Potatoes", "fingerling", "$3.99 / lb"), V("Parsnips", "parsnip", "$2.49 / lb"), V("Turnips", "turnip", "$1.99 / lb"), V("Radishes", "radish", "$1.49 bunch")] },
  { island: 8, side: "N", category: "cooking-vegetables", varieties: [V("Butternut Squash", "butternut", "$1.49 / lb"), V("Zucchini", "zucchini", "$1.79 / lb"), V("Eggplant", "eggplant", "$1.99 each"), V("Broccoli", "broccoli", "$2.49 / lb"), V("Cauliflower", "cauliflower", "$3.49 each")] },
  { island: 8, side: "S", category: null, varieties: [V("Brussels Sprouts", "brussels", "$3.49 / lb"), V("Green Beans", "greenBeans", "$2.99 / lb"), V("Okra", "okra", "$3.99 / lb"), V("Snap Peas", "snapPeas", "$4.99 / lb"), V("Artichokes", "artichoke", "$2.49 each")] },
];

// ---------------------------------------------------------------- the wet wall

/** What a bay of the wet wall holds: its target's name, the kind on its decks, the chalkboard's price. */
export interface Bay {
  name: string;
  kind: KindId | "tub" | "bottle";
  /** a tub's contents (packs atlas), or a bottle's juice number (J01–J21) */
  pack?: PackId;
  juice?: number[];
  price: string;
}

export interface WallSection {
  category: string;
  header: string;
  bays: Bay[];
}

const B = (name: string, kind: Bay["kind"], price: string, more: Partial<Bay> = {}): Bay => ({ name, kind, price, ...more });

/** 28 bays of 1.25 m, west to east (left to right facing the wall) */
export const WALL: WallSection[] = [
  { category: "salad-greens", header: "GREENS & SALAD KITS", bays: [B("Romaine Hearts", "romaine", "$2.99 each"), B("Green Leaf Lettuce", "greenLeaf", "$1.99 each"), B("Red Leaf Lettuce", "redLeaf", "$1.99 each"), B("Lacinato Kale", "kale", "$2.49 bunch"), B("Baby Spinach & Spring Mix", "spinach", "$4.99 each"), B("Salad Kits", "saladKit", "$4.49 each")] },
  { category: "fresh-herbs", header: "FRESH HERBS", bays: [B("Cilantro", "cilantro", "99¢ bunch"), B("Flat-leaf Parsley", "parsley", "99¢ bunch"), B("Basil", "basil", "$2.49 bunch"), B("Mint", "mint", "$1.99 bunch"), B("Dill", "dill", "$1.99 bunch")] },
  { category: "mushrooms-sprouts", header: "MUSHROOMS & SPROUTS", bays: [B("White Mushrooms", "tub", "$2.99 each", { pack: "whiteMushrooms" }), B("Baby Bella Mushrooms", "tub", "$3.49 each", { pack: "babyBella" }), B("Shiitake Mushrooms", "tub", "$4.99 each", { pack: "shiitake" }), B("Oyster Mushrooms", "tub", "$5.49 each", { pack: "oyster" }), B("Bean Sprouts", "tub", "$1.99 each", { pack: "sprouts" }), B("Microgreens", "tub", "$3.99 each", { pack: "microgreens" })] },
  { category: "cut-vegetables", header: "CUT VEGETABLES", bays: [B("Stir-fry Mix", "tub", "$4.99 each", { pack: "stirFry" }), B("Veggie Noodles", "tub", "$4.49 each", { pack: "veggieNoodles" }), B("Diced Onions", "tub", "$2.99 each", { pack: "dicedOnion" }), B("Broccoli Florets", "tub", "$3.99 each", { pack: "broccoliFlorets" }), B("Carrot Sticks & Butternut Cubes", "tub", "$3.49 each", { pack: "carrotSticks" })] },
  {
    category: "cut-fruit-juice",
    header: "CUT FRUIT · GROSHER PRESS",
    bays: [
      B("Cut Fruit Medley", "tub", "$5.99 each", { pack: "fruitMedley" }),
      B("Watermelon & Melon Cubes", "tub", "$4.99 each", { pack: "watermelonCubes" }),
      B("Pineapple & Mango Chunks", "tub", "$5.49 each", { pack: "pineappleChunks" }),
      B("Grosher Press Cold-Pressed Juice J01–J07", "bottle", "$6.99 each", { juice: [1, 2, 3, 4, 5, 6, 7] }),
      B("Grosher Press Cold-Pressed Juice J08–J14", "bottle", "$6.99 each", { juice: [8, 9, 10, 11, 12, 13, 14] }),
      B("Grosher Press Cold-Pressed Juice J15–J21", "bottle", "$6.99 each", { juice: [15, 16, 17, 18, 19, 20, 21] }),
    ],
  },
];

/** the cut fruit's tubs, mixed as in the reference: each cut fruit bay shows these, in its own order */
export const CUT_FRUIT: PackId[] = ["fruitMedley", "watermelonCubes", "pineappleChunks", "mangoChunks", "cantaloupeCubes", "honeydewCubes", "kiwiSlices", "grapesMix", "berryCups", "papayaCubes", "citrusSegments", "dragonfruit"];

/** under the juice, on the chilled well: energy balls and bites in tubs, mixed along each bay */
export const BITES: PackId[] = ["bitesCocoa", "bitesCoconut", "bitesDate", "bitesMatcha"];

/** The Grosher Press line: 21 cold-pressed juices, each its colour and what the label's second line says. */
export const JUICES: { n: number; name: string; color: string }[] = [
  { n: 1, name: "Green", color: "#6E9A2E" },
  { n: 2, name: "Orange Carrot Ginger", color: "#E8802A" },
  { n: 3, name: "Beet Apple", color: "#8A1E3A" },
  { n: 4, name: "Lemon Cayenne", color: "#E8D86A" },
  { n: 5, name: "Watermelon Mint", color: "#E8505A" },
  { n: 6, name: "Pineapple Turmeric", color: "#ECB82A" },
  { n: 7, name: "Celery", color: "#A8C86A" },
  { n: 8, name: "Cucumber Kale", color: "#5A8A3A" },
  { n: 9, name: "Grapefruit", color: "#F0906A" },
  { n: 10, name: "Carrot", color: "#EC7A1E" },
  { n: 11, name: "Apple Ginger", color: "#D8B84A" },
  { n: 12, name: "Strawberry Basil", color: "#C8303A" },
  { n: 13, name: "Mango Lime", color: "#F0A830" },
  { n: 14, name: "Coconut Water", color: "#ECE6D6" },
  { n: 15, name: "Spinach Pear", color: "#7AA03A" },
  { n: 16, name: "Blood Orange", color: "#C83A2A" },
  { n: 17, name: "Pomegranate", color: "#7A1A2E" },
  { n: 18, name: "Golden Milk", color: "#E8B23A" },
  { n: 19, name: "Charcoal Lemonade", color: "#2A2A2A" },
  { n: 20, name: "Tomato Basil", color: "#B8301E" },
  { n: 21, name: "Tropical Greens", color: "#8AB040" },
];

// ---------------------------------------------------------------- the chalk atlas

/**
 * The chalk atlas, 2048 × 1280 (UASTC: lettering): chalkboard signs in 10 × 11 cells of 192 × 88 (top 968 px),
 * the juice labels in one row of 21 cells of 96 × 128 (y 976–1104), and black header boards with white
 * uppercase in two rows of six 340 × 64 (y 1112–1240): the wet wall's sections, Bulk's beyond, floral.
 */
export const CHALK_ATLAS: [number, number] = [2048, 1280];
export const SIGN = { w: 192, h: 88, cols: 10, rows: 11 };
export const JUICE_LABEL = { y: 976, w: 96, h: 128 };
export const HEADER = { y: 1112, w: 340, h: 64, cols: 6 };

export interface SignCell {
  name: string;
  price: string;
}
/** every chalkboard, in atlas order: the islands' varieties, then the wall's bays */
export function signCells(): SignCell[] {
  const out: SignCell[] = [...DISPLAYS.flatMap((d) => d.varieties.map((v) => ({ name: v.name, price: v.price }))), ...WALL.flatMap((s) => s.bays.map((b) => ({ name: b.name.replace(/ J\d\d–J\d\d$/, ""), price: b.price })))];
  if (out.length > SIGN.cols * SIGN.rows) throw new Error(`chalk atlas full: ${out.length} > ${SIGN.cols * SIGN.rows}`);
  return out;
}
const [CW, CH] = CHALK_ATLAS;
const rect = (x: number, y: number, w: number, h: number): [number, number, number, number] => [x / CW, 1 - (y + h) / CH, (x + w) / CW, 1 - y / CH];
export const signRect = (i: number) => rect((i % SIGN.cols) * SIGN.w, Math.floor(i / SIGN.cols) * SIGN.h, SIGN.w, SIGN.h);
export const juiceRect = (n: number) => rect((n - 1) * JUICE_LABEL.w, JUICE_LABEL.y, JUICE_LABEL.w, JUICE_LABEL.h);
/** the header boards: the wall's sections, then Bulk's five (seen beyond), then floral */
export const HEADERS = [...WALL.map((s) => s.header), "PULSES & DALS", "RICE & GRAINS", "FLOURS & ATTA", "NUTS & SEEDS", "DRIED FRUIT", "FLORAL"];
export const headerRect = (i: number) => rect((i % HEADER.cols) * HEADER.w + 4, HEADER.y + Math.floor(i / HEADER.cols) * HEADER.h + 3, HEADER.w - 8, HEADER.h - 6);
