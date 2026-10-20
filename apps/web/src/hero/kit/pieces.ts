// The shelf kit's fixed pieces: steel frames, pine planks, header boards, jute sacks, clay pots with dried
// wheat, a stone chakki in its wooden tray, conduit and track lights, and the backdrop's simpler fixtures
// (produce stands, a gondola). Each returns world-space geometry under a material key; zone recipes
// (src/hero/<zone>/zone.ts) place them and merge them per key. A piece may carry a tint (vertex colour), a
// label cell or a grain (shape index, metres per cell) for the materials that read them.

import { BufferGeometry, CatmullRomCurve3, PlaneGeometry, TubeGeometry, Vector3 } from "three";
import { beam, clean, cylinder, gridPlane, lathe, place, roundedPlank, tiledBox, toRect, rng, type Rect, type V3 } from "./geom.ts";
import type { KitMaterialKey } from "./materials.ts";

export type MaterialKey = Exclude<KitMaterialKey, "acrylic" | "binTrim" | "grainSolid">;

export interface Piece {
  key: MaterialKey;
  geo: BufferGeometry;
  /** multiplied into the material's colour (a straw, a clay, a fruit) */
  tint?: V3;
  /** a label's atlas cell (u0, v0, du, dv) */
  cell?: [number, number, number, number];
  /** a grain: shape index and metres per atlas cell */
  grain?: [number, number];
}

const STEEL_W = 0.04; // square steel tube

/**
 * Shelving: black powder-coated square-steel uprights at every bay boundary (front and back), rails under
 * every tier, a top rail; thick light pine planks with rounded edges on every tier.
 */
export function shelving(o: { x0: number; x1: number; zBack: number; zFront: number; bays: number; tiers: number[]; top: number; plank: number }): Piece[] {
  const out: Piece[] = [];
  const bay = (o.x1 - o.x0) / o.bays;
  for (let b = 0; b <= o.bays; b++) {
    const x = o.x0 + b * bay;
    // the uprights rise past the top plank to carry the header boards
    for (const z of [o.zBack + STEEL_W / 2, o.zFront - STEEL_W / 2]) out.push({ key: "steel", geo: place(tiledBox(STEEL_W, o.top + 0.42, STEEL_W, 0.5), { pos: [x, (o.top + 0.42) / 2, z] }) });
    for (const y of [...o.tiers, o.top - 0.02]) out.push({ key: "steel", geo: beam([x, y - 0.02, o.zBack + STEEL_W], [x, y - 0.02, o.zFront - STEEL_W], 0.025) });
  }
  for (const y of [...o.tiers, o.top - 0.02]) {
    out.push({ key: "steel", geo: beam([o.x0, y - 0.025, o.zFront - STEEL_W / 2], [o.x1, y - 0.025, o.zFront - STEEL_W / 2], 0.03) });
    out.push({ key: "steel", geo: beam([o.x0, y - 0.025, o.zBack + STEEL_W / 2], [o.x1, y - 0.025, o.zBack + STEEL_W / 2], 0.03) });
  }
  const depth = o.zFront - o.zBack - 0.02;
  const r = rng(91);
  for (let b = 0; b < o.bays; b++) {
    const len = bay - STEEL_W - 0.01;
    const cx = o.x0 + (b + 0.5) * bay;
    for (const y of o.tiers) {
      const g = roundedPlank(len, o.plank, depth, 0.008, 1.1);
      // each plank cut from a different part of the board: shift its grain
      const uv = g.getAttribute("uv");
      const du = r() * 3;
      const dv = r() * 2;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
      out.push({ key: "pine", geo: place(g, { pos: [cx, y + o.plank / 2, (o.zBack + o.zFront) / 2] }), tint: [0.96 + r() * 0.08, 0.95 + r() * 0.08, 0.92 + r() * 0.08] });
    }
  }
  return out;
}

/** A black header board with white lettering from the headers atlas, on two posts, tilted toward the aisle. */
export function headerBoard(o: { x0: number; x1: number; y0: number; y1: number; z: number; rect: Rect; facing?: 1 | -1; tilt?: number }): Piece[] {
  const f = o.facing ?? 1;
  const w = o.x1 - o.x0;
  const h = o.y1 - o.y0;
  const tilt = o.tilt ?? 0;
  const face = clean(new PlaneGeometry(w, h));
  toRect(face, o.rect);
  const back = tiledBox(w + 0.01, h + 0.01, 0.02, 1);
  place(face, { pos: [0, 0, 0.011] });
  const parts = [face, back];
  for (const g of parts) {
    // tip the top toward the shopper, then face the aisle
    g.rotateX(-tilt);
    if (f === -1) g.rotateY(Math.PI);
    place(g, { pos: [(o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, o.z] });
  }
  return [
    { key: "header", geo: face },
    { key: "steel", geo: back },
  ];
}

/** A grain pile's top: a disc (or rectangle) mounded in the middle. */
export function grainMound(o: { w: number; d: number; peak: number; round?: boolean; seg?: number; lump?: number; seed?: number }): BufferGeometry {
  const seg = o.seg ?? 10;
  const g = gridPlane(o.w, o.d, Math.max(o.w, o.d) / seg, 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute("position");
  const r = rng(o.seed ?? 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = o.round ? Math.hypot(x / (o.w / 2), z / (o.d / 2)) : Math.max(Math.abs(x) / (o.w / 2), Math.abs(z) / (o.d / 2));
    const k = Math.max(0, 1 - d);
    pos.setY(i, o.peak * Math.sin((k * Math.PI) / 2) ** 1.4 + (k > 0.05 ? (r() - 0.5) * (o.lump ?? 0) : 0));
    if (o.round && d > 1) {
      pos.setX(i, x / d);
      pos.setZ(i, z / d);
    }
  }
  g.computeVertexNormals();
  return g;
}
export const moundHeight = (peak: number, w: number, d: number, round: boolean) => (x: number, z: number) => {
  const k = Math.max(0, 1 - (round ? Math.hypot(x / (w / 2), z / (d / 2)) : Math.max(Math.abs(x) / (w / 2), Math.abs(z) / (d / 2))));
  return peak * Math.sin((k * Math.PI) / 2) ** 1.4;
};

/**
 * An open jute sack as in the reference: slumped and wide at the floor, the mouth rolled down into a thick,
 * lumpy rim with frayed fibres hanging off it, a mill's stencil on its side, grain heaped in the mouth.
 */
export function sack(o: { x: number; y?: number; z: number; r: number; h: number; grain: [number, number]; tint: V3; stencil: Rect | null; fringe: Rect; turn: number; seed: number }): Piece[] {
  const { r, h } = o;
  const y0 = o.y ?? 0;
  const rnd = rng(o.seed);
  const seg = 20;
  // the body: a slumped bag, its profile pushed in and out around the circumference so it is never a lathe
  const profile: [number, number][] = [
    [0, 0],
    [r * 1.0, 0.004],
    [r * 1.18, h * 0.08],
    [r * 1.16, h * 0.28],
    [r * 1.04, h * 0.52],
    [r * 0.92, h * 0.72],
    [r * 0.88, h * 0.84],
  ];
  const body = lathe(profile, seg, 3, 2);
  const wob = Array.from({ length: seg + 1 }, () => 1 + (rnd() - 0.5) * 0.12);
  wob[seg] = wob[0];
  const bp = body.getAttribute("position");
  for (let i = 0; i < bp.count; i++) {
    const a = Math.atan2(bp.getZ(i), bp.getX(i));
    const k = wob[Math.round(((a + Math.PI) / (Math.PI * 2)) * seg) % seg];
    const t = bp.getY(i) / h;
    const lean = 1 + Math.cos(a - o.turn) * 0.08 * t; // it sags toward one side
    // folds running down from the neck, fading toward the bulging foot
    const fold = 1 + Math.sin(a * 7 + o.seed) * 0.035 * t + Math.sin(a * 13 + o.seed * 3) * 0.015 * t;
    bp.setX(i, bp.getX(i) * k * lean * fold);
    bp.setZ(i, bp.getZ(i) * k * lean * fold);
  }
  body.computeVertexNormals();
  // the rolled rim: a fat, lumpy tube round the mouth
  const pts: Vector3[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const rr = r * 0.9 * wob[Math.round((k / 24) * seg) % seg] + 0.05;
    pts.push(new Vector3(Math.cos(a) * rr, h * 0.84 + (rnd() - 0.5) * 0.035, Math.sin(a) * rr));
  }
  const rimGeo = new TubeGeometry(new CatmullRomCurve3(pts, true), 48, 0.055, 7, true);
  const rp = rimGeo.getAttribute("position");
  for (let i = 0; i < rp.count; i++) {
    const k = 1 + Math.sin(i * 0.37) * 0.08;
    rp.setXYZ(i, rp.getX(i) * k, rp.getY(i), rp.getZ(i) * k);
  }
  const rim = clean(rimGeo);
  rim.computeVertexNormals();
  // the fringe: a ring of fibres hanging off the rim's outer edge
  const fr = cylinder(r * 0.9 + 0.1, r * 0.92 + 0.105, 0.06, 28, true);
  place(fr, { pos: [0, h * 0.84 - 0.07, 0] });
  // the strip is tileable along x: once round the rim (fibres a millimetre or two wide)
  toRect(fr, o.fringe);
  // the grain heaped in the mouth
  const pile = grainMound({ w: r * 1.9, d: r * 1.9, peak: r * 0.3, round: true, seg: 12, lump: 0.006, seed: o.seed });
  place(pile, { pos: [0, h * 0.8, 0] });
  const out: Piece[] = [
    { key: "burlap", geo: body },
    { key: "burlap", geo: rim },
    { key: "cutout", geo: fr },
    { key: "grain", geo: pile, tint: o.tint, grain: o.grain },
  ];
  if (o.stencil) {
    // the stencil: a patch of the body's side, a few millimetres proud of it, facing `turn`
    const st = clean(new PlaneGeometry(r * 1.3, r * 0.65, 6, 1));
    const sp = st.getAttribute("position");
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i);
      const a = x / (r * 1.06);
      sp.setXYZ(i, Math.sin(a) * (r * 1.16 + 0.012), sp.getY(i), Math.cos(a) * (r * 1.16 + 0.012));
    }
    st.computeVertexNormals();
    toRect(st, o.stencil);
    place(st, { pos: [0, h * 0.26, 0] });
    st.rotateY(o.turn);
    out.push({ key: "cutout", geo: st, tint: [0.7, 0.75, 0.8] });
  }
  for (const p of out) place(p.geo, { pos: [o.x, y0, o.z] });
  return out;
}

/** A clay pot (a matka shape) standing on y = 0 at x, z; `rope` gives it a twisted rope lip (the big pot). */
export function clayPot(o: { x: number; y?: number; z: number; r: number; h: number; tint?: V3; rope?: boolean; seg?: number; key?: MaterialKey }): Piece[] {
  const { r, h } = o;
  const profile: [number, number][] = [
    [0, 0],
    [r * 0.42, 0],
    [r * 0.78, h * 0.12],
    [r, h * 0.4],
    [r * 0.94, h * 0.66],
    [r * 0.7, h * 0.86],
    [r * 0.6, h * 0.94],
    [r * 0.66, h],
    [r * 0.58, h],
    [r * 0.54, h * 0.95],
  ];
  const key = o.key ?? "terracotta";
  const out: Piece[] = [{ key, geo: place(lathe(profile, o.seg ?? 20, 2, 1), { pos: [o.x, o.y ?? 0, o.z] }), tint: o.tint }];
  if (o.rope) {
    // a twisted rope round the lip: a tube whose radius wobbles with the twist
    const pts: Vector3[] = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      pts.push(new Vector3(Math.cos(a) * r * 0.66, h * 0.985, Math.sin(a) * r * 0.66));
    }
    const rope = clean(new TubeGeometry(new CatmullRomCurve3(pts, true), 120, 0.016, 6, true));
    const p = rope.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const k = 1 + Math.sin(i * 0.9) * 0.012;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) + Math.sin(i * 0.9) * 0.003, p.getZ(i) * k);
    }
    rope.computeVertexNormals();
    out.push({ key: "burlap", geo: place(rope, { pos: [o.x, o.y ?? 0, o.z] }), tint: [0.62, 0.56, 0.5] });
  }
  return out;
}

/**
 * Dried wheat as in the reference's pot: a sheaf of thin stalks splaying out of the neck, each with an ear
 * (two crossed cards from the cutouts atlas: two rows of spikelets and long awns).
 */
export function wheatSheaf(o: { x: number; y: number; z: number; count: number; height: number; spread: number; ears: Rect[]; rand: () => number }): Piece[] {
  const stalks: BufferGeometry[] = [];
  const ears: BufferGeometry[] = [];
  for (let i = 0; i < o.count; i++) {
    const a = o.rand() * Math.PI * 2;
    const lean = o.spread * (0.25 + o.rand() * 0.75);
    const h = o.height * (0.78 + o.rand() * 0.34);
    const base = new Vector3(o.x + Math.cos(a) * 0.04 * o.rand(), o.y, o.z + Math.sin(a) * 0.04 * o.rand());
    const dir = new Vector3(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
    const top = base.clone().addScaledVector(dir, h);
    // the stalk: a thin ribbon, bowed a little
    const mid = base.clone().lerp(top, 0.5).add(new Vector3(Math.cos(a) * 0.02, 0, Math.sin(a) * 0.02));
    for (const [p, q] of [
      [base, mid],
      [mid, top],
    ])
      stalks.push(beam([p.x, p.y, p.z], [q.x, q.y, q.z], 0.0035));
    // the ear: two crossed cards along the stalk's last 16 cm (awns included)
    const rect = o.ears[Math.floor(o.rand() * o.ears.length)];
    for (const turn of [0, Math.PI / 2]) {
      const card = clean(new PlaneGeometry(0.07, 0.16));
      toRect(card, rect);
      card.translate(0, 0.08 - 0.03, 0);
      card.rotateY(turn + o.rand());
      ears.push(alongStalk(card, top.clone().addScaledVector(dir, -0.06), dir));
    }
  }
  const out: Piece[] = [];
  // dried to a pale, greyish straw
  for (const s of stalks) out.push({ key: "straw", geo: s, tint: [0.95 + o.rand() * 0.08, 0.93 + o.rand() * 0.08, 0.86 + o.rand() * 0.1] });
  for (const e of ears) out.push({ key: "cutout", geo: e });
  return out;
}

/** turn a card built along +y to point along `dir`, and move its base to `at` */
function alongStalk(g: BufferGeometry, at: Vector3, dir: Vector3): BufferGeometry {
  const up = new Vector3(0, 1, 0);
  const axis = up.clone().cross(dir);
  const ang = Math.acos(Math.max(-1, Math.min(1, up.dot(dir))));
  if (axis.lengthSq() > 1e-8) {
    axis.normalize();
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    for (const attr of [p, n]) {
      for (let i = 0; i < attr.count; i++) {
        const v = new Vector3(attr.getX(i), attr.getY(i), attr.getZ(i));
        // Rodrigues' rotation
        const r = v.clone().multiplyScalar(c).add(axis.clone().cross(v).multiplyScalar(s)).add(axis.clone().multiplyScalar(axis.dot(v) * (1 - c)));
        attr.setXYZ(i, r.x, r.y, r.z);
      }
    }
  }
  g.translate(at.x, at.y, at.z);
  return g;
}

/**
 * A stone chakki (hand quern) as in the reference: two dressed granite wheels (chisel grooves round their
 * rims, the gap between them), grain heaped round the upper stone's eye, a tall pale wooden peg near its
 * rim, a spout where the flour leaves, all in a round wooden tray on four chunky posts.
 */
export function chakki(o: { x: number; y?: number; z: number; scale?: number; grain: [number, number]; flour: [number, number]; tint: V3; flourTint: V3; spoutTurn: number }): Piece[] {
  const out: Piece[] = [];
  const y0 = o.y ?? 0;
  const R = 0.5; // the tray's radius
  const trayY = 0.26; // the tray's floor
  // weathered wood: grey-brown, not new pine
  const wood: V3 = [0.5, 0.42, 0.36];
  const woodDark: V3 = [0.4, 0.33, 0.28];
  // the tray: a floor and a low curved wall of staves
  out.push({ key: "pine", geo: place(cylinder(R - 0.02, R - 0.02, 0.04, 28), { pos: [0, trayY - 0.02, 0] }), tint: woodDark });
  const wall = lathe(
    [
      [R - 0.045, trayY - 0.02],
      [R, trayY - 0.02],
      [R + 0.005, trayY + 0.12],
      [R - 0.035, trayY + 0.13],
      [R - 0.045, trayY + 0.02],
    ],
    32,
    6,
    0.4,
  );
  out.push({ key: "pine", geo: wall, tint: wood });
  // four chunky posts, rising a little above the wall, with a peg through each
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const px = Math.cos(a) * (R + 0.01);
    const pz = Math.sin(a) * (R + 0.01);
    out.push({ key: "pine", geo: place(tiledBox(0.085, trayY + 0.2, 0.085, 0.5), { pos: [px, (trayY + 0.2) / 2, pz], rot: [0, -a, 0] }), tint: woodDark });
    out.push({ key: "pine", geo: place(tiledBox(0.16, 0.03, 0.03, 0.5), { pos: [px * 1.04, trayY + 0.06, pz * 1.04], rot: [0, -a, 0] }), tint: wood });
  }
  // the stones: the lower one sits in the tray, the upper one turns on it; their rims dressed with grooves
  const stoneR = 0.28;
  const lower = cylinder(stoneR, stoneR + 0.006, 0.15, 36);
  place(lower, { pos: [0, trayY + 0.075, 0] });
  const upper = cylinder(stoneR - 0.012, stoneR - 0.008, 0.14, 36);
  place(upper, { pos: [0, trayY + 0.15 + 0.008 + 0.07, 0] });
  for (const g of [lower, upper]) {
    // stretch the rim's texture round it so the grooves run vertical, and roughen the edge
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 4);
  }
  out.push({ key: "stone", geo: lower, tint: [0.95, 0.95, 0.96] });
  out.push({ key: "stone", geo: upper, tint: [0.88, 0.88, 0.9] });
  const topY = trayY + 0.15 + 0.008 + 0.14;
  // grain heaped round the eye on top, and flour spilled into the tray by the spout
  const heap = grainMound({ w: 0.36, d: 0.36, peak: 0.035, round: true, seg: 10, lump: 0.004, seed: 11 });
  place(heap, { pos: [0, topY + 0.001, 0] });
  out.push({ key: "grain", geo: heap, tint: o.tint, grain: o.grain });
  const spill = grainMound({ w: 0.2, d: 0.14, peak: 0.03, round: true, seg: 8, lump: 0.003, seed: 12 });
  place(spill, { pos: [Math.cos(o.spoutTurn) * 0.36, trayY, Math.sin(o.spoutTurn) * 0.36] });
  out.push({ key: "grain", geo: spill, tint: o.flourTint, grain: o.flour });
  // the spout: a little stone lip on the lower stone's rim
  out.push({ key: "stone", geo: place(tiledBox(0.07, 0.03, 0.08, 0.3), { pos: [Math.cos(o.spoutTurn) * (stoneR + 0.03), trayY + 0.03, Math.sin(o.spoutTurn) * (stoneR + 0.03)], rot: [0, -o.spoutTurn, 0] }) });
  // the peg handle: pale, worn wood, upright near the rim
  out.push({ key: "pine", geo: place(cylinder(0.019, 0.022, 0.36, 10), { pos: [stoneR - 0.06, topY + 0.18, 0] }), tint: [1.05, 1.02, 0.96] });
  const k = o.scale ?? 1;
  for (const p of out) place(p.geo.scale(k, k, k), { pos: [o.x, y0, o.z] });
  return out;
}

/** Copper conduit: straight runs with saddle clips, plus drops down a wall. */
export function conduit(points: V3[], r = 0.016): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    out.push({ key: "copper", geo: beam(points[i], points[i + 1], r * 2) });
    out.push({ key: "copper", geo: place(cylinder(r * 1.6, r * 1.6, 0.03, 10), { pos: points[i] }) });
  }
  return out;
}

/** A black ceiling track with cylindrical spot heads aimed at their targets, a bright lens in each. */
export function track(o: { x0: number; x1: number; y: number; z: number; heads: { x: number; target: V3 }[] }): Piece[] {
  const out: Piece[] = [{ key: "steel", geo: beam([o.x0, o.y, o.z], [o.x1, o.y, o.z], 0.035, 0.045) }];
  for (const h of o.heads) {
    const from: V3 = [h.x, o.y - 0.07, o.z];
    const dir = [h.target[0] - from[0], h.target[1] - from[1], h.target[2] - from[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    const u = dir.map((c) => c / len);
    const end: V3 = [from[0] + u[0] * 0.17, from[1] + u[1] * 0.17, from[2] + u[2] * 0.17];
    out.push({ key: "steel", geo: beam([h.x, o.y, o.z], from, 0.02) });
    out.push({ key: "steel", geo: beam(from, end, 0.085) });
    // the lens: a pale disc at the head's mouth (it reads as lit in the ceiling's shade)
    out.push({ key: "glow", geo: beam(end, [end[0] + u[0] * 0.004, end[1] + u[1] * 0.004, end[2] + u[2] * 0.004], 0.07), tint: [1, 0.92, 0.8] });
  }
  return out;
}

/** A recessed round downlight in the ceiling: a bright disc and a dark trim ring. */
export function downlight(o: { x: number; y: number; z: number }): Piece[] {
  const disc = cylinder(0.085, 0.085, 0.004, 16);
  place(disc, { pos: [o.x, o.y - 0.004, o.z] });
  const trim = cylinder(0.1, 0.1, 0.003, 16);
  place(trim, { pos: [o.x, o.y - 0.0015, o.z] });
  return [
    { key: "glow", geo: disc, tint: [1, 0.94, 0.84] },
    { key: "steel", geo: trim },
  ];
}

// ---------------------------------------------------------------- the backdrop: what shows beyond the zone

/** A produce stand as in the reference: a black steel frame carrying two tiers of tilted wooden crates. */
export function produceStand(o: { x0: number; x1: number; z0: number; z1: number }): Piece[] {
  const out: Piece[] = [];
  const w = o.x1 - o.x0;
  const d = o.z1 - o.z0;
  const cx = (o.x0 + o.x1) / 2;
  const cz = (o.z0 + o.z1) / 2;
  for (const x of [o.x0 + 0.03, o.x1 - 0.03])
    for (const z of [o.z0 + 0.03, o.z1 - 0.03]) out.push({ key: "steel", geo: place(tiledBox(0.04, 0.95, 0.04, 1), { pos: [x, 0.475, z] }) });
  out.push({ key: "steel", geo: place(tiledBox(w, 0.04, d, 1), { pos: [cx, 0.2, cz] }) });
  return out;
}

/** A gondola: a painted carcass with shelves on both faces (the backdrop's aisle 1). */
export function gondola(o: { x0: number; x1: number; z0: number; z1: number; h: number; shelves: number[] }): Piece[] {
  const out: Piece[] = [];
  const w = o.x1 - o.x0;
  const cx = (o.x0 + o.x1) / 2;
  const cz = (o.z0 + o.z1) / 2;
  out.push({ key: "paint", geo: place(tiledBox(w, o.h, 0.06, 1), { pos: [cx, o.h / 2, cz] }) });
  out.push({ key: "paint", geo: place(tiledBox(w, 0.12, o.z1 - o.z0, 1), { pos: [cx, 0.06, cz] }) });
  for (const y of o.shelves) out.push({ key: "paint", geo: place(tiledBox(w, 0.025, o.z1 - o.z0 - 0.04, 1), { pos: [cx, y, cz] }) });
  for (let x = o.x0; x <= o.x1 + 1e-6; x += 1.2) out.push({ key: "paint", geo: place(tiledBox(0.05, o.h, o.z1 - o.z0, 1), { pos: [x, o.h / 2, cz] }), tint: [0.9, 0.9, 0.9] });
  return out;
}
