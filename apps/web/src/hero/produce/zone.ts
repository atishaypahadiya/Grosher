// Grosher's Produce zone, assembled from the shelf kit: the one daylit room in the store. A skylight over the
// islands (x 14–46, y 3–13; black steel mullions every 4 m, glass that glows) lets in a cool white daylight:
// soft-edged sun patches on the oak floor and the crates (the sun through the panes, the mullions' shadows),
// a broad fill under the opening, faint light shafts. Along the north wall the wet wall: a stainless open
// multideck, five slanted decks with an LED strip under every lip, misting bars over the greens and herbs, a
// brushed canopy carrying the sections' header boards; greens and salad kits, herbs, mushrooms and sprouts,
// cut vegetables, cut fruit in clear tubs, the Grosher Press juices. Eight islands of black steel with two
// tiers of tilted wooden crates each side, five varieties a face under chalkboards; two tall potted plants.
// Beyond it: floral by the entrance, Bulk's shelving and header boards to the east, in their own warm light.
//
// Fruit are instances (fruit.ts). Which crates and wall decks get them one by one depends on the stop: those
// the shopper faces within a few metres, to a triangle budget (`selectDetail`); everything else shows its pile
// at the fruit's real size (the mounds atlas). Pure geometry: no textures, no React (ProduceZone.tsx).

import { BoxGeometry, BufferAttribute, BufferGeometry, Euler, Matrix4, Path, PlaneGeometry, Quaternion, Shape, ShapeGeometry, Vector3 } from "three";
import { colorize, hex } from "../kit/bake.ts";
import { Batch, beam, clean, cylinder, gridPlane, lathe, place, rng, tiledBox, toRect, type V3 } from "../kit/geom.ts";
import { grainMound, headerBoard, shelving, type Piece } from "../kit/pieces.ts";
import { scaled, WARM_3000K, type LightRig, type ZoneLightDef } from "../kit/light.ts";
import type { Decal } from "../kit/decals.ts";
import type { ProduceMaterialKey } from "../kit/materials.ts";
import { bag, bananaBunch, bottleParts, deliTubParts, bunchLeaves, bunchStems, fruitMatrix, leafyHead, packCrate, packParts, roundGeometry, shapeOf, type Pile } from "./fruit.ts";
import { BITES, CUT_FRUIT, DISPLAYS, foliageRect, HEADERS, headerRect, JUICES, juiceRect, KINDS, moundIndex, MOUNDS, packRect, signCells, signRect, WALL, type Kind, type KindId, type MoundId, type PackId } from "./recipe.ts";

// ---------------------------------------------------------------- the plan (map metres; z is the map's y)
export const ZONE = { x0: 12, x1: 48, z0: 1.0, z1: 14.4 };
export const WALL_Z = 1.0;
export const CEILING = 4.6;
export const SKY = { x0: 14, x1: 46, z0: 3, z1: 13, y: 6.5 };
/** the multideck: 28 bays of 1.25 m from x 13, its back at zBack, its well's front at zFront */
export const CASE = { x0: 13, x1: 48, zBack: 1.12, zFront: 2.2, bays: 28, top: 2.12, canopyZ: 1.8 };
export const BAY = (CASE.x1 - CASE.x0) / CASE.bays;
/** the decks, bottom (the well) to top: the front lip's height, the depth from the case's back, how much
 * higher the back is (they slope toward the shopper) */
export const DECKS = [
  { lip: 0.66, depth: 0.93, rise: 0.12 },
  { lip: 1.0, depth: 0.6, rise: 0.08 },
  { lip: 1.3, depth: 0.54, rise: 0.07 },
  { lip: 1.58, depth: 0.5, rise: 0.06 },
  { lip: 1.86, depth: 0.44, rise: 0.05 },
];
const deckFront = (d: number) => CASE.zBack + DECKS[d].depth;
const deckY = (d: number, z: number) => DECKS[d].lip + (DECKS[d].rise * (deckFront(d) - z)) / DECKS[d].depth;
const deckTilt = (d: number) => Math.atan2(DECKS[d].rise, DECKS[d].depth);
/** the islands, from the store map (f-island1…8): x0, x1, z0, z1 */
export const ISLANDS: [number, number, number, number][] = [
  [14, 20.2, 4.8, 7],
  [22.4, 28.6, 4.8, 7],
  [30.8, 37, 4.8, 7],
  [39.2, 45.4, 4.8, 7],
  [14, 20.2, 9.6, 11.8],
  [22.4, 28.6, 9.6, 11.8],
  [30.8, 37, 9.6, 11.8],
  [39.2, 45.4, 9.6, 11.8],
];
/** the walking lines (the map's corridors): along the wall and between the rows; and across, between islands */
export const WALKWAYS = [3.5, 8.3, 14.2];
export const CROSS = [12, 21.3, 29.7, 38.1, 47];
export const EYE = 1.6;
/** a crate (outer size) and the two tiers either side of an island's spine */
export const CRATE = { w: 0.58, h: 0.16, d: 0.42, tilt: 0.24 };
const TIERS = [
  { y: 0.86, off: 0.38 },
  { y: 0.5, off: 0.84 },
];
/** the potted plants: x, z */
export const PLANTS: [number, number][] = [
  [46.6, 5.4],
  [13.1, 12.7],
];
export const HIDE_FIXTURES = ["f-produce-wall", "f-island1", "f-island2", "f-island3", "f-island4", "f-island5", "f-island6", "f-island7", "f-island8", "f-floral", "f-bulk-wall", "f-bulk-run", "f-bulk-display"];

/** the plain parts, merged into the steel and paint meshes, each its colour */
const BLACK = hex("#1E1D1C");

// ---------------------------------------------------------------- light

/** daylight through the skylight: neutral and bright, cool beside the store's 3000 K (DESIGN.md: never blue) */
export const SKYLIGHT: V3 = [1.0, 0.985, 0.955];
/** the sun's direction of travel: from high in the south-east, down toward the north-west */
export const SUN_DIR: V3 = (() => {
  const v = new Vector3(-0.32, -0.84, -0.44).normalize();
  return [v.x, v.y, v.z];
})();
const REF = 2.6;

/**
 * The room's light: the sun through the panes (a point far up the sun's direction, the roof round the opening
 * and the mullions as slabs, so the patches it throws are the panes' shapes, soft-edged), the sky's diffuse
 * light through the opening (a broad cone from above it, the roof again cutting it off under the margins), the
 * multideck's lip lights, and warm spots on Bulk's shelving beyond, so the next aisle reads warm.
 */
export function produceRig(): LightRig {
  const lights: ZoneLightDef[] = [];
  const at = (k: number, d: number) => scaled(SKYLIGHT, (k * d * d) / (REF * REF));
  // the sun: 70 m up its ray from the zone's middle; its strength is the floor's, after the distance
  const mid: V3 = [30, 0, 8];
  const sun: V3 = [mid[0] - SUN_DIR[0] * 70, mid[1] - SUN_DIR[1] * 70, mid[2] - SUN_DIR[2] * 70];
  lights.push({ pos: sun, target: mid, angle: 0.36, softness: 0.2, color: at(3.6, 70), reach: 120 });
  // the sky through the opening: from 13 m over its middle, broad and soft
  lights.push({ pos: [30, 19.5, 8], target: [30, 0, 8], angle: 0.95, softness: 0.55, color: at(1.25, 19.5), reach: 60 });
  // a softer second sky light toward the wall, so the wet wall's front is in daylight too
  lights.push({ pos: [30, 14, 11], target: [30, 1, 2], angle: 1.0, softness: 0.6, color: at(0.55, 16), reach: 60 });
  // beyond, east: Bulk's wall run under its track spots, warm
  for (const x of [52.5, 58.5, 64.5]) lights.push({ pos: [x, 4.3, 3.2], target: [x, 1.2, 2.2], angle: 0.55, softness: 0.3, color: scaled(WARM_3000K, 6), reach: 8 });
  // floral, by the entrance: a warm wash
  lights.push({ pos: [6.2, 4.4, 5.8], target: [6.2, 0.9, 3], angle: 0.6, softness: 0.35, color: scaled(WARM_3000K, 5), reach: 8 });
  // the roof round the opening, and the mullions: the sun's patches are the panes
  const slabs = [
    { x0: -20, x1: 110, z0: -20, z1: SKY.z0, y: SKY.y },
    { x0: -20, x1: 110, z0: SKY.z1, z1: 80, y: SKY.y },
    { x0: -20, x1: SKY.x0, z0: SKY.z0, z1: SKY.z1, y: SKY.y },
    { x0: SKY.x1, x1: 110, z0: SKY.z0, z1: SKY.z1, y: SKY.y },
    ...[18, 22, 26, 30, 34, 38, 42].map((x) => ({ x0: x - 0.07, x1: x + 0.07, z0: SKY.z0, z1: SKY.z1, y: SKY.y })),
    { x0: SKY.x0, x1: SKY.x1, z0: 7.94, z1: 8.06, y: SKY.y },
  ];
  // the lip lights: under the canopy and under each deck's front edge
  const strips = [{ y: 2.1, z: CASE.canopyZ - 0.05 }, ...[1, 2, 3, 4].map((d) => ({ y: DECKS[d].lip - 0.03, z: deckFront(d) - 0.03 }))];
  return { lights, slabs, reference: REF, soft: 0.06, cases: { x0: CASE.x0, x1: CASE.x1, zBack: CASE.zBack, zFront: CASE.zFront, strips, color: [1.9, 1.85, 1.72], falloff: 0.3 } };
}

/** the dark a hemisphere light misses: under the decks, at the back of the case, under the crates */
const occlusion = (p: Vector3, n: Vector3) => {
  let o = 1;
  if (p.x > CASE.x0 - 0.05 && p.x < CASE.x1 + 0.05 && p.z < CASE.zFront + 0.02 && p.y < CASE.top + 0.05) {
    for (let d = 1; d < DECKS.length; d++) {
      const t = DECKS[d].lip;
      if (p.y < t && t - p.y < 0.16 && p.z < deckFront(d) + 0.02) o *= 0.7 + ((t - p.y) / 0.16) * 0.3;
    }
    o *= 0.78 + 0.22 * Math.min(1, Math.max(0, (p.z - CASE.zBack) / (CASE.zFront - CASE.zBack)));
  }
  if (n.y < -0.5 && p.y > CEILING - 0.05) o *= 0.9;
  // under an island's crates: the stock boxes and the low shelf in its shade
  for (const [x0, x1, z0, z1] of ISLANDS)
    if (p.x > x0 - 0.02 && p.x < x1 + 0.02 && p.z > z0 - 0.02 && p.z < z1 + 0.02 && p.y < 0.7) {
      o *= 0.5 + 0.5 * Math.min(1, Math.max(0, (Math.min(p.z - z0, z1 - p.z) < 0.15 ? 0.6 : 0) + p.y * 0.4));
      break;
    }
  return o;
};

// ---------------------------------------------------------------- what the build holds

/** an instanced template: its geometry, material and per-instance attributes */
export interface InstanceSpec {
  name: string;
  geo: BufferGeometry;
  material: ProduceMaterialKey;
  attrs: { name: string; size: number }[];
}

/** one instance: its set, matrix, colour and attributes; `group` is the crate or deck it belongs to (−1: none) */
export interface Item {
  set: string;
  m: Matrix4;
  color: V3;
  attrs?: Record<string, number[]>;
  group: number;
  /** drawn whatever the stop (a crate, a pile); otherwise only when its group is in detail */
  always?: boolean;
}

/** A crate or a wall deck: where it is, which way it faces, its far pile (a wall deck's fill). */
export interface Group {
  id: number;
  center: V3;
  /** out of the display toward the shopper (x, z) */
  out: [number, number];
  /** triangles of its items one by one */
  tris: number;
  /** a wall deck's pile, shown instead of its items when it is not in detail */
  fill?: Item;
}

export interface ProduceTarget {
  category: string;
  name: string;
  /** the crates or decks it is: lit lime, lifted */
  groups: number[];
  center: V3;
  size: V3;
  facing: 1 | -1;
  /** the walking line the shopper stands on */
  walkZ: number;
  door: V3;
  via: V3[];
  /** the way down through the skylight (approach) */
  descent: V3[];
  stand: number;
  side: number;
  bounds: { x0: number; x1: number };
  kind: "island" | "wall";
}

export interface ProduceBuild {
  statics: Map<ProduceMaterialKey, BufferGeometry>;
  specs: InstanceSpec[];
  items: Item[];
  groups: Group[];
  decals: Decal[];
  targets: ProduceTarget[];
  /** the shafts of daylight: additive quads (ProduceZone draws them with their own material) */
  shafts: BufferGeometry;
  /** the misting bars' plumes: quads in front of the greens' and herbs' decks */
  mist: BufferGeometry;
  /** triangles always drawn: the statics, every crate and pile, the far fills */
  triangles: number;
  /** every chalkboard: what it says, where (tests: one on every display) */
  signs: { name: string; at: V3 }[];
}

/** at most this many triangles of fruit and stock one by one, whatever the stop */
export const DETAIL_TRIANGLES = 80_000;
/** groups farther than this from where the shopper stands keep their piles */
export const DETAIL_M = 6.5;

const M = (pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) => new Matrix4().compose(new Vector3(...pos), new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...scale));
const cellOf = (r: [number, number, number, number]) => [r[0], r[1], r[2] - r[0], r[3] - r[1]];

/** a template normalised to a unit footprint: x and z −0.5…0.5, y 0…1 */
function unit(g: BufferGeometry): BufferGeometry {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const s = new Vector3().subVectors(b.max, b.min);
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.scale(1 / s.x, 1 / s.y, 1 / s.z);
  g.computeVertexNormals();
  return g;
}
const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

export function buildProduceZone(outline: [number, number][] | undefined): ProduceBuild {
  const batch = new Batch();
  const decals: Decal[] = [];
  const rand = rng(2112);
  const add = (pieces: (Piece | { key: ProduceMaterialKey; geo: BufferGeometry; tint?: V3 })[]) => {
    for (const p of pieces) {
      // the kit's pieces carry its own keys: map them onto Produce's materials
      const key = ({ header: "chalk", copper: "steel", plaster: "paint", concrete: "paint", lid: "steel", metal: "steel", terracotta: "paint" } as Record<string, ProduceMaterialKey>)[p.key] ?? (p.key as ProduceMaterialKey);
      colorize(p.geo, p.tint ?? [1, 1, 1], occlusion);
      batch.add(key, p.geo);
    }
  };

  // ---- the templates
  const specs: InstanceSpec[] = [];
  const spec = (name: string, geo: BufferGeometry, material: ProduceMaterialKey, attrs: InstanceSpec["attrs"] = []) => {
    if (!geo.getAttribute("color")) colorize(geo);
    specs.push({ name, geo, material, attrs });
  };
  const FRUIT_ATTRS = ["aShapeA", "aShapeB", "aShapeC", "aBlush", "aPole"].map((name) => ({ name, size: 4 }));
  spec("crate", crateGeometry(), "pine");
  spec("mound", unit(grainMound({ w: 1, d: 1, peak: 1, seg: 5, lump: 0.04, seed: 5 })), "mound", [{ name: "aGrain", size: 2 }]);
  spec("fruit", roundGeometry(false), "fruit", FRUIT_ATTRS);
  spec("fruitHi", roundGeometry(true), "fruit", FRUIT_ATTRS);
  spec("banana", bananaBunch(), "plain");
  spec("head", unit(leafyHead()), "plain");
  spec("stems", unit(bunchStems()), "plain");
  spec("leaves", bunchLeaves(), "foliageCell", [{ name: "aCell", size: 4 }]);
  const pk = packParts();
  spec("packClear", pk.clear, "clear");
  spec("packContent", pk.content, "packs", [{ name: "aCell", size: 4 }]);
  spec("bag", bag(), "packs", [{ name: "aCell", size: 4 }]);
  const bt = bottleParts();
  spec("bottleGlass", bt.glass, "clear");
  spec("bottleBody", bt.body, "plain");
  spec("bottleCap", bt.cap, "metal");
  spec("bottleLabel", bt.label, "chalkCell", [{ name: "aCell", size: 4 }]);
  const deli = deliTubParts();
  spec("deliClear", deli.clear, "clear");
  spec("deliContent", deli.content, "packs", [{ name: "aCell", size: 4 }]);
  spec("deliLabel", deli.label, "packs", [{ name: "aCell", size: 4 }]);
  // a far deck: one box, its front a row of the stock (one cell, repeated)
  spec("row", place(clean(new BoxGeometry(1, 1, 1)), { pos: [0, 0.5, 0] }), "packsRow", [
    { name: "aCell", size: 4 },
    { name: "aRep", size: 2 },
  ]);
  const specTris = Object.fromEntries(specs.map((s) => [s.name, tris(s.geo)]));

  const items: Item[] = [];
  const groups: Group[] = [];
  const signs: { name: string; at: V3 }[] = [];
  const signIndex = new Map(signCells().map((c, i) => [c.name, i]));
  const group = (center: V3, out: [number, number]) => {
    const g: Group = { id: groups.length, center, out, tris: 0 };
    groups.push(g);
    return g;
  };
  const P = new Vector3();
  const UP = new Vector3(0, 1, 0);
  const put = (it: Item) => {
    // the wall's stock sits in the case's shade: its colour takes the case's occlusion at its place (the lip
    // lights do the rest, per pixel), so the case reads dark inside, as in the reference
    P.setFromMatrixPosition(it.m);
    if (P.z < CASE.zFront && P.x > CASE.x0 && P.x < CASE.x1 && P.y > 0.6) {
      const o = occlusion(P, UP) * 0.8;
      it.color = [it.color[0] * o, it.color[1] * o, it.color[2] * o];
    }
    items.push(it);
    if (it.group >= 0 && !it.always) groups[it.group].tris += specTris[it.set];
  };
  const moundAttr = (id: MoundId) => [moundIndex(id), MOUNDS[moundIndex(id)].cellM];

  // ---- the shell: the oak floor, the rest of the store's floor, the wall, the ceiling round the skylight
  const floor = gridPlane(ZONE.x1 - ZONE.x0 + 0.4, ZONE.z1 - ZONE.z0, 3, 1.6);
  floor.rotateX(-Math.PI / 2);
  add([{ key: "oak", geo: place(floor, { pos: [(ZONE.x0 + ZONE.x1) / 2, 0.002, (ZONE.z0 + ZONE.z1) / 2] }) }]);
  if (outline) {
    const shape = new Shape(outline.map(([x, y]) => ({ x, y }) as never));
    shape.holes.push(new Path([{ x: ZONE.x0 - 0.2, y: ZONE.z0 }, { x: ZONE.x1 + 0.2, y: ZONE.z0 }, { x: ZONE.x1 + 0.2, y: ZONE.z1 }, { x: ZONE.x0 - 0.2, y: ZONE.z1 }] as never));
    const g = clean(new ShapeGeometry(shape));
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i), 0.002, pos.getY(i));
    const nor = g.getAttribute("normal");
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
    flipWinding(g);
    add([{ key: "paint", geo: g, tint: hex("#8A8076") }]);
  }
  // the north wall: brushed stainless cladding over the case, in panels, plaster-white above
  for (let x = ZONE.x0; x < ZONE.x1 - 0.01; x += 2.5) {
    const w = Math.min(2.5, ZONE.x1 - x);
    add([{ key: "stainless", geo: place(tiledBox(w - 0.012, 1.1, 0.02, 1.2), { pos: [x + w / 2, CASE.top + 0.25 + 0.55, WALL_Z + 0.01] }), tint: [0.92, 0.92, 0.92] }]);
  }
  add([{ key: "paint", geo: place(gridPlane(ZONE.x1 - ZONE.x0, CEILING - 3.47, 4, 1), { pos: [(ZONE.x0 + ZONE.x1) / 2, (CEILING + 3.47) / 2, WALL_Z] }), tint: hex("#D8D2C6") }]);
  // the ceiling round the opening, facing down only (from above it is not there)
  const ceil = (x0: number, x1: number, z0: number, z1: number) => {
    const g = gridPlane(x1 - x0, z1 - z0, 3, 1);
    g.rotateX(Math.PI / 2);
    add([{ key: "paint", geo: place(g, { pos: [(x0 + x1) / 2, CEILING, (z0 + z1) / 2] }), tint: hex("#CFC8BC") }]);
  };
  ceil(ZONE.x0, ZONE.x1, WALL_Z, SKY.z0);
  ceil(ZONE.x0, ZONE.x1, SKY.z1, ZONE.z1);
  ceil(ZONE.x0, SKY.x0, SKY.z0, SKY.z1);
  ceil(SKY.x1, ZONE.x1, SKY.z0, SKY.z1);
  // the skylight's well, its walls facing in, white, catching the daylight
  const wellWall = (a: [number, number], b: [number, number]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const g = gridPlane(len, SKY.y - CEILING, 2, 1);
    const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    add([{ key: "paint", geo: place(g, { pos: [(a[0] + b[0]) / 2, (SKY.y + CEILING) / 2, (a[1] + b[1]) / 2], rot: [0, yaw, 0] }), tint: hex("#EEE8DE") }]);
  };
  wellWall([SKY.x0, SKY.z0], [SKY.x1, SKY.z0]);
  wellWall([SKY.x1, SKY.z1], [SKY.x0, SKY.z1]);
  wellWall([SKY.x0, SKY.z1], [SKY.x0, SKY.z0]);
  wellWall([SKY.x1, SKY.z0], [SKY.x1, SKY.z1]);
  // the glass: glowing panes, facing down
  const glass = gridPlane(SKY.x1 - SKY.x0, SKY.z1 - SKY.z0, 4, 1);
  glass.rotateX(Math.PI / 2);
  add([{ key: "glow", geo: place(glass, { pos: [(SKY.x0 + SKY.x1) / 2, SKY.y + 0.02, (SKY.z0 + SKY.z1) / 2] }), tint: [0.96, 0.96, 0.94] }]);
  // the frame: black steel, the rim and the mullions; like every overhead part, facing down and in only, so
  // the camera on its way down sees straight into the room (Bulk's ceiling the same)
  const strip = (x: number, z: number, w: number, d: number, y = SKY.y - 0.01) => {
    const g = gridPlane(w, d, Math.max(w, d), 1);
    g.rotateX(Math.PI / 2);
    add([{ key: "steel", geo: place(g, { pos: [x, y, z] }), tint: BLACK }]);
  };
  const cxs = (SKY.x0 + SKY.x1) / 2;
  strip(cxs, SKY.z0 + 0.08, SKY.x1 - SKY.x0, 0.16);
  strip(cxs, SKY.z1 - 0.08, SKY.x1 - SKY.x0, 0.16);
  strip(SKY.x0 + 0.08, 8, 0.16, SKY.z1 - SKY.z0);
  strip(SKY.x1 - 0.08, 8, 0.16, SKY.z1 - SKY.z0);
  for (let x = 18; x < SKY.x1; x += 4) strip(x, 8, 0.12, SKY.z1 - SKY.z0);
  strip(cxs, 8, SKY.x1 - SKY.x0, 0.12);
  // a fascia round the ceiling's open sides, facing in
  for (const [a, b] of [
    [[ZONE.x0, ZONE.z1], [ZONE.x0, WALL_Z]],
    [[ZONE.x1, ZONE.z1], [ZONE.x0, ZONE.z1]],
    [[ZONE.x1, WALL_Z], [ZONE.x1, ZONE.z1]],
  ] as [number, number][][]) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const g = gridPlane(len, 0.5, 3, 1);
    add([{ key: "paint", geo: place(g, { pos: [(a[0] + b[0]) / 2, CEILING - 0.25, (a[1] + b[1]) / 2], rot: [0, Math.atan2(-(b[1] - a[1]), b[0] - a[0]), 0] }), tint: hex("#CFC8BC") }]);
  }
  // linear LED fittings along the ceiling margins, as in the reference: a black rail, a bright strip under it
  for (const z of [2.2, 13.6]) {
    add([{ key: "steel", geo: beam([ZONE.x0 + 0.5, CEILING - 0.05, z], [ZONE.x1 - 0.5, CEILING - 0.05, z], 0.05, 0.045), tint: BLACK }]);
    add([{ key: "glow", geo: place(tiledBox(ZONE.x1 - ZONE.x0 - 1.2, 0.006, 0.03, 1), { pos: [(ZONE.x0 + ZONE.x1) / 2, CEILING - 0.075, z] }), tint: [1, 0.99, 0.96] }]);
  }

  // ---- the wet wall: the multideck's carcass
  wetWall(add, decals);
  // the stock, bay by bay and deck by deck: each deck a group (one by one near the stop, its fill beyond)
  let bayN = 0;
  for (const sec of WALL) {
    sec.bays.forEach((b, bi) => {
      const bx0 = CASE.x0 + (bayN + bi) * BAY;
      stockBay(b, bx0, sec.category === "cut-fruit-juice" && b.kind === "tub" ? bi : -1, (center, out) => group(center, out), put, rand);
      // the bay's chalkboard, clipped to the well's front lip
      const at: V3 = [bx0 + BAY / 2, 0.6, CASE.zFront + 0.012];
      add([{ key: "chalk", geo: place(toRect(clean(new PlaneGeometry(0.26, 0.12)), signRect(signIndex.get(b.name.replace(/ J\d\d–J\d\d$/, ""))!)), { pos: at, rot: [-0.08, 0, 0] }) }]);
      add([{ key: "steel", geo: place(tiledBox(0.28, 0.14, 0.01, 1), { pos: [at[0], at[1], at[2] - 0.008] }), tint: hex("#4A3A2A") }]);
      signs.push({ name: b.name, at });
    });
    // the section's header board, on the canopy's front
    const x0 = CASE.x0 + bayN * BAY + 0.06;
    const x1 = CASE.x0 + (bayN + sec.bays.length) * BAY - 0.06;
    add(headerBoard({ x0, x1, y0: CASE.top + 0.03, y1: CASE.top + 0.25, z: CASE.canopyZ + 0.03, rect: headerRect(HEADERS.indexOf(sec.header)), tilt: 0.12 }));
    bayN += sec.bays.length;
  }

  // ---- the islands: black steel stands, two tiers of tilted crates each side, a chalkboard per variety
  const crateGroup = new Map<string, number>();
  for (const d of DISPLAYS) {
    const [x0, x1, z0, z1] = ISLANDS[d.island - 1];
    const cz = (z0 + z1) / 2;
    const s = d.side === "N" ? -1 : 1;
    const pitch = (x1 - x0) / 10;
    d.varieties.forEach((v, vi) => {
      const k = KINDS[v.kind] as Kind;
      for (let ti = 0; ti < TIERS.length; ti++)
        for (let c = 0; c < 2; c++) {
          const i = vi * 2 + c;
          const x = x0 + pitch * (i + 0.5);
          const z = cz + s * TIERS[ti].off;
          const crate = M([x, TIERS[ti].y, z], [0, s === -1 ? Math.PI : 0, 0]).multiply(M([0, 0, 0], [CRATE.tilt, 0, 0]));
          const g = group([x, TIERS[ti].y + 0.1, z], [0, s]);
          crateGroup.set(`${d.island}${d.side}:${vi}:${ti}:${c}`, g.id);
          const shade = 0.82 + rand() * 0.2;
          put({ set: "crate", m: crate, color: [shade, shade * 0.97, shade * 0.93], group: g.id, always: true });
          // the pile: its surface the fruit sit on, in the crate's frame (floor at y 0.02)
          const iw = CRATE.w - 0.05;
          const id = CRATE.d - 0.05;
          const peak = k.model === "pack" ? 0.02 : 0.045;
          const fillY = 0.085;
          const pile: Pile = { w: iw, d: id, height: (px, pz) => fillY + peak * Math.sin((Math.max(0, 1 - Math.max(Math.abs(px) / (iw / 2), Math.abs(pz) / (id / 2))) * Math.PI) / 2) ** 1.4 };
          // the pile under the top layer: the fruit's colours mixed (its blush too), in the shade of the ones on top
          const base = hex(k.colors[0]);
          const bl = k.blush ? hex(k.blush[0]) : base;
          // (most of a pile shows the blush side: an apple pile is red, not the tan a half-mix makes)
          const mix = Math.abs(k.blush?.[1] ?? 0) * 0.7;
          const moundTint = base.map((c, q) => (c * (1 - mix) + bl[q] * mix) * 0.85) as V3;
          put({ set: "mound", m: crate.clone().multiply(M([0, fillY, 0], [0, 0, 0], [iw, peak, id])), color: moundTint, attrs: { aGrain: moundAttr(k.mound) }, group: g.id, always: true });
          if (!k.loose) stockCrate(v.kind, crate, pile, (d.island * 97 + vi * 13 + ti * 5 + c) | 0, g.id, put);
        }
      // the variety's chalkboard: on a post at the upper tier's front edge, tilted back, between its crates
      const sx = x0 + pitch * (vi * 2 + 1);
      const sz = cz + s * (TIERS[0].off + CRATE.d / 2 + 0.03);
      const sign = place(toRect(clean(new PlaneGeometry(0.24, 0.11)), signRect(signIndex.get(v.name)!)), { rot: [-0.42, 0, 0] });
      const back = place(tiledBox(0.26, 0.13, 0.012, 1), { pos: [0, 0, -0.008], rot: [-0.42, 0, 0] });
      const post = place(tiledBox(0.012, 0.22, 0.012, 1), { pos: [0, -0.12, -0.03] });
      for (const g of [sign, back, post]) {
        if (s === -1) g.rotateY(Math.PI);
        place(g, { pos: [sx, TIERS[0].y + 0.2, sz] });
      }
      add([
        { key: "chalk", geo: sign },
        { key: "steel", geo: back, tint: hex("#3A2E24") },
        { key: "steel", geo: post, tint: BLACK },
      ]);
      signs.push({ name: v.name, at: [sx, TIERS[0].y + 0.2, sz] });
    });
  }
  for (const [x0, x1, z0, z1] of ISLANDS) {
    add(stand(x0, x1, z0, z1));
    decals.push({ pos: [(x0 + x1) / 2, 0.004, (z0 + z1) / 2], size: [x1 - x0 + 0.5, z1 - z0 + 0.5], shade: 0.42 });
  }

  // ---- two tall potted plants, as in the reference
  for (const [x, z] of PLANTS) {
    add(pottedPlant(x, z, rand));
    decals.push({ pos: [x, 0.004, z], size: [0.9, 0.9], shade: 0.55, round: true });
  }

  // ---- beyond: floral by the entrance, Bulk's shelving and header boards to the east
  backdrop(add, decals, rand);

  // ---- daylight shafts and the misting plumes
  const shafts = shaftGeometry();
  const mist = mistGeometry();

  // ---- targets: every display variety and every wall bay
  const targets: ProduceTarget[] = [];
  for (const d of DISPLAYS) {
    if (!d.category) continue;
    const [x0, x1, z0, z1] = ISLANDS[d.island - 1];
    const cz = (z0 + z1) / 2;
    const s = d.side === "N" ? -1 : 1;
    const pitch = (x1 - x0) / 10;
    const walkZ = s === -1 ? WALKWAYS.filter((w) => w < z0).at(-1)! : WALKWAYS.find((w) => w > z1)!;
    d.varieties.forEach((v, vi) => {
      const cx = x0 + pitch * (vi * 2 + 1);
      const center: V3 = [cx, 0.72, cz + s * 0.61];
      const gs = [0, 1].flatMap((ti) => [0, 1].map((c) => crateGroup.get(`${d.island}${d.side}:${vi}:${ti}:${c}`)!));
      targets.push({ category: d.category!, name: v.name, groups: gs, center, size: [pitch * 2 + 0.04, 0.62, 0.92], facing: s as 1 | -1, walkZ, stand: Math.abs(walkZ - center[2]), side: 0, kind: "island", ...approach(cx, walkZ) });
    });
  }
  bayN = 0;
  for (const sec of WALL) {
    sec.bays.forEach((b, bi) => {
      const cx = CASE.x0 + (bayN + bi + 0.5) * BAY;
      // the bay's middle decks: what the shopper faces at eye level
      const gs = groups.filter((g) => Math.abs(g.center[0] - cx) < BAY / 2 && g.center[2] < CASE.zFront + 0.05 && g.center[1] > 0.9 && g.center[1] < 1.7).map((g) => g.id);
      const center: V3 = [cx, 1.34, 1.72];
      targets.push({ category: sec.category, name: b.name, groups: gs, center, size: [BAY - 0.04, 0.96, 0.66], facing: 1, walkZ: WALKWAYS[0], stand: WALKWAYS[0] - center[2] + 0.15, side: 0, kind: "wall", ...approach(cx, WALKWAYS[0]) });
    });
    bayN += sec.bays.length;
  }

  const statics = batch.merged() as Map<ProduceMaterialKey, BufferGeometry>;
  const always = items.filter((i) => i.always).reduce((s, i) => s + specTris[i.set], 0);
  const fills = groups.reduce((s, g) => s + (g.fill ? specTris[g.fill.set] : 0), 0);
  const triangles = [...statics.values()].reduce((s, g) => s + tris(g), 0) + always + fills + decals.length * 2 + tris(shafts) + tris(mist);
  return { statics, specs, items, groups, decals, targets, shafts, mist, triangles: Math.round(triangles), signs };
}

/** the skylight's panes: their centres (between the mullions every 4 m and the cross bar at z 8) */
export const PANE_X = [16, 20, 24, 28, 32, 36, 40, 44];
export const PANE_Z = [5.5, 10.5];
/** a stroll: the walk in and between stops, metres a second */
export const WALK_SPEED = 1.4;
/** the walk in, at most; and how far from the stop the camera lands, along its walking line */
export const WALK_IN_MAX = 4;
export const LANDING_M = 2.2;

/**
 * How the shopper reaches a display: the camera comes down over the roof to the pane above its landing,
 * through the middle of its glass (never near a mullion), over the islands, and lands at eye level on the
 * stop's walking line 2.2 m from where the shopper will stand; then a short walk along the line, at a
 * stroll (1.6 s), turning to face it. (The descent's curve is CloseUpCamera's `descentPath` through these
 * waypoints.)
 */
export function approach(standX: number, walkZ: number): { door: V3; via: V3[]; descent: V3[]; bounds: { x0: number; x1: number } } {
  // the landing: a couple of metres from the stop along its line, toward the zone's middle (so it is under the
  // skylight, whose ends are 2 m in from the zone's)
  const toward = standX < (SKY.x0 + SKY.x1) / 2 ? 1 : -1;
  const xd = standX + toward * LANDING_M;
  // through the glass at the middle of the pane over the landing, never near a mullion
  const xp = PANE_X.reduce((a, b) => (Math.abs(b - xd) < Math.abs(a - xd) ? b : a));
  // the pane row on the walkway's side: the wall's walkway under the north row, the rows' walkway under the south
  const zp = walkZ < 6 ? PANE_Z[0] : PANE_Z[1];
  return {
    door: [xd, EYE, walkZ],
    via: [],
    // well over the roof above the pane, then through its glass, then down over the islands to the walkway
    descent: [
      [xp, SKY.y + 3.5, zp],
      [xp, SKY.y - 0.9, zp],
      [xd, EYE + 1.6, walkZ + (zp - walkZ) * 0.25],
    ],
    bounds: { x0: ZONE.x0 + 0.6, x1: ZONE.x1 - 0.6 },
  };
}

/**
 * The way from one stop to the next inside the zone, at eye level: along the walking line the shopper is on,
 * up or down the nearest cross aisle to the next one's line, and along it; never through an island.
 */
export function walkOver(from: V3, to: { x: number; walkZ: number }): V3[] {
  const fromZ = WALKWAYS.reduce((a, b) => (Math.abs(b - from[2]) < Math.abs(a - from[2]) ? b : a));
  if (Math.abs(fromZ - to.walkZ) < 0.01) return [[from[0], EYE, fromZ]];
  const xc = CROSS.reduce((a, b) => (Math.abs(from[0] - b) + Math.abs(b - to.x) < Math.abs(from[0] - a) + Math.abs(a - to.x) ? b : a));
  return [
    [from[0], EYE, fromZ],
    [xc, EYE, fromZ],
    [xc, EYE, to.walkZ],
  ];
}

// ---------------------------------------------------------------- the wet wall

function wetWall(add: (p: { key: ProduceMaterialKey; geo: BufferGeometry; tint?: V3 }[]) => void, decals: Decal[]) {
  const w = CASE.x1 - CASE.x0;
  const cx = (CASE.x0 + CASE.x1) / 2;
  const st = (geo: BufferGeometry, tint: V3 = [1, 1, 1]) => add([{ key: "stainless", geo, tint }]);
  // the base and the well's front: stainless, with a black bumper rail
  st(place(tiledBox(w, 0.7, 0.03, 1.2), { pos: [cx, 0.35, CASE.zFront] }));
  add([{ key: "steel", geo: place(tiledBox(w, 0.05, 0.05, 1), { pos: [cx, 0.71, CASE.zFront + 0.01] }), tint: BLACK }]);
  add([{ key: "steel", geo: place(tiledBox(w, 0.1, 0.04, 1), { pos: [cx, 0.05, CASE.zFront + 0.03] }), tint: BLACK }]);
  // inside the case it is dark, as in the reference: a black back, black decks, so the stock and the lip
  // lights carry it; stainless outside (the base, the uprights, the canopy)
  add([{ key: "steel", geo: place(tiledBox(w, CASE.top - 0.55, 0.02, 1.2), { pos: [cx, (CASE.top + 0.55) / 2, CASE.zBack - 0.01] }), tint: hex("#2A2A28") }]);
  const canopy = tiledBox(w, 0.02, CASE.canopyZ - WALL_Z + 0.05, 1.2);
  place(canopy, { pos: [cx, CASE.top + 0.16, (CASE.canopyZ + WALL_Z) / 2], rot: [-0.3, 0, 0] });
  st(canopy, [0.95, 0.95, 0.95]);
  st(place(tiledBox(w, 0.3, 0.02, 1.2), { pos: [cx, CASE.top + 0.13, CASE.canopyZ] }));
  // the LED strip under the canopy's lip
  add([{ key: "glow", geo: place(tiledBox(w, 0.012, 0.025, 1), { pos: [cx, CASE.top - 0.025, CASE.canopyZ - 0.04] }), tint: [1, 0.98, 0.93] }]);
  // the decks: stainless trays sloping toward the shopper, a lip on each with its LED strip under it
  DECKS.forEach((d, i) => {
    const front = deckFront(i);
    const depth = d.depth;
    const tilt = deckTilt(i);
    const tray = tiledBox(w, 0.02, depth / Math.cos(tilt), 1.2);
    place(tray, { pos: [cx, d.lip + d.rise / 2 - 0.012, CASE.zBack + depth / 2], rot: [tilt, 0, 0] });
    add([{ key: "steel", geo: tray, tint: hex("#252523") }]);
    if (i === 0) return;
    st(place(tiledBox(w, 0.06, 0.012, 1), { pos: [cx, d.lip + 0.01, front] }));
    // a black price rail, the strip under it
    add([{ key: "steel", geo: place(tiledBox(w, 0.035, 0.006, 1), { pos: [cx, d.lip + 0.005, front + 0.009] }), tint: hex("#2A2826") }]);
    add([{ key: "glow", geo: place(tiledBox(w, 0.01, 0.022, 1), { pos: [cx, d.lip - 0.028, front - 0.035] }), tint: [1, 0.98, 0.93] }]);
  });
  // the uprights: a stainless panel every two bays, from the well to the canopy; the ends full depth
  for (let b = 0; b <= CASE.bays; b += 2) {
    const x = CASE.x0 + b * BAY;
    const end = b === 0 || b === CASE.bays;
    const depth = end ? CASE.zFront - CASE.zBack : DECKS[1].depth + 0.04;
    st(place(tiledBox(end ? 0.05 : 0.02, CASE.top - (end ? 0 : 0.64), depth, 1), { pos: [x, end ? CASE.top / 2 : (CASE.top + 0.64) / 2, CASE.zBack + depth / 2] }), [0.92, 0.92, 0.92]);
  }
  // the juice (the last three bays) as in its reference: a stainless back with rows of vent slots between the
  // shelves, and stainless shelves, where the rest of the case is black inside
  const jx0 = CASE.x0 + (CASE.bays - 3) * BAY;
  const jw = CASE.x1 - jx0;
  const jcx = jx0 + jw / 2;
  st(place(tiledBox(jw - 0.06, CASE.top - 0.62, 0.012, 1.2), { pos: [jcx, (CASE.top + 0.62) / 2, CASE.zBack + 0.008] }), [0.9, 0.9, 0.9]);
  for (let i = 1; i < DECKS.length; i++) {
    const below = DECKS[i - 1].lip + DECKS[i - 1].rise;
    for (const f of [0.38, 0.62]) {
      const y = below + (DECKS[i].lip - below) * f;
      for (let x = jx0 + 0.08; x < CASE.x1 - 0.08; x += 0.07) add([{ key: "steel", geo: place(tiledBox(0.036, 0.006, 0.004, 1), { pos: [x, y, CASE.zBack + 0.016] }), tint: hex("#1A1A19") }]);
    }
  }
  DECKS.forEach((d, i) => {
    const tilt = deckTilt(i);
    const plate = tiledBox(jw - 0.06, 0.006, d.depth / Math.cos(tilt), 1.2);
    place(plate, { pos: [jcx, d.lip + d.rise / 2 - 0.0, CASE.zBack + d.depth / 2], rot: [tilt, 0, 0] });
    st(plate, [0.92, 0.92, 0.92]);
  });
  // misting bars over the greens and herbs (bays 1–11): a thin tube under each deck's lip, nozzles on it
  const misting = CASE.x0 + 11 * BAY;
  for (let i = 1; i < DECKS.length; i++) {
    const y = DECKS[i].lip - 0.055;
    const z = deckFront(i) - 0.07;
    add([{ key: "steel", geo: beam([CASE.x0 + 0.05, y, z], [misting - 0.05, y, z], 0.011), tint: [0.62, 0.62, 0.6] }]);
    for (let x = CASE.x0 + 0.2; x < misting; x += 0.3) add([{ key: "steel", geo: place(tiledBox(0.012, 0.018, 0.012, 1), { pos: [x, y - 0.012, z] }), tint: [0.5, 0.5, 0.48] }]);
  }
  decals.push({ pos: [cx, 0.004, CASE.zFront + 0.12], size: [w + 0.2, 0.4], shade: 0.5 });
}

/** a wall bay's stock, deck by deck: each deck a group; its items one by one, and its fill for far away */
function stockBay(b: (typeof WALL)[number]["bays"][number], bx0: number, cutFruit: number, group: (center: V3, out: [number, number]) => Group, put: (i: Item) => void, rand: () => number) {
  const bx1 = bx0 + BAY;
  DECKS.forEach((_, di) => {
    const front = deckFront(di);
    const tilt = deckTilt(di);
    const y0 = deckY(di, front);
    const g = group([(bx0 + bx1) / 2, y0 + 0.1, front - 0.15], [0, 1]);
    const depth = DECKS[di].depth - 0.04;
    // what stands on this deck, in rows from the front
    const onDeck = (x: number, z: number) => M([x, deckY(di, z) + 0.004, z], [tilt, 0, 0]);
    const row = (z: number, step: number, f: (x: number, k: number) => void) => {
      let k = 0;
      for (let x = bx0 + 0.04 + step / 2; x < bx1 - 0.04 - step / 2 + 1e-6; x += step) f(x, k++);
    };
    // the far row: which cell, how many across, how tall, stacked how many
    let far: { pack: PackId; w: number; h: number; stack: number; tint: V3 } = { pack: "spinach", w: 0.18, h: 0.16, stack: 1, tint: [1, 1, 1] };
    if (b.kind === "bottle" && di === 0) {
      // the chilled well under the juice, as in the reference: energy balls in round deli tubs stacked two
      // high, three rows deep, a paper label on each lid, mixed along the bay
      far = { pack: BITES[0], w: 0.13, h: 0.155, stack: 2, tint: [1, 1, 1] };
      for (let r = 0; r < 3; r++) {
        const z = front - 0.09 - r * 0.13;
        row(z, 0.13, (x, k) => {
          const pack = BITES[(k + r * 3 + Math.floor(bx0)) % BITES.length];
          for (let h = 0; h < 2; h++) {
            const m = onDeck(x + (rand() - 0.5) * 0.008, z).multiply(M([0, h * 0.0785, 0], [0, rand() * Math.PI * 2, 0]));
            put({ set: "deliClear", m, color: [1, 1, 1], group: g.id });
            put({ set: "deliContent", m, color: [1, 1, 1], attrs: { aCell: cellOf(packRect(pack)) }, group: g.id });
            if (h === 1) put({ set: "deliLabel", m, color: [1, 1, 1], attrs: { aCell: cellOf(packRect("bitesLabel")) }, group: g.id });
          }
        });
      }
    } else if (b.kind === "bottle") {
      far = { pack: "bottlesRow", w: 0.296, h: 0.21, stack: 1, tint: [1, 1, 1] };
      const juices = b.juice!;
      // two rows deep, each juice two bottles wide; the top deck a single row
      for (let r = 0; r < (di === DECKS.length - 1 ? 1 : 2); r++) {
        const z = front - 0.045 - r * 0.075;
        row(z, 0.074, (x, k) => {
          const j = JUICES[juices[Math.floor(k / 2) % juices.length] - 1];
          const m = onDeck(x + (rand() - 0.5) * 0.004, z).multiply(M([0, 0, 0], [0, (rand() - 0.5) * 0.4, 0]));
          put({ set: "bottleGlass", m, color: [1, 1, 1], group: g.id });
          put({ set: "bottleBody", m, color: hex(j.color), group: g.id });
          put({ set: "bottleCap", m, color: [1, 1, 1], group: g.id });
          put({ set: "bottleLabel", m, color: [1, 1, 1], attrs: { aCell: cellOf(juiceRect(j.n)) }, group: g.id });
        });
      }
    } else if (b.kind === "tub") {
      // tubs stacked two high in tidy rows, as in the cut fruit reference; cut fruit mixes its varieties
      // cut fruit: tall tubs, two filling a deck's height as in the reference; mushrooms and cut veg flatter
      const size: V3 = cutFruit >= 0 ? [0.13, 0.115, 0.12] : [0.14, 0.075, 0.11];
      const tint = b.pack!;
      far = { pack: cutFruit >= 0 ? CUT_FRUIT[cutFruit * 4] : tint, w: size[0] + 0.012, h: size[1] * 2 + 0.003, stack: di === DECKS.length - 1 ? 1 : 2, tint: [1, 1, 1] };
      const rows = Math.max(1, Math.floor((depth - 0.02) / (size[2] + 0.01)));
      for (let r = 0; r < Math.min(rows, 3); r++) {
        const z = front - 0.02 - size[2] / 2 - r * (size[2] + 0.008);
        row(z, size[0] + 0.012, (x, k) => {
          const pack: PackId = cutFruit >= 0 ? CUT_FRUIT[(k + cutFruit * 4 + r) % CUT_FRUIT.length] : tint;
          for (let h = 0; h < (di === DECKS.length - 1 ? 1 : 2); h++) {
            const m = onDeck(x, z).multiply(M([0, h * (size[1] + 0.003), 0], [0, (rand() - 0.5) * 0.06, 0], size));
            put({ set: "packClear", m, color: [1, 1, 1], group: g.id });
            put({ set: "packContent", m, color: [1, 1, 1], attrs: { aCell: cellOf(packRect(pack)) }, group: g.id });
          }
        });
      }
    } else {
      const k = KINDS[b.kind as KindId] as Kind;
      far = k.model === "head" ? { pack: "headsRow", w: 0.6, h: 0.18, stack: 1, tint: [1, 1, 1] } : k.model === "bunch" ? { pack: "herbsRow", w: 0.6, h: 0.24, stack: 1, tint: [1, 1, 1] } : { pack: k.pack!, w: k.size[0] + 0.012, h: k.size[1] * (k.pack === "saladKit" ? 0.9 : 2), stack: k.pack === "saladKit" ? 1 : 2, tint: [1, 1, 1] };
      const clearance = (di === DECKS.length - 1 ? CASE.top : DECKS[di + 1].lip) - y0 - 0.03;
      if (k.model === "head") {
        // heads: standing (or lying, when tall) in two rows
        const lying = k.size[1] > clearance;
        const s: V3 = lying ? [k.size[0], k.size[2], k.size[1]] : k.size;
        for (let r = 0; r < 2; r++) {
          const z = front - s[2] / 2 - 0.02 - r * s[2] * 0.85;
          row(z, s[0] * 0.92, (x) => {
            const v = 0.9 + rand() * 0.2;
            const c = hex(k.colors[Math.floor(rand() * k.colors.length)]).map((q) => q * (0.9 + rand() * 0.2)) as V3;
            const m = onDeck(x, z).multiply(lying ? M([0, s[1] * v * 0.45, 0], [Math.PI / 2, rand() * 0.4, 0], [k.size[0] * v, k.size[1] * v, k.size[2] * v]) : M([0, 0, 0], [0, rand() * 6, 0], [s[0] * v, s[1] * v, s[2] * v]));
            put({ set: "head", m, color: c, group: g.id });
          });
        }
      } else if (k.model === "bunch") {
        // bunches standing, leaning back against the row behind
        const h = Math.min(k.size[1], clearance);
        for (let r = 0; r < 2; r++) {
          const z = front - 0.05 - r * 0.1;
          row(z, k.size[0] * 0.78, (x) => {
            const m = onDeck(x, z).multiply(M([0, 0, 0], [-0.28 - rand() * 0.1, (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.15], [k.size[0], h, k.size[2]]));
            const c = hex(k.colors[0]).map((q) => q * (0.9 + rand() * 0.2)) as V3;
            put({ set: "stems", m, color: [1, 1, 1], group: g.id });
            put({ set: "leaves", m, color: c, attrs: { aCell: cellOf(foliageRect(k.leaf!)) }, group: g.id });
          });
        }
      } else if (k.model === "pack") {
        const s = k.size;
        const isBag = k.pack === "saladKit";
        for (let r = 0; r < 2; r++) {
          const z = front - 0.03 - (isBag ? 0.04 : s[2] / 2) - r * (isBag ? 0.09 : s[2] + 0.01);
          row(z, s[0] + 0.012, (x) => {
            if (isBag) {
              const hh = Math.min(s[1], clearance);
              put({ set: "bag", m: onDeck(x, z).multiply(M([0, 0, 0], [-0.32, (rand() - 0.5) * 0.1, 0], [s[0], hh, s[2]])), color: [1, 1, 1], attrs: { aCell: cellOf(packRect(k.pack!)) }, group: g.id });
            } else
              for (let hh = 0; hh < 2; hh++) {
                const m = onDeck(x, z).multiply(M([0, hh * (s[1] + 0.003), 0], [0, (rand() - 0.5) * 0.06, 0], s));
                put({ set: "packClear", m, color: [1, 1, 1], group: g.id });
                put({ set: "packContent", m, color: [1, 1, 1], attrs: { aCell: cellOf(packRect(k.pack!)) }, group: g.id });
              }
          });
        }
      }
    }
    // the fill: what the deck shows from far away, a row of its stock on the deck's front half
    const clear = (di === DECKS.length - 1 ? CASE.top : DECKS[di + 1].lip) - y0 - 0.03;
    const fd = Math.min(depth, 0.3);
    g.fill = { set: "row", m: M([(bx0 + bx1) / 2, deckY(di, front - fd / 2 - 0.02) + 0.004, front - fd / 2 - 0.02], [tilt, 0, 0], [BAY - 0.08, Math.min(far.h, clear), fd]), color: far.tint, attrs: { aCell: cellOf(packRect(far.pack)), aRep: [(BAY - 0.08) / far.w, far.stack] }, group: g.id };
  });
}

// ---------------------------------------------------------------- the islands

/** a crate's fruit: packed into its pile (fruit.ts), round ones on the fruit template, others theirs */
function stockCrate(kindId: KindId, crate: Matrix4, pile: Pile, seed: number, groupId: number, put: (i: Item) => void) {
  const k = KINDS[kindId] as Kind;
  const r = rng(seed);
  if (k.model === "round") {
    const sh = shapeOf(k);
    const attrs = { aShapeA: sh.a, aShapeB: sh.b, aShapeC: sh.c, aBlush: sh.blush, aPole: sh.pole };
    for (const p of packCrate(kindId, pile, seed)) {
      put({ set: "fruit", m: fruitMatrix(crate, p), color: p.color, attrs, group: groupId });
      // a pineapple's crown
      if (k.leaf === "crown") put({ set: "leaves", m: fruitMatrix(crate, { ...p, pos: [p.pos[0], p.pos[1] + p.size[1] * 0.3, p.pos[2]], size: [0.16, 0.2, 0.16], rot: [p.rot[0] * 0.3, p.rot[1], p.rot[2] * 0.3] }), color: hex("#5A7A3A"), attrs: { aCell: cellOf(foliageRect("crown")) }, group: groupId });
    }
  } else if (k.model === "banana") {
    // bunches lying in the crate, crowns alternating, two rows
    for (let i = 0; i < 6; i++) {
      const row = i % 2;
      const x = (Math.floor(i / 2) - 1) * 0.16;
      const z = (row - 0.5) * 0.15;
      const y = pile.height(x, z) + 0.01;
      const c = hex(k.colors[Math.floor(r() * k.colors.length)]).map((q) => q * (0.9 + r() * 0.15)) as V3;
      const m = crate.clone().multiply(M([x, y, z], [0, (row ? Math.PI : 0) + Math.PI / 2 + (r() - 0.5) * 0.3, 0], [k.size[0] / 0.2, k.size[0] / 0.2, k.size[0] / 0.2]));
      put({ set: "banana", m, color: c, group: groupId });
    }
  } else if (k.model === "head") {
    for (let i = 0; i < 4; i++) {
      const x = (i % 2 - 0.5) * 0.25;
      const z = (Math.floor(i / 2) - 0.5) * 0.18;
      const v = 0.85 + r() * 0.15;
      const c = hex(k.colors[Math.floor(r() * k.colors.length)]).map((q) => q * (0.9 + r() * 0.2)) as V3;
      put({ set: "head", m: crate.clone().multiply(M([x, pile.height(x, z) - 0.02, z], [0, r() * 6, 0], [k.size[0] * v * 0.95, k.size[1] * v, k.size[2] * v * 0.95])), color: c, group: groupId });
    }
  } else if (k.model === "bunch") {
    // tied bunches lying in rows (spring onions)
    for (let i = 0; i < 5; i++) {
      const z = (i - 2) * 0.075;
      const m = crate.clone().multiply(M([-0.12, pile.height(0, z) + 0.02, z], [0, 0, -Math.PI / 2 + 0.1], [k.size[0], k.size[1], k.size[2]]));
      put({ set: "stems", m, color: [1, 1, 1], group: groupId });
      put({ set: "leaves", m, color: hex(k.colors[0]), attrs: { aCell: cellOf(foliageRect(k.leaf!)) }, group: groupId });
    }
  } else if (k.model === "pack") {
    // punnets in a grid, bags of grapes lying
    const s = k.size;
    const isBag = k.pack === "grapes";
    const nx = Math.max(1, Math.floor((pile.w + 0.01) / (s[0] + 0.01)));
    const nz = Math.max(1, Math.floor((pile.d + 0.01) / (s[2] + 0.01)));
    for (let ix = 0; ix < nx; ix++)
      for (let iz = 0; iz < nz; iz++) {
        const x = (ix - (nx - 1) / 2) * (s[0] + 0.01);
        const z = (iz - (nz - 1) / 2) * (s[2] + 0.01);
        const y = pile.height(x, z) - 0.01;
        const tint = hex(k.colors[0]);
        if (isBag) put({ set: "bag", m: crate.clone().multiply(M([x, y, z + s[2] * 0.25], [-Math.PI / 2 + 0.15, (r() - 0.5) * 0.3, 0], [s[0], s[2] * 1.4, s[1]])), color: tint, attrs: { aCell: cellOf(packRect(k.pack!)) }, group: groupId });
        else {
          const m = crate.clone().multiply(M([x, y, z], [0, (r() - 0.5) * 0.08, 0], s));
          put({ set: "packClear", m, color: [1, 1, 1], group: groupId });
          put({ set: "packContent", m, color: tint, attrs: { aCell: cellOf(packRect(k.pack!)) }, group: groupId });
        }
      }
  }
}

/** an open wooden crate, outer size CRATE, its floor at y 0 */
function crateGeometry(): BufferGeometry {
  const { w, h, d } = CRATE;
  const t = 0.014;
  const parts = [
    place(tiledBox(w, t, d, 0.6), { pos: [0, t / 2, 0] }),
    place(tiledBox(w, h, t, 0.6), { pos: [0, h / 2, d / 2 - t / 2] }),
    place(tiledBox(w, h * 0.62, t, 0.6), { pos: [0, h * 0.31, -d / 2 + t / 2] }),
    place(tiledBox(t, h, d, 0.6), { pos: [w / 2 - t / 2, h / 2, 0] }),
    place(tiledBox(t, h, d, 0.6), { pos: [-w / 2 + t / 2, h / 2, 0] }),
  ];
  const g = mergeAll(parts);
  colorize(g);
  return g;
}

/** an island's stand: black steel legs and rails, the spine between its two faces, a low shelf under it all */
function stand(x0: number, x1: number, z0: number, z1: number): { key: ProduceMaterialKey; geo: BufferGeometry; tint?: V3 }[] {
  const out: { key: ProduceMaterialKey; geo: BufferGeometry; tint?: V3 }[] = [];
  const cz = (z0 + z1) / 2;
  const w = x1 - x0;
  const legs = 4;
  for (let i = 0; i < legs; i++) {
    const x = x0 + 0.03 + (i * (w - 0.06)) / (legs - 1);
    for (const s of [-1, 1]) {
      out.push({ key: "steel", geo: place(tiledBox(0.04, 1.0, 0.04, 1), { pos: [x, 0.5, cz + s * 0.2] }), tint: BLACK });
      out.push({ key: "steel", geo: place(tiledBox(0.04, 0.55, 0.04, 1), { pos: [x, 0.275, cz + s * 1.06] }), tint: BLACK });
      // the arms the crates rest on, sloping out
      out.push({ key: "steel", geo: beam([x, TIERS[0].y - 0.05, cz + s * 0.18], [x, TIERS[0].y - 0.15, cz + s * 0.6], 0.03), tint: BLACK });
      out.push({ key: "steel", geo: beam([x, TIERS[1].y - 0.05, cz + s * 0.62], [x, TIERS[1].y - 0.15, cz + s * 1.06], 0.03), tint: BLACK });
    }
  }
  for (const s of [-1, 1]) {
    for (const [y, z] of [
      [TIERS[0].y - 0.08, 0.36],
      [TIERS[1].y - 0.12, 1.06],
      [0.1, 1.04],
    ])
      out.push({ key: "steel", geo: place(tiledBox(w, 0.03, 0.03, 1), { pos: [(x0 + x1) / 2, y, cz + s * z] }), tint: BLACK });
  }
  // the spine: an open frame, a rail along the top between the faces; the low shelf under it all
  out.push({ key: "steel", geo: place(tiledBox(w, 0.035, 0.035, 1), { pos: [(x0 + x1) / 2, 1.0, cz] }), tint: BLACK });
  out.push({ key: "steel", geo: place(tiledBox(w, 0.03, 2.1, 1), { pos: [(x0 + x1) / 2, 0.12, cz] }), tint: BLACK });
  return out;
}

function pottedPlant(x: number, z: number, rand: () => number): { key: ProduceMaterialKey; geo: BufferGeometry; tint?: V3 }[] {
  const out: { key: ProduceMaterialKey; geo: BufferGeometry; tint?: V3 }[] = [];
  // a tall black planter
  out.push({ key: "steel", geo: place(lathe([[0, 0], [0.24, 0], [0.3, 0.62], [0.27, 0.62], [0.27, 0.58]], 16), { pos: [x, 0, z] }), tint: hex("#262422") });
  out.push({ key: "paint", geo: place(cylinder(0.27, 0.27, 0.02, 16), { pos: [x, 0.58, z] }), tint: hex("#3A2E24") });
  // three stems, and fronds fanning off their tops (crossed cards)
  for (let s = 0; s < 3; s++) {
    const a = (s / 3) * Math.PI * 2 + rand();
    const top: V3 = [x + Math.cos(a) * 0.18, 1.5 + s * 0.28, z + Math.sin(a) * 0.18];
    out.push({ key: "paint", geo: beam([x, 0.58, z], top, 0.035), tint: hex("#6A5A40") });
    for (let f = 0; f < 9; f++) {
      const fa = (f / 9) * Math.PI * 2 + rand() * 0.4;
      const card = clean(new PlaneGeometry(0.22, 0.8));
      toRect(card, foliageRect(f % 2 ? "dracaena" : "palm"));
      card.translate(0, 0.4, 0);
      card.rotateX(0.5 + rand() * 0.6);
      card.rotateY(fa);
      card.translate(...top);
      out.push({ key: "foliage", geo: card, tint: [0.85 + rand() * 0.2, 0.9 + rand() * 0.15, 0.85] });
    }
  }
  return out;
}

// ---------------------------------------------------------------- beyond the zone

function backdrop(add: (p: (Piece | { key: ProduceMaterialKey; geo: BufferGeometry; tint?: V3 })[]) => void, decals: Decal[], rand: () => number) {
  // floral (x 3–9.5, y 1.6–4.4): a wooden table of steel buckets of flowers, under its header
  add([{ key: "pine", geo: place(tiledBox(6.5, 0.06, 2.8, 1.2), { pos: [6.25, 0.72, 3] }), tint: [0.75, 0.6, 0.48] }]);
  for (const [lx, lz] of [
    [3.1, 1.7],
    [9.4, 1.7],
    [3.1, 4.3],
    [9.4, 4.3],
  ])
    add([{ key: "steel", geo: place(tiledBox(0.05, 0.72, 0.05, 1), { pos: [lx, 0.36, lz] }), tint: BLACK }]);
  const blooms = ["bloomRose", "bloomDaisy", "bloomTulip"] as const;
  const tints = ["#E8708A", "#F2D24A", "#E84A3A", "#F4F0E8", "#C86AA8", "#F2944A"];
  for (let x = 3.5; x < 9.3; x += 0.42)
    for (let z = 1.9; z < 4.2; z += 0.42) {
      add([{ key: "steel", geo: place(lathe([[0, 0], [0.11, 0], [0.13, 0.26], [0.125, 0.26]], 10), { pos: [x, 0.75, z] }), tint: [0.62, 0.62, 0.6] }]);
      const kind = blooms[Math.floor(rand() * blooms.length)];
      const tint = hex(tints[Math.floor(rand() * tints.length)]);
      for (let c = 0; c < 2; c++) {
        const card = clean(new PlaneGeometry(0.34, 0.42));
        toRect(card, foliageRect(kind));
        card.translate(0, 0.2, 0);
        card.rotateY(c * (Math.PI / 2) + rand());
        card.translate(x, 0.98, z);
        add([{ key: "foliage", geo: card, tint }]);
      }
    }
  add(headerBoard({ x0: 4.5, x1: 8, y0: 2.4, y1: 2.7, z: 1.6, rect: headerRect(HEADERS.indexOf("FLORAL")), tilt: 0 }));
  decals.push({ pos: [6.25, 0.004, 3], size: [7, 3.2], shade: 0.4 });

  // Bulk (x 50–68): its wall shelving with packs, the five header boards, the scoop-bin run across the aisle
  add(shelving({ x0: 50, x1: 68, zBack: 1.55, zFront: 2.2, bays: 15, tiers: [0.06, 0.62, 0.97, 1.3, 2.06], top: 2.1, plank: 0.034 }));
  const packs = ["#C8A86A", "#5E7A3A", "#B8603A", "#E8D8A8", "#8A4A2A", "#D8B84A", "#6A5A3A", "#A8B87A"];
  for (const y of [0.094, 0.654, 1.004, 1.334])
    for (let x = 50.05; x < 67.9; ) {
      const w = 0.1 + rand() * 0.14;
      const h = 0.16 + rand() * 0.14;
      add([{ key: "paint", geo: place(tiledBox(w, h, 0.22, 1), { pos: [x + w / 2, y + h / 2, 2.05] }), tint: hex(packs[Math.floor(rand() * packs.length)]) }]);
      x += w + 0.015;
    }
  ["PULSES & DALS", "RICE & GRAINS", "FLOURS & ATTA", "NUTS & SEEDS", "DRIED FRUIT"].forEach((h, i) => {
    const x0 = 50 + i * 3.6 + 0.05;
    add(headerBoard({ x0, x1: x0 + 3.5, y0: 2.22, y1: 2.52, z: 2.24, rect: headerRect(HEADERS.indexOf(h)), tilt: 0.32 }));
  });
  add([{ key: "pine", geo: place(tiledBox(15.6, 0.9, 0.65, 1.2), { pos: [60.2, 0.45, 5.12] }), tint: [0.86, 0.8, 0.74] }]);
  for (let x = 52.7; x < 67.8; x += 0.6) add([{ key: "paint", geo: place(tiledBox(0.42, 0.24, 0.48, 1), { pos: [x, 1.02, 5.05] }), tint: hex(packs[Math.floor(rand() * packs.length)]) }]);
  decals.push({ pos: [59, 0.004, 2.35], size: [18.4, 0.4], shade: 0.5 });
}

// ---------------------------------------------------------------- light shafts and mist

/**
 * Faint shafts of daylight: for each pane, two crossed quads along the sun's direction from the glass to the
 * floor, brightest at the top, fading out at the bottom and at their edges (alpha in the vertex colour).
 */
function shaftGeometry(): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const dir = new Vector3(...SUN_DIR);
  const len = (SKY.y - 0.2) / -dir.y;
  for (let x = SKY.x0 + 2; x < SKY.x1; x += 4)
    for (const z of [5.5, 10.5]) {
      const top = new Vector3(x, SKY.y - 0.1, z);
      const bottom = top.clone().addScaledVector(dir, len);
      for (const across of [new Vector3(1, 0, 0), new Vector3(0, 0, 1)]) {
        const half = across.clone().multiplyScalar(across.x ? 1.6 : 2.0);
        const q = [top.clone().sub(half), top.clone().add(half), bottom.clone().add(half), bottom.clone().sub(half)];
        const a = [0.9, 0.9, 0, 0];
        for (const i of [0, 1, 2, 0, 2, 3]) {
          pos.push(q[i].x, q[i].y, q[i].z);
          col.push(1, 1, 1);
          uv.push(i === 0 || i === 3 ? 0 : 1, a[i]);
        }
      }
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.computeBoundingSphere();
  return g;
}

/** the misting plumes: a quad hanging under each misting bar, bay by bay (bays 1–11), over its deck */
function mistGeometry(): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  for (let d = 1; d < DECKS.length; d++) {
    const y = DECKS[d].lip - 0.06;
    const z = deckFront(d) - 0.12;
    for (let b = 0; b < 11; b++) {
      const x0 = CASE.x0 + b * BAY + 0.02;
      const x1 = x0 + BAY - 0.04;
      const q = [
        [x0, y, z],
        [x1, y, z],
        [x1, y - 0.24, z - 0.06],
        [x0, y - 0.24, z - 0.06],
      ];
      const t = [
        [b, 1],
        [b + 1, 1],
        [b + 1, 0],
        [b, 0],
      ];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(...q[i]);
        uv.push(t[i][0], t[i][1] + d * 3);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- detail by distance

export interface Selection {
  /** per set: the instances to draw this stop */
  sets: Map<string, Item[]>;
  /** the target's instances to lift: their set and index in that set's list */
  lift: { set: string; index: number }[];
  /** triangles of the instances one by one (fruit, heads, bunches, packs, bottles) */
  detail: number;
}

/**
 * What this stop draws one by one: the groups the shopper faces, nearest first, within DETAIL_M of where they
 * stand and DETAIL_TRIANGLES in all; the target's own groups always (its fruit on the finer template); every
 * crate and pile whatever; each far wall deck's fill in place of its stock.
 */
export function selectDetail(b: ProduceBuild, t: ProduceTarget, budget = DETAIL_TRIANGLES): Selection {
  const stand: [number, number] = [t.center[0] + t.side, t.center[2] + t.facing * t.stand];
  const look: [number, number] = [0, -t.facing];
  const target = new Set(t.groups);
  const chosen = new Set<number>(target);
  const specTris = Object.fromEntries(b.specs.map((s) => [s.name, tris(s.geo)]));
  let detail = 0;
  // the target's own stock (its round fruit on the finer template) counts first
  for (const it of b.items) if (!it.always && target.has(it.group)) detail += specTris[it.set === "fruit" ? "fruitHi" : it.set];
  const ranked = b.groups
    .filter((g) => !target.has(g.id) && g.tris > 0)
    .map((g) => {
      const dx = g.center[0] - stand[0];
      const dz = g.center[2] - stand[1];
      const d = Math.hypot(dx, dz);
      // it faces the shopper, and it is ahead or beside them, not behind
      const faces = g.out[0] * -dx + g.out[1] * -dz > 0;
      const ahead = (dx * look[0] + dz * look[1]) / Math.max(d, 1e-3) > -0.35;
      return { g, d, ok: faces && ahead && d <= DETAIL_M };
    })
    .filter((r) => r.ok)
    .sort((a, b) => a.d - b.d);
  for (const { g } of ranked) {
    if (detail + g.tris > budget) continue;
    chosen.add(g.id);
    detail += g.tris;
  }
  const sets = new Map<string, Item[]>(b.specs.map((s) => [s.name, []]));
  const lift: Selection["lift"] = [];
  for (const it of b.items) {
    if (!it.always && !chosen.has(it.group)) continue;
    // the target's round fruit on the finer template
    const set = it.set === "fruit" && target.has(it.group) ? "fruitHi" : it.set;
    const list = sets.get(set)!;
    if (target.has(it.group)) lift.push({ set, index: list.length });
    list.push(it);
  }
  for (const g of b.groups)
    if (g.fill && !chosen.has(g.id)) sets.get(g.fill.set)!.push(g.fill);
  return { sets, lift, detail: Math.round(detail) };
}

/** The display a stop points the camera at: its category's variety or bay whose name shares the most words with the item. */
export function pickProduceTarget(targets: ProduceTarget[], category: string, itemName: string): ProduceTarget | null {
  // singular, so "apples" finds "Apple" and "tomatoes" "Tomato"
  const stem = (w: string) => (w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("oes") ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  const words = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 1).map(stem);
  const want = new Set(words(itemName));
  let best: ProduceTarget | null = null;
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

function mergeAll(parts: BufferGeometry[]): BufferGeometry {
  const b = new Batch();
  b.add("x", ...parts);
  return b.merged().get("x")!;
}

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

/** Built once per store map and kept: prepared ahead, reused by every produce close-up after. */
const built = new Map<string, ProduceBuild>();
export function produceZoneFor(store: { storeId: string; version?: number; outline?: [number, number][] }): ProduceBuild {
  const key = `${store.storeId}:${store.version ?? 0}`;
  let z = built.get(key);
  if (!z) built.set(key, (z = buildProduceZone(store.outline)));
  return z;
}
export function dropProduceZone() {
  built.clear();
}
