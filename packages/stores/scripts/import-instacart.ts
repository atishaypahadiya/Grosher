// Imports the Instacart 2017 product list (data/instacart/products.csv,
// not committed; see the README there for source and terms) into a catalog
// for the demo Supercenter: demo/catalog.instacart.json. No model anywhere.
//
//   npm run import:instacart -w @grosher/stores
//
// Each product becomes an item whose canonical name is the product name
// cleaned of pack sizes, counts and marketing words ("Organic", "Family
// Size" become aliases, never lost) and of a leading brand where one is
// detectable (the full name stays an alias). Its shelf comes from the
// hand-written data/instacart/aisle-map.json: Instacart aisle → one or
// more of our categories, the product landing in the one whose labels its
// words match (else the first); products in Instacart's "other" / "missing"
// aisles fall back to their department's default; a product with neither is
// dropped and counted. Near-identical names merge on the resolver's own key.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalize, singularize, type Category, type ItemTag, type Stop } from "@grosher/core";

const here = import.meta.dirname;
const dataDir = join(here, "..", "data", "instacart");
const demo = join(here, "..", "demo");

interface AisleMap {
  aisles: Record<string, string[]>;
  departments: Record<string, { department: string | null; default: string | null }>;
}

// ---------------------------------------------------------------- csv

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

const table = (file: string) => {
  const [head, ...rows] = parseCsv(readFileSync(join(dataDir, file), "utf8"));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
};

// ---------------------------------------------------------------- name cleaning

const UNIT = "(?:fl\\.? ?oz|oz|ounces?|lbs?|pounds?|g|grams?|kg|mg|ml|l|liters?|litres?|gal|gallons?|quarts?|qt|pints?|pt|ct|count|pk|packs?|pcs?|pieces?|ea|each|bags?|cans?|bottles?|rolls?|sheets?|loads?|tablets?|capsules?|softgels?|caplets?|gummies|servings?|inch|in|ply|sq ft|square feet|k|x)";
const SIZE_PATTERNS: RegExp[] = [
  new RegExp(`\\(?\\b\\d+(?:[.,/]\\d+)?\\s?${UNIT}\\b\\.?\\)?`, "gi"), // 12 oz, 6-pack handled below, 2 ct, 1.5 L
  /\b\d+\s?-\s?(?:pack|pk|ct|count|piece|pc)\b/gi, // 6-pack, 12-ct
  /\bpack of \d+\b/gi,
  /\b\d+\s?(?:x|×)\s?\d+(?:[.,]\d+)?\s?\w*\b/gi, // 6 x 12 oz
  /\(\s*\)/g,
  /\b(?:size|sz)\s?\d+\b/gi, // diapers "Size 4" is a real distinction, kept as an alias by the caller
];

/** marketing words: removed from the canonical name, kept as an alias with them */
const MARKETING = ["organic", "all natural", "natural", "family size", "party size", "value pack", "value size", "premium", "original", "classic", "homestyle", "select", "signature", "gourmet", "artisan", "deluxe", "ultra", "jumbo", "giant", "bonus", "resealable", "single serve", "variety pack", "assorted", "limited edition", "new", "improved", "extra strength", "maximum strength"];
const MARKETING_RE = new RegExp(`\\b(?:${MARKETING.map((w) => w.replace(/ /g, "\\s+")).join("|")})\\b`, "gi");

/** brands worth stripping from the front of a name; a possessive first word ("Annie's") counts too */
const BRANDS = [
  "Kraft", "Heinz", "Kellogg's", "Nabisco", "Oreo", "Cheerios", "Lay's", "Lays", "Doritos", "Tide", "Dawn", "Bounty", "Charmin", "Pampers", "Huggies", "Gerber", "Similac", "Enfamil", "Purina", "Pedigree", "Friskies",
  "Chobani", "Yoplait", "Dannon", "Oikos", "Fage", "Tropicana", "Minute Maid", "Coca-Cola", "Coca Cola", "Coke", "Pepsi", "Sprite", "Gatorade", "Red Bull", "Monster", "Starbucks", "Folgers", "Lipton", "Nescafe", "Quaker", "Kashi",
  "Nature Valley", "Clif", "Kind", "Barilla", "Prego", "Ragu", "Campbell's", "Progresso", "Hormel", "Oscar Mayer", "Tyson", "Perdue", "Ben & Jerry's", "Häagen-Dazs", "Haagen-Dazs", "Breyers", "Blue Bell", "Ore-Ida", "Eggo", "Hot Pockets",
  "DiGiorno", "Tostitos", "Pringles", "Cheetos", "Fritos", "Ritz", "Triscuit", "Wheat Thins", "Goldfish", "Pepperidge Farm", "Nutella", "Jif", "Skippy", "Smucker's", "Hellmann's", "French's", "Tabasco", "McCormick", "Morton",
  "Clorox", "Lysol", "Windex", "Febreze", "Glad", "Ziploc", "Hefty", "Reynolds", "Colgate", "Crest", "Listerine", "Dove", "Old Spice", "Secret", "Degree", "Gillette", "Tylenol", "Advil", "Aleve", "Zyrtec", "Claritin", "Tums",
  "Pepto-Bismol", "NyQuil", "Vaseline", "Cetaphil", "Neutrogena", "Pantene", "Head & Shoulders", "Kirkland Signature", "Kirkland", "Great Value", "365 Everyday Value", "365", "Simply", "Horizon", "Organic Valley", "Silk", "Almond Breeze",
  "Oatly", "Lactaid", "Land O Lakes", "Land O'Lakes", "Philadelphia", "Sargento", "Velveeta", "Tillamook", "Daisy", "Breakstone's", "Amy's", "Annie's", "Annie's Homegrown", "Newman's Own", "Trader Joe's", "Nestle", "Nestlé", "Hershey's",
  "Mars", "Snickers", "M&M's", "Reese's", "Kit Kat", "Twix", "Skittles", "Starburst", "Haribo", "Wrigley's", "Trident", "Orbit", "Extra", "Altoids", "Tic Tac", "Bigelow", "Twinings", "Celestial Seasonings", "Yogi", "Tazo", "Peet's",
  "Dunkin'", "Dunkin", "Maxwell House", "Green Mountain", "Keurig", "Swiss Miss", "Ovaltine", "Nesquik", "Planters", "Blue Diamond", "Wonderful", "Sun-Maid", "Ocean Spray", "Welch's", "Mott's", "Dole", "Del Monte", "Green Giant", "Birds Eye",
  "Stouffer's", "Lean Cuisine", "Healthy Choice", "Marie Callender's", "Totino's", "Red Baron", "Tombstone", "Jimmy Dean", "Hillshire Farm", "Johnsonville", "Ball Park", "Nathan's", "Boar's Head", "Applegate", "Sabra", "Tostitos",
  "Hidden Valley", "Wish-Bone", "Ken's", "Kikkoman", "Lee Kum Kee", "Huy Fong", "Goya", "Old El Paso", "Ortega", "Mission", "Guerrero", "La Banderita", "Dave's Killer Bread", "Nature's Own", "Wonder", "Sara Lee", "Thomas'", "Arnold",
  "King Arthur", "Pillsbury", "Betty Crocker", "Duncan Hines", "Jell-O", "Cool Whip", "Reddi-wip", "Country Crock", "I Can't Believe It's Not Butter!", "Smart Balance", "Earth Balance", "Challenge", "Kerrygold", "Cabot", "Boursin",
  "Bounce", "Downy", "Gain", "Persil", "Arm & Hammer", "OxiClean", "Shout", "Cascade", "Finish", "Palmolive", "Mr. Clean", "Pine-Sol", "Fabuloso", "Scrubbing Bubbles", "Swiffer", "Scotch-Brite", "Brawny", "Scott", "Cottonelle", "Kleenex", "Puffs",
  "Angel Soft", "Quilted Northern", "Seventh Generation", "Method", "Mrs. Meyer's", "Burt's Bees", "Aveeno", "Olay", "Nivea", "Eucerin", "CeraVe", "Garnier", "L'Oreal", "L'Oréal", "Tresemme", "TRESemmé", "Suave", "Herbal Essences", "Axe", "Schick",
  "Always", "Tampax", "Kotex", "Playtex", "Depend", "Poise", "Band-Aid", "Neosporin", "Benadryl", "Mucinex", "DayQuil", "Robitussin", "Halls", "Ricola", "Emergen-C", "Airborne", "Centrum", "Nature Made", "Nature's Bounty", "One A Day", "Flintstones",
  "Pedialyte", "Ensure", "Boost", "Premier Protein", "Muscle Milk", "Orgain", "Vega", "Bob's Red Mill", "Arrowhead Mills", "Rice-A-Roni", "Near East", "Uncle Ben's", "Zatarain's", "Knorr", "Lipton", "Maggi", "Swanson", "College Inn", "Pacific",
  "Imagine", "Bush's", "Hunt's", "Muir Glen", "Rao's", "Classico", "Bertolli", "Newman's", "Ronzoni", "De Cecco", "Mueller's", "Kraft Macaroni & Cheese", "Velveeta", "Hamburger Helper", "Stove Top", "Idahoan", "Betty Crocker", "Jiffy",
  "Pop-Tarts", "Pop Tarts", "Toaster Strudel", "Eggo", "Aunt Jemima", "Krusteaz", "Bisquick", "Mrs. Butterworth's", "Log Cabin", "Hungry Jack", "Honey Bunches of Oats", "Frosted Flakes", "Froot Loops", "Lucky Charms", "Cinnamon Toast Crunch",
  "Special K", "Raisin Bran", "Chex", "Life", "Kix", "Trix", "Cap'n Crunch", "Honey Nut Cheerios", "Post", "General Mills",
];
const brandRe = new RegExp(`^(?:${[...BRANDS].sort((a, b) => b.length - a.length).map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b[\\s:,-]*`, "i");
const possessiveRe = /^([A-Z][\w&'.-]*'s(?:\s+[A-Z][\w&'.-]*){0,1})\s+/;

const tidy = (s: string) =>
  s
    .replace(/\s*[-–—]\s*$/, "")
    .replace(/^\s*[-–—,:]\s*/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.)])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();

export interface Cleaned {
  name: string;
  aliases: string[];
  brand?: string;
}

/** the canonical name and the aliases that record what was stripped */
export function cleanName(raw: string): Cleaned {
  const original = tidy(raw);
  const aliases = new Set<string>();
  let s = original;
  // sizes and counts
  for (const re of SIZE_PATTERNS) s = s.replace(re, " ");
  s = tidy(s);
  // brand at the front
  let brand: string | undefined;
  const bm = s.match(brandRe);
  if (bm && tidy(s.slice(bm[0].length)).split(" ").length >= 1 && tidy(s.slice(bm[0].length)).length >= 3) {
    brand = tidy(bm[0]);
    s = tidy(s.slice(bm[0].length));
  } else {
    const pm = s.match(possessiveRe);
    if (pm && tidy(s.slice(pm[0].length)).length >= 3) {
      brand = tidy(pm[1]);
      s = tidy(s.slice(pm[0].length));
    }
  }
  if (brand) aliases.add(tidy(s ? `${brand} ${s}` : brand));
  // marketing words
  const withMarketing = s;
  s = tidy(s.replace(MARKETING_RE, " "));
  if (s && s !== withMarketing) aliases.add(withMarketing);
  if (!s) s = withMarketing || original;
  if (original !== s) aliases.add(original);
  aliases.delete(s);
  return { name: s, aliases: [...aliases], brand };
}

// ---------------------------------------------------------------- mapping

const key = (s: string) => singularize(normalize(s));
const tokens = (s: string) => key(s).split(" ").filter((t) => t && t !== "and" && t !== "the" && t !== "with");

function pickCategory(name: string, aliases: string[], candidates: Category[]): Category {
  if (candidates.length === 1) return candidates[0];
  const words = new Set([...tokens(name), ...aliases.flatMap(tokens)]);
  let best = candidates[0];
  let bestScore = 0;
  for (const c of candidates) {
    const labels = [c.name, c.id.replace(/-/g, " "), ...(c.aliases ?? [])];
    let score = 0;
    for (const l of labels) {
      const lt = tokens(l);
      const hit = lt.filter((t) => words.has(t)).length;
      if (hit) score = Math.max(score, hit / lt.length + hit * 0.01);
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------- run

if (import.meta.main ?? process.argv[1]?.endsWith("import-instacart.ts")) {
  const categories = JSON.parse(readFileSync(join(demo, "categories.json"), "utf8")) as Category[];
  const catById = new Map(categories.map((c) => [c.id, c]));
  const map = JSON.parse(readFileSync(join(dataDir, "aisle-map.json"), "utf8")) as AisleMap;
  const aisles = new Map(table("aisles.csv").map((r) => [r.aisle_id, r.aisle]));
  const departments = new Map(table("departments.csv").map((r) => [r.department_id, r.department]));
  const products = table("products.csv");

  // the map must cover every aisle and department, and name only real categories
  const missingAisles = [...aisles.values()].filter((a) => !map.aisles[a]);
  const missingDepts = [...departments.values()].filter((d) => !map.departments[d]);
  if (missingAisles.length || missingDepts.length) throw new Error(`aisle-map.json is missing aisles ${JSON.stringify(missingAisles)} / departments ${JSON.stringify(missingDepts)}`);
  for (const [a, ids] of Object.entries(map.aisles)) for (const id of ids) if (id !== "@department" && !catById.has(id)) throw new Error(`aisle "${a}" maps to unknown category ${id}`);
  for (const [d, m] of Object.entries(map.departments)) if (m.default && !catById.has(m.default)) throw new Error(`department "${d}" defaults to unknown category ${m.default}`);

  const items: (Stop & { origin: "instacart"; category: string })[] = [];
  const byKey = new Map<string, Stop & { origin: "instacart"; category: string }>();
  let dropped = 0;
  let merged = 0;
  let branded = 0;
  const perAisle = new Map<string, number>();
  for (const p of products) {
    const aisle = aisles.get(p.aisle_id) ?? "missing";
    const dept = departments.get(p.department_id) ?? "missing";
    let targets = map.aisles[aisle] ?? ["@department"];
    if (targets[0] === "@department") {
      const d = map.departments[dept]?.default;
      if (!d) {
        dropped++;
        continue;
      }
      targets = [d];
    }
    const cleaned = cleanName(p.product_name);
    if (!cleaned.name) {
      dropped++;
      continue;
    }
    if (cleaned.brand) branded++;
    const cat = pickCategory(cleaned.name, cleaned.aliases, targets.map((t) => catById.get(t)!));
    const k = key(cleaned.name);
    const existing = byKey.get(k);
    if (existing) {
      merged++;
      existing.aliases = [...new Set([...(existing.aliases ?? []), ...cleaned.aliases])].slice(0, 8);
      if (!existing.locationIds.includes(cat.locationId) && existing.locationIds.length < 2) existing.locationIds.push(cat.locationId);
      continue;
    }
    const id = `ic-${k.replace(/\s+/g, "-").replace(/[^\p{L}\p{N}-]/gu, "")}`.slice(0, 64);
    const tags = cat.tags?.length ? ([...cat.tags] as ItemTag[]) : undefined;
    const item: Stop & { origin: "instacart"; category: string } = { id, name: cleaned.name.charAt(0).toUpperCase() + cleaned.name.slice(1), locationIds: [cat.locationId], origin: "instacart", category: cat.id };
    if (cleaned.aliases.length) item.aliases = cleaned.aliases.slice(0, 8);
    if (tags) item.tags = tags;
    item.department = cat.department;
    items.push(item);
    byKey.set(k, item);
    perAisle.set(cat.aisle, (perAisle.get(cat.aisle) ?? 0) + 1);
  }
  const out = { source: "instacart-2017", importedAt: new Date().toISOString().slice(0, 10), products: products.length, dropped, merged, items };
  writeFileSync(join(demo, "catalog.instacart.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`${products.length} products → ${items.length} items (${merged} merged into another, ${dropped} dropped: no aisle and no department, ${branded} with a brand split off)`);
  console.log([...perAisle.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a}:${n}`).join(" "));
}
