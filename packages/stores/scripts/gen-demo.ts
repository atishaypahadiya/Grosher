// Generates demo/{store,categories}.json and the base of demo/catalog.json:
// a synthetic Walmart-Supercenter-style grocery side plus the near general
// merchandise aisles, laid out from scripts/taxonomy.ts. Units: meters.
//
// Run: npm run gen:demo -w @grosher/stores
//
//   y=0    ┌──── back wall: meat & seafood (left) · dairy (right) ──────────┐
//   y=12   │ ┬   ┬   ┬ … 30 aisles, A30 at the left, A1 at the right   ┬   │ produce
//          │ │A30│A29│ … household · pet · baby · pharmacy … frozen … │A1 │ wall
//   y=44   │ ┴───┴───┴──────── action alley (endcaps) ────────────────┴───│ (right)
//   deli / │ pharmacy counter   ║ ║ ║ ║ ║ ║ ║ ║ ║ ║  10 checkout lanes      │
//   bakery │                                                 vestibule ─ entrance / exit
//   (left) └──────────────────────────────── front corridor y=58 ──────────┘
//
// Each category in the taxonomy becomes one shelf location at the centre of
// its bay run; categories.json carries aisle, side, bays and that location.
// The catalog this writes is the hand-kept base (stable ids the tests use);
// scripts/seed-catalog.ts adds the generated products on top.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Category, Fixture, GraphEdge, GraphNode, ShelfLocation, StoreGraph, Stop } from "@grosher/core";
import { DEPARTMENTS } from "../src/departments.ts";
import { TAXONOMY, type TaxAisle } from "./taxonomy.ts";

export const AISLES = 30;
const AISLE_X0 = 10; // x of A30 (the left-most aisle)
const AISLE_GAP = 4;
const BACK_Y = 12;
const FRONT_Y = 44;
const LEFT_X = 4;
const RIGHT_X = AISLE_X0 + AISLE_GAP * (AISLES - 1) + 6; // 132
const LANE_Y = 51;
const FRONT_CORRIDOR_Y = 58;
const LANES = 10;
const LANE_X0 = 34;
const LANE_GAP = 8;

const HALF = 0.6; // half the walkable corridor width, kept clear
const DEPTH = 1.4; // shelf depth
const END_INSET = 0.8; // keep the back / front corridors clear
const COUNTER_H = 1.0;
const BAY_M = 1.22;

/** x of aisle i: A1 is at the right, by produce and the entrance */
const ax = (i: number) => AISLE_X0 + AISLE_GAP * (AISLES - i);
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const byAisle = new Map(TAXONOMY.map((a) => [a.aisle, a]));
const deptOfAisle = (i: number) => byAisle.get(`A${i}`)?.department ?? "dry";

interface Built {
  store: StoreGraph;
  categories: Category[];
}

function build(): Built {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const locations: ShelfLocation[] = [];
  const categories: Category[] = [];
  const N = (id: string, x: number, y: number, type: GraphNode["type"]) => nodes.push({ id, x, y, type });
  let eid = 0;
  const E = (from: string, to: string, oneWay = false) => {
    const id = `e${eid++}`;
    edges.push({ id, from, to, oneWay });
    return id;
  };

  // perimeter corners
  N("BL", LEFT_X, BACK_Y, "junction");
  N("FL", LEFT_X, FRONT_Y, "junction");
  N("BR", RIGHT_X, BACK_Y, "junction");
  N("FR", RIGHT_X, FRONT_Y, "junction");

  // aisles, left to right (A30 … A1), the back and front rows between them
  const aisleEdge: Record<string, string> = {};
  const backRow: { edge: string; x0: number; x1: number }[] = [];
  const frontRow: { edge: string; x0: number; x1: number }[] = [];
  let prevTop = "BL";
  let prevBot = "FL";
  let prevX = LEFT_X;
  for (let i = AISLES; i >= 1; i--) {
    const x = ax(i);
    N(`A${i}T`, x, BACK_Y, "aisle_end");
    N(`A${i}B`, x, FRONT_Y, "aisle_end");
    aisleEdge[`A${i}`] = E(`A${i}T`, `A${i}B`);
    backRow.push({ edge: E(prevTop, `A${i}T`), x0: prevX, x1: x });
    frontRow.push({ edge: E(prevBot, `A${i}B`), x0: prevX, x1: x });
    prevTop = `A${i}T`;
    prevBot = `A${i}B`;
    prevX = x;
  }
  backRow.push({ edge: E(prevTop, "BR"), x0: prevX, x1: RIGHT_X });
  frontRow.push({ edge: E(prevBot, "FR"), x0: prevX, x1: RIGHT_X });
  const leftWall = E("BL", "FL"); // deli (back half), bakery (front half)
  const rightWall = E("BR", "FR"); // produce

  // checkout lanes: one-way from the action alley out to the front corridor
  const checkoutIds: string[] = [];
  N("FC0", LANE_X0 - 6, FRONT_CORRIDOR_Y, "junction");
  let prevFront = "FC0";
  for (let k = 0; k < LANES; k++) {
    const x = LANE_X0 + k * LANE_GAP;
    N(`L${k}a`, x, FRONT_Y, "junction");
    N(`L${k}`, x, LANE_Y, "checkout");
    N(`L${k}o`, x, FRONT_CORRIDOR_Y, "junction");
    E(`L${k}a`, `L${k}`, true);
    E(`L${k}`, `L${k}o`, true);
    E(prevFront, `L${k}o`);
    prevFront = `L${k}o`;
    checkoutIds.push(`L${k}`);
    // the lane's access point joins the action alley between its two neighbouring aisle bottoms
    const right = Math.max(1, Math.min(AISLES, Math.ceil((RIGHT_X - 6 - x) / AISLE_GAP) + 1)); // the aisle just right of x
    const left = Math.min(AISLES, right + 1);
    if (ax(left) < x) E(`A${left}B`, `L${k}a`);
    if (ax(right) >= x) E(`L${k}a`, `A${right}B`);
  }
  // the pharmacy counter sits front-left, reached from the action alley
  N("PHARM", 16, FRONT_Y, "junction");
  E("FL", "PHARM");
  E("PHARM", `A${AISLES}B`);
  // front corridor west end joins the front-left corner through the pharmacy front
  N("FCW", 16, FRONT_CORRIDOR_Y, "junction");
  E("FCW", "FC0");

  N("EXIT", RIGHT_X - 2, FRONT_CORRIDOR_Y + 4, "exit");
  N("ENTRANCE", RIGHT_X + 2, FRONT_CORRIDOR_Y + 4, "entrance");
  N("VEST", RIGHT_X, FRONT_CORRIDOR_Y, "junction");
  E(prevFront, "VEST");
  E("VEST", "EXIT", true);
  E("ENTRANCE", "VEST", true);
  E("VEST", "FR", true); // vestibule into the store, not a shortcut back out

  // ----- categories → shelf locations
  const runLength = FRONT_Y - BACK_Y - 2 * END_INSET; // 30.4 m of shelving per aisle side
  const bays = Math.round(runLength / BAY_M); // 25
  const bayLen = runLength / bays;
  let shelfSeq = 0;

  /** lay categories along a run of `bays` bays; returns bay ranges from the entrance-facing end */
  const spread = (n: number, totalBays: number): [number, number][] => {
    const out: [number, number][] = [];
    let start = 1;
    for (let k = 0; k < n; k++) {
      const end = Math.round(((k + 1) * totalBays) / n);
      out.push([start, Math.max(start, end)]);
      start = Math.max(start, end) + 1;
    }
    return out;
  };

  const place = (tax: TaxAisle, side: "L" | "R", cats: TaxAisle["left"], at: (centreBayFromFront: number, bayCount: number) => { edgeId: string; offsetM: number }, bayCount: number) => {
    const ranges = spread(cats.length, bayCount);
    cats.forEach((cat, k) => {
      const [b0, b1] = ranges[k];
      const { edgeId, offsetM } = at((b0 + b1) / 2, bayCount);
      const locationId = `${tax.aisle}-${side}${b0}`;
      locations.push({ id: locationId, aisle: tax.aisle, side, edgeId, offsetM: Math.round(offsetM * 10) / 10, shelf: 1 + (shelfSeq++ % 3), tags: cat.tags });
      categories.push({ id: cat.id, name: cat.name, group: tax.sign, aisle: tax.aisle, side, bays: [b0, b1], locationId, department: tax.department, tags: cat.tags, aliases: cat.aliases });
    });
  };

  // aisles: bay 1 is at the front (bottom) end; offset is measured from the top node
  for (let i = 1; i <= AISLES; i++) {
    const tax = byAisle.get(`A${i}`);
    if (!tax) throw new Error(`taxonomy has no aisle A${i}`);
    const at = (centreBay: number) => ({ edgeId: aisleEdge[`A${i}`], offsetM: FRONT_Y - END_INSET - (centreBay - 0.5) * bayLen - BACK_Y });
    place(tax, "L", tax.left, at, bays);
    if (tax.right) place(tax, "R", tax.right, at, bays);
  }

  // walls: produce on the right wall (fixture east of the corridor: side R), bay 1 at the front
  const wall = (id: string, edgeId: string, side: "L" | "R", from: number, to: number, forward: boolean) => {
    const tax = byAisle.get(id);
    if (!tax) throw new Error(`taxonomy has no wall ${id}`);
    const len = to - from;
    const n = Math.max(1, Math.round(len / BAY_M));
    const bl = len / n;
    // forward: bay 1 at `to` (the end nearer the entrance); offsets grow from `from`
    const at = (centreBay: number) => ({ edgeId, offsetM: forward ? to - (centreBay - 0.5) * bl : from + (centreBay - 0.5) * bl });
    place(tax, side, tax.left, at, n);
  };
  wall("PRODUCE", rightWall, "R", END_INSET, FRONT_Y - BACK_Y - END_INSET, true);
  const mid = (FRONT_Y - BACK_Y) / 2;
  wall("DELI", leftWall, "L", END_INSET, mid, true);
  wall("BAKERY", leftWall, "L", mid, FRONT_Y - BACK_Y - END_INSET, true);

  // the back wall: meat & seafood over the left half, dairy over the right half; each category's
  // location lands on whichever back-row edge spans its x (fixture north of the corridor: side L)
  const backAt = (x: number) => {
    const seg = backRow.find((s) => x >= s.x0 && x <= s.x1) ?? backRow[backRow.length - 1];
    return { edgeId: seg.edge, offsetM: x - seg.x0 };
  };
  const backWall = (id: string, x0: number, x1: number) => {
    const tax = byAisle.get(id)!;
    const n = Math.max(1, Math.round((x1 - x0) / BAY_M));
    const bl = (x1 - x0) / n;
    // bay 1 at the right end (nearer the entrance)
    place(tax, "L", tax.left, (centreBay) => backAt(x1 - (centreBay - 0.5) * bl), n);
  };
  const midX = (LEFT_X + RIGHT_X) / 2;
  backWall("MEAT", LEFT_X, midX);
  backWall("DAIRY", midX, RIGHT_X);

  // the pharmacy counter: a block south of the action alley at the front-left (side R of the front row)
  const pharmTax = byAisle.get("PHARMACY")!;
  const pharmX0 = 8;
  const pharmX1 = 24;
  const frontAt = (x: number) => {
    const seg = frontRow.find((s) => x >= s.x0 && x <= s.x1) ?? frontRow[0];
    return { edgeId: seg.edge, offsetM: x - seg.x0 };
  };
  {
    const n = Math.max(1, Math.round((pharmX1 - pharmX0) / BAY_M));
    const bl = (pharmX1 - pharmX0) / n;
    place(pharmTax, "R", pharmTax.left, (centreBay) => frontAt(pharmX1 - (centreBay - 0.5) * bl), n);
  }

  const store: StoreGraph = {
    storeId: "demo-supercenter",
    version: 3,
    name: "Demo Supercenter",
    address: "Synthetic layout · San José",
    nodes,
    edges,
    locations,
    entranceId: "ENTRANCE",
    checkoutIds,
    exitId: "EXIT",
    fixtures: makeFixtures(pharmX0, pharmX1),
    departments: DEPARTMENTS,
  };
  return { store, categories };
}

// ----- fixtures (DESIGN.md §6): 1.4 m shelf blocks each side of every aisle
// corridor, merged where neighbours meet and share a department; wall
// shelving behind the perimeter corridors; counters beside each lane.

function makeFixtures(pharmX0: number, pharmX1: number): Fixture[] {
  const out: Fixture[] = [];
  const y0 = BACK_Y + END_INSET;
  const y1 = FRONT_Y - END_INSET;

  // the right block of A1 stands alone against the produce corridor; the left block of A30 against the deli corridor
  out.push({ id: "f-A1-R", kind: "shelf", polygon: rect(ax(1) + HALF, y0, ax(1) + HALF + DEPTH, y1), department: deptOfAisle(1), aisle: "A1" });
  for (let i = 1; i < AISLES; i++) {
    const left = ax(i) - HALF; // the left block of aisle i …
    const right = ax(i + 1) + HALF; // … meets the right block of aisle i+1 (to its west)
    const d1 = deptOfAisle(i);
    const d2 = deptOfAisle(i + 1);
    if (d1 === d2) {
      out.push({ id: `f-A${i + 1}-A${i}`, kind: "shelf", polygon: rect(right, y0, left, y1), department: d1, aisle: `A${i}` });
    } else {
      out.push({ id: `f-A${i}-L`, kind: "shelf", polygon: rect(left - DEPTH, y0, left, y1), department: d1, aisle: `A${i}` });
      out.push({ id: `f-A${i + 1}-R`, kind: "shelf", polygon: rect(right, y0, right + DEPTH, y1), department: d2, aisle: `A${i + 1}` });
    }
  }
  out.push({ id: `f-A${AISLES}-L`, kind: "shelf", polygon: rect(ax(AISLES) - HALF - DEPTH, y0, ax(AISLES) - HALF, y1), department: deptOfAisle(AISLES), aisle: `A${AISLES}` });

  // perimeter walls
  const mid = (y0 + y1) / 2;
  out.push({ id: "f-PRODUCE", kind: "wall", polygon: rect(RIGHT_X + HALF, y0, RIGHT_X + HALF + DEPTH, y1), department: "produce", aisle: "PRODUCE" });
  out.push({ id: "f-DELI", kind: "wall", polygon: rect(LEFT_X - HALF - DEPTH, y0, LEFT_X - HALF, mid), department: "deli", aisle: "DELI" });
  out.push({ id: "f-BAKERY", kind: "wall", polygon: rect(LEFT_X - HALF - DEPTH, mid, LEFT_X - HALF, y1), department: "bakery", aisle: "BAKERY" });
  const wallY0 = BACK_Y - HALF - DEPTH;
  const wallY1 = BACK_Y - HALF;
  const midX = (LEFT_X + RIGHT_X) / 2;
  out.push({ id: "f-MEAT", kind: "wall", polygon: rect(LEFT_X - HALF - DEPTH, wallY0, midX, wallY1), department: "meat", aisle: "MEAT" });
  out.push({ id: "f-DAIRY", kind: "wall", polygon: rect(midX, wallY0, RIGHT_X + HALF + DEPTH, wallY1), department: "dairy", aisle: "DAIRY" });

  // the pharmacy counter, south of the action alley at the front-left
  out.push({ id: "f-PHARMACY", kind: "counter", height: COUNTER_H, polygon: rect(pharmX0, FRONT_Y + HALF, pharmX1, FRONT_Y + HALF + 2.0), department: "pharmacy", aisle: "PHARMACY" });

  // checkout counters: one each side of every lane, between the lane access row and the front corridor
  const cy0 = FRONT_Y + 1;
  const cy1 = FRONT_CORRIDOR_Y - 1;
  for (let k = 0; k < LANES; k++) {
    const x = LANE_X0 + k * LANE_GAP;
    out.push({ id: `f-L${k}-L`, kind: "counter", height: COUNTER_H, polygon: rect(x - HALF - DEPTH, cy0, x - HALF, cy1), department: "checkout" });
    out.push({ id: `f-L${k}-R`, kind: "counter", height: COUNTER_H, polygon: rect(x + HALF, cy0, x + HALF + DEPTH, cy1), department: "checkout" });
  }
  return out;
}

/**
 * The hand-kept base of the catalog: stable ids the tests, bench and perf
 * gate use, each placed in a category. The seed script adds thousands more
 * and keeps these ids.
 */
const BASE_ITEMS: (Omit<Stop, "locationIds"> & { categories: string[] })[] = [
  { id: "bananas", name: "Bananas", categories: ["bananas"], tags: ["produce"] },
  { id: "spinach", name: "Spinach", categories: ["salad-greens"], tags: ["produce"] },
  { id: "onions", name: "Onions", categories: ["onions-garlic"], tags: ["produce"] },
  { id: "bread", name: "Bread", categories: ["sandwich-bread"], tags: ["fragile"], aliases: ["sandwich bread", "loaf of bread"] },
  { id: "tortillas", name: "Tortillas", categories: ["tortillas-wraps"], aliases: ["wraps", "flour tortillas"] },
  { id: "eggs", name: "Eggs", categories: ["eggs"], tags: ["fragile", "chilled"] },
  { id: "milk", name: "Milk", categories: ["milk"], tags: ["chilled", "heavy"], aliases: ["whole milk", "2 percent milk", "skim milk"] },
  { id: "yogurt", name: "Greek yogurt", categories: ["yogurt"], tags: ["chilled"], aliases: ["yogurt", "yoghurt", "chobani"] },
  { id: "chicken", name: "Chicken thighs", categories: ["chicken"], tags: ["chilled"], aliases: ["chicken", "chicken breast"] },
  { id: "paneer", name: "Paneer", categories: ["paneer-indian-dairy"], tags: ["chilled"] },
  { id: "rice", name: "Basmati rice 10 lb", categories: ["basmati-indian-rice"], tags: ["heavy"], aliases: ["rice", "basmati", "jasmine rice"] },
  { id: "lentils", name: "Lentils", categories: ["dried-beans-lentils"] },
  { id: "pasta", name: "Pasta", categories: ["pasta"] },
  { id: "sauce", name: "Pasta sauce", categories: ["pasta-sauce"], tags: ["fragile"] },
  { id: "cereal", name: "Cereal", categories: ["cereal"], aliases: ["cheerios", "corn flakes"] },
  { id: "coffee", name: "Coffee", categories: ["ground-coffee"] },
  { id: "oats", name: "Oats", categories: ["hot-cereal"], aliases: ["oatmeal", "quaker oats", "rolled oats"] },
  { id: "spices", name: "Cumin", categories: ["spices-herbs"], aliases: ["cumin seeds", "jeera"] },
  { id: "oil", name: "Olive oil", categories: ["cooking-oil"], tags: ["heavy", "fragile"], aliases: ["evoo", "cooking oil"] },
  { id: "chips", name: "Chips", categories: ["potato-chips"], tags: ["fragile"], aliases: ["crisps", "potato chips", "lays", "doritos"] },
  { id: "water", name: "Water 24-pack", categories: ["bottled-water"], tags: ["heavy"], aliases: ["water", "bottled water", "water bottles"] },
  { id: "soda", name: "Soda", categories: ["soda"], tags: ["heavy"], aliases: ["coke", "pepsi", "pop", "cola", "sprite"] },
  { id: "tp", name: "Toilet paper", categories: ["toilet-paper"], aliases: ["toilet roll", "bath tissue", "charmin", "loo roll"] },
  { id: "detergent", name: "Detergent", categories: ["laundry-detergent"], tags: ["heavy"], aliases: ["laundry detergent", "tide", "tide pods"] },
  { id: "batteries", name: "Batteries", categories: ["batteries-lightbulbs"] },
  { id: "icecream", name: "Ice cream", categories: ["ice-cream"], tags: ["frozen"], aliases: ["icecream", "ben and jerrys", "gelato"] },
  { id: "peas", name: "Frozen peas", categories: ["frozen-vegetables"], tags: ["frozen"] },
  { id: "pizza", name: "Frozen pizza", categories: ["frozen-pizza"], tags: ["frozen"] },
  { id: "berries", name: "Frozen berries", categories: ["frozen-fruit"], tags: ["frozen"] },
  { id: "snacks", name: "Granola bars", categories: ["breakfast-bars"], aliases: ["granola", "cereal bars", "nature valley"] },
];

export interface CatalogFile {
  generatedAt: string | null;
  model: string | null;
  /** category ids the seed has finished, so a run can resume */
  seeded: string[];
  items: Stop[];
}

const out = join(import.meta.dirname, "..", "demo");
mkdirSync(out, { recursive: true });
const { store, categories } = build();
const catById = new Map(categories.map((c) => [c.id, c]));
const base: Stop[] = BASE_ITEMS.map(({ categories: cats, ...s }) => ({
  ...s,
  locationIds: cats.map((id) => {
    const c = catById.get(id);
    if (!c) throw new Error(`base item ${s.id}: unknown category ${id}`);
    return c.locationId;
  }),
}));
writeFileSync(join(out, "store.json"), JSON.stringify(store, null, 2) + "\n");
writeFileSync(join(out, "categories.json"), JSON.stringify(categories, null, 2) + "\n");

// the catalog keeps whatever the seed already generated; only the base rows are rewritten
const catalogPath = join(out, "catalog.json");
let file: CatalogFile = { generatedAt: null, model: null, seeded: [], items: [] };
if (existsSync(catalogPath)) {
  const raw = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFile | Stop[];
  if (!Array.isArray(raw)) file = raw;
}
const baseIds = new Set(base.map((s) => s.id));
const validLoc = new Set(store.locations.map((l) => l.id));
const kept = file.items.filter((s) => !baseIds.has(s.id) && s.locationIds.every((l) => validLoc.has(l)));
file = { ...file, items: [...base, ...kept] };
writeFileSync(catalogPath, JSON.stringify(file, null, 2) + "\n");
console.log(`wrote ${out}: ${store.nodes.length} nodes, ${store.edges.length} edges, ${store.locations.length} locations, ${store.fixtures?.length} fixtures, ${categories.length} categories, ${file.items.length} catalog items (${base.length} base)`);
