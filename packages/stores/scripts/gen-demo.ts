// Generates demo/{store,catalog}.json: a synthetic
// Walmart-Supercenter-style grocery side, used for tests and benchmarks
// until the real Story Rd / Almaden map exists. Units: meters.
//
// Run: npm run gen:demo -w @grosher/stores
//
//   y=0   ┌──────────────── back wall: meat / dairy ─────────────────┐
//   y=12  │ ┬   ┬   ┬   ┬   ┬   ┬   ┬   ┬   ┬   ┬   ┬   ┬           │
//         │ │A1 │A2 │A3 │ … │   │   │   │   │A9 │A10│A11│A12 (frozen)│
//   y=52  │ ┴───┴───┴───┴── action alley (endcaps) ───┴───┴───┴─────│
//         │produce (left wall)                       bakery (right)  │
//   y=60  │      ║  ║  ║  ║  ║   checkout lanes (one-way)            │
//   y=66  └──────╨──╨──╨──╨──╨───────────────── front ── exit/entry ─┘

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Fixture, GraphEdge, GraphNode, ShelfLocation, StoreGraph, Stop } from "@grosher/core";
import { DEPARTMENTS } from "../src/departments.ts";

const AISLES = 12;
const AISLE_X0 = 10;
const AISLE_GAP = 4;
const BACK_Y = 12;
const FRONT_Y = 52;
const LEFT_X = 4;
const RIGHT_X = AISLE_X0 + AISLE_GAP * (AISLES - 1) + 6; // 60
const LANE_Y = 60;
const FRONT_CORRIDOR_Y = 66;

function makeDemoStore(): StoreGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const locations: ShelfLocation[] = [];
  const N = (id: string, x: number, y: number, type: GraphNode["type"]) =>
    nodes.push({ id, x, y, type });
  let eid = 0;
  const E = (from: string, to: string, oneWay = false) => {
    const id = `e${eid++}`;
    edges.push({ id, from, to, oneWay });
    return id;
  };

  // Corners of the perimeter loop.
  N("BL", LEFT_X, BACK_Y, "junction");
  N("FL", LEFT_X, FRONT_Y, "junction");
  N("BR", RIGHT_X, BACK_Y, "junction");
  N("FR", RIGHT_X, FRONT_Y, "junction");

  // Aisles A1..A12.
  const aisleEdge: Record<string, string> = {};
  const backEdges: string[] = [];
  const frontEdges: string[] = [];
  let prevTop = "BL";
  let prevBot = "FL";
  for (let i = 1; i <= AISLES; i++) {
    const x = AISLE_X0 + AISLE_GAP * (i - 1);
    N(`A${i}T`, x, BACK_Y, "aisle_end");
    N(`A${i}B`, x, FRONT_Y, "aisle_end");
    aisleEdge[`A${i}`] = E(`A${i}T`, `A${i}B`);
    backEdges.push(E(prevTop, `A${i}T`));
    frontEdges.push(E(prevBot, `A${i}B`));
    prevTop = `A${i}T`;
    prevBot = `A${i}B`;
  }
  backEdges.push(E(prevTop, "BR"));
  frontEdges.push(E(prevBot, "FR"));
  const leftWall = E("BL", "FL"); // produce
  const rightWall = E("BR", "FR"); // bakery / deli

  // Checkout lanes: one-way from the action alley out to the front corridor.
  const checkoutIds: string[] = [];
  let prevFront = "FC0";
  N("FC0", 14, FRONT_CORRIDOR_Y, "junction");
  for (let k = 0; k < 6; k++) {
    const x = 16 + k * 5;
    N(`L${k}a`, x, FRONT_Y, "junction");
    N(`L${k}`, x, LANE_Y, "checkout");
    N(`L${k}o`, x, FRONT_CORRIDOR_Y, "junction");
    E(`L${k}a`, `L${k}`, true);
    E(`L${k}`, `L${k}o`, true);
    E(prevFront, `L${k}o`);
    prevFront = `L${k}o`;
    checkoutIds.push(`L${k}`);
  }
  // Lane access points sit on the action alley; connect them to the nearest aisle bottoms.
  // (Simple approach: connect each lane access to its two neighbouring aisle bottoms.)
  for (let k = 0; k < 6; k++) {
    const x = 16 + k * 5;
    const left = Math.max(1, Math.floor((x - AISLE_X0) / AISLE_GAP) + 1);
    E(`A${left}B`, `L${k}a`);
    if (left + 1 <= AISLES) E(`L${k}a`, `A${left + 1}B`);
  }

  N("EXIT", RIGHT_X - 2, FRONT_CORRIDOR_Y + 4, "exit");
  N("ENTRANCE", RIGHT_X + 2, FRONT_CORRIDOR_Y + 4, "entrance");
  N("VEST", RIGHT_X, FRONT_CORRIDOR_Y, "junction");
  E(prevFront, "VEST");
  E("VEST", "EXIT", true);
  E("ENTRANCE", "VEST", true);
  E("VEST", "FR", true); // vestibule into the store, not a shortcut back out

  // ----- shelf locations
  let shelfSeq = 0;
  const L = (id: string, aisle: string, edgeId: string, offsetM: number, side: "L" | "R" = "L") =>
    locations.push({ id, aisle, side, edgeId, offsetM, shelf: 1 + (shelfSeq++ % 3) });

  for (let i = 1; i <= AISLES; i++) {
    for (const off of [8, 20, 32]) L(`A${i}-${off}`, `A${i}`, aisleEdge[`A${i}`], off);
  }
  [6, 18, 30].forEach((off) => L(`PRODUCE-${off}`, "PRODUCE", leftWall, off));
  [10, 25].forEach((off) => L(`BAKERY-${off}`, "BAKERY", rightWall, off));
  // Back wall: meat on the left half, dairy on the right half.
  [1, 3, 5].forEach((i) => L(`MEAT-${i}`, "MEAT", backEdges[i], 2));
  [8, 10, 11].forEach((i) => L(`DAIRY-${i}`, "DAIRY", backEdges[i], 2));
  // Endcaps on the action alley.
  [2, 6, 9].forEach((i) => L(`END-${i}`, "ENDCAP", frontEdges[i], 2));

  return {
    storeId: "demo-supercenter",
    version: 2,
    name: "Demo Supercenter",
    address: "Synthetic layout · San José",
    nodes,
    edges,
    locations,
    entranceId: "ENTRANCE",
    checkoutIds,
    exitId: "EXIT",
    fixtures: makeFixtures(),
    departments: DEPARTMENTS,
  };
}

// ----- fixtures (DESIGN.md §6): 1.4 m shelf blocks each side of every aisle
// corridor, merged where neighbours meet and share a department; wall
// shelving behind the perimeter corridors; 1.0 m counters beside each lane.

const HALF = 0.6; // half the walkable corridor width, kept clear
const DEPTH = 1.4; // shelf depth
const END_INSET = 0.8; // keep the back / front corridors clear
const COUNTER_H = 1.0;

function deptOfAisle(i: number): string {
  if (i <= 5) return "dry";
  if (i === 6) return "snack";
  if (i === 7) return "drinks";
  if (i <= 9) return "household";
  return "frozen";
}

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function makeFixtures(): Fixture[] {
  const out: Fixture[] = [];
  const y0 = BACK_Y + END_INSET;
  const y1 = FRONT_Y - END_INSET;
  const ax = (i: number) => AISLE_X0 + AISLE_GAP * (i - 1);

  // Left side of A1 and right side of A12 stand alone.
  out.push({ id: "f-A1-L", kind: "shelf", polygon: rect(ax(1) - HALF - DEPTH, y0, ax(1) - HALF, y1), department: deptOfAisle(1), aisle: "A1" });
  for (let i = 1; i < AISLES; i++) {
    const right = ax(i) + HALF; // right block of aisle i
    const left = ax(i + 1) - HALF; // left block of aisle i+1
    const d1 = deptOfAisle(i);
    const d2 = deptOfAisle(i + 1);
    if (d1 === d2) {
      out.push({ id: `f-A${i}-A${i + 1}`, kind: "shelf", polygon: rect(right, y0, left, y1), department: d1, aisle: `A${i}` });
    } else {
      out.push({ id: `f-A${i}-R`, kind: "shelf", polygon: rect(right, y0, right + DEPTH, y1), department: d1, aisle: `A${i}` });
      out.push({ id: `f-A${i + 1}-L`, kind: "shelf", polygon: rect(left - DEPTH, y0, left, y1), department: d2, aisle: `A${i + 1}` });
    }
  }
  out.push({ id: "f-A12-R", kind: "shelf", polygon: rect(ax(AISLES) + HALF, y0, ax(AISLES) + HALF + DEPTH, y1), department: deptOfAisle(AISLES), aisle: "A12" });

  // Perimeter walls: produce (left), bakery (right), meat + dairy (back).
  out.push({ id: "f-PRODUCE", kind: "wall", polygon: rect(LEFT_X - HALF - DEPTH, y0, LEFT_X - HALF, y1), department: "produce", aisle: "PRODUCE" });
  out.push({ id: "f-BAKERY", kind: "wall", polygon: rect(RIGHT_X + HALF, y0, RIGHT_X + HALF + DEPTH, y1), department: "bakery", aisle: "BAKERY" });
  const wallY0 = BACK_Y - HALF - DEPTH;
  const wallY1 = BACK_Y - HALF;
  const midX = (LEFT_X + RIGHT_X) / 2;
  out.push({ id: "f-MEAT", kind: "wall", polygon: rect(LEFT_X - HALF - DEPTH, wallY0, midX, wallY1), department: "meat", aisle: "MEAT" });
  out.push({ id: "f-DAIRY", kind: "wall", polygon: rect(midX, wallY0, RIGHT_X + HALF + DEPTH, wallY1), department: "dairy", aisle: "DAIRY" });

  // Checkout counters: one each side of every lane, between the lane access row and the front corridor.
  const cy0 = FRONT_Y + 1;
  const cy1 = FRONT_CORRIDOR_Y - 1;
  for (let k = 0; k < 6; k++) {
    const x = 16 + k * 5;
    out.push({ id: `f-L${k}-L`, kind: "counter", height: COUNTER_H, polygon: rect(x - HALF - DEPTH, cy0, x - HALF, cy1), department: "checkout" });
    out.push({ id: `f-L${k}-R`, kind: "counter", height: COUNTER_H, polygon: rect(x + HALF, cy0, x + HALF + DEPTH, cy1), department: "checkout" });
  }
  return out;
}

/** Catalog of resolved items for the demo store. */
const DEMO_ITEMS: Stop[] = [
  { id: "bananas", name: "Bananas", locationIds: ["PRODUCE-6"], tags: ["produce"] },
  { id: "spinach", name: "Spinach", locationIds: ["PRODUCE-18"], tags: ["produce"] },
  { id: "onions", name: "Onions", locationIds: ["PRODUCE-30"], tags: ["produce"] },
  { id: "bread", name: "Bread", locationIds: ["BAKERY-10"], tags: ["fragile"] },
  { id: "tortillas", name: "Tortillas", locationIds: ["BAKERY-25"], aliases: ["wraps", "flour tortillas"] },
  { id: "eggs", name: "Eggs", locationIds: ["DAIRY-8"], tags: ["fragile", "chilled"] },
  { id: "milk", name: "Milk", locationIds: ["DAIRY-10"], tags: ["chilled", "heavy"], aliases: ["whole milk", "2 percent milk", "skim milk"] },
  { id: "yogurt", name: "Greek yogurt", locationIds: ["DAIRY-11"], tags: ["chilled"], aliases: ["yogurt", "yoghurt", "chobani"] },
  { id: "chicken", name: "Chicken thighs", locationIds: ["MEAT-1"], tags: ["chilled"], aliases: ["chicken", "chicken breast"] },
  { id: "paneer", name: "Paneer", locationIds: ["MEAT-5"], tags: ["chilled"] },
  { id: "rice", name: "Basmati rice 10 lb", locationIds: ["A1-8"], tags: ["heavy"], aliases: ["rice", "basmati", "jasmine rice"] },
  { id: "lentils", name: "Lentils", locationIds: ["A1-20"] },
  { id: "pasta", name: "Pasta", locationIds: ["A2-8"] },
  { id: "sauce", name: "Pasta sauce", locationIds: ["A2-20"], tags: ["fragile"] },
  { id: "cereal", name: "Cereal", locationIds: ["A3-8"], aliases: ["cheerios", "corn flakes"] },
  { id: "coffee", name: "Coffee", locationIds: ["A3-32"] },
  { id: "oats", name: "Oats", locationIds: ["A3-20"], aliases: ["oatmeal", "quaker oats", "rolled oats"] },
  { id: "spices", name: "Cumin", locationIds: ["A4-20"], aliases: ["cumin seeds", "jeera"] },
  { id: "oil", name: "Olive oil", locationIds: ["A4-32"], tags: ["heavy", "fragile"], aliases: ["evoo", "cooking oil"] },
  { id: "chips", name: "Chips", locationIds: ["A6-8", "END-6"], tags: ["fragile"], aliases: ["crisps", "potato chips", "lays", "doritos"] },
  { id: "water", name: "Water 24-pack", locationIds: ["A7-32", "END-9"], tags: ["heavy"], aliases: ["water", "bottled water", "water bottles"] },
  { id: "soda", name: "Soda", locationIds: ["A7-20"], tags: ["heavy"], aliases: ["coke", "pepsi", "pop", "cola", "sprite"] },
  { id: "tp", name: "Toilet paper", locationIds: ["A8-20"], aliases: ["toilet roll", "bath tissue", "charmin", "loo roll"] },
  { id: "detergent", name: "Detergent", locationIds: ["A9-8"], tags: ["heavy"], aliases: ["laundry detergent", "tide", "tide pods"] },
  { id: "batteries", name: "Batteries", locationIds: ["A9-32", "END-2"] },
  { id: "icecream", name: "Ice cream", locationIds: ["A10-20"], tags: ["frozen"], aliases: ["icecream", "ben and jerrys", "gelato"] },
  { id: "peas", name: "Frozen peas", locationIds: ["A11-8"], tags: ["frozen"] },
  { id: "pizza", name: "Frozen pizza", locationIds: ["A12-20"], tags: ["frozen"] },
  { id: "berries", name: "Frozen berries", locationIds: ["A11-32"], tags: ["frozen"] },
  { id: "snacks", name: "Granola bars", locationIds: ["A5-20", "END-6"], aliases: ["granola", "cereal bars", "nature valley"] },
];

const out = join(import.meta.dirname, "..", "demo");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "store.json"), JSON.stringify(makeDemoStore(), null, 2) + "\n");
writeFileSync(join(out, "catalog.json"), JSON.stringify(DEMO_ITEMS, null, 2) + "\n");
console.log(`wrote ${out}`);
