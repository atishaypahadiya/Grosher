// A standard close-up: any stop outside a hero zone, generated from the store data with the shelf kit. The
// stop's fixture face is rebuilt at eye-level detail for its whole length (packs in detail within a few
// metres of the slot, plain printed boxes beyond), and so is the face across the corridor; the rest of the
// store stays the overview's, dimmed into the close-up's warm dark. One generic build per fixture type:
//
//   gondola    black square-steel shelving with pine planks, a pine back, a header board per sign with the
//              aisle's name (centre aisles 1–10, the beer, wine and spirits aisles, pharmacy, body care, bread)
//   chiller    an open multi-deck case: a dark interior, stainless shelves, a lit canopy (dairy, meat, cheese)
//   doors      the same case behind reach-in glass doors with lit mullions (frozen, cold beer)
//   coffin     an open chest freezer under sliding glass lids, the packs lying in its well
//   service    a service counter: a base, a lit deck of trays behind curved glass, the staff side and a back
//              wall with the counter's sign (seafood, butcher, cheese, rotisserie, sushi, pizza, deli, bakery)
//   bar        the food hall's islands: steel wells of food under a sneeze guard (hot bar, salad bar, soups)
//   produce    tilted crates on black stands (the islands, floral) or a stepped rack (the produce wall)
//   counter    a pine counter and a stocked back wall (customer service, pharmacy pickup, café, wine bar)
//
// Every build is made in its face's own frame (the face on z = 0 looking +z, along x, the floor y = 0) and
// moved into the store, so faces in any of the four directions come out the same. Light is the shelf kit's
// (per pixel, analytic plank shadows) with a fixed number of lights and slabs, so every standard zone shares
// one set of shader programs: the second close-up of a trip compiles nothing. Pure geometry; StandardZone.tsx
// makes the meshes.

import { type BufferGeometry, Matrix4, PlaneGeometry, Shape, ShapeGeometry, Vector3, type BufferAttribute } from "three";
import type { StoreGraph } from "@grosher/core";
import { BAY_M, COFFIN_DECK_M, SERVICE_DECK_M, slotFor, shelfHeight } from "@grosher/stores";
import { colorize, constant, hex, type Occlusion } from "../kit/bake.ts";
import { Batch, beam, clean, gridPlane, place, rng, tiledBox, type V3 } from "../kit/geom.ts";
import { grainMound, headerBoard, produceStand, shelving, track, type MaterialKey, type Piece } from "../kit/pieces.ts";
import { packBox, STANDARD_TEMPLATES, type ProductPart, type StandardStyle, type Template } from "../kit/products.ts";
import { scaled, WARM_3000K, type LightRig, type ZoneLightDef } from "../kit/light.ts";
import type { Decal } from "../kit/decals.ts";
import type { KitMaterialKey } from "../kit/materials.ts";
import { shapeIndex } from "../bulk/recipe.ts";
import type { CategoryRow } from "../index.ts";
import { standOff, type FaceFrame, type StandardPlan, type V2 } from "./plan.ts";
import { BAND, catCell, looseOf, signCell, signKey, signKeys, styleOf, VARIANTS } from "./styles.ts";

/** every standard zone has exactly these many lights and slabs: one program set for all of them */
export const STD_LIGHTS = 10;
export const STD_SLABS = 12;
const PLANK = 0.03;
/** within this many metres of the slot (along the face) the packs are modelled; beyond, printed boxes */
export const DETAIL_M = 4.5;
/** the modelled packs' share of the budget: ~120k triangles over five shelves on two faces, so a kind's window
 * is this over its triangles per metre of shelf (bottles and jars get a narrower one) */
const DETAIL_TRIS = 4000;
/** the shelving itself is modelled (rounded planks, rails at every bay) this far either side of the slot */
const FRAME_M = 6;
const trisOf = (t: Template) => (["label", "glass", "grain", "lid", "metal", "terracotta"] as ProductPart[]).reduce((n, p) => n + (t[p] ? t[p]!.getAttribute("position").count / 3 : 0), 0);
const halfWindow = new Map<StandardStyle, number>();
/** how far either side of the slot this kind of pack is modelled */
export const detailOf = (style: StandardStyle) => {
  let h = halfWindow.get(style);
  if (h === undefined) {
    const t = tpl(style);
    const perM = trisOf(t) / (t.size[0] + 0.012);
    halfWindow.set(style, (h = Math.max(1.4, Math.min(DETAIL_M, DETAIL_TRIS / perM))));
  }
  return h;
};
const LIGHT_Y = 4.2;

export type BuildKind = "gondola" | "chiller" | "doors" | "coffin" | "service" | "bar" | "produce" | "producewall" | "counter";

/** The plain parts merged into the white "steel" mesh, each with its own colour (as in the Bulk zone). */
const SOLID: Partial<Record<MaterialKey, V3>> = { steel: hex("#262422"), copper: hex("#C27A4A"), paint: hex("#CFC7BA"), lid: [1, 1, 1], metal: [1, 1, 1] };
const STAINLESS = hex("#B9B6AE");
const INTERIOR = hex("#2C2A28");

export interface CategoryRun {
  id: string;
  /** index into the store's categories: its cell in the categories atlas */
  index: number;
  department: string;
  aisle: string;
  group: string;
  style: StandardStyle;
  /** along the face, metres from the face's centre (face-frame along, not local x) */
  from: number;
  to: number;
}

type Category = CategoryRow;

/** Every fixture face's categories as runs along it, from their bays (shifted onto their own slot's bay). */
const FACES = new WeakMap<object, Map<string, CategoryRun[]>>();
export function faceCategories(store: StoreGraph, categories: Category[]): Map<string, CategoryRun[]> {
  let out = FACES.get(categories);
  if (out) return out;
  out = new Map();
  categories.forEach((c, index) => {
    const loc = store.locations.find((l) => l.id === c.locationId);
    const s = loc && slotFor(store, loc);
    if (!s) return;
    const bayLen = s.params.length / s.params.bays;
    let [b0, b1] = c.bays ?? [s.bay, s.bay];
    if (s.bay < b0) [b0, b1] = [s.bay, s.bay + (b1 - b0)];
    if (s.bay > b1) [b0, b1] = [s.bay - (b1 - b0), s.bay];
    b0 = Math.max(1, b0);
    b1 = Math.min(s.params.bays, b1);
    const L = s.params.length;
    // bay k from the front end, as an along range from the fixture's centre (slots.ts)
    const range = (k: number): [number, number] => (s.frontSign === 1 ? [L / 2 - k * bayLen, L / 2 - (k - 1) * bayLen] : [-L / 2 + (k - 1) * bayLen, -L / 2 + k * bayLen]);
    const a = range(b0);
    const b = range(b1);
    const key = `${s.fixture.id}:${s.face}`;
    const list = out!.get(key) ?? [];
    list.push({ id: c.id, index, department: c.department, aisle: c.aisle, group: c.group, style: styleOf(c.id, c.department), from: Math.min(a[0], b[0]), to: Math.max(a[1], b[1]) });
    out!.set(key, list);
  });
  FACES.set(categories, out);
  return out;
}

export function buildKind(face: FaceFrame): BuildKind {
  const d = face.department;
  if (d === "produce" || d === "floral") return face.fixtureKind === "wall" ? "producewall" : "produce";
  if (face.kind === "coffin") return "coffin";
  if (face.kind === "coldcase") return d === "frozen" || d === "alcohol" ? "doors" : "chiller";
  if (face.kind === "servicecase") return face.fixtureKind === "wall" ? "service" : "bar";
  if (face.fixtureKind === "counter" || face.kind === "counter") return "counter";
  return "gondola";
}

/** shelf depth behind a face: a deep double gondola splits at its spine; a thin half is one face's own */
const shelfDepth = (face: FaceFrame) => (face.fixtureKind === "wall" || face.params.width < 0.9 ? Math.min(face.params.width, 1.2) : face.params.width / 2);

/** The shelf levels (the top of each plank) of a face, as the store data has them (slots.ts shelfHeight). */
function tiersOf(face: FaceFrame): number[] {
  return Array.from({ length: Math.max(1, face.shelves) }, (_, s) => shelfHeight(face.params, s));
}

export interface StandardTarget {
  /** the lit slot's centre and size (along, up, depth), and its turn about y (world) */
  center: V3;
  size: V3;
  rotY: number;
  /** out of the face toward the shopper, and along it (world x, z) */
  out: [number, number];
  axis: [number, number];
  /** along `axis`: where an eye-level camera may pan */
  bounds: { x0: number; x1: number };
  door: V3;
  via: V3[];
  /** metres from the slot's centre to the shopper */
  stand: number;
  /** metres along `axis` the shopper stands to the side, looking back at the slot */
  side: number;
}

export interface StandardBuild {
  statics: Map<KitMaterialKey, BufferGeometry>;
  decals: Decal[];
  rig: LightRig;
  target: StandardTarget;
  kind: BuildKind;
  triangles: number;
}

/** face frame → world: local (x, y, z) is the face's along × up × out */
function frameMatrix(face: FaceFrame): { m: Matrix4; theta: number; sgn: 1 | -1; tw: V2 } {
  const theta = Math.atan2(face.n[0], face.n[1]);
  const tw: V2 = [face.n[1], -face.n[0]];
  const sgn = face.t[0] * tw[0] + face.t[1] * tw[1] >= 0 ? 1 : -1;
  const m = new Matrix4().makeTranslation(face.origin[0], 0, face.origin[1]).multiply(new Matrix4().makeRotationY(theta));
  return { m, theta, sgn, tw };
}

/** one face built in its own frame: its pieces, decals and lights, local coordinates */
interface FaceOut {
  pieces: Piece[];
  decals: Decal[];
  slabs: { x0: number; x1: number; z0: number; z1: number; y: number }[];
  /** the lit box of a slot at local x, shelf s */
  slotBox: (x: number, shelf: number) => { y0: number; y1: number; z0: number; z1: number; w: number };
}

interface FaceInput {
  face: FaceFrame;
  runs: CategoryRun[];
  categoriesCount: number;
  signs: string[];
  /** local x of the window's centre (the slot, or its projection on the face across) */
  winC: number;
  seed: number;
  /** the stop's category and half its slot's width: what fills the slot */
  target?: { id: string; half: number };
}

const templates = new Map<StandardStyle, Template>();
const tpl = (s: StandardStyle) => {
  let t = templates.get(s);
  if (!t) templates.set(s, (t = STANDARD_TEMPLATES[s]()));
  return t;
};
const proxies = new Map<StandardStyle, Template>();
/** the far packs: a printed box the size of the pack's front */
const proxy = (s: StandardStyle) => {
  let t = proxies.get(s);
  if (!t) {
    const [w, h, d] = tpl(s).size;
    proxies.set(s, (t = packBox(w, h, Math.min(d, 0.12))));
  }
  return t;
};

const partKey: Record<ProductPart, MaterialKey> = { label: "label", glass: "glass", grain: "grain", lid: "lid", metal: "metal", terracotta: "plaster" };
const LIDS: V3[] = [hex("#8C6A48"), hex("#C9A24A"), hex("#2A2622"), hex("#EDE7DA"), hex("#9E3A2A"), hex("#3A5A7A")];

function buildFace(inp: FaceInput, kind: BuildKind): FaceOut {
  const { face, runs, winC } = inp;
  const { sgn } = frameMatrix(face);
  const rand = rng(inp.seed);
  const pieces: Piece[] = [];
  const decals: Decal[] = [];
  const slabs: FaceOut["slabs"] = [];
  const L = face.length;
  const x0 = -L / 2;
  const x1 = L / 2;
  const depth = shelfDepth(face);
  const H = face.height;
  // runs in local x, sorted; every x on the face belongs to the nearest run
  const local = runs.map((r) => ({ ...r, a: Math.min(r.from * sgn, r.to * sgn), b: Math.max(r.from * sgn, r.to * sgn) })).sort((p, q) => p.a - q.a);
  // the stop's own category fills its slot's bay; elsewhere the run that holds x (overlapping runs split at
  // the middle: the one whose centre is nearer), else the nearest
  const own = inp.target ? local.find((r) => r.id === inp.target!.id) : undefined;
  const runAt = (x: number) => {
    if (own && Math.abs(x - winC) <= inp.target!.half) return own;
    let best = local[0];
    let bd = Infinity;
    for (const r of local) {
      const d = x < r.a ? r.a - x : x > r.b ? x - r.b : 0;
      const k = d * 100 + Math.abs(x - (r.a + r.b) / 2);
      if (k < bd) {
        bd = k;
        best = r;
      }
    }
    return best;
  };
  const cellOf = (r: CategoryRun) => catCell(r.index, inp.categoriesCount);

  /** packs in a row along x on a level, fronts at z = zf facing +z, no taller than maxH */
  const row = (y: number, zf: number, maxH: number, xa = x0 + 0.04, xb = x1 - 0.04, opts: { lie?: boolean; tilt?: number; stack?: boolean; styleFor?: (r: CategoryRun) => StandardStyle } = {}) => {
    let x = xa + rand() * 0.02;
    // blocks of 2–5 facings of one product, then the next product of the range
    let block = 0;
    let variant = VARIANTS[0];
    let lastRun = "";
    for (let guard = 0; x < xb && guard < 4000; guard++) {
      const r = runAt(x);
      if (!r) return;
      if (block <= 0 || r.id !== lastRun) {
        block = 2 + Math.floor(rand() * 4);
        variant = VARIANTS[Math.floor(rand() * VARIANTS.length)];
        lastRun = r.id;
      }
      block--;
      const style = opts.styleFor?.(r) ?? r.style;
      const near = Math.abs(x - winC) < detailOf(style);
      const t = near ? tpl(style) : proxy(style);
      let [w, h, d] = t.size;
      if (opts.lie) [h, d] = [d, h];
      const k = Math.min(1, maxH / (h * variant.size[1]));
      const sx = variant.size[0] * k;
      const sy = variant.size[1] * k;
      w *= sx;
      if (x + w > xb) break;
      if (near && rand() < 0.04) {
        x += w * 0.9; // one just taken
        continue;
      }
      const yaw = near ? (rand() - 0.5) * 0.06 : 0;
      const at: V3 = [x + w / 2, y, zf - (d * k) / 2 - (near ? rand() * 0.015 : 0)];
      const stack = opts.stack && h * sy * 2.1 < maxH ? Math.min(3, Math.floor(maxH / (h * sy * 1.05))) : 1;
      const m = new Matrix4().makeTranslation(at[0], at[1], at[2]);
      if (opts.lie) m.multiply(new Matrix4().makeRotationX(-Math.PI / 2 + (opts.tilt ?? 0))).multiply(new Matrix4().makeTranslation(0, 0, -t.size[2] / 2));
      else if (opts.tilt) m.multiply(new Matrix4().makeRotationX(opts.tilt));
      m.multiply(new Matrix4().makeRotationY(yaw)).multiply(new Matrix4().makeScale(sx, sy, k));
      const lid = LIDS[Math.floor(rand() * LIDS.length)];
      const band = hex(BAND[r.department] ?? "#8A7A6A");
      for (let level = 0; level < stack; level++)
      for (const part of Object.keys(partKey) as ProductPart[]) {
        const g = t[part];
        if (!g) continue;
        const geo = g.clone().applyMatrix4(level ? new Matrix4().makeTranslation(0, h * sy * level * 1.02, 0).multiply(m) : m);
        const tint: V3 = part === "label" ? variant.tint : part === "lid" ? lid : part === "metal" ? (style === "wine" ? hex(rand() < 0.5 ? "#2E3A22" : "#4A1E22") : hex("#B8B4AC")) : part === "grain" ? [0.4 + band[0] * 0.6, 0.4 + band[1] * 0.6, 0.4 + band[2] * 0.6] : [1, 1, 1];
        pieces.push({ key: partKey[part], geo, tint, cell: part === "label" ? cellOf(r) : undefined, grain: part === "grain" ? [shapeIndex("powder"), 0.12] : undefined });
      }
      x += w + (near ? 0.006 + rand() * 0.012 : 0.01);
    }
  };

  /** loose goods (produce, a counter's trays): a mound of the run's goods on a w × d patch at (x, y, z) */
  const mound = (x: number, y: number, z: number, w: number, d: number, r: CategoryRun, tip = 0, peak = 0.07) => {
    const l = looseOf(r.id);
    const g = grainMound({ w, d, peak, seg: 4, lump: 0.012, seed: Math.floor(rand() * 1000) });
    place(g, { pos: [0, 0, 0] });
    g.applyMatrix4(new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeRotationX(tip)));
    const tint = hex(l.tints[Math.floor(rand() * l.tints.length)]);
    pieces.push({ key: "grain", geo: g, tint, grain: [shapeIndex(l.shape), l.cellM] });
  };

  /** header boards: one per sign every 7.2 m along its run, so one is always near the slot */
  const headers = (y: number, z: number, faceUp = 0.28) => {
    const groups = new Map<string, { a: number; b: number; key: string }>();
    for (const r of local) {
      const k = signKey(r);
      const g = groups.get(k) ?? { a: r.a, b: r.b, key: k };
      g.a = Math.min(g.a, r.a);
      g.b = Math.max(g.b, r.b);
      groups.set(k, g);
    }
    for (const g of groups.values()) {
      const i = inp.signs.indexOf(g.key);
      if (i < 0) continue;
      const c = signCell(i);
      const len = g.b - g.a;
      const n = Math.max(1, Math.round(len / 7.2));
      for (let k = 0; k < n; k++) {
        const cx = g.a + (len * (k + 0.5)) / n;
        const w = Math.min(3.2, len - 0.1);
        pieces.push(...headerBoard({ x0: cx - w / 2, x1: cx + w / 2, y0: y, y1: y + (w / 8) * 1, z, rect: [c[0], c[1], c[0] + c[2], c[1] + c[3]], tilt: faceUp }));
      }
    }
  };

  const occ: Occlusion = (p, n) => {
    let o = 1;
    if (p.z < 0.02 && p.z > -depth - 0.05 && p.y < H) {
      o *= 0.68 + 0.32 * Math.min(1, Math.max(0, (p.z + depth) / depth));
      if (n.y < -0.5) o *= 0.85;
    }
    return o;
  };

  let slotBox: FaceOut["slotBox"];
  const tiers = tiersOf(face);
  const top = (s: number) => (s + 1 < tiers.length ? tiers[s + 1] : H) - 0.02;

  switch (kind) {
    case "gondola": {
      const bays = Math.max(1, Math.round(L / BAY_M));
      const bay = L / bays;
      // the bays near the slot in full; beyond, plain planks and uprights (a long run is 35 m)
      const b0 = Math.max(0, Math.floor((winC - FRAME_M - x0) / bay));
      const b1 = Math.min(bays, Math.ceil((winC + FRAME_M - x0) / bay));
      if (b1 > b0) pieces.push(...shelving({ x0: x0 + b0 * bay, x1: x0 + b1 * bay, zBack: -depth, zFront: 0, bays: b1 - b0, tiers, top: H, plank: PLANK }));
      for (const [a, b] of [
        [x0, x0 + b0 * bay],
        [x0 + b1 * bay, x1],
      ]) {
        if (b - a < 0.05) continue;
        const cx = (a + b) / 2;
        for (const y of tiers) pieces.push({ key: "pine", geo: place(tiledBox(b - a, PLANK, depth - 0.02, 1.1), { pos: [cx, y + PLANK / 2, -depth / 2] }) });
        pieces.push({ key: "steel", geo: place(tiledBox(b - a, 0.03, 0.03, 1), { pos: [cx, H - 0.03, -0.02] }) });
        for (let x = a; x <= b + 1e-6; x += bay) pieces.push({ key: "steel", geo: place(tiledBox(0.04, H + 0.42, 0.04, 0.5), { pos: [x, (H + 0.42) / 2, -0.02] }) });
      }
      const back = clean(new PlaneGeometry(L, H, Math.max(1, Math.ceil(L / 4)), Math.round(H / 0.12)));
      pieces.push({ key: "pine", geo: place(back, { pos: [0, H / 2, -depth + 0.01] }), tint: [0.62, 0.55, 0.48] });
      pieces.push({ key: "steel", geo: place(tiledBox(L, tiers[0], 0.02, 1), { pos: [0, tiers[0] / 2, -0.01] }) });
      tiers.forEach((y, s) => {
        row(y + PLANK, -0.015, top(s) - y - PLANK - 0.02);
        slabs.push({ x0: x0 + 0.02, x1: x1 - 0.02, z0: -depth, z1: -0.004, y: y + PLANK / 2 });
      });
      headers(H + 0.14, 0.04);
      decals.push({ pos: [0, 0.004, 0.12], size: [L + 0.2, 0.3], shade: 0.45 });
      slotBox = (_x, s) => ({ y0: tiers[s] + PLANK, y1: top(s), z0: -Math.min(depth, 0.42), z1: 0.01, w: 1 });
      break;
    }
    case "chiller":
    case "doors": {
      // the case: a dark interior, a black base with its grille, the canopy with its light, stainless ends
      const base = tiers[0];
      pieces.push({ key: "steel", geo: place(tiledBox(L, base, depth, 1), { pos: [0, base / 2, -depth / 2] }) });
      const back = clean(new PlaneGeometry(L, H, Math.max(1, Math.ceil(L / 4)), Math.round(H / 0.12)));
      pieces.push({ key: "paint", geo: place(back, { pos: [0, H / 2, -depth + 0.01] }), tint: INTERIOR });
      pieces.push({ key: "paint", geo: place(tiledBox(L, 0.3, depth + 0.12, 1), { pos: [0, H + 0.15, -depth / 2 + 0.06] }), tint: STAINLESS });
      const strip = gridPlane(L, 0.05, 1, 1);
      strip.rotateX(Math.PI / 2);
      pieces.push({ key: "glow", geo: place(strip, { pos: [0, H - 0.002, 0.03] }), tint: [1, 0.96, 0.88] });
      for (const ex of [x0, x1]) pieces.push({ key: "paint", geo: place(tiledBox(0.04, H + 0.3, depth + 0.12, 1), { pos: [ex, (H + 0.3) / 2, -depth / 2 + 0.06] }), tint: STAINLESS });
      tiers.forEach((y, s) => {
        if (s > 0) {
          pieces.push({ key: "paint", geo: place(tiledBox(L, 0.012, depth - 0.06, 1), { pos: [0, y + 0.006, -depth / 2 - 0.02] }), tint: STAINLESS });
          // the price rail along its front edge
          pieces.push({ key: "steel", geo: place(tiledBox(L, 0.04, 0.012, 1), { pos: [0, y - 0.01, -0.05] }) });
          slabs.push({ x0: x0, x1: x1, z0: -depth, z1: -0.05, y: y + 0.006 });
        }
        // flat packs (meat trays, eggs, frozen boxes) stack two or three high
        row(y + 0.012, -0.06, top(s) - y - 0.04, x0 + 0.04, x1 - 0.04, { stack: true });
      });
      if (kind === "doors") {
        const door = 0.76;
        const n = Math.max(1, Math.round(L / door));
        const dw = L / n;
        for (let i = 0; i <= n; i++) {
          const x = x0 + i * dw;
          pieces.push({ key: "steel", geo: place(tiledBox(0.06, H - base + 0.02, 0.05, 1), { pos: [x, (H + base) / 2, 0.02] }) });
          // a light down each mullion's inside
          const led = gridPlane(0.018, H - base - 0.1, 1, 1);
          pieces.push({ key: "glow", geo: place(led, { pos: [x, (H + base) / 2, -0.006] }), tint: [1, 0.97, 0.9] });
        }
        for (let i = 0; i < n; i++) {
          const cx = x0 + (i + 0.5) * dw;
          const pane = gridPlane(dw - 0.06, H - base - 0.04, 1, 1);
          pieces.push({ key: "glass", geo: place(pane, { pos: [cx, (H + base) / 2, 0.035] }) });
          // the handle, at the door's opening edge
          const hx = cx + (i % 2 === 0 ? 1 : -1) * (dw / 2 - 0.09);
          pieces.push({ key: "steel", geo: place(tiledBox(0.018, 0.46, 0.022, 1), { pos: [hx, base + (H - base) * 0.52, 0.07] }) });
        }
        pieces.push({ key: "steel", geo: place(tiledBox(L, 0.06, 0.06, 1), { pos: [0, H + 0.01, 0.02] }) });
        pieces.push({ key: "steel", geo: place(tiledBox(L, 0.06, 0.06, 1), { pos: [0, base - 0.01, 0.02] }) });
      }
      decals.push({ pos: [0, 0.004, 0.14], size: [L + 0.2, 0.34], shade: 0.5 });
      slotBox = (_x, s) => ({ y0: tiers[s] + 0.012, y1: top(s), z0: -Math.min(depth, 0.5), z1: 0.0, w: 1 });
      break;
    }
    case "coffin": {
      const rim = 0.9;
      const deck = COFFIN_DECK_M;
      pieces.push({ key: "paint", geo: place(tiledBox(L, rim, 0.04, 1), { pos: [0, rim / 2, -0.02] }), tint: [0.92, 0.91, 0.88] });
      pieces.push({ key: "paint", geo: place(tiledBox(L, rim, 0.04, 1), { pos: [0, rim / 2, -depth + 0.02] }), tint: [0.92, 0.91, 0.88] });
      pieces.push({ key: "steel", geo: place(tiledBox(L, 0.1, depth, 1), { pos: [0, 0.05, -depth / 2] }) });
      pieces.push({ key: "paint", geo: place(tiledBox(L, 0.02, depth - 0.08, 1), { pos: [0, deck, -depth / 2] }), tint: hex("#3A3C3E") });
      pieces.push({ key: "metal", geo: place(tiledBox(L, 0.03, 0.06, 1), { pos: [0, rim + 0.015, -0.03] }), tint: STAINLESS });
      // the packs lie in the well, two rows, their fronts up
      for (const z of [-0.08, -0.32]) row(deck + 0.012, z, 0.2, x0 + 0.06, x1 - 0.06, { lie: true, tilt: 0.25 });
      // sliding glass lids
      const lid = gridPlane(L, depth - 0.06, 1, 1);
      lid.rotateX(-Math.PI / 2 + 0.06);
      pieces.push({ key: "glass", geo: place(lid, { pos: [0, rim + 0.03, -depth / 2] }) });
      decals.push({ pos: [0, 0.004, 0.1], size: [L + 0.2, 0.3], shade: 0.5 });
      slotBox = () => ({ y0: deck, y1: rim + 0.04, z0: -0.5, z1: 0.0, w: 1 });
      break;
    }
    case "service":
    case "bar": {
      const deckY = kind === "service" ? SERVICE_DECK_M : 0.9;
      const caseD = kind === "service" ? Math.min(1.0, depth) : depth;
      const finish = face.department === "bakery" ? "pine" : "metal";
      pieces.push({ key: finish, geo: place(tiledBox(L, deckY - 0.12, caseD, 1.2), { pos: [0, 0.12 + (deckY - 0.12) / 2, -caseD / 2] }), tint: finish === "metal" ? STAINLESS : [0.86, 0.78, 0.7] });
      pieces.push({ key: "steel", geo: place(tiledBox(L, 0.12, caseD - 0.04, 1), { pos: [0, 0.06, -caseD / 2] }) });
      pieces.push({ key: "paint", geo: place(tiledBox(L, 0.02, caseD - 0.04, 1), { pos: [0, deckY, -caseD / 2] }), tint: kind === "bar" ? STAINLESS : [0.96, 0.95, 0.92] });
      slabs.push({ x0, x1, z0: -caseD, z1: 0, y: deckY });
      const bakery = face.department === "bakery";
      // trays (or, at the bakery, loaves and cakes) on the deck in two rows
      for (const z of [-0.2, -0.52]) {
        if (bakery) {
          row(deckY + 0.012, z + 0.1, 0.22, x0 + 0.06, x1 - 0.06);
          continue;
        }
        for (let x = x0 + 0.18; x < x1 - 0.18; x += kind === "bar" ? 0.4 : 0.3) {
          const r = runAt(x);
          if (!r) continue;
          const w = kind === "bar" ? 0.34 : 0.26;
          const d = kind === "bar" ? 0.26 : 0.2;
          pieces.push({ key: kind === "bar" ? "metal" : "paint", geo: place(tiledBox(w, 0.05, d, 1), { pos: [x, deckY + 0.035, z] }), tint: kind === "bar" ? STAINLESS : [0.95, 0.95, 0.93] });
          if (Math.abs(x - winC) < DETAIL_M + 3) mound(x, deckY + 0.06, z, w - 0.03, d - 0.03, r, 0, 0.05);
          else pieces.push({ key: "grain", geo: place(tiledBox(w - 0.03, 0.03, d - 0.03, 1), { pos: [x, deckY + 0.075, z] }), tint: hex(looseOf(r.id).tints[0]), grain: [shapeIndex(looseOf(r.id).shape), looseOf(r.id).cellM] });
        }
      }
      // the glass: a curved front (two panes) and a top shelf; a bar's sneeze guard is one tilted pane
      if (kind === "service") {
        const front = gridPlane(L, 0.34, 1, 1);
        front.rotateX(-0.35);
        pieces.push({ key: "glass", geo: place(front, { pos: [0, deckY + 0.16, 0.05] }) });
        const upper = gridPlane(L, 0.22, 1, 1);
        upper.rotateX(-1.0);
        pieces.push({ key: "glass", geo: place(upper, { pos: [0, deckY + 0.39, -0.06] }) });
        const lid = gridPlane(L, caseD * 0.55, 1, 1);
        lid.rotateX(-Math.PI / 2);
        pieces.push({ key: "glass", geo: place(lid, { pos: [0, deckY + 0.46, -caseD * 0.4] }) });
        // the canopy's light along the case's back edge
        const strip = gridPlane(L, 0.04, 1, 1);
        strip.rotateX(Math.PI / 2);
        pieces.push({ key: "glow", geo: place(strip, { pos: [0, deckY + 0.48, -caseD + 0.08] }), tint: [1, 0.95, 0.86] });
        // the staff side: a back counter, the wall behind it with the counter's sign
        const wallZ = -(face.params.width + 1.3);
        pieces.push({ key: finish, geo: place(tiledBox(L, 0.92, 0.6, 1.2), { pos: [0, 0.46, wallZ + 0.32] }), tint: finish === "metal" ? STAINLESS : [0.8, 0.72, 0.64] });
        const wall = gridPlane(L + 2, 3.6, 0.5, 1.6);
        pieces.push({ key: "plaster", geo: place(wall, { pos: [0, 1.8, wallZ] }), tint: [0.86, 0.84, 0.8] });
        headers(2.3, wallZ + 0.03, 0);
      } else {
        const guard = gridPlane(L, 0.4, 1, 1);
        guard.rotateX(-0.9);
        pieces.push({ key: "glass", geo: place(guard, { pos: [0, deckY + 0.45, -0.25] }) });
        for (let x = x0 + 0.3; x < x1; x += 1.6) pieces.push({ key: "metal", geo: place(tiledBox(0.025, 0.55, 0.025, 1), { pos: [x, deckY + 0.28, -0.45] }), tint: STAINLESS });
        headers(1.9, -caseD / 2, 0);
      }
      decals.push({ pos: [0, 0.004, 0.12], size: [L + 0.2, 0.3], shade: 0.5 });
      slotBox = () => ({ y0: deckY, y1: deckY + 0.34, z0: -0.7, z1: -0.02, w: 1 });
      break;
    }
    case "produce": {
      // a black stand of tilted crates: two tiers facing this side, two facing the other
      const xa = x0 + 0.1;
      const xb = x1 - 0.1;
      const D = face.params.width;
      pieces.push(...produceStand({ x0: x0, x1: x1, z0: -D, z1: 0 }));
      for (const [y, z, tip] of [
        [0.45, -0.22, -0.22],
        [0.82, -0.62, -0.22],
        [0.82, -D + 0.62, 0.22],
        [0.45, -D + 0.22, 0.22],
      ] as [number, number, number][]) {
        for (let x = xa + 0.29; x < xb - 0.2; x += 0.6) {
          const r = runAt(x);
          if (!r) continue;
          const box = tiledBox(0.56, 0.12, 0.4, 0.6);
          box.applyMatrix4(new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeRotationX(-tip)));
          pieces.push({ key: "pine", geo: box, tint: [0.78, 0.62, 0.48] });
          mound(x, y + 0.06, z, 0.52, 0.36, r, -tip);
        }
      }
      slabs.push({ x0, x1, z0: -D, z1: 0, y: 0.2 });
      decals.push({ pos: [0, 0.004, -D / 2], size: [L + 0.4, D + 0.4], shade: 0.4 });
      slotBox = () => ({ y0: 0.38, y1: 1.0, z0: -0.9, z1: 0.02, w: 1 });
      break;
    }
    case "producewall": {
      // a stepped rack of crates, three tiers back toward the wall
      const back = gridPlane(L, H + 0.4, 0.4, 1.2);
      pieces.push({ key: "pine", geo: place(back, { pos: [0, (H + 0.4) / 2, -depth + 0.01] }), tint: [0.55, 0.47, 0.4] });
      for (const [y, z] of [
        [0.5, -0.24],
        [0.95, -0.62],
        [1.4, -0.98],
      ] as [number, number][]) {
        if (-z > depth) continue;
        pieces.push({ key: "steel", geo: place(tiledBox(L, y - 0.08, 0.04, 1), { pos: [0, (y - 0.08) / 2, z + 0.2] }) });
        for (let x = x0 + 0.32; x < x1 - 0.2; x += 0.6) {
          const r = runAt(x);
          if (!r) continue;
          const box = tiledBox(0.56, 0.12, 0.38, 0.6);
          box.applyMatrix4(new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeRotationX(0.22)));
          pieces.push({ key: "pine", geo: box, tint: [0.78, 0.62, 0.48] });
          mound(x, y + 0.06, z, 0.52, 0.34, r, 0.22);
        }
      }
      // a mist bar and its light over the top tier
      pieces.push({ key: "steel", geo: place(tiledBox(L, 0.08, 0.3, 1), { pos: [0, H + 0.2, -depth + 0.2] }) });
      const strip = gridPlane(L, 0.05, 1, 1);
      strip.rotateX(Math.PI / 2);
      pieces.push({ key: "glow", geo: place(strip, { pos: [0, H + 0.155, -depth + 0.32] }), tint: [1, 0.96, 0.88] });
      headers(H + 0.3, -depth + 0.36);
      decals.push({ pos: [0, 0.004, 0.1], size: [L + 0.2, 0.3], shade: 0.45 });
      slotBox = (_x, s) => {
        const y = [0.5, 0.95, 1.4][Math.min(2, s)];
        const z = [-0.24, -0.62, -0.98][Math.min(2, s)];
        return { y0: y - 0.06, y1: y + 0.3, z0: z - 0.24, z1: z + 0.24, w: 1 };
      };
      break;
    }
    case "counter": {
      const h = Math.max(1.0, Math.min(1.15, H));
      const D = Math.min(face.params.width, 0.8);
      pieces.push({ key: "pine", geo: place(tiledBox(L, h - 0.05, D - 0.06, 1.2), { pos: [0, (h - 0.05) / 2, -D / 2] }), tint: [0.84, 0.76, 0.68] });
      pieces.push({ key: "pine", geo: place(tiledBox(L + 0.04, 0.05, D + 0.04, 1.2), { pos: [0, h - 0.025, -D / 2] }) });
      pieces.push({ key: "steel", geo: place(tiledBox(L, 0.1, D - 0.1, 1), { pos: [0, 0.05, -D / 2] }) });
      // a few things on the counter, and a stocked wall behind the staff side
      row(h, -0.12, 0.2, x0 + 0.3, Math.min(x1 - 0.3, x0 + 0.3 + L * 0.3));
      const wallZ = -(face.params.width + 1.2);
      const wt = [0.4, 0.8, 1.2, 1.6];
      pieces.push(...shelving({ x0, x1, zBack: wallZ, zFront: wallZ + 0.4, bays: Math.max(1, Math.round(L / BAY_M)), tiers: wt, top: 2.0, plank: PLANK }));
      wt.forEach((y) => row(y + PLANK, wallZ + 0.39, 0.32));
      const wall = gridPlane(L + 2, 3.6, 0.5, 1.6);
      pieces.push({ key: "plaster", geo: place(wall, { pos: [0, 1.8, wallZ - 0.01] }), tint: [0.86, 0.84, 0.8] });
      headers(2.45, wallZ + 0.45, 0);
      decals.push({ pos: [0, 0.004, 0.1], size: [L + 0.2, 0.3], shade: 0.45 });
      slotBox = () => ({ y0: h, y1: h + 0.32, z0: -D + 0.05, z1: 0.0, w: 1 });
      break;
    }
  }
  // a wall fixture stands against the building's wall
  if (face.fixtureKind === "wall" && kind !== "service") {
    const wall = gridPlane(L + 2, 4.4, 0.5, 1.6);
    pieces.push({ key: "plaster", geo: place(wall, { pos: [0, 2.2, -depth - 0.03] }), tint: [0.82, 0.8, 0.76] });
  }
  for (const p of pieces) {
    const base = SOLID[p.key];
    const t = p.tint ?? [1, 1, 1];
    colorize(p.geo, base ? [t[0] * base[0], t[1] * base[1], t[2] * base[2]] : t, occ);
  }
  return { pieces, decals, slabs, slotBox: slotBox! };
}

/** The whole store's floor at the zone's finish (polished concrete), from the building's outline. */
function floor(store: StoreGraph): BufferGeometry {
  const outline = store.outline ?? [
    [0, 0],
    [85, 0],
    [85, 70],
    [0, 70],
  ];
  const shape = new Shape(outline.map(([x, y]) => ({ x, y }) as never));
  const g = clean(new ShapeGeometry(shape));
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getY(i);
    pos.setXYZ(i, x, 0.002, z);
    uv.setXY(i, x / 2.4, z / 2.4);
  }
  const nor = g.getAttribute("normal");
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
  // the shape lay in x / y; with y as z its triangles now face down: flip them
  const idx = (a: BufferAttribute, i: number, j: number) => {
    for (let c = 0; c < a.itemSize; c++) {
      const t = a.array[i * a.itemSize + c];
      (a.array as Float32Array)[i * a.itemSize + c] = a.array[j * a.itemSize + c];
      (a.array as Float32Array)[j * a.itemSize + c] = t;
    }
  };
  for (let i = 0; i < pos.count; i += 3) for (const a of [pos, uv] as BufferAttribute[]) idx(a, i + 1, i + 2);
  return g;
}

/** Light: warm spots on the face around the slot and on the face across, then downlights on the floor. */
function rigFor(plan: StandardPlan, standZ: number, slabsW: LightRig["slabs"]): LightRig {
  const { m } = frameMatrix(plan.face);
  const { sgn } = frameMatrix(plan.face);
  const winC = plan.slot.along * sgn;
  const w = (x: number, y: number, z: number): V3 => {
    const v = new Vector3(x, y, z).applyMatrix4(m);
    return [v.x, v.y, v.z];
  };
  const lights: ZoneLightDef[] = [];
  const spot = (pos: V3, target: V3, angle: number, k: number, reach = 6): ZoneLightDef => ({ pos, target, angle, softness: 0.25, color: scaled(WARM_3000K, k), reach });
  const lz = plan.opposite ? plan.clearance / 2 : 1.4;
  for (const dx of [-3.6, -1.8, 0, 1.8, 3.6]) lights.push(spot(w(winC + dx, LIGHT_Y, lz - 0.25), w(winC + dx, 1.0, 0), 0.4, 5.2));
  for (const dx of [-2.7, -0.9, 0.9, 2.7]) lights.push(plan.opposite ? spot(w(winC + dx, LIGHT_Y, lz + 0.25), w(winC + dx, 1.0, plan.clearance), 0.4, 4.6) : spot(w(winC + dx, LIGHT_Y, standZ + 0.6), w(winC + dx, 0, standZ + 0.6), 0.36, 3.2));
  // the slot's own: a narrower beam from above the shopper's shoulder
  lights.push(spot(w(winC, LIGHT_Y - 0.4, Math.min(standZ, lz + 0.4)), w(winC, Math.max(0.4, plan.slot.y + 0.15), 0), 0.24, 3.2));
  const slabs = slabsW.slice(0, STD_SLABS);
  while (slabs.length < STD_SLABS) slabs.push({ x0: 0, x1: 0, z0: 0, z1: 0, y: -10 });
  return { lights: lights.slice(0, STD_LIGHTS), slabs, reference: 2.6 };
}

/** world rect of a local slab */
function slabWorld(face: FaceFrame, s: FaceOut["slabs"][number]) {
  const { m } = frameMatrix(face);
  const a = new Vector3(s.x0, s.y, s.z0).applyMatrix4(m);
  const b = new Vector3(s.x1, s.y, s.z1).applyMatrix4(m);
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), y: s.y };
}

export function buildStandardZone(store: StoreGraph, categories: Category[], plan: StandardPlan, eye = 1.6): StandardBuild {
  const own = categories.find((c) => c.locationId === plan.locationId)?.id;
  const runs = faceCategories(store, categories);
  const signs = signKeys(categories);
  const kind = buildKind(plan.face);
  const batch = new Batch();
  const decals: Decal[] = [];
  const faces: { face: FaceFrame; out: FaceOut; kind: BuildKind }[] = [];
  const { sgn } = frameMatrix(plan.face);
  const winC = plan.slot.along * sgn;
  const key = (f: FaceFrame) => `${f.fixtureId}:${f.n[0] < -0.5 ? "west" : f.n[0] > 0.5 ? "east" : f.n[1] < -0.5 ? "north" : "south"}`;
  const main = buildFace({ face: plan.face, runs: runs.get(key(plan.face)) ?? [], categoriesCount: categories.length, signs, winC, seed: 17, target: own ? { id: own, half: Math.min(plan.slot.w, 1.2) / 2 + 0.05 } : undefined }, kind);
  faces.push({ face: plan.face, out: main, kind });
  if (plan.opposite) {
    const o = plan.opposite;
    const fo = frameMatrix(o);
    const along = (plan.slot.at[0] - o.origin[0]) * o.t[0] + (plan.slot.at[1] - o.origin[1]) * o.t[1];
    const r = runs.get(key(o)) ?? [];
    if (r.length) faces.push({ face: o, out: buildFace({ face: o, runs: r, categoriesCount: categories.length, signs, winC: along * fo.sgn, seed: 29 }, buildKind(o)), kind: buildKind(o) });
  }
  const slabsW: LightRig["slabs"] = [];
  for (const { face, out } of faces) {
    const { m, theta } = frameMatrix(face);
    for (const p of out.pieces) {
      p.geo.applyMatrix4(m);
      const base = SOLID[p.key];
      if (p.key === "label") constant(p.geo, "aCell", p.cell ?? [0, 0, 1, 1]);
      if (p.key === "grain") constant(p.geo, "aGrain", p.grain ?? [shapeIndex("powder"), 0.12]);
      batch.add(base ? "steel" : p.key, p.geo);
    }
    for (const d of out.decals) {
      const v = new Vector3(...d.pos).applyMatrix4(m);
      decals.push({ ...d, pos: [v.x, v.y, v.z], rotY: (d.rotY ?? 0) + theta });
    }
    // planks near the slot first: the shader has room for twelve
    for (const s of out.slabs) slabsW.push(slabWorld(face, s));
  }
  const fl = floor(store);
  colorize(fl);
  batch.add("concrete", fl);

  // ---- the target: the lit slot, where the shopper stands, the walk in
  const { m, theta, tw } = frameMatrix(plan.face);
  const box = main.slotBox(winC, plan.slot.shelf);
  // a bay or 0.8 m, whichever is less: the lit slot fits the width of a phone held upright
  const w = Math.min(plan.slot.w, 0.8);
  const h = box.y1 - box.y0;
  const dz = box.z1 - box.z0;
  const c = new Vector3(winC, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2).applyMatrix4(m);
  const standZ = standOff(plan);
  const door = new Vector3(winC, eye, standZ);
  // the walk in: along the corridor from the end with more room, to stand in front of the slot
  const toPlus = plan.face.length / 2 - winC;
  const toMinus = plan.face.length / 2 + winC;
  const dir = toPlus > toMinus ? 1 : -1;
  const walk = Math.min(3.6, Math.max(2.2, Math.max(toPlus, toMinus) * 0.5));
  door.x = winC + dir * walk;
  door.applyMatrix4(m);
  const centerAlong = c.x * tw[0] + c.z * tw[1];
  const xa = Math.max(-plan.face.length / 2 + 0.5, winC - 6) - winC;
  const xb = Math.min(plan.face.length / 2 - 0.5, winC + 6) - winC;
  // the light: planks nearest the slot first
  slabsW.sort((p, q) => Math.hypot((p.x0 + p.x1) / 2 - c.x, (p.z0 + p.z1) / 2 - c.z) - Math.hypot((q.x0 + q.x1) / 2 - c.x, (q.z0 + q.z1) / 2 - c.z));
  const rig = rigFor(plan, standZ, slabsW);
  // the tracks the spots hang from, and their heads
  const mm = m;
  const lz = plan.opposite ? plan.clearance / 2 : 1.4;
  for (const z of [lz - 0.25, lz + 0.25]) {
    const heads = rig.lights
      .map((l) => ({ l, p: new Vector3(...l.pos).applyMatrix4(mm.clone().invert()) }))
      .filter(({ l, p }) => Math.abs(p.z - z) < 0.05 && l.pos[1] > LIGHT_Y - 0.1)
      .map(({ l, p }) => ({ x: p.x, target: (() => {
        const t = new Vector3(...l.target).applyMatrix4(mm.clone().invert());
        return [t.x, t.y, t.z] as V3;
      })() }));
    const tr = track({ x0: winC - 9, x1: winC + 9, y: LIGHT_Y + 0.06, z, heads });
    for (const p of tr) {
      colorize(p.geo, SOLID[p.key] ?? p.tint ?? [1, 1, 1]);
      p.geo.applyMatrix4(mm);
      batch.add(SOLID[p.key] ? "steel" : p.key, p.geo);
    }
  }
  // hangers up into the dark
  for (const x of [winC - 8, winC, winC + 8])
    for (const z of [lz - 0.25, lz + 0.25]) {
      const g = beam([x, LIGHT_Y + 0.06, z], [x, 7, z], 0.012);
      colorize(g, SOLID.steel!);
      batch.add("steel", g.applyMatrix4(mm));
    }

  const statics = batch.merged() as Map<KitMaterialKey, BufferGeometry>;
  const tri = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  const triangles = [...statics.values()].reduce((s, g) => s + tri(g), 0) + decals.length * 2;
  const target: StandardTarget = {
    center: [c.x, c.y, c.z],
    size: [w, h, dz],
    rotY: theta,
    out: [plan.face.n[0], plan.face.n[1]],
    axis: tw,
    bounds: { x0: centerAlong + xa, x1: centerAlong + xb },
    door: [door.x, eye, door.z],
    via: [],
    stand: standZ + dz / 2 - box.z1,
    // a step toward the way they came in: the aisle recedes beside the slot (none where the face is short)
    side: plan.face.length > 3 ? Math.min(0.9, standZ * 0.55) * dir : 0,
  };
  return { statics, decals, rig, target, kind, triangles: Math.round(triangles) };
}

/** Built once per plan and kept: prepared ahead (the next stop, the first on the list screen), reused after. */
const built = new Map<string, StandardBuild>();
export function standardZoneFor(store: StoreGraph, categories: Category[], plan: StandardPlan): StandardBuild {
  const key = `${store.storeId}:${store.version ?? 0}:${plan.locationId}`;
  let z = built.get(key);
  if (!z) {
    // a trip opens a dozen of these: keep the last few
    if (built.size > 3) built.delete(built.keys().next().value!);
    built.set(key, (z = buildStandardZone(store, categories, plan)));
  }
  return z;
}
export function dropStandardZone(store: StoreGraph, plan: StandardPlan) {
  built.delete(`${store.storeId}:${store.version ?? 0}:${plan.locationId}`);
}
