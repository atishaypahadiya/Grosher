// The shelf kit's packaged products: stand-up pouches in three sizes, kraft bags, woven 1 / 5 / 10 kg sacks,
// tall cartons, glass jars, spice jars, ghee tins, glass oil bottles, tins, and stacked clay pots with lids.
// Each template is built once at the origin (base centre, front facing +z) as parts per material; a zone
// places copies (any position, yaw, lean and scale) and merges them per material, so a shelf of a thousand
// packs is still one draw call per material. Label UVs: the front takes a label cell's front region
// (u 13/128 → 1), everything else its 12 px side strip (the pack's plain colour); a cylinder's label covers
// its front half. `front` is each kind's label front in metres, which the generator draws at that aspect.

import { BoxGeometry, type BufferGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clean, cylinder, lathe, place } from "./geom.ts";
import type { ProductKind } from "../bulk/recipe.ts";

export const FRONT_U0 = 13 / 128;
const STRIP_U = [2 / 128, 10 / 128];

/** what a product is made of: label (the labels atlas), glass, grain (what shows inside), lid, metal, clay */
export type ProductPart = "label" | "glass" | "grain" | "lid" | "metal" | "terracotta";
export type Template = Partial<Record<ProductPart, BufferGeometry>> & { size: [number, number, number]; front: [number, number] };

/** Map a box-like geometry's faces: +z-facing triangles take the front region (their 0–1 UVs), the rest the strip. */
function labelUVs(g: BufferGeometry, frontTest = (nz: number) => nz > 0.7): BufferGeometry {
  const nor = g.getAttribute("normal");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    if (frontTest(nor.getZ(i))) uv.setX(i, FRONT_U0 + uv.getX(i) * (1 - FRONT_U0));
    else uv.setXY(i, STRIP_U[0] + uv.getX(i) * (STRIP_U[1] - STRIP_U[0]), uv.getY(i));
  }
  return g;
}

/** A cylinder band whose front half (facing +z) carries the label and back half the strip. */
function labelBand(r: number, h: number, y: number, seg: number): BufferGeometry {
  const g = cylinder(r, r, h, seg, true);
  place(g, { pos: [0, y, 0] });
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getX(i), pos.getZ(i)); // 0 facing +z
    const v = (pos.getY(i) - (y - h / 2)) / h;
    if (Math.abs(a) <= Math.PI / 2 + 1e-4) uv.setXY(i, FRONT_U0 + (0.5 + a / Math.PI) * (1 - FRONT_U0), v);
    else uv.setXY(i, STRIP_U[0] + 0.5 * (STRIP_U[1] - STRIP_U[0]), v);
  }
  return g;
}

/** Bulge a box's faces outward (pillow sacks, pouches): `k` metres at the middle of each face. */
function bulge(g: BufferGeometry, w: number, h: number, d: number, kz: number, kx = 0) {
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (w / 2);
    const y = pos.getY(i) / (h / 2);
    const z = pos.getZ(i);
    const fx = Math.cos((x * Math.PI) / 2);
    const fy = Math.cos((y * Math.PI) / 2);
    if (Math.abs(z) > 1e-4) pos.setZ(i, z + Math.sign(z) * kz * fx * fy);
    if (kx && Math.abs(pos.getX(i)) > 1e-4) pos.setX(i, pos.getX(i) + Math.sign(pos.getX(i)) * kx * fy * Math.cos((z / (d / 2) * Math.PI) / 2));
  }
  g.computeVertexNormals();
}

/** A stand-up pouch: a gusseted base, the top pinched flat and sealed. */
function pouch(w: number, h: number, d: number): Template {
  const g = clean(new BoxGeometry(w, h, d, 1, 4, 1));
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + h / 2) / h;
    const squeeze = t > 0.62 ? 1 - ((t - 0.62) / 0.38) * 0.82 : 1 + Math.sin(t * Math.PI) * 0.08;
    pos.setZ(i, pos.getZ(i) * squeeze);
    pos.setY(i, pos.getY(i) + h / 2);
  }
  g.computeVertexNormals();
  return { label: labelUVs(g), size: [w, h, d], front: [w, h] };
}

/** A kraft paper bag with its top rolled down twice. */
function kraftBag(w = 0.15, h = 0.24, d = 0.1): Template {
  const body = clean(new BoxGeometry(w, h, d, 1, 1, 1));
  place(body, { pos: [0, h / 2, 0] });
  labelUVs(body);
  const roll = clean(new BoxGeometry(w * 1.01, 0.035, d * 0.55));
  place(roll, { pos: [0, h + 0.0175, 0] });
  labelUVs(roll, () => false);
  return { label: mergeGeometries([body, roll])!, size: [w, h + 0.035, d], front: [w, h] };
}

/** A woven polypropylene sack standing up, filled: bulging faces, a stitched seam across the top. */
function wovenSack(w: number, h: number, d: number): Template {
  const body = clean(new BoxGeometry(w, h, d, 3, 3, 1));
  bulge(body, w, h, d, d * 0.28, w * 0.04);
  place(body, { pos: [0, h / 2, 0] });
  labelUVs(body);
  const seam = clean(new BoxGeometry(w * 0.96, 0.03, d * 0.25));
  place(seam, { pos: [0, h + 0.012, 0] });
  labelUVs(seam, () => false);
  return { label: mergeGeometries([body, seam])!, size: [w, h + 0.025, d + d * 0.5], front: [w, h] };
}

/** A tall printed carton (oats, sooji). */
function carton(w = 0.09, h = 0.26, d = 0.065): Template {
  const g = clean(new BoxGeometry(w, h, d));
  place(g, { pos: [0, h / 2, 0] });
  return { label: labelUVs(g), size: [w, h, d], front: [w, h] };
}

/** A glass jar: the glass, the contents inside, a label band round the front, the lid. */
function jar(r = 0.05, h = 0.14, seg = 8): Template {
  const glass = lathe(
    [
      [0, 0],
      [r * 0.92, 0],
      [r, 0.012],
      [r, h * 0.86],
      [r * 0.82, h * 0.93],
      [r * 0.82, h],
    ],
    seg,
  );
  const fill = cylinder(r * 0.93, r * 0.93, h * 0.78, seg);
  place(fill, { pos: [0, h * 0.4, 0] });
  const lid = cylinder(r * 0.86, r * 0.86, 0.024, seg);
  place(lid, { pos: [0, h + 0.012, 0] });
  const lh = h * 0.42;
  return { glass, grain: fill, label: labelBand(r * 1.012, lh, h * 0.44, seg + 4), lid, size: [r * 2, h + 0.024, r * 2], front: [Math.PI * r, lh] };
}

/** A tin with its label wrapped round and a metal lid (its base stands on the shelf: never seen). */
function tin(r = 0.055, h = 0.12): Template {
  const body = labelBand(r, h, h / 2, 12);
  const top = cylinder(r * 1.01, r * 1.01, 0.012, 10);
  place(top, { pos: [0, h + 0.006, 0] });
  return { label: body, metal: top, size: [r * 2, h + 0.012, r * 2], front: [Math.PI * r, h] };
}

/** A ghee tin: a squat gold tin with a ring-pull lid. */
function gheeTin(r = 0.062, h = 0.15): Template {
  const t = tin(r, h);
  const ring = cylinder(r * 0.7, r * 0.7, 0.008, 8);
  place(ring, { pos: [0, h + 0.014, 0] });
  return { ...t, metal: mergeGeometries([t.metal!, ring])!, size: [r * 2, h + 0.018, r * 2] };
}

/** A glass oil bottle: body, shoulder, neck; the oil inside; a label on the front; a cap. */
function oilBottle(r = 0.034, h = 0.27, seg = 8): Template {
  const glass = lathe(
    [
      [0, 0],
      [r * 0.95, 0],
      [r, 0.01],
      [r, h * 0.6],
      [r * 0.7, h * 0.72],
      [r * 0.38, h * 0.8],
      [r * 0.36, h * 0.95],
      [r * 0.4, h],
    ],
    seg,
  );
  const oil = lathe(
    [
      [0, 0.005],
      [r * 0.92, 0.008],
      [r * 0.92, h * 0.6],
      [r * 0.62, h * 0.71],
      [r * 0.32, h * 0.77],
      [0, h * 0.77],
    ],
    seg,
  );
  const cap = cylinder(r * 0.44, r * 0.44, 0.03, seg);
  place(cap, { pos: [0, h + 0.012, 0] });
  const lh = h * 0.34;
  return { glass, grain: oil, label: labelBand(r * 1.012, lh, h * 0.32, seg + 4), lid: cap, size: [r * 2, h + 0.03, r * 2], front: [Math.PI * r, lh] };
}

/** A small spice jar with a coloured cap. */
function spiceJar(): Template {
  const t = jar(0.03, 0.085, 8);
  return { ...t, front: [Math.PI * 0.03, 0.085 * 0.42] };
}

export const TEMPLATES: Record<ProductKind, () => Template> = {
  pouchS: () => pouch(0.1, 0.16, 0.05),
  pouchM: () => pouch(0.13, 0.21, 0.065),
  pouchL: () => pouch(0.16, 0.26, 0.08),
  kraft: () => kraftBag(),
  sack1: () => wovenSack(0.14, 0.22, 0.06),
  sack5: () => wovenSack(0.3, 0.44, 0.1),
  sack10: () => wovenSack(0.38, 0.56, 0.13),
  carton: () => carton(),
  jar: () => jar(),
  spiceJar: () => spiceJar(),
  gheeTin: () => gheeTin(),
  oilBottle: () => oilBottle(),
  tin: () => tin(),
};

/** A matka (clay pot) and, optionally, its lid: for stacks on the top shelf. */
export function matka(r: number, h: number, withLid: boolean, seg = 12): BufferGeometry {
  const body = lathe(
    [
      [0, 0],
      [r * 0.45, 0],
      [r * 0.82, h * 0.14],
      [r, h * 0.44],
      [r * 0.86, h * 0.74],
      [r * 0.52, h * 0.9],
      [r * 0.5, h * 0.96],
      [r * 0.58, h],
      [r * 0.48, h],
    ],
    seg,
    2,
    1,
  );
  if (!withLid) return body;
  const lid = lathe(
    [
      [0, h + 0.045],
      [r * 0.12, h + 0.045],
      [r * 0.1, h + 0.03],
      [r * 0.3, h + 0.022],
      [r * 0.62, h + 0.004],
      [r * 0.64, h - 0.004],
    ],
    seg,
    1,
    1,
  );
  return mergeGeometries([body, lid])!;
}

// ---------------------------------------------------------------- the standard close-ups' packs
// More shapes for every other shelf in the store (src/hero/standard): what a category's goods come in.
// Every one carries its category's house label (the categories atlas) on the front.

/** A plain printed box (cereal, crackers, pharmacy, frozen meals, a drinks case, a multipack). */
export function packBox(w: number, h: number, d: number): Template {
  const g = clean(new BoxGeometry(w, h, d));
  place(g, { pos: [0, h / 2, 0] });
  return { label: labelUVs(g), size: [w, h, d], front: [w, h] };
}

/** A puffy bag of chips: a pouch blown out at the middle, crimped flat at top and bottom. */
function chipBag(w = 0.22, h = 0.3, d = 0.07): Template {
  const g = clean(new BoxGeometry(w, h, d, 1, 6, 1));
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + h / 2) / h;
    pos.setZ(i, pos.getZ(i) * Math.sin(Math.PI * Math.min(1, Math.max(0, t * 1.04 - 0.02))) * 1.1);
    pos.setY(i, pos.getY(i) + h / 2);
  }
  g.computeVertexNormals();
  return { label: labelUVs(g), size: [w, h, d], front: [w, h] };
}

/** A plastic bottle with a wide shoulder (detergent, shampoo, dish soap): opaque, the label on its front. */
function plasticBottle(r = 0.045, h = 0.24): Template {
  const body = lathe(
    [
      [0, 0],
      [r * 0.95, 0],
      [r, 0.01],
      [r, h * 0.72],
      [r * 0.7, h * 0.85],
      [r * 0.32, h * 0.9],
      [r * 0.32, h],
      [0, h],
    ],
    8,
  );
  // the body takes the label's side strip colour; the band on its front is the label
  const uv = body.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, STRIP_U[0] + 0.5 * (STRIP_U[1] - STRIP_U[0]), 0.5);
  const cap = cylinder(r * 0.36, r * 0.36, 0.03, 8);
  place(cap, { pos: [0, h + 0.015, 0] });
  return { label: mergeGeometries([body, labelBand(r * 1.012, h * 0.5, h * 0.38, 8)])!, lid: cap, size: [r * 2, h + 0.03, r * 2], front: [Math.PI * r, h * 0.5] };
}

/** A wine or spirits bottle: dark glass, a long neck, a paper label, a capsule. */
function wineBottle(r = 0.038, h = 0.3): Template {
  const glass = lathe(
    [
      [0, 0],
      [r * 0.95, 0],
      [r, 0.01],
      [r, h * 0.62],
      [r * 0.55, h * 0.74],
      [r * 0.3, h * 0.8],
      [r * 0.3, h],
      [0, h],
    ],
    6,
  );
  const capsule = cylinder(r * 0.33, r * 0.33, h * 0.12, 6);
  place(capsule, { pos: [0, h * 0.94, 0] });
  const lh = h * 0.28;
  return { metal: glass, lid: capsule, label: labelBand(r * 1.012, lh, h * 0.3, 8), size: [r * 2, h, r * 2], front: [Math.PI * r, lh] };
}

/** A gallon jug: a squared body, a neck and cap, a handle bulge; the label on its front. */
function jug(w = 0.15, h = 0.26, d = 0.15): Template {
  const body = clean(new BoxGeometry(w, h * 0.82, d, 1, 2, 1));
  place(body, { pos: [0, (h * 0.82) / 2, 0] });
  labelUVs(body);
  const shoulder = clean(new BoxGeometry(w * 0.6, h * 0.1, d * 0.6));
  place(shoulder, { pos: [-w * 0.15, h * 0.87, 0] });
  labelUVs(shoulder, () => false);
  const cap = cylinder(0.022, 0.022, 0.03, 8);
  place(cap, { pos: [-w * 0.15, h * 0.95, 0] });
  return { label: mergeGeometries([body, shoulder])!, lid: cap, size: [w, h, d], front: [w, h * 0.82] };
}

/** A tub (yogurt cup, ice cream pint, butter, dip): a tapered cylinder with a lid; the label round its front. */
function tub(r: number, h: number): Template {
  const body = labelBand(r, h, h / 2, 12);
  const lid = cylinder(r * 1.04, r * 1.04, 0.01, 12);
  place(lid, { pos: [0, h + 0.005, 0] });
  return { label: body, lid, size: [r * 2, h + 0.01, r * 2], front: [Math.PI * r, h] };
}

/** A meat or fish tray: a shallow tray under clear film, the label on the film. */
function tray(w = 0.24, h = 0.05, d = 0.17): Template {
  const g = clean(new BoxGeometry(w, h, d));
  place(g, { pos: [0, h / 2, 0] });
  // the label is on top, facing up and toward the shopper: the top takes the front region
  return { label: labelUVs(g, (nz) => nz > 0.7), size: [w, h, d], front: [w, h] };
}

/** A cheese wedge: a triangular prism lying on its side, the rind label on its long face. */
function wedge(w = 0.13, h = 0.06, d = 0.1): Template {
  const shape = clean(new BoxGeometry(w, h, d));
  const pos = shape.getAttribute("position");
  for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < 0) pos.setX(i, pos.getX(i) * 0.15);
  shape.computeVertexNormals();
  place(shape, { pos: [0, h / 2, 0] });
  return { label: labelUVs(shape), size: [w, h, d], front: [w, h] };
}

/** A loaf in its bag: a rounded box, the bag's label on its front. */
function loaf(w = 0.12, h = 0.12, d = 0.26): Template {
  const g = clean(new BoxGeometry(w, h, d, 1, 3, 1));
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / (h / 2);
    if (y > 0) pos.setX(i, pos.getX(i) * (1 - 0.25 * y * y));
  }
  g.computeVertexNormals();
  place(g, { pos: [0, h / 2, 0] });
  return { label: labelUVs(g), size: [w, h, d], front: [w, h] };
}

export type StandardStyle =
  | "carton"
  | "cereal"
  | "smallbox"
  | "pouch"
  | "bag"
  | "tin"
  | "jar"
  | "spice"
  | "bottle"
  | "plastic"
  | "wine"
  | "jug"
  | "cup"
  | "pint"
  | "tray"
  | "wedge"
  | "loaf"
  | "eggs"
  | "bigpack"
  | "case"
  | "sack"
  | "kraft"
  | "frozen";

export const STANDARD_TEMPLATES: Record<StandardStyle, () => Template> = {
  carton: () => packBox(0.09, 0.22, 0.06),
  cereal: () => packBox(0.2, 0.29, 0.07),
  smallbox: () => packBox(0.08, 0.11, 0.04),
  pouch: () => pouch(0.13, 0.21, 0.065),
  bag: () => chipBag(),
  tin: () => tin(0.042, 0.11),
  // the standard close-ups' glass is a little coarser than Bulk's (6 sides): a shelf holds hundreds
  jar: () => jar(0.042, 0.12, 6),
  spice: () => jar(0.026, 0.085, 6),
  bottle: () => oilBottle(0.032, 0.22, 6),
  plastic: () => plasticBottle(),
  wine: () => wineBottle(),
  jug: () => jug(),
  cup: () => tub(0.042, 0.065),
  pint: () => tub(0.05, 0.11),
  tray: () => tray(),
  wedge: () => wedge(),
  loaf: () => loaf(),
  eggs: () => packBox(0.3, 0.07, 0.11),
  bigpack: () => packBox(0.3, 0.3, 0.24),
  case: () => packBox(0.28, 0.2, 0.36),
  sack: () => wovenSack(0.3, 0.44, 0.1),
  kraft: () => kraftBag(),
  frozen: () => packBox(0.2, 0.26, 0.05),
};
