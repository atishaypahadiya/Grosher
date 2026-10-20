// Grosher's Bulk & pulses zone, assembled from the shelf kit: an aisle with shelving both sides, as in the
// reference pulses store. The wall run (five sections under their header boards: woven sacks low, kraft bags,
// pouches, cartons, jars, ghee tins, oil bottles and spice jars above, gravity bins at eye level, clay pots
// stacked on top) faces the south run across 2.6 m (a waist-high counter of scoop bins, three tiers of snack
// packs above, four header boards); the centerpiece stands in the aisle's mouth (open jute sacks, a stone
// chakki in its tray, a big clay pot of dried wheat); the clay-plaster wall,
// a ceiling over the zone only (copper conduit, black tracks of spots, recessed downlights) and, beyond it,
// the next fixtures as the shopper would see them: produce stands under the skylight, the aisle 1 gondola,
// the beer aisle. Light is per pixel (light.ts); this file only places the lights and the slabs that cast
// the shelves' shadows.
//
// Pure geometry: no textures, no React. HeroZone.tsx turns the result into meshes.

import { BoxGeometry, BufferAttribute, type BufferGeometry, Matrix4, Quaternion, Shape, ShapeGeometry, Path, Vector3, Euler } from "three";
import { colorize, constant, hex, type Occlusion } from "../kit/bake.ts";
import { Batch, clean, gridPlane, place, rng, tiledBox, beam, type V3, type Rect } from "../kit/geom.ts";
import { chakki, clayPot, conduit, downlight, gondola, grainMound, headerBoard, produceStand, sack, shelving, track, wheatSheaf, type MaterialKey, type Piece } from "../kit/pieces.ts";
import { BIN, BIN_FILL, gravityBin, SCOOP, scoopBin } from "../kit/templates.ts";
import { matka, TEMPLATES, type ProductPart, type Template } from "../kit/products.ts";
import { DAYLIGHT, scaled, WARM_3000K, type LightRig, type ZoneLightDef } from "../kit/light.ts";
import type { Decal } from "../kit/decals.ts";
import type { KitMaterialKey } from "../kit/materials.ts";
import { earRect, fringeRect, GRAIN_SHAPES, GRAINS, headerRect, labelCells, labelKey, labelRect, RUN_SECTIONS, SACKS, SCOOP_BINS, SCOOP_CATEGORY, SECTIONS, shapeIndex, stencilRect, tagRect, type BinItem, type GrainShape, type Stock } from "./recipe.ts";

// ---------------------------------------------------------------- the plan (map metres; z is the map's y)
const WALL_Z = 1.5;
const PLANK = 0.034;
export const SHELF = { x0: 50, x1: 68, zBack: 1.55, zFront: 2.2, bays: 15, tiers: [0.06, 0.62, 0.97, 1.3, 2.06], top: 2.1 };
/** the south run, facing the wall (−z): a counter of scoop bins, three tiers of packs set back above it */
export const RUN = { x0: 52.4, x1: 68, zFront: 4.8, zBack: 5.45, shelfFront: 5.08, counter: 0.9, tiers: [1.5, 1.82, 2.14], top: 2.18, bays: 13 };
/** the centerpiece, in the aisle's mouth, south of the walking line (y 3.5) */
export const MOUTH = { x0: 50.3, x1: 52.1, z0: 3.75, z1: 4.7 };
/** the walking line down the aisle (the map's corridor) */
const AISLE_Z = 3.5;
export const CEILING = 4.4;
/** the zone's own ceiling: over both runs, the aisle and the centerpiece, nowhere else */
export const CEIL = { x0: 49.4, x1: 68.6, z0: WALL_Z, z1: 6.0 };
/** the floor drawn at the zone's finish (the rest of the store's floor around it) */
const ZONE = { x0: 46, x1: 72, z0: 0, z1: 9.6 };
/** overview fixtures the close-up replaces: its own three, and the backdrop it redraws */
export const HIDE_FIXTURES = ["f-bulk-wall", "f-bulk-run", "f-bulk-display", "f-island3", "f-island4", "f-island7", "f-island8", "f-produce-wall", "f-run0", "f-run0-capE", "f-bws0", "f-bws0-capW", "f-bws0-capE"];
export const EYE = 1.6;

/** the plain parts merged into the "steel" mesh (a white material), each with its own colour */
const SOLID: Partial<Record<MaterialKey, V3>> = { steel: hex("#262422"), copper: hex("#C27A4A"), paint: hex("#CFC7BA"), lid: [1, 1, 1], metal: [1, 1, 1] };

const shapeOf = (grain: keyof typeof GRAINS): GrainShape => GRAIN_SHAPES[shapeIndex(GRAINS[grain].shape)];
const grainAttr = (grain: keyof typeof GRAINS): [number, number] => {
  const i = shapeIndex(GRAINS[grain].shape);
  return [i, GRAIN_SHAPES[i].cellM];
};

// ---------------------------------------------------------------- light
/**
 * The light, as in the reference: an even, warm fill (the zone's hemisphere, HeroZone.tsx) that does most of
 * the work, and the track spots as accents on the shelf faces, their pools crisp but not stark.
 */
export const ACCENT = 0.62;
export function bulkRig(): LightRig {
  const lights: ZoneLightDef[] = [];
  const spot = (pos: V3, target: V3, angle: number, k: number, softness = 0.1, color: V3 = WARM_3000K, reach = 5): ZoneLightDef => ({ pos, target, angle, softness, color: scaled(color, k), reach });
  // track A, over the aisle's north half: a spot per 1.8 m on the wall run's face
  for (let k = 0; k < 10; k++) {
    const x = 50.9 + k * 1.8;
    lights.push(spot([x, CEILING - 0.2, 3.15], [x, 1.2, SHELF.zFront], 0.3, 9.5 * ACCENT));
  }
  // track B, over its south half: a spot per 1.8 m on the south run's face
  for (let k = 0; k < 9; k++) {
    const x = 53.2 + k * 1.8;
    lights.push(spot([x, CEILING - 0.2, 3.85], [x, 1.35, RUN.zFront], 0.3, 9 * ACCENT));
  }
  // the centerpiece: one on the chakki, one on the pot of wheat
  lights.push(spot([50.8, CEILING - 0.2, 3.1], [51.2, 0.4, 4.22], 0.24, 8 * ACCENT));
  lights.push(spot([52.4, CEILING - 0.2, 3.5], [52.0, 0.7, 4.42], 0.22, 7.5 * ACCENT));
  // recessed downlights down the middle of the aisle: round pools on the floor
  for (let k = 0; k < 5; k++) lights.push(spot([51.8 + k * 3.6, CEILING, AISLE_Z], [51.8 + k * 3.6, 0, AISLE_Z], 0.2, 3.6 * ACCENT, 0.1));
  // beyond the zone: daylight on the produce under the skylight, and a warm wash on the aisle 1 gondola
  lights.push(spot([31, 18, 8], [31, 0, 8], 0.78, 34, 0.55, DAYLIGHT, 40));
  for (const x of [40, 46, 52]) lights.push(spot([x, 5.6, 13.6], [x, 0.9, 15.8], 0.55, 5.5, 0.4, WARM_3000K, 8));
  const slabs = [
    ...SHELF.tiers.map((y) => ({ x0: SHELF.x0 + 0.02, x1: SHELF.x1 - 0.02, z0: SHELF.zBack, z1: SHELF.zFront - 0.004, y: y + PLANK / 2 })),
    ...RUN.tiers.map((y) => ({ x0: RUN.x0 + 0.02, x1: RUN.x1 - 0.02, z0: RUN.shelfFront + 0.004, z1: RUN.zBack, y: y + PLANK / 2 })),
    { x0: RUN.x0, x1: RUN.x1, z0: RUN.zFront, z1: RUN.zBack, y: RUN.counter },
  ];
  return { lights, slabs, reference: 2.6 };
}

/** the dark a hemisphere light misses: under each plank, toward the back of the shelf, at the wall's foot */
const occlusion: Occlusion = (p, n) => {
  let o = 1;
  const inShelf = p.x > SHELF.x0 - 0.05 && p.x < SHELF.x1 + 0.05 && p.z < SHELF.zFront + 0.02 && p.z > WALL_Z - 0.01;
  if (inShelf && p.y < SHELF.top + 0.05) {
    for (const t of SHELF.tiers) if (p.y < t && t - p.y < 0.14) o *= 0.62 + ((t - p.y) / 0.14) * 0.38;
    o *= 0.72 + 0.28 * Math.min(1, Math.max(0, (p.z - SHELF.zBack) / (SHELF.zFront - SHELF.zBack)));
  }
  // the south run's upper tiers: under each plank, and deeper toward its back
  const inRun = p.x > RUN.x0 - 0.05 && p.x < RUN.x1 + 0.05 && p.z > RUN.shelfFront - 0.02 && p.z < RUN.zBack + 0.01;
  if (inRun && p.y > RUN.counter && p.y < RUN.top + 0.05) {
    for (const t of RUN.tiers) if (p.y < t && t - p.y < 0.14) o *= 0.62 + ((t - p.y) / 0.14) * 0.38;
    o *= 0.72 + 0.28 * Math.min(1, Math.max(0, (RUN.zBack - p.z) / (RUN.zBack - RUN.shelfFront)));
  }
  if (n.y < -0.5 && p.y > CEILING - 0.05) o *= 0.9;
  return o;
};

// ---------------------------------------------------------------- instancing (the bins)
export interface InstanceSet {
  name: string;
  geo: BufferGeometry;
  material: KitMaterialKey;
  matrices: Matrix4[];
  colors: V3[];
  /** per-instance attributes: aCell (tags) or aGrain (fills) */
  attr?: { name: "aCell" | "aGrain"; size: number; values: number[][] };
}

const M = (pos: V3, rotY = 0, scale: V3 = [1, 1, 1], lean = 0, tip = 0) => new Matrix4().compose(new Vector3(...pos), new Quaternion().setFromEuler(new Euler(tip, rotY, lean)), new Vector3(...scale));

// ---------------------------------------------------------------- targets: where a stop's camera looks
export interface Target {
  category: string;
  name: string;
  grain: keyof typeof GRAINS;
  /** the instance sets and index of this bin's parts, to lift it */
  parts: { set: string; index: number }[];
  /** the bin's centre and size, for the lit slot */
  center: V3;
  size: V3;
  /** which way the bin faces (z): the shopper stands on that side */
  facing: 1 | -1;
  kind: "gravity" | "scoop";
  /** fill level (gravity bins: the fill's height in metres above its base) */
  level: number;
  /** where the walk in starts: eye level, outside the zone's ceiling */
  door: V3;
  /** the walk's turns between the door and where the shopper stands (along the aisle's walking line) */
  via: V3[];
  /** metres from the bin's centre to the shopper */
  stand: number;
  /** where an eye-level camera may pan along x, from this bin (never through the centerpiece) */
  bounds: { x0: number; x1: number };
}

export interface ZoneBuild {
  statics: Map<KitMaterialKey, BufferGeometry>;
  instances: InstanceSet[];
  decals: Decal[];
  targets: Target[];
  /** where an eye-level camera may pan along x */
  bounds: { x0: number; x1: number };
  triangles: number;
  /** every pack in placement order, by row: what the shopper sees side by side (tests: no two alike) */
  facings: { row: string; kind: Stock["kind"]; name: string; x: number }[];
}

export function buildBulkZone(outline: [number, number][] | undefined): ZoneBuild {
  const batch = new Batch();
  const decals: Decal[] = [];
  const rand = rng(5435);
  const { index } = labelCells();
  const cellOf = (kind: Stock["kind"], name: string): [number, number, number, number] => {
    const r = labelRect(index.get(labelKey(kind, name)) ?? 0);
    return [r[0], r[1], r[2] - r[0], r[3] - r[1]];
  };
  /** colour (tint × occlusion) and per-material attributes, then into the batch; the plain painted and
   * metal parts (steel, copper, paint, caps, tin lids) share one mesh, their colour in the tint */
  const add = (pieces: Piece[]) => {
    for (const p of pieces) {
      const base = SOLID[p.key];
      const t = p.tint ?? [1, 1, 1];
      colorize(p.geo, base ? [t[0] * base[0], t[1] * base[1], t[2] * base[2]] : t, occlusion);
      if (p.key === "label") constant(p.geo, "aCell", p.cell ?? [0, 0, 1, 1]);
      if (p.key === "grain") constant(p.geo, "aGrain", p.grain ?? [shapeIndex("powder"), 0.12]);
      batch.add(base ? "steel" : p.key, p.geo);
    }
  };
  const tagNames = [...SECTIONS.flatMap((s) => s.bins.map((b) => b.name)), ...SCOOP_BINS.map((b) => b.name)];

  // ---- shell: the clay-plaster wall behind the shelving, the floor, the zone's ceiling with a fascia round its open sides
  add([{ key: "plaster", geo: place(gridPlane(CEIL.x1 - CEIL.x0, CEILING, 4, 1.6), { pos: [(CEIL.x0 + CEIL.x1) / 2, CEILING / 2, WALL_Z] }) }]);
  const floor = gridPlane(ZONE.x1 - ZONE.x0, ZONE.z1 - ZONE.z0, 4, 2.4);
  floor.rotateX(-Math.PI / 2);
  add([{ key: "concrete", geo: place(floor, { pos: [(ZONE.x0 + ZONE.x1) / 2, 0.002, (ZONE.z0 + ZONE.z1) / 2] }) }]);
  // the ceiling faces down only: from above (the camera on its way down) it is not there at all
  const ceil = gridPlane(CEIL.x1 - CEIL.x0, CEIL.z1 - CEIL.z0, 4, 2.4);
  ceil.rotateX(Math.PI / 2);
  add([{ key: "ceiling", geo: place(ceil, { pos: [(CEIL.x0 + CEIL.x1) / 2, CEILING, (CEIL.z0 + CEIL.z1) / 2] }) }]);
  const FASCIA = 0.5;
  for (const [a, b] of [
    [
      [CEIL.x0, CEIL.z0],
      [CEIL.x0, CEIL.z1],
    ],
    [
      [CEIL.x0, CEIL.z1],
      [CEIL.x1, CEIL.z1],
    ],
    [
      [CEIL.x1, CEIL.z1],
      [CEIL.x1, CEIL.z0],
    ],
  ] as [number, number][][])
    add([{ key: "ceiling", geo: beam([a[0], CEILING - FASCIA / 2, a[1]], [b[0], CEILING - FASCIA / 2, b[1]], 0.06, FASCIA), tint: [0.92, 0.9, 0.88] }]);
  if (outline) {
    // the rest of the store's floor, with the zone cut out (no ceiling and no walls: beyond the zone the
    // store fades into the warm dark, and the camera's descent sees nothing but the floor and the fixtures)
    const shape = new Shape(outline.map(([x, y]) => ({ x, y }) as never));
    shape.holes.push(new Path([{ x: ZONE.x0, y: ZONE.z0 }, { x: ZONE.x1, y: ZONE.z0 }, { x: ZONE.x1, y: ZONE.z1 }, { x: ZONE.x0, y: ZONE.z1 }] as never));
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
    flipWinding(g);
    add([{ key: "concrete", geo: g }]);
  }

  // ---- overhead: copper conduit, the two black tracks, the downlights
  add(conduit([[CEIL.x0 + 0.6, CEILING - 0.1, WALL_Z + 0.08], [CEIL.x1 - 0.6, CEILING - 0.1, WALL_Z + 0.08]]));
  add(conduit([[49.7, 2.6, WALL_Z + 0.08], [49.7, CEILING - 0.1, WALL_Z + 0.08], [59, CEILING - 0.1, WALL_Z + 0.16], [59, CEILING - 0.1, CEIL.z1 - 0.2]]));
  add(conduit([[CEIL.x0 + 0.3, CEILING - 0.08, 4.55], [CEIL.x1 - 0.3, CEILING - 0.08, 4.55]]));
  const rig = bulkRig();
  for (const z of [3.35, 5.7]) {
    const heads = rig.lights.filter((l) => Math.abs(l.pos[2] - z) < 0.01 && l.pos[1] < CEILING - 0.1).map((l) => ({ x: l.pos[0], target: l.target }));
    add(track({ x0: CEIL.x0 + 0.4, x1: CEIL.x1 - 0.4, y: CEILING - 0.04, z, heads }));
  }
  const centre = rig.lights.filter((l) => l.pos[2] === 4.7 || l.pos[2] === 5.6);
  add(track({ x0: 50.2, x1: 52.6, y: CEILING - 0.04, z: 5.15, heads: centre.map((l) => ({ x: l.pos[0], target: l.target })) }));
  for (const l of rig.lights) if (l.pos[1] === CEILING) add(downlight({ x: l.pos[0], y: CEILING, z: l.pos[2] }));

  // ---- the wall shelving and its header boards, tilted toward the aisle
  add(shelving({ ...SHELF, plank: PLANK }));
  SECTIONS.forEach((s, i) => {
    const x0 = SHELF.x0 + i * 3.6 + 0.05;
    add(headerBoard({ x0, x1: x0 + 3.5, y0: SHELF.top + 0.12, y1: SHELF.top + 0.42, z: SHELF.zFront + 0.04, rect: headerRectOf(i), tilt: 0.32 }));
  });
  decals.push({ pos: [(SHELF.x0 + SHELF.x1) / 2, 0.004, SHELF.zFront + 0.12], size: [SHELF.x1 - SHELF.x0 + 0.2, 0.34], shade: 0.5 });

  // ---- bins (instanced: they are the targets)
  const sets = new Map<string, InstanceSet>();
  const define = (name: string, geo: BufferGeometry, material: KitMaterialKey, attr?: InstanceSet["attr"]) => {
    colorize(geo);
    sets.set(name, { name, geo, material, matrices: [], colors: [], attr });
  };
  const put = (name: string, m: Matrix4, color: V3, attr?: number[]) => {
    const s = sets.get(name)!;
    s.matrices.push(m);
    s.colors.push(color);
    if (s.attr && attr) s.attr.values.push(attr);
    return s.matrices.length - 1;
  };
  const gb = gravityBin();
  define("bin-acrylic", gb.acrylic, "acrylic");
  define("bin-fill", gb.fill, "grain", { name: "aGrain", size: 2, values: [] });
  define("bin-trim", gb.trim, "binTrim");
  define("bin-tag", gb.tag, "label", { name: "aCell", size: 4, values: [] });
  const sb = scoopBin();
  define("scoop-acrylic", sb.acrylic, "acrylic");
  define("scoop-fill", sb.fill, "grain", { name: "aGrain", size: 2, values: [] });
  define("scoop-trim", sb.trim, "binTrim");
  define("scoop-tag", sb.tag, "label", { name: "aCell", size: 4, values: [] });
  const tagCell = (name: string) => {
    const r = tagRect(tagNames.indexOf(name));
    return [r[0], r[1], r[2] - r[0], r[3] - r[1]];
  };

  const targets: Target[] = [];
  const bay = (SHELF.x1 - SHELF.x0) / SHELF.bays;
  const front = SHELF.zFront;
  const tierY = (t: number) => SHELF.tiers[t] + PLANK;
  /**
   * How the shopper reaches a bin: from the nearer end of the aisle (a door at eye level, outside the ceiling,
   * on the walking line), along that line, then a step across to stand `stand` metres from the bin. Beside
   * the centerpiece they stand closer, on its north side; past it, panning never takes them through it.
   */
  const approach = (x: number, standZ: number) => {
    const west = x - CEIL.x0 < CEIL.x1 - x;
    const door: V3 = [west ? CEIL.x0 - 1.4 : CEIL.x1 + 1.4, EYE, AISLE_Z];
    // turn off the walking line 0.9 m before the bin, but never before clearing the centerpiece
    const vx = west && standZ > AISLE_Z + 0.2 ? Math.max(x - 0.9, MOUTH.x1 + 0.2) : x + (west ? -0.9 : 0.9);
    const via: V3[] = Math.abs(standZ - AISLE_Z) > 0.05 && (west ? vx > door[0] + 0.3 : vx < door[0] - 0.3) ? [[vx, EYE, AISLE_Z]] : [];
    const bounds = standZ > MOUTH.z0 - 0.15 ? { x0: MOUTH.x1 + 0.4, x1: CEIL.x1 - 0.2 } : { x0: CEIL.x0 + 0.2, x1: CEIL.x1 - 0.2 };
    return { door, via, bounds };
  };
  const STAND = 2.0;
  const STAND_MOUTH = 1.55;

  // ---- packs on the tiers: rows of every kind, no two neighbours alike
  const products: { kind: Stock["kind"]; t: Template; m: Matrix4; stock: Stock; band: string; at: V3; row: string; facing: 1 | -1 }[] = [];
  const LIDS: V3[] = [hex("#8C6A48"), hex("#C9A24A"), hex("#2A2622"), hex("#EDE7DA"), hex("#9E3A2A")];
  /** a row of packs from x0 to x1 on a tier, their fronts at zf, facing +z (the wall run) or −z (the south run) */
  const placeRow = (stock: Stock[], x0: number, x1: number, y: number, zf: number, band: string, seed: number, maxDepth: number, facing: 1 | -1 = 1) => {
    const r = rng(seed);
    let x = x0 + r() * 0.03;
    let k = Math.floor(r() * stock.length);
    let prev = "";
    let deepest = 0;
    for (let guard = 0; x < x1 && guard < 200; guard++) {
      // the next item that is not the one beside it
      let st = stock[k % stock.length];
      for (let tries = 0; tries < stock.length && labelKey(st.kind, st.name) === prev; tries++) st = stock[++k % stock.length];
      k += 1 + (r() < 0.3 ? 1 : 0);
      const t = templates.get(st.kind)!;
      const [w, , d] = t.size;
      if (x + w > x1) break;
      if (d > maxDepth) continue;
      if (r() < 0.05) {
        x += w * 0.8; // a gap: someone just took one
        continue;
      }
      const flexible = ["pouchS", "pouchM", "pouchL", "kraft", "sack1", "sack5", "sack10"].includes(st.kind);
      const yaw = (r() - 0.5) * (flexible ? 0.16 : 0.08);
      const lean = flexible ? (r() - 0.5) * 0.06 : 0;
      const fill = flexible ? 0.93 + r() * 0.1 : 1;
      const at: V3 = [x + w / 2, y, zf - facing * (d / 2 + r() * 0.02)];
      products.push({ kind: st.kind, t, m: M(at, yaw + (facing === 1 ? 0 : Math.PI), [1, fill, 1], lean), stock: st, band, at, row: `${facing}:${seed}`, facing });
      deepest = Math.max(deepest, d);
      prev = labelKey(st.kind, st.name);
      x += w + 0.006 + r() * 0.02;
    }
    return deepest;
  };
  const templates = new Map(Object.entries(TEMPLATES).map(([k, f]) => [k as Stock["kind"], f()]));

  for (let b = 0; b < SHELF.bays; b++) {
    const s = SECTIONS[Math.floor(b / 3)];
    const items = s.bins.slice((b % 3) * 3, (b % 3) * 3 + 3);
    const x0 = SHELF.x0 + b * bay + 0.03;
    const x1 = x0 + bay - 0.06;
    const depth = SHELF.zFront - SHELF.zBack - 0.04;
    for (let t = 0; t < 3; t++) {
      const y = tierY(t);
      // a front row and, behind it, a second row of the same section's stock in another order
      const d0 = placeRow(s.tiers[t], x0, x1, y, front - 0.01, s.band, b * 31 + t * 7 + 1, depth);
      placeRow(s.tiers[t], x0 + 0.02, x1, y, front - 0.03 - d0, s.band, b * 31 + t * 7 + 4, depth - d0 - 0.03);
    }
    // tier 3, eye level: three gravity bins
    items.forEach((it, k) => {
      const cx = x0 + 0.2 + k * ((x1 - x0 - 0.4) / 2);
      const cz = front - BIN.d / 2 - 0.02;
      const y = tierY(3);
      const g = GRAINS[it.grain];
      const level = 0.4 + ((b * 3 + k) % 5) * 0.03 + rand() * 0.04;
      const o = occlusion(new Vector3(cx, y + 0.3, front), new Vector3(0, 0, 1));
      const shade: V3 = [o, o, o];
      const tint = hex(g.tint);
      const parts = [
        { set: "bin-acrylic", index: put("bin-acrylic", M([cx, y, cz]), [1, 1, 1]) },
        { set: "bin-fill", index: put("bin-fill", M([cx, y + BIN_FILL.base, cz], 0, [1, level, 1]), [tint[0] * o, tint[1] * o, tint[2] * o], grainAttr(it.grain)) },
        { set: "bin-trim", index: put("bin-trim", M([cx, y, cz]), shade) },
        { set: "bin-tag", index: put("bin-tag", M([cx, y, cz]), [1, 1, 1], tagCell(it.name)) },
      ];
      const stand = cx < MOUTH.x1 + 0.3 ? STAND_MOUTH : STAND;
      const standZ = cz + stand;
      targets.push({ category: s.category, name: it.name, grain: it.grain, parts, center: [cx, y + 0.36, cz], size: [BIN.w + 0.06, 0.74, BIN.d + 0.04], facing: 1, kind: "gravity", level, stand, ...approach(cx, standZ) });
      decals.push({ pos: [cx, y + 0.002, cz - 0.04], size: [BIN.w * 1.1, BIN.d * 1.2], shade: 0.4 });
    });
    // tier 4, the top: clay pots, some stacked with lids, and a tin or two
    const yTop = tierY(4);
    let px = x0 + 0.08 + rand() * 0.1;
    while (px < x1 - 0.24) {
      const big = 0.1 + rand() * 0.04;
      const h = big * (1.6 + rand() * 0.4);
      const cx = px + big;
      const lidded = rand() < 0.6;
      add([{ key: "terracotta", geo: place(matka(big, h, lidded && rand() < 0.5), { pos: [cx, yTop, front - 0.28 - rand() * 0.06], rot: [0, rand() * 6, 0] }), tint: [0.95 + rand() * 0.1, 0.92 + rand() * 0.1, 0.9 + rand() * 0.1] }]);
      decals.push({ pos: [cx, yTop + 0.002, front - 0.3], size: [big * 2.6, big * 2.6], shade: 0.45, round: true });
      if (rand() < 0.4) {
        const small = big * (0.62 + rand() * 0.12);
        add([{ key: "terracotta", geo: place(matka(small, small * 1.6, true), { pos: [cx, yTop + h * 0.97, front - 0.29] }), tint: [1, 0.95, 0.92] }]);
      }
      px += big * 2 + 0.06 + rand() * 0.12;
    }
    // a few tins by the pots; a section with one of its own borrows its neighbours', so no two stand alike
    const tins = s.top.length > 1 ? s.top : [...s.top, ...SECTIONS.flatMap((o) => (o === s ? [] : o.top))];
    placeRow(tins, x1 - 0.32, x1, yTop, front - 0.03, s.band, b * 13 + 5, 0.2);
  }

  // ---- the south run, facing the wall across the aisle: a pine counter of scoop bins (two a bay), three
  // tiers of snack packs set back above it on the same black steel and pine, header boards on top
  const rw = RUN.x1 - RUN.x0;
  const rcx = (RUN.x0 + RUN.x1) / 2;
  const rd = RUN.zBack - RUN.zFront;
  const rcz = (RUN.zFront + RUN.zBack) / 2;
  add([{ key: "pine", geo: place(tiledBox(rw - 0.04, RUN.counter - 0.14, rd - 0.06, 1.2), { pos: [rcx, 0.1 + (RUN.counter - 0.14) / 2, rcz] }), tint: [0.86, 0.8, 0.74] }]);
  add([{ key: "pine", geo: place(tiledBox(rw, 0.04, rd, 1.2), { pos: [rcx, RUN.counter - 0.02, rcz] }) }]);
  add([{ key: "steel", geo: place(tiledBox(rw - 0.06, 0.1, rd - 0.08, 1), { pos: [rcx, 0.05, rcz] }) }]);
  add(shelving({ x0: RUN.x0, x1: RUN.x1, zBack: RUN.shelfFront, zFront: RUN.zBack, bays: RUN.bays, tiers: RUN.tiers, top: RUN.top, plank: PLANK }));
  // its back, toward the south walkway: a plain pine panel
  add([{ key: "pine", geo: place(tiledBox(rw, RUN.top - RUN.counter, 0.02, 1.2), { pos: [rcx, (RUN.top + RUN.counter) / 2, RUN.zBack + 0.01] }), tint: [0.8, 0.74, 0.68] }]);
  decals.push({ pos: [rcx, 0.004, RUN.zFront - 0.1], size: [rw + 0.2, 0.32], shade: 0.5 });
  const rbay = rw / RUN.bays;
  let bayAt = 0;
  RUN_SECTIONS.forEach((sec, si) => {
    const sx0 = RUN.x0 + bayAt * rbay;
    add(headerBoard({ x0: sx0 + 0.05, x1: sx0 + sec.bays * rbay - 0.05, y0: RUN.top + 0.12, y1: RUN.top + 0.42, z: RUN.shelfFront - 0.04, rect: headerRectOf(SECTIONS.length + si), facing: -1, tilt: 0.32 }));
    for (let b = 0; b < sec.bays; b++) {
      const bx0 = sx0 + b * rbay + 0.03;
      const bx1 = bx0 + rbay - 0.06;
      const seed = (bayAt + b) * 29 + 3;
      RUN.tiers.forEach((ty, t) => {
        // one row: from across the aisle the back of a 37 cm shelf is in its own shadow (the budget's choice)
        placeRow(sec.tiers[t], bx0, bx1, ty + PLANK, RUN.shelfFront + 0.01, sec.band, seed + t * 5, RUN.zBack - RUN.shelfFront - 0.04, -1);
      });
      // two scoop bins a bay on the counter, at its front
      for (let k = 0; k < 2; k++) {
        const it = sec.bins[(b * 2 + k) % sec.bins.length];
        const cx = bx0 - 0.03 + rbay * (k === 0 ? 0.27 : 0.73);
        const z = RUN.zFront + SCOOP.d / 2 + 0.02;
        const y = RUN.counter;
        const tint = hex(GRAINS[it.grain].tint);
        const parts = [
          { set: "scoop-acrylic", index: put("scoop-acrylic", M([cx, y, z], Math.PI), [1, 1, 1]) },
          { set: "scoop-fill", index: put("scoop-fill", M([cx, y, z], Math.PI), tint, grainAttr(it.grain)) },
          { set: "scoop-trim", index: put("scoop-trim", M([cx, y, z], Math.PI), [1, 1, 1]) },
          { set: "scoop-tag", index: put("scoop-tag", M([cx, y, z], Math.PI), [1, 1, 1], tagCell(it.name)) },
        ];
        const standZ = z - STAND;
        targets.push({ category: SCOOP_CATEGORY, name: it.name, grain: it.grain, parts, center: [cx, y + 0.2, z], size: [SCOOP.w + 0.04, 0.46, SCOOP.d + 0.04], facing: -1, kind: "scoop", level: 0, stand: STAND, ...approach(cx, standZ) });
      }
    }
    bayAt += sec.bays;
  });

  // ---- the centerpiece, in the aisle's mouth as in the reference: open jute sacks round a stone chakki in its
  // tray, a big clay pot of dried wheat behind; south of the walking line, so the aisle stays open
  const sackAt: [number, number, number, number][] = [
    [50.52, 4.02, 0.17, 0],
    [50.56, 4.5, 0.16, 1],
    [51.68, 3.98, 0.15, 3],
  ];
  sackAt.forEach(([x, z, r, i], n) => {
    const it = SACKS[i];
    // the stencils face the walking line (north) and the door (west)
    add(sack({ x, z, r, h: 0.44 + (n % 2) * 0.05, grain: grainAttr(it.grain), tint: hex(GRAINS[it.grain].tint), stencil: stencilRect(n), fringe: fringeRect, turn: n === 1 ? -Math.PI / 2 : Math.PI, seed: 40 + n }));
    decals.push({ pos: [x, 0.004, z], size: [r * 3.2, r * 3.2], shade: 0.6, round: true });
  });
  add(chakki({ x: 51.12, z: 4.3, scale: 0.8, grain: grainAttr("toor"), flour: grainAttr("besan"), tint: hex(GRAINS.toor.tint), flourTint: hex(GRAINS.besan.tint), spoutTurn: Math.PI * 0.25 }));
  decals.push({ pos: [51.12, 0.004, 4.3], size: [1.1, 1.1], shade: 0.55, round: true });
  // the big pot: dark, unglazed, a rope round its lip; the sheaf of dried wheat out of its neck
  // (the clay plaster's tan, darkened to the reference pot's grey-brown: terracotta would stay orange)
  add(clayPot({ x: 51.86, z: 4.46, r: 0.24, h: 0.72, tint: [0.44, 0.45, 0.52], rope: true, seg: 28, key: "plaster" }));
  add(wheatSheaf({ x: 51.86, y: 0.67, z: 4.46, count: 200, height: 0.78, spread: 0.6, ears: Array.from({ length: 8 }, (_, i) => earRect(i)), rand }));
  decals.push({ pos: [51.86, 0.004, 4.46], size: [0.8, 0.8], shade: 0.6, round: true });

  // ---- products: every pack merged per material, labels and grain through their attributes
  const partKey: Record<ProductPart, MaterialKey> = { label: "label", glass: "glass", grain: "grain", lid: "lid", metal: "metal", terracotta: "terracotta" };
  for (const p of products) {
    const { t, m, stock } = p;
    const capTint = stock.kind === "spiceJar" ? hex(["#9E3A2A", "#2A2622", "#5A6A3A"][Math.floor(rand() * 3)]) : stock.kind === "oilBottle" ? hex(rand() < 0.5 ? "#C9A24A" : "#2A2622") : LIDS[Math.floor(rand() * LIDS.length)];
    for (const part of Object.keys(partKey) as ProductPart[]) {
      const g = t[part];
      if (!g) continue;
      const geo = g.clone().applyMatrix4(m);
      const tint: V3 = part === "lid" ? capTint : part === "metal" ? (stock.kind === "gheeTin" ? hex("#D9A82E") : hex("#B8B4AC")) : part === "grain" ? hex(GRAINS[stock.grain].tint) : [1, 1, 1];
      add([{ key: partKey[part], geo, tint, cell: part === "label" ? cellOf(stock.kind, stock.name) : undefined, grain: part === "grain" ? grainAttr(stock.grain) : undefined }]);
    }
    // its shadow on the plank, thrown back by the spots in front and above
    const [w, h, d] = t.size;
    decals.push({ pos: [p.at[0], p.at[1] + 0.002, p.at[2] - p.facing * (d * 0.25 + h * 0.12)], size: [w * 1.05, d * 0.8 + h * 0.3], shade: 0.38 });
  }

  // ---- beyond the zone: produce stands under the skylight, the produce wall, the aisle 1 gondola, the beer aisle
  backdrop(add, decals, rand);

  const instances = [...sets.values()];
  const statics = batch.merged() as Map<KitMaterialKey, BufferGeometry>;
  const tri = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  const triangles = [...statics.values()].reduce((s, g) => s + tri(g), 0) + instances.reduce((s, i) => s + tri(i.geo) * i.matrices.length, 0) + decals.length * 2;
  const facings = products.map((p) => ({ row: p.row, kind: p.kind, name: p.stock.name, x: p.at[0] }));
  return { statics, instances, decals, targets, bounds: { x0: CEIL.x0 + 0.2, x1: CEIL.x1 - 0.2 }, triangles: Math.round(triangles), facings };
}

/**
 * The backdrop: what a shopper in the zone sees beyond it, simpler than the zone but recognisable. Produce
 * stands (black frames, tilted crates of fruit and vegetables) under the skylight's daylight, the produce wall,
 * the aisle 1 gondola's face full of packs, the beer aisle's cases. Fruit are grain piles at fruit size.
 */
function backdrop(add: (p: Piece[]) => void, decals: Decal[], rand: () => number) {
  const fruit: { shape: string; cellM: number; tint: string }[] = [
    { shape: "makhana", cellM: 0.8, tint: "#C8402E" }, // apples
    { shape: "makhana", cellM: 0.85, tint: "#E8902A" }, // oranges
    { shape: "basmati", cellM: 1.3, tint: "#E8C840" }, // bananas
    { shape: "makhana", cellM: 0.7, tint: "#8EAE3A" }, // limes, green apples
    { shape: "apricot", cellM: 0.9, tint: "#6E3A6A" }, // aubergines, onions
    { shape: "walnut", cellM: 0.7, tint: "#B88A52" }, // potatoes
    { shape: "chip", cellM: 0.9, tint: "#5E8A3A" }, // greens
    { shape: "makhana", cellM: 0.9, tint: "#D04A2A" }, // tomatoes
  ];
  const crate = (x: number, y: number, z: number, w: number, d: number, tipTo: 1 | -1) => {
    const tip = 0.22 * tipTo;
    const box = tiledBox(w, 0.12, d, 0.6);
    const f = fruit[Math.floor(rand() * fruit.length)];
    const heap = grainMound({ w: w - 0.04, d: d - 0.04, peak: 0.07, seg: 4, lump: 0.01, seed: Math.floor(rand() * 1000) });
    place(heap, { pos: [0, 0.08, 0] });
    for (const g of [box, heap]) place(g, { pos: [x, y, z], rot: [tip, 0, 0] });
    add([
      { key: "pine", geo: box, tint: [0.78, 0.62, 0.48] },
      { key: "grain", geo: heap, tint: hex(f.tint), grain: [shapeIndex(f.shape), f.cellM] },
    ]);
  };
  // the four stands nearest the zone (x 30.8–45.4, y 4.8–7 and 9.6–11.8)
  for (const [x0, x1, z0, z1] of [
    [30.8, 37, 4.8, 7],
    [39.2, 45.4, 4.8, 7],
    [30.8, 37, 9.6, 11.8],
    [39.2, 45.4, 9.6, 11.8],
  ]) {
    add(produceStand({ x0, x1, z0, z1 }));
    const cz = (z0 + z1) / 2;
    for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.62) {
      crate(x, 0.82, cz - 0.42, 0.56, 0.4, -1);
      crate(x, 0.82, cz + 0.42, 0.56, 0.4, 1);
      crate(x, 0.45, cz - 0.82, 0.56, 0.38, -1);
      crate(x, 0.45, cz + 0.82, 0.56, 0.38, 1);
    }
    decals.push({ pos: [(x0 + x1) / 2, 0.004, cz], size: [x1 - x0 + 0.4, z1 - z0 + 0.4], shade: 0.4 });
  }
  // the produce wall (x 13–48, y 1–2.2): a stepped rack of crates, its near end
  for (let x = 36; x < 47.8; x += 0.62) {
    crate(x, 0.5, 1.95, 0.56, 0.4, 1);
    crate(x, 0.95, 1.55, 0.56, 0.4, 1);
    crate(x, 1.4, 1.2, 0.56, 0.36, 1);
  }
  add([{ key: "steel", geo: place(tiledBox(12, 1.7, 0.1, 1), { pos: [42, 0.85, 1.02] }) }]);
  // aisle 1 (x 15–51, y 15.8–16.9) and its east cap: a gondola whose north face is full of packs
  add(gondola({ x0: 37, x1: 51, z0: 15.8, z1: 16.9, h: 1.9, shelves: [0.32, 0.72, 1.12, 1.52] }));
  const { labels } = labelCells();
  for (const y of [0.13, 0.345, 0.745, 1.145, 1.545])
    for (let x = 37.05; x < 50.9; ) {
      const w = 0.07 + rand() * 0.12;
      const h = 0.14 + rand() * 0.16;
      const box = place(clean(new BoxGeometry(w, h, 0.18)), { pos: [x + w / 2, y + h / 2, 15.8 + 0.12] });
      const r = labelRect(Math.floor(rand() * labels.length));
      add([{ key: "label", geo: box, cell: [r[0] + 0.1 * (r[2] - r[0]), r[1], (r[2] - r[0]) * 0.9, r[3] - r[1]] }]);
      x += w + 0.01;
    }
  decals.push({ pos: [44, 0.004, 16.35], size: [14.4, 1.5], shade: 0.4 });
  // the beer aisle (x 54–71, y 17–18.1): cases stacked on its north face
  add(gondola({ x0: 54, x1: 71, z0: 17, z1: 18.1, h: 1.9, shelves: [0.4, 0.85, 1.3] }));
  for (const y of [0.13, 0.425, 0.875, 1.325])
    for (let x = 54.05; x < 70.9; ) {
      const w = 0.26 + rand() * 0.1;
      const box = place(clean(new BoxGeometry(w, 0.24, 0.36)), { pos: [x + w / 2, y + 0.12, 17 + 0.2] });
      const r = labelRect(Math.floor(rand() * labels.length));
      add([{ key: "label", geo: box, cell: [r[0] + 0.1 * (r[2] - r[0]), r[1], (r[2] - r[0]) * 0.9, r[3] - r[1]] }]);
      x += w + 0.02;
    }
  // the skylight over produce: its glow, seen from the zone (it lights the produce through the rig)
  // (x 14–46, y 3–13, 6.5 m up): glazing that glows, in a black frame with mullions every 4 m
  const sky = gridPlane(32, 10, 32, 1);
  sky.rotateX(Math.PI / 2);
  add([{ key: "glow", geo: place(sky, { pos: [30, 6.5, 8] }), tint: [0.8, 0.77, 0.7] }]);
  // the frame: strips that face down, so the camera on its way down never sees them from above
  const Y = 6.48;
  const strip = (x: number, z: number, w: number, d: number) => {
    const g = gridPlane(w, d, Math.max(w, d), 1);
    g.rotateX(Math.PI / 2);
    add([{ key: "steel", geo: place(g, { pos: [x, Y, z] }) }]);
  };
  strip(30, 3, 32, 0.14);
  strip(30, 13, 32, 0.14);
  strip(30, 8, 32, 0.1);
  strip(46, 8, 0.14, 10);
  for (let x = 18; x < 46; x += 4) strip(x, 8, 0.1, 10);
}

const headerRectOf = (i: number): Rect => headerRect(i);

function flipWinding(g: BufferGeometry) {
  const pos = g.getAttribute("position") as BufferAttribute;
  const uv = g.getAttribute("uv") as BufferAttribute;
  for (let i = 0; i < pos.count; i += 3) {
    for (const a of [pos, uv]) {
      const n = a.itemSize;
      for (let c = 0; c < n; c++) {
        const t = a.array[(i + 1) * n + c];
        (a.array as Float32Array)[(i + 1) * n + c] = a.array[(i + 2) * n + c];
        (a.array as Float32Array)[(i + 2) * n + c] = t;
      }
    }
  }
}

/** Built once per store map and kept: prepared ahead on the list screen, reused by every close-up after. */
const built = new Map<string, ZoneBuild>();
export function bulkZoneFor(store: { storeId: string; version?: number; outline?: [number, number][] }): ZoneBuild {
  const key = `${store.storeId}:${store.version ?? 0}`;
  let z = built.get(key);
  if (!z) built.set(key, (z = buildBulkZone(store.outline)));
  return z;
}
export function dropBuiltZones() {
  built.clear();
}

/** The bin a stop points the camera at: its category's bin whose name shares the most words with the item. */
export function pickTarget(targets: Target[], category: string, itemName: string): Target | null {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w && w !== "bulk");
  const want = new Set(words(itemName));
  let best: Target | null = null;
  let score = -1;
  for (const t of targets) {
    if (t.category !== category) continue;
    const s = words(t.name).filter((w) => want.has(w)).length;
    if (s > score) {
      score = s;
      best = t;
    }
  }
  return best;
}

/** The target's real-grain layer: where on it the grains go. */
export function grainSurface(t: Target): { kind: "front"; center: V3; w: number; h: number; facing: 1 | -1 } | { kind: "top"; center: V3; w: number; d: number; height: (x: number, z: number) => number } {
  if (t.kind === "gravity") {
    // the fill's front: from the foot to the level (its mound's peak is above, out of sight under the lid)
    const base = t.center[1] - 0.36 + BIN_FILL.base;
    return { kind: "front", center: [t.center[0], base + t.level / 2, t.center[2] + t.facing * BIN_FILL.front], w: BIN_FILL.w, h: t.level, facing: t.facing };
  }
  const w = SCOOP.w - 0.02;
  const d = SCOOP.d - 0.02;
  return { kind: "top", center: [t.center[0], t.center[1] - 0.2 + SCOOP.h * SCOOP.level, t.center[2]], w, d, height: (x, z) => SCOOP.peak * Math.sin((Math.max(0, 1 - Math.max(Math.abs(x) / (w / 2), Math.abs(z) / (d / 2))) * Math.PI) / 2) ** 1.4 };
}
export { shapeOf };
export type { BinItem };
