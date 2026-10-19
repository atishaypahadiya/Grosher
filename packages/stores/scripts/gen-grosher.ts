// Generates grosher/{store,categories,catalog.base,rehome,lists}.json and grosher/textures/{wood,stainless}.jpg:
// Grosher, our own designed market (design/store-grosher.md), laid out from scripts/grosher-taxonomy.ts.
// Local metres, x right 0–85, y down 0–70.
//
// Run: npm run gen:grosher -w @grosher/stores
//
//   y=0  ┌ floral ┬──── produce: wet wall, 8 islands (skylight) ────┬─ bulk bins ─┐╲ cut corner
//   ENT ─┤ svc    │                                                  │             │  ╲
//        │ Rx OTC ├──── north walkway ─────────────────────────────┴─────────────┴───┤ seafood
//        │ body   │ ═══ aisles 1–10, runs east–west, end caps ═══ │cross│ beer·wine │ meat
//        │ care   │                                                │aisle│ spirits  │
//        │ check- │                                                │     │ wine bar │ dairy
//        │ out    ├──── frozen walkway · reach-in doors · coffins ─┴─────┴──────────┤ (far wall)
//        │ seats  ├──── food hall walkway ────────────────────────────────────────┤ cheese
//   EXIT ┘ café   └ hot bar · salad bar · soups / rotisserie · sushi · pizza · deli ┴ bakery
//
// The walk graph is built from corridor centrelines: every crossing is a node, every corridor is split at
// its crossings. Checkout lanes are one-way east → west, then the front walkway runs down to the exit.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encode } from "jpeg-js";
import type { Category, Fixture, FixtureKind, GraphEdge, GraphNode, NodeType, ShelfLocation, StoreGraph, Stop } from "@grosher/core";
import { TAXONOMY, type TaxCategory } from "./taxonomy.ts";
import { BULKY, CATEGORY_PATCHES, FACES, GROSHER_DEPARTMENTS, GROSHER_ITEMS, HEAVY, HERO_LISTS, NEW_CATEGORIES, REHOME } from "./grosher-taxonomy.ts";
import { HANDLING_TAGS, handlingTags } from "../src/handling.ts";

const BAY_M = 1.22;
const ENTRANCE: [number, number] = [0, 6];

// ----------------------------------------------------------------------------- the plan, in numbers
// corridors (centrelines)
const X_WEST = 12; // the west walkway, from the wet-wall aisle down to the café
const X_CROSS = 52.5; // the cross aisle between the two banks
const X_EAST = 73.5; // the east walkway in front of the service counters
const X_FRONT = 2.2; // the front-end walkway from the lanes down to the exit
const Y_ENTRY = 6; // the entrance corridor, floral on the left, the service desk on the right
const Y_WET = 3.5; // produce: between the wet wall and the first row of islands (and the bulk aisle)
const Y_ISLANDS = 8.3; // produce: between the two rows of islands (and the bulk island's south side)
const Y_NORTH = 14.2; // the north walkway
const Y_FROZEN = 49.4; // the frozen walkway (south ends of the aisles, the reach-in doors' north side)
const Y_FROZEN_AISLE = 53.5; // between the reach-in doors and the coffins
const Y_FOODHALL = 58.3; // the food hall walkway (coffins' south side, the bread wall)
const Y_SOUTH = 64.6; // the café / food hall / bakery aisle in front of the counters
const Y_EAST_BANK = 30.0; // south of the spirits run, cross aisle to the east walkway
// centre runs: 11 gondola runs, 1.1 m deep at 3.1 m pitch (2.0 m clear aisles), end caps 1 m long
const RUN_X: [number, number] = [15, 50];
const CAP = 1;
const RUN_Y0 = 15.8;
const RUN_PITCH = 3.1;
const RUN_DEPTH = 1.1;
const runY = (k: number): [number, number] => [RUN_Y0 + RUN_PITCH * k, RUN_Y0 + RUN_PITCH * k + RUN_DEPTH];
const aisleY = (k: number) => runY(k - 1)[1] + (runY(k)[0] - runY(k - 1)[1]) / 2; // aisle k between run k-1 and run k
// beer, wine & spirits: 4 runs at 3.3 m pitch (2.2 m clear)
const W_X: [number, number] = [55, 70];
const wY = (j: number): [number, number] => [17 + 3.3 * j, 18.1 + 3.3 * j];
const wAisleY = (j: number) => (wY(j - 1)[1] + wY(j)[0]) / 2; // aisle 10 + j between W(j-1) and W(j)
// spurs into the west column (pharmacy and body care runs are perpendicular to the wall)
const SPURS = [15.0, 18.7, 22.4, 26.1, 29.8];
const OTC_X: [number, number] = [4, 9.5];
// checkout: 8 staffed lanes + express at 1.6 m pitch (0.7 m belt counters, 0.9 m lanes), then 6 self-checkouts
const LANES = 9;
const laneY = (k: number) => 32.15 + 1.6 * k;
const SCO_Y = 46.85;
const LANE_X: [number, number] = [3.5, 9.5];
const CHECKOUT_X = 6.5;
// produce islands
const ISLAND_X: [number, number][] = [
  [14, 20.2],
  [22.4, 28.6],
  [30.8, 37],
  [39.2, 45.4],
];
const ISLAND_ROWS: [number, number][] = [
  [4.8, 7.0],
  [9.6, 11.8],
];
// the frozen runs break once so the walk is not 57 m around
const FROZEN_SEGS: [number, number][] = [
  [14, 41.6],
  [44, 71],
];
const X_FROZEN_GAP = 42.8;
// food hall connectors between its walkway and its aisle
const FOODHALL_X = [21.7, 34, 46, 54.2, 60.5];
const PRODUCE_X = [21.3, 29.7, 38.1, 47];
const X_BULK_EAST = 69;

// ----------------------------------------------------------------------------- graph from corridors
interface Seg {
  a: [number, number];
  b: [number, number];
  oneWay?: boolean;
}
const r2 = (v: number) => Math.round(v * 100) / 100;
const segs: Seg[] = [];
const H = (y: number, x0: number, x1: number) => segs.push({ a: [x0, y], b: [x1, y] });
const V = (x: number, y0: number, y1: number) => segs.push({ a: [x, y0], b: [x, y1] });

H(Y_ENTRY, 1, X_WEST);
V(X_WEST, Y_WET, Y_SOUTH);
H(Y_WET, X_WEST, X_BULK_EAST);
H(Y_ISLANDS, X_WEST, X_BULK_EAST);
for (const x of PRODUCE_X) V(x, Y_WET, Y_NORTH);
V(X_BULK_EAST, Y_WET, Y_NORTH);
H(Y_NORTH, X_WEST, X_EAST);
for (let k = 1; k <= 10; k++) H(aisleY(k), X_WEST, X_CROSS);
V(X_CROSS, Y_NORTH, Y_FROZEN);
for (let j = 1; j <= 3; j++) H(wAisleY(j), X_CROSS, X_EAST);
H(Y_EAST_BANK, X_CROSS, X_EAST);
V(X_EAST, Y_NORTH, Y_SOUTH);
H(Y_FROZEN, X_WEST, X_EAST);
H(Y_FROZEN_AISLE, X_WEST, X_EAST);
V(X_FROZEN_GAP, Y_FROZEN, Y_FOODHALL);
H(Y_FOODHALL, X_WEST, X_EAST);
H(Y_SOUTH, X_WEST, X_EAST);
for (const x of FOODHALL_X) V(x, Y_FOODHALL, Y_SOUTH);
SPURS.forEach((y, i) => H(y, i === 0 ? 3.4 : OTC_X[0], X_WEST));
V(X_FRONT, laneY(0), 64);

const named = new Map<string, { id: string; type: NodeType }>([
  [`${ENTRANCE[0]},${ENTRANCE[1]}`, { id: "ENTRANCE", type: "entrance" }],
  ["0,64", { id: "EXIT", type: "exit" }],
]);
const checkoutIds: string[] = [];
const laneName = (k: number) => (k < 8 ? `LANE${k + 1}` : "EXPRESS");
for (let k = 0; k < LANES; k++) {
  named.set(`${CHECKOUT_X},${r2(laneY(k))}`, { id: laneName(k), type: "checkout" });
  checkoutIds.push(laneName(k));
}
named.set(`${CHECKOUT_X},${SCO_Y}`, { id: "SELF", type: "checkout" });
checkoutIds.push("SELF");

const nodes = new Map<string, GraphNode>();
const nodeAt = (x: number, y: number, type: NodeType = "junction"): string => {
  const key = `${r2(x)},${r2(y)}`;
  const hit = nodes.get(key);
  if (hit) return hit.id;
  const n = named.get(key);
  const id = n?.id ?? `J${r2(x)}-${r2(y)}`;
  nodes.set(key, { id, x: r2(x), y: r2(y), type: n?.type ?? type });
  return id;
};
const horizontal = (s: Seg) => s.a[1] === s.b[1];
// every crossing of a horizontal and a vertical corridor is a node (T junctions included)
const points = segs.map((s) => [s.a, s.b] as [number, number][]);
for (let i = 0; i < segs.length; i++) {
  for (let j = 0; j < segs.length; j++) {
    const h = segs[i];
    const v = segs[j];
    if (!horizontal(h) || horizontal(v)) continue;
    const [hx0, hx1] = [Math.min(h.a[0], h.b[0]), Math.max(h.a[0], h.b[0])];
    const [vy0, vy1] = [Math.min(v.a[1], v.b[1]), Math.max(v.a[1], v.b[1])];
    const x = v.a[0];
    const y = h.a[1];
    if (x >= hx0 - 1e-9 && x <= hx1 + 1e-9 && y >= vy0 - 1e-9 && y <= vy1 + 1e-9) {
      points[i].push([x, y]);
      points[j].push([x, y]);
    }
  }
}
const edges: GraphEdge[] = [];
const E = (from: string, to: string, oneWay = false) => {
  const id = `e${edges.length}`;
  edges.push({ id, from, to, ...(oneWay ? { oneWay: true } : {}) });
  return id;
};
segs.forEach((s, i) => {
  const along = horizontal(s) ? 0 : 1;
  const pts = [...new Map(points[i].map((p) => [`${r2(p[0])},${r2(p[1])}`, p])).values()].sort((p, q) => p[along] - q[along]);
  for (let k = 0; k + 1 < pts.length; k++) E(nodeAt(...pts[k]), nodeAt(...pts[k + 1]));
});
// the doors: in through the entrance, out through the exit, never the other way
E(nodeAt(...ENTRANCE), nodeAt(1, Y_ENTRY), true);
E(nodeAt(X_FRONT, 64), nodeAt(0, 64), true);
// checkout lanes: from the west walkway, one-way west through the till to the front walkway
for (let k = 0; k < LANES; k++) {
  const y = r2(laneY(k));
  E(nodeAt(X_WEST, y), nodeAt(CHECKOUT_X, y), true);
  E(nodeAt(CHECKOUT_X, y), nodeAt(X_FRONT, y), true);
}
E(nodeAt(X_WEST, SCO_Y), nodeAt(CHECKOUT_X, SCO_Y), true);
E(nodeAt(CHECKOUT_X, SCO_Y), nodeAt(X_FRONT, SCO_Y), true);
// the lanes' points on the two walkways split those walkways too
const splitAt = (x: number, y: number) => {
  const id = nodeAt(x, y);
  const at = [...nodes.values()].find((n) => n.id === id)!;
  for (const e of [...edges]) {
    if (e.oneWay) continue;
    const a = [...nodes.values()].find((n) => n.id === e.from)!;
    const b = [...nodes.values()].find((n) => n.id === e.to)!;
    if (a.id === id || b.id === id) continue;
    const onV = a.x === b.x && a.x === at.x && at.y > Math.min(a.y, b.y) && at.y < Math.max(a.y, b.y);
    const onH = a.y === b.y && a.y === at.y && at.x > Math.min(a.x, b.x) && at.x < Math.max(a.x, b.x);
    if (onV || onH) {
      edges.splice(edges.indexOf(e), 1, { id: e.id, from: e.from, to: id }, { id: `e${edges.length + 1000}`, from: id, to: e.to });
      return;
    }
  }
};
for (let k = 0; k < LANES; k++) {
  splitAt(X_WEST, r2(laneY(k)));
  splitAt(X_FRONT, r2(laneY(k)));
}
splitAt(X_WEST, SCO_Y);
splitAt(X_FRONT, SCO_Y);
// renumber edges in order so ids are stable and dense
edges.forEach((e, i) => (e.id = `e${i}`));

const nodeById = new Map([...nodes.values()].map((n) => [n.id, n]));
/** the corridor edge a point lies on (along the given axis), and the offset from its `from` node */
function pin(x: number, y: number, axis: "h" | "v"): { edgeId: string; offsetM: number } {
  for (const e of edges) {
    if (e.oneWay) continue;
    const a = nodeById.get(e.from)!;
    const b = nodeById.get(e.to)!;
    if (axis === "h" && a.y === b.y && Math.abs(a.y - y) < 1e-6 && x >= Math.min(a.x, b.x) - 1e-6 && x <= Math.max(a.x, b.x) + 1e-6) return { edgeId: e.id, offsetM: r2(Math.abs(x - a.x)) };
    if (axis === "v" && a.x === b.x && Math.abs(a.x - x) < 1e-6 && y >= Math.min(a.y, b.y) - 1e-6 && y <= Math.max(a.y, b.y) + 1e-6) return { edgeId: e.id, offsetM: r2(Math.abs(y - a.y)) };
  }
  throw new Error(`no ${axis} corridor through (${x}, ${y})`);
}

// ----------------------------------------------------------------------------- fixtures
const fixtures: Fixture[] = [];
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [r2(x0), r2(y0)],
  [r2(x1), r2(y0)],
  [r2(x1), r2(y1)],
  [r2(x0), r2(y1)],
];
const F = (id: string, kind: Fixture["kind"], box: [number, number, number, number], department: string, extra: Partial<Fixture> = {}) =>
  fixtures.push({ id, kind, polygon: rect(...box), department, ...extra });

// centre runs: a run whose two faces belong to different departments is two half-depth blocks
const deptOfFace = (key: string) => FACES[key]?.department;
for (let k = 0; k <= 10; k++) {
  const [y0, y1] = runY(k);
  const north = k >= 1 ? `A${k}-R` : null; // the run's north face is aisle k's south side
  const south = k <= 9 ? `A${k + 1}-L` : null; // its south face is aisle k+1's north side
  const dn = north ? deptOfFace(north)! : deptOfFace(south!)!;
  const ds = south ? deptOfFace(south)! : dn;
  const an = north ? `A${k}` : `A${k + 1}`;
  const as = south ? `A${k + 1}` : `A${k}`;
  if (dn === ds) F(`f-run${k}`, "shelf", [RUN_X[0], y0, RUN_X[1], y1], dn, { aisle: as });
  else {
    const mid = (y0 + y1) / 2;
    F(`f-run${k}-n`, "shelf", [RUN_X[0], y0, RUN_X[1], mid], dn, { aisle: an });
    F(`f-run${k}-s`, "shelf", [RUN_X[0], mid, RUN_X[1], y1], ds, { aisle: as });
  }
  F(`f-run${k}-capW`, "shelf", [RUN_X[0] - CAP, y0, RUN_X[0], y1], ds, { bays: 1 });
  F(`f-run${k}-capE`, "shelf", [RUN_X[1], y0, RUN_X[1] + CAP, y1], ds, { bays: 1 });
}
// beer, wine & spirits: W0 is the cold-beer doors
for (let j = 0; j < 4; j++) {
  const [y0, y1] = wY(j);
  F(`f-bws${j}`, "shelf", [W_X[0], y0, W_X[1], y1], "alcohol", { aisle: `A${Math.min(13, 11 + j)}`, ...(j === 0 ? { fixtureKind: "coldcase" as FixtureKind } : {}) });
  F(`f-bws${j}-capW`, "shelf", [W_X[0] - CAP, y0, W_X[0], y1], "alcohol", { bays: 1 });
  F(`f-bws${j}-capE`, "shelf", [W_X[1], y0, W_X[1] + CAP, y1], "alcohol", { bays: 1 });
}
// the wine bar: a ring of bar counter around its service well
F("f-winebar-w", "counter", [55, 37, 55.8, 44], "winebar", { aisle: "WINEBAR", height: 1.1 });
F("f-winebar-n", "counter", [55.8, 37, 71, 37.8], "winebar", { height: 1.1 });
F("f-winebar-s", "counter", [55.8, 43.2, 71, 44], "winebar", { height: 1.1 });
F("f-winebar-e", "counter", [70.2, 37.8, 71, 43.2], "winebar", { height: 1.1 });
// produce: the wet wall along the north wall, two rows of four islands under the skylight
F("f-produce-wall", "wall", [13, 1, 48, 2.2], "produce", { aisle: "PRODUCE", fixtureKind: "gondola", height: 1.7, shelves: 4 });
ISLAND_ROWS.forEach(([y0, y1], row) => ISLAND_X.forEach(([x0, x1], i) => F(`f-island${row * 4 + i + 1}`, "shelf", [x0, y0, x1, y1], "produce", { fixtureKind: "produce" })));
// bulk: gravity bins on the wall, scoop bins on the island
F("f-bulk-wall", "wall", [50, 1, 68, 2.2], "bulk", { aisle: "BULK" });
F("f-bulk-island", "shelf", [50.5, 4.8, 67.5, 6.8], "bulk", { height: 1.5 });
// west column
F("f-floral", "shelf", [3, 1.6, 9.5, 4.4], "floral", { aisle: "FLORAL", height: 1.0 });
F("f-service", "counter", [3, 7.6, 9, 8.6], "service", { aisle: "SERVICE", height: 1.1 });
F("f-rx", "counter", [1, 13.4, 2.6, 16.8], "pharmacy", { aisle: "PHARMACY", height: 1.1 });
const westRuns: [string, number, string][] = [
  ["f-otc1", 16.3, "pharmacy"],
  ["f-otc2", 20.0, "pharmacy"],
  ["f-body1", 23.7, "bodycare"],
  ["f-body2", 27.4, "bodycare"],
];
for (const [id, y0, dept] of westRuns) F(id, "shelf", [OTC_X[0], y0, OTC_X[1], y0 + 1.1], dept, { aisle: dept === "pharmacy" ? "PHARMACY" : "BODYCARE", height: 1.6 });
for (let k = 0; k < LANES; k++) F(`f-lane${k + 1}`, "counter", [LANE_X[0], laneY(k) - 1.15, LANE_X[1], laneY(k) - 0.45], "checkout");
F("f-lane-end", "counter", [LANE_X[0], laneY(LANES - 1) + 0.45, LANE_X[1], laneY(LANES - 1) + 1.15], "checkout");
for (let i = 0; i < 6; i++) F(`f-self${i + 1}`, "selfcheckout", [3.3 + 1.1 * i, 47.6, 3.3 + 1.1 * i + 0.9, 48.4], "checkout", { height: 1.3 });
for (const [x0, y0] of [
  [4, 50.4],
  [7, 50.4],
  [4, 52.4],
  [7, 52.4],
  [4, 54.4],
  [7, 54.4],
] as [number, number][])
  F(`f-seat-w${x0}-${y0}`, "other", [x0, y0, x0 + 1.4, y0 + 1.2], "seating", { height: 0.75 });
// east wall: service counters and cases, open toward the store
F("f-seafood", "wall", [76, 12.5, 77.4, 21.5], "seafood", { aisle: "SEAFOOD" });
F("f-meat-counter", "wall", [76, 24.5, 77.4, 30], "meat", { aisle: "MEAT" });
F("f-meat-case", "wall", [76, 30.5, 77.2, 36.5], "meat", { fixtureKind: "coldcase" });
F("f-dairy", "wall", [76, 39.5, 77.2, 51.5], "dairy", { aisle: "DAIRY" });
F("f-cheese-counter", "wall", [76, 54.5, 77.4, 59], "cheese", { aisle: "CHEESE" });
F("f-cheese-case", "wall", [76, 59.5, 77.2, 65.5], "cheese", { fixtureKind: "coldcase" });
// frozen: double-sided reach-in doors, then a run of coffins by the food hall
FROZEN_SEGS.forEach(([x0, x1], i) => {
  F(`f-frozen-doors${i + 1}`, "shelf", [x0, 51, x1, 52.4], "frozen", { aisle: "FROZEN" });
  F(`f-frozen-coffin${i + 1}`, "shelf", [x0, 54.6, x1, 55.6], "frozen", { fixtureKind: "coffin" });
});
// south band: café, the food hall's islands and counters, the bakery
F("f-cafe", "wall", [13, 65.8, 20.5, 67], "cafe", { aisle: "CAFE" });
for (const [x0, y0] of [
  [13.5, 61.4],
  [16.5, 61.4],
  [55.2, 61.6],
  [57.9, 61.6],
] as [number, number][])
  F(`f-seat-${x0}-${y0}`, "other", [x0, y0, x0 + 1.6, y0 + 1.6], "seating", { height: 0.75 });
F("f-hotbar", "shelf", [23, 61.6, 33, 63.4], "hotbar", { aisle: "HOTBAR" });
F("f-saladbar", "shelf", [35, 61.6, 45, 63.4], "saladbar", { aisle: "SALADBAR" });
F("f-soups", "shelf", [47, 61.6, 53, 63.4], "soups", { aisle: "SOUPS" });
F("f-rotisserie", "wall", [23, 65.8, 29.5, 67], "rotisserie", { aisle: "ROTISSERIE" });
F("f-sushi", "wall", [30.5, 65.8, 37.5, 67], "sushi", { aisle: "SUSHI" });
F("f-pizza", "wall", [38.5, 65.8, 45, 67], "pizza", { aisle: "PIZZA" });
F("f-deli", "wall", [46, 65.8, 53, 67], "deli", { aisle: "DELI" });
F("f-bread", "shelf", [61.5, 61, 71.5, 62], "bakery", { aisle: "BAKERY", fixtureKind: "gondola", height: 1.6 });
F("f-bakery-case", "wall", [61.5, 65.8, 71.5, 67], "bakery", { aisle: "BAKERY" });

// ----------------------------------------------------------------------------- categories → locations
const reused = new Map<string, TaxCategory>();
for (const a of TAXONOMY) for (const cat of [...a.left, ...(a.right ?? [])]) reused.set(cat.id, cat);
const fresh = new Map(NEW_CATEGORIES.map((cat) => [cat.id, cat]));
for (const id of [...HEAVY, ...BULKY]) if (!fresh.has(id) && !reused.has(id)) throw new Error(`HEAVY / BULKY names an unknown category ${id}`);
const categoryDef = (id: string): TaxCategory => {
  const found = fresh.get(id) ?? reused.get(id);
  if (!found) throw new Error(`unknown category ${id}`);
  // heavy and bulky are Grosher's own (HEAVY, BULKY), never the demo taxonomy's
  const tags = [...(found.tags ?? []).filter((t) => !HANDLING_TAGS.includes(t)), ...(HEAVY.includes(id) ? (["heavy"] as const) : []), ...(BULKY.includes(id) ? (["bulky"] as const) : [])];
  const base: TaxCategory = { ...found, ...(tags.length || found.tags ? { tags } : {}) };
  const p = CATEGORY_PATCHES[id];
  if (!p) return base;
  const aliases = [...(base.aliases ?? []).filter((a) => !p.remove?.includes(a)), ...(p.add ?? []).filter((a) => !(base.aliases ?? []).includes(a))];
  return { ...base, name: p.name ?? base.name, aliases };
};

const locations: ShelfLocation[] = [];
const categories: Category[] = [];
let shelfSeq = 0;

/**
 * Lay one face's categories along a corridor in equal bay runs, bay 1 at the end nearer the entrance.
 * `spans` are the stretches of the corridor the face's fixture covers (two for a run with a break).
 */
function layFace(faceId: string, axis: "h" | "v", at: number, spans: [number, number][], side: ShelfLocation["side"] & string) {
  const face = FACES[faceId];
  if (!face) throw new Error(`no face ${faceId}`);
  const n = face.cats.length;
  const lens = spans.map(([a, b]) => b - a);
  const total = lens.reduce((s, l) => s + l, 0);
  const bays = Math.max(n, Math.round(total / BAY_M));
  const bayLen = total / bays;
  // which end faces the entrance
  const pt = (along: number): [number, number] => (axis === "h" ? [along, at] : [at, along]);
  const lo = spans[0][0];
  const hi = spans[spans.length - 1][1];
  const d = (p: [number, number]) => Math.hypot(p[0] - ENTRANCE[0], p[1] - ENTRANCE[1]);
  const fromLow = d(pt(lo)) <= d(pt(hi));
  /** corridor coordinate of the centre of fractional bay position `b` (0 = the entrance-facing end) */
  const coord = (b: number) => {
    let m = b * bayLen;
    const ordered = fromLow ? spans : [...spans].reverse();
    for (const [a, z] of ordered) {
      const len = z - a;
      if (m <= len + 1e-9) return fromLow ? a + m : z - m;
      m -= len;
    }
    return fromLow ? hi : lo;
  };
  let start = 1;
  face.cats.forEach((catId, k) => {
    const end = Math.max(start, Math.round(((k + 1) * bays) / n));
    const centre = coord((start - 1 + end) / 2);
    const def = categoryDef(catId);
    const [x, y] = pt(r2(centre));
    const where = pin(x, y, axis);
    const id = /^A\d+-[LR]$/.test(faceId) ? `${faceId}${start}` : `${faceId}-${start}`;
    locations.push({ id, aisle: face.aisle, side, edgeId: where.edgeId, offsetM: where.offsetM, shelf: 1 + (shelfSeq++ % 3), tags: (def.tags ?? []).slice() });
    categories.push({ id: def.id, name: def.name, group: face.sign, aisle: face.aisle, side, bays: [start, end], locationId: id, department: face.department, tags: def.tags, aliases: def.aliases });
    start = end + 1;
  });
}

// centre aisles: L is the north side, R the south side
const RUN_SPAN: [number, number][] = [[RUN_X[0] + 0.3, RUN_X[1] - 0.3]];
for (let k = 1; k <= 10; k++) {
  layFace(`A${k}-L`, "h", r2(aisleY(k)), RUN_SPAN, "L");
  layFace(`A${k}-R`, "h", r2(aisleY(k)), RUN_SPAN, "R");
}
const W_SPAN: [number, number][] = [[W_X[0] + 0.3, W_X[1] - 0.3]];
for (let j = 1; j <= 3; j++) {
  layFace(`A${10 + j}-L`, "h", r2(wAisleY(j)), W_SPAN, "L");
  layFace(`A${10 + j}-R`, "h", r2(wAisleY(j)), W_SPAN, "R");
}
layFace("WINEBAR", "v", X_CROSS, [[38.5, 42.5]], "R");
// produce
layFace("PRODUCE-WALL", "h", Y_WET, [[13.3, 47.7]], "L");
const islandFaces: [string, number, number][] = [
  // [face, island index, corridor]: north faces from the aisle above, south faces from the aisle below
  ["PRODUCE-I1N", 0, Y_WET],
  ["PRODUCE-I1S", 0, Y_ISLANDS],
  ["PRODUCE-I2N", 1, Y_WET],
  ["PRODUCE-I3N", 2, Y_WET],
  ["PRODUCE-I4N", 3, Y_WET],
  ["PRODUCE-I4S", 3, Y_ISLANDS],
  ["PRODUCE-I5N", 0, Y_ISLANDS],
  ["PRODUCE-I6N", 1, Y_ISLANDS],
  ["PRODUCE-I7N", 2, Y_ISLANDS],
  ["PRODUCE-I8N", 3, Y_ISLANDS],
];
for (const [face, i, y] of islandFaces) {
  const [x0, x1] = ISLAND_X[i];
  const southFace = face.endsWith("S");
  layFace(face, "h", y, [[x0 + 0.3, x1 - 0.3]], southFace ? "L" : "R");
}
layFace("BULK-WALL", "h", Y_WET, [[50.3, 67.7]], "L");
layFace("BULK-ISLAND-N", "h", Y_WET, [[50.8, 67.2]], "R");
layFace("BULK-ISLAND-S", "h", Y_ISLANDS, [[50.8, 67.2]], "L");
// west column
layFace("FLORAL", "h", Y_ENTRY, [[3.3, 9.2]], "L");
layFace("SERVICE", "h", Y_ENTRY, [[3.3, 8.7]], "R");
{
  // the Rx counter at the end of the first spur
  const def = categoryDef("pharmacy-counter");
  const where = pin(3.6, SPURS[0], "h");
  locations.push({ id: "RX-1", aisle: "PHARMACY", side: "E", edgeId: where.edgeId, offsetM: where.offsetM, shelf: 1, tags: [] });
  categories.push({ id: def.id, name: def.name, group: FACES.RX.sign, aisle: "PHARMACY", side: "E", bays: [1, 1], locationId: "RX-1", department: "pharmacy", tags: def.tags, aliases: def.aliases });
}
const OTC_SPAN: [number, number][] = [[OTC_X[0] + 0.3, OTC_X[1] - 0.3]];
layFace("OTC1-N", "h", SPURS[0], OTC_SPAN, "R");
layFace("OTC1-S", "h", SPURS[1], OTC_SPAN, "L");
layFace("OTC2-N", "h", SPURS[1], OTC_SPAN, "R");
layFace("OTC2-S", "h", SPURS[2], OTC_SPAN, "L");
layFace("BODY1-N", "h", SPURS[2], OTC_SPAN, "R");
layFace("BODY1-S", "h", SPURS[3], OTC_SPAN, "L");
layFace("BODY2-N", "h", SPURS[3], OTC_SPAN, "R");
layFace("BODY2-S", "h", SPURS[4], OTC_SPAN, "L");
// east wall (fixtures east of the walkway: side R)
layFace("SEAFOOD", "v", X_EAST, [[14.2, 21.2]], "R");
layFace("MEAT-COUNTER", "v", X_EAST, [[24.8, 29.7]], "R");
layFace("MEAT-CASE", "v", X_EAST, [[30.8, 36.2]], "R");
layFace("DAIRY", "v", X_EAST, [[39.8, 51.2]], "R");
layFace("CHEESE-COUNTER", "v", X_EAST, [[54.8, 58.7]], "R");
layFace("CHEESE-CASE", "v", X_EAST, [[59.8, 64.4]], "R");
// frozen
const FROZEN_SPANS: [number, number][] = FROZEN_SEGS.map(([a, b]) => [a + 0.3, b - 0.3]);
layFace("FROZEN-A-N", "h", Y_FROZEN, FROZEN_SPANS, "R");
layFace("FROZEN-A-S", "h", Y_FROZEN_AISLE, FROZEN_SPANS, "L");
layFace("FROZEN-B-N", "h", Y_FROZEN_AISLE, FROZEN_SPANS, "R");
layFace("FROZEN-B-S", "h", Y_FOODHALL, FROZEN_SPANS, "L");
// south band (counters south of the aisle: R; islands north of it: L)
layFace("CAFE", "h", Y_SOUTH, [[13.3, 20.2]], "R");
layFace("HOTBAR", "h", Y_SOUTH, [[23.3, 32.7]], "L");
layFace("SALADBAR", "h", Y_SOUTH, [[35.3, 44.7]], "L");
layFace("SOUPS", "h", Y_SOUTH, [[47.3, 52.7]], "L");
layFace("ROTISSERIE", "h", Y_SOUTH, [[23.3, 29.2]], "R");
layFace("SUSHI", "h", Y_SOUTH, [[30.8, 37.2]], "R");
layFace("PIZZA", "h", Y_SOUTH, [[38.8, 44.7]], "R");
layFace("DELI", "h", Y_SOUTH, [[46.3, 52.7]], "R");
layFace("BREAD-N", "h", Y_FOODHALL, [[61.8, 71.2]], "R");
layFace("BREAD-S", "h", Y_SOUTH, [[61.8, 71.2]], "L");
layFace("BAKERY-CASE", "h", Y_SOUTH, [[61.8, 71.2]], "R");

// every face laid, every reused category placed exactly once
for (const key of Object.keys(FACES)) if (key !== "RX" && !categories.some((cat) => cat.group === FACES[key].sign && FACES[key].cats.includes(cat.id))) throw new Error(`face ${key} was never laid out`);
const placedIds = categories.map((cat) => cat.id);
const dup = placedIds.find((id, i) => placedIds.indexOf(id) !== i);
if (dup) throw new Error(`category ${dup} placed twice`);
const missing = [...reused.keys()].filter((id) => !placedIds.includes(id));
if (missing.length) throw new Error(`reused categories with no Grosher shelf: ${missing.join(", ")}`);

// ----------------------------------------------------------------------------- the store
const outline: [number, number][] = [
  [0, 0],
  [75, 0],
  [85, 10],
  [85, 70],
  [0, 70],
];
const store: StoreGraph = {
  storeId: "grosher",
  version: 1,
  name: "Grosher",
  address: "Demo market",
  nodes: [...nodes.values()],
  edges,
  locations,
  entranceId: "ENTRANCE",
  checkoutIds,
  exitId: "EXIT",
  fixtures,
  departments: GROSHER_DEPARTMENTS,
  outline,
  skylights: [{ id: "produce-skylight", polygon: rect(14, 3, 46, 13), height: 6.5 }],
};

// ----------------------------------------------------------------------------- catalog: base rows and the carry-over
const demoDir = join(import.meta.dirname, "..", "demo");
const demoCats = JSON.parse(readFileSync(join(demoDir, "categories.json"), "utf8")) as Category[];
const demoCatOfLoc = new Map(demoCats.map((cat) => [cat.locationId, cat.id]));
const catById = new Map(categories.map((cat) => [cat.id, cat]));
const demoBase = JSON.parse(readFileSync(join(demoDir, "catalog.base.json"), "utf8")) as Stop[];
const own: Stop[] = GROSHER_ITEMS.map(({ categories: cats, ...s }) => {
  for (const id of cats) if (!catById.get(id)) throw new Error(`Grosher item ${s.id}: unknown category ${id}`);
  const tags = handlingTags(s.tags, catById.get(cats[0]), s.name);
  return { ...s, ...(tags.length ? { tags } : { tags: undefined }), locationIds: cats.map((id) => catById.get(id)!.locationId) };
}).map((s) => JSON.parse(JSON.stringify(s)) as Stop);
// the demo's 30 base rows keep their ids (the tests and the bench use them); their shelves move to Grosher's,
// and their heavy / bulky become the shelf's
const carriedBase: Stop[] = demoBase.map((s) => {
  const cat = catById.get(demoCatOfLoc.get(s.locationIds[0])!);
  return { ...s, tags: handlingTags(s.tags, cat, s.name), locationIds: s.locationIds.map((l) => catById.get(demoCatOfLoc.get(l)!)!.locationId) };
});
const base = [...own, ...carriedBase];

// the re-homing table over the full carried catalog: item id → {from category: to category}
const demoCatalog = JSON.parse(readFileSync(join(demoDir, "catalog.json"), "utf8")) as { items: Stop[] };
const rehome: Record<string, Record<string, string>> = {};
const moved: Record<string, number> = {};
for (const s of demoCatalog.items) {
  for (const l of s.locationIds) {
    const from = demoCatOfLoc.get(l);
    if (!from) continue;
    const rule = REHOME.find((r) => r.from.includes(from) && r.match.test(s.name) && !r.not?.test(s.name));
    if (!rule) continue;
    (rehome[s.id] ??= {})[from] = rule.to;
    moved[`${from} → ${rule.to}`] = (moved[`${from} → ${rule.to}`] ?? 0) + 1;
  }
}

// ----------------------------------------------------------------------------- placeholder finishes
function finishTexture(kind: "wood" | "stainless", seed: number): Buffer {
  const SIZE = 512;
  let s = seed;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const data = Buffer.alloc(SIZE * SIZE * 4);
  // wood: warm grain running along u, with slow rings; stainless: a fine brushed streak along u
  const rows = Array.from({ length: SIZE }, () => rand());
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      let rgb: [number, number, number];
      if (kind === "wood") {
        // light oak: honey ground, soft rings, fine grain
        const ring = Math.sin((y / SIZE) * Math.PI * 18 + Math.sin((x / SIZE) * Math.PI * 2) * 1.6) * 8;
        const grain = (rows[y] - 0.5) * 16 + (rand() - 0.5) * 6;
        const l = ring + grain;
        rgb = [236 + l, 198 + l * 0.85, 150 + l * 0.7];
      } else {
        const streak = (rows[y] - 0.5) * 16 + (rand() - 0.5) * 6;
        rgb = [226 + streak, 228 + streak, 224 + streak];
      }
      data[i] = Math.max(0, Math.min(255, Math.round(rgb[0])));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(rgb[1])));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(rgb[2])));
      data[i + 3] = 255;
    }
  }
  return Buffer.from(encode({ data, width: SIZE, height: SIZE }, 80).data);
}

// ----------------------------------------------------------------------------- write
const out = join(import.meta.dirname, "..", "grosher");
mkdirSync(join(out, "textures"), { recursive: true });
writeFileSync(join(out, "store.json"), JSON.stringify(store, null, 2) + "\n");
writeFileSync(join(out, "categories.json"), JSON.stringify(categories, null, 2) + "\n");
writeFileSync(join(out, "catalog.base.json"), JSON.stringify(base, null, 2) + "\n");
writeFileSync(join(out, "rehome.json"), JSON.stringify({ note: "carried catalog rows whose Walmart shelf Grosher has a better one for: item id → {demo category: Grosher category} (scripts/grosher-taxonomy.ts REHOME)", moved, items: rehome }, null, 1) + "\n");
writeFileSync(join(out, "lists.json"), JSON.stringify(HERO_LISTS, null, 2) + "\n");
writeFileSync(join(out, "textures", "wood.jpg"), finishTexture("wood", 7));
writeFileSync(join(out, "textures", "stainless.jpg"), finishTexture("stainless", 11));
const finishes = { wood: { file: "wood.jpg", w: 512, h: 512, shotAt: null, repeatMeters: 2 }, stainless: { file: "stainless.jpg", w: 512, h: 512, shotAt: null, repeatMeters: 2 } };
writeFileSync(join(out, "textures", "textures.json"), JSON.stringify(finishes, null, 2) + "\n");
console.log(
  `wrote ${out}: ${store.nodes.length} nodes, ${store.edges.length} edges, ${locations.length} locations, ${fixtures.length} fixtures, ${categories.length} categories (${NEW_CATEGORIES.length} new), ${base.length} base rows, ${Object.keys(rehome).length} re-homed rows`,
);
for (const [k, v] of Object.entries(moved).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
