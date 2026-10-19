// The shelf kit's fixed pieces: steel frames, pine planks, header boards, burlap sacks, clay pots with dried
// wheat, a stone chakki on its stand. Each returns world-space geometry under a material key; zone recipes
// (src/hero/<zone>/zone.ts) place them, bake them and merge them per key.

import type { BufferGeometry } from "three";
import { beam, clean, cylinder, gridPlane, lathe, place, roundedPlank, tiledBox, toRect, type Rect, type V3 } from "./geom.ts";
import { PlaneGeometry } from "three";

export interface Piece {
  key: MaterialKey;
  geo: BufferGeometry;
  /** multiplied into the baked light (a grain's colour, the straw's) */
  tint?: V3;
}

/** The kit's materials; zone.ts maps each to one merged mesh. */
export type MaterialKey = "plaster" | "ceiling" | "concrete" | "pine" | "steel" | "copper" | "header" | "burlap" | "grain" | "terracotta" | "stone" | "straw";

const STEEL_W = 0.04; // square steel tube

/**
 * Shelving: black powder-coated square-steel uprights at every bay boundary (front and back), rails under
 * every tier, a top rail; light pine planks with rounded edges on every tier.
 */
export function shelving(o: { x0: number; x1: number; zBack: number; zFront: number; bays: number; tiers: number[]; top: number }): Piece[] {
  const out: Piece[] = [];
  const bay = (o.x1 - o.x0) / o.bays;
  for (let b = 0; b <= o.bays; b++) {
    const x = o.x0 + b * bay;
    for (const z of [o.zBack + STEEL_W / 2, o.zFront - STEEL_W / 2]) out.push({ key: "steel", geo: place(tiledBox(STEEL_W, o.top, STEEL_W, 0.5), { pos: [x, o.top / 2, z] }) });
    // side braces at every tier
    for (const y of [...o.tiers, o.top - 0.02]) out.push({ key: "steel", geo: beam([x, y - 0.02, o.zBack + STEEL_W], [x, y - 0.02, o.zFront - STEEL_W], 0.025) });
  }
  for (const y of [...o.tiers, o.top - 0.02]) {
    out.push({ key: "steel", geo: beam([o.x0, y - 0.025, o.zFront - STEEL_W / 2], [o.x1, y - 0.025, o.zFront - STEEL_W / 2], 0.03) });
    out.push({ key: "steel", geo: beam([o.x0, y - 0.025, o.zBack + STEEL_W / 2], [o.x1, y - 0.025, o.zBack + STEEL_W / 2], 0.03) });
  }
  const depth = o.zFront - o.zBack - 0.02;
  for (let b = 0; b < o.bays; b++) {
    const len = bay - STEEL_W - 0.01;
    const cx = o.x0 + (b + 0.5) * bay;
    for (const y of o.tiers) out.push({ key: "pine", geo: place(roundedPlank(len, 0.028, depth, 0.007), { pos: [cx + ((b * 7) % 3) * 0.001, y + 0.014, (o.zBack + o.zFront) / 2] }) });
  }
  return out;
}

/** A black header board with white lettering from the headers atlas, facing +z (or −z). */
export function headerBoard(o: { x0: number; x1: number; y0: number; y1: number; z: number; rect: Rect; facing?: 1 | -1 }): Piece[] {
  const f = o.facing ?? 1;
  const w = o.x1 - o.x0;
  const h = o.y1 - o.y0;
  const face = clean(new PlaneGeometry(w, h));
  toRect(face, o.rect);
  if (f === -1) face.rotateY(Math.PI);
  place(face, { pos: [(o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, o.z + f * 0.011] });
  const back = place(tiledBox(w + 0.01, h + 0.01, 0.02, 1), { pos: [(o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, o.z] });
  return [
    { key: "header", geo: face },
    { key: "steel", geo: back },
  ];
}

/** A grain pile's top: a disc (or rectangle) mounded in the middle, UVs into a grains-atlas cell. */
export function grainMound(o: { w: number; d: number; peak: number; rect: Rect; round?: boolean; seg?: number }): BufferGeometry {
  const seg = o.seg ?? 10;
  const g = gridPlane(o.w, o.d, Math.max(o.w, o.d) / seg, 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  const span = Math.max(o.w, o.d);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = o.round ? Math.hypot(x / (o.w / 2), z / (o.d / 2)) : Math.max(Math.abs(x) / (o.w / 2), Math.abs(z) / (o.d / 2));
    const k = Math.max(0, 1 - r);
    pos.setY(i, o.peak * Math.sin((k * Math.PI) / 2) ** 1.4);
    if (o.round && r > 1) {
      // pull the corners in onto the circle
      pos.setX(i, (x / r) * 1);
      pos.setZ(i, (z / r) * 1);
    }
    uv.setXY(i, 0.5 + x / span, 0.5 - z / span);
  }
  g.computeVertexNormals();
  toRect(g, o.rect, 6);
  return g;
}

/** An open burlap sack with a rolled rim, full of grain mounded at the top. */
export function sack(o: { x: number; z: number; r: number; h: number; grainRect: Rect; tint: V3; seed?: number }): Piece[] {
  const { r, h } = o;
  // the body bulges a little, slumps at the base and flares under the roll
  const profile: [number, number][] = [
    [0, 0],
    [r * 0.82, 0.005],
    [r * 0.98, h * 0.12],
    [r * 1.03, h * 0.45],
    [r * 0.99, h * 0.8],
    [r * 1.05, h * 0.9],
  ];
  const body = place(lathe(profile, 22, 3, 2), { pos: [o.x, 0, o.z] });
  // the rolled rim: a fat torus-ish lathe of a circle
  const roll: [number, number][] = [];
  const rr = 0.035;
  for (let k = 0; k <= 10; k++) {
    const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
    roll.push([r * 1.05 + rr + Math.cos(a) * rr, h * 0.9 + Math.sin(a) * rr]);
  }
  const rim = place(lathe(roll, 22, 6, 1), { pos: [o.x, 0, o.z] });
  const pile = place(grainMound({ w: r * 2.04, d: r * 2.04, peak: r * 0.32, rect: o.grainRect, round: true, seg: 14 }), { pos: [o.x, h * 0.86, o.z] });
  return [
    { key: "burlap", geo: body },
    { key: "burlap", geo: rim },
    { key: "grain", geo: pile, tint: o.tint },
  ];
}

/** A clay pot (a matka shape) standing on y = 0 at x, z. */
export function clayPot(o: { x: number; y?: number; z: number; r: number; h: number }): Piece[] {
  const { r, h } = o;
  const profile: [number, number][] = [
    [0, 0],
    [r * 0.45, 0],
    [r * 0.8, h * 0.12],
    [r, h * 0.42],
    [r * 0.88, h * 0.72],
    [r * 0.52, h * 0.9],
    [r * 0.5, h * 0.97],
    [r * 0.58, h],
    [r * 0.5, h * 1.0],
    [r * 0.44, h * 0.93],
  ];
  return [{ key: "terracotta", geo: place(lathe(profile, 20, 2, 1), { pos: [o.x, o.y ?? 0, o.z] }) }];
}

/** Dried wheat stalks fanning out of a pot's neck: thin stalks and seed heads, one straw-coloured mesh. */
export function wheatBundle(o: { x: number; y: number; z: number; count: number; height: number; rand: () => number }): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < o.count; i++) {
    const a = o.rand() * Math.PI * 2;
    const lean = 0.08 + o.rand() * 0.22;
    const h = o.height * (0.8 + o.rand() * 0.3);
    const base: V3 = [o.x + Math.cos(a) * 0.03, o.y, o.z + Math.sin(a) * 0.03];
    const top: V3 = [base[0] + Math.cos(a) * lean * h, o.y + h, base[2] + Math.sin(a) * lean * h];
    out.push({ key: "straw", geo: beam(base, top, 0.006) });
    // the ear: a slim spindle along the stalk's last 9 cm
    const ear = lathe(
      [
        [0, 0],
        [0.009, 0.02],
        [0.011, 0.05],
        [0.007, 0.08],
        [0, 0.095],
      ],
      6,
    );
    const dir = [top[0] - base[0], top[1] - base[1], top[2] - base[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    const pitch = Math.acos(dir[1] / len);
    out.push({ key: "straw", geo: place(ear, { pos: top, rot: [Math.sin(a) * pitch, 0, -Math.cos(a) * pitch] }), tint: [0.9, 0.78, 0.5] });
  }
  return out;
}

/** A stone chakki (hand quern) on a low wooden stand: two stones, the upper one's eye and its peg handle. */
export function chakki(o: { x: number; z: number }): Piece[] {
  const out: Piece[] = [];
  const top = 0.42;
  // the stand: four legs and a slatted top
  for (const [dx, dz] of [
    [-0.26, -0.26],
    [0.26, -0.26],
    [-0.26, 0.26],
    [0.26, 0.26],
  ])
    out.push({ key: "pine", geo: place(tiledBox(0.06, top - 0.04, 0.06, 0.6), { pos: [o.x + dx, (top - 0.04) / 2, o.z + dz] }) });
  for (let k = -2; k <= 2; k++) out.push({ key: "pine", geo: place(roundedPlank(0.64, 0.04, 0.115, 0.008, 0.8), { pos: [o.x, top - 0.02, o.z + k * 0.125] }) });
  out.push({ key: "stone", geo: place(cylinder(0.3, 0.31, 0.1, 28), { pos: [o.x, top + 0.05, o.z] }) });
  out.push({ key: "stone", geo: place(cylinder(0.285, 0.29, 0.085, 28), { pos: [o.x, top + 0.143, o.z] }) });
  // the eye where grain is fed, a dark ring, and the peg handle
  out.push({ key: "steel", geo: place(cylinder(0.045, 0.045, 0.006, 16), { pos: [o.x, top + 0.188, o.z] }) });
  out.push({ key: "pine", geo: place(cylinder(0.018, 0.02, 0.2, 10), { pos: [o.x + 0.22, top + 0.27, o.z] }) });
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

/** A black ceiling track with spot heads aimed at their targets. */
export function track(o: { x0: number; x1: number; y: number; z: number; heads: { x: number; target: V3 }[] }): Piece[] {
  const out: Piece[] = [{ key: "steel", geo: beam([o.x0, o.y, o.z], [o.x1, o.y, o.z], 0.035, 0.045) }];
  for (const h of o.heads) {
    const from: V3 = [h.x, o.y - 0.06, o.z];
    const dir = [h.target[0] - from[0], h.target[1] - from[1], h.target[2] - from[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    const end: V3 = [from[0] + (dir[0] / len) * 0.16, from[1] + (dir[1] / len) * 0.16, from[2] + (dir[2] / len) * 0.16];
    out.push({ key: "steel", geo: beam([h.x, o.y, o.z], from, 0.02) });
    out.push({ key: "steel", geo: beam(from, end, 0.075) });
  }
  return out;
}
