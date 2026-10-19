// Grosher's Bulk & pulses zone, assembled from the shelf kit: the wall shelving (five sections under their
// header boards: packs on the low tiers, gravity bins at eye level, clay pots on top), the scoop-bin island,
// the centerpiece (open sacks, a stone chakki, a clay pot of dried wheat), the clay-plaster shell with its
// copper conduit and black ceiling tracks, and the room around it (floor, ceiling, walls) so eye level
// never sees the sky. Light is baked: the tracks' spots make warm pools on the shelves, darker between.
//
// Pure geometry: no textures, no React. HeroZone.tsx turns the result into meshes.

import { BufferAttribute, type BufferGeometry, Matrix4, Quaternion, Shape, ShapeGeometry, Path, Vector3, Euler } from "three";
import { bakeVertexColors, hex, irradiance, WARM_3000K, type BakeSetup, type Spot } from "../kit/bake.ts";
import { Batch, clean, gridPlane, place, rng, tiledBox, beam, type V3, type Rect } from "../kit/geom.ts";
import { chakki, clayPot, conduit, headerBoard, sack, shelving, track, wheatBundle, type MaterialKey, type Piece } from "../kit/pieces.ts";
import { BIN, gravityBin, jar, kraftBag, pouch, SCOOP, scoopBin, tin } from "../kit/templates.ts";
import type { KitMaterials } from "../kit/materials.ts";
import { GRAINS, GRAIN_SHAPES, HEADERS, labelCells, labelRect, SACKS, SCOOP_BINS, SCOOP_CATEGORY, SECTIONS, tagRect, type BinItem } from "./recipe.ts";

// ---------------------------------------------------------------- the plan (map metres; z is the map's y)
const WALL_Z = 1.5;
const SHELF = { x0: 50, x1: 68, zBack: 1.55, zFront: 2.2, bays: 15, tiers: [0.1, 0.5, 0.9, 1.28, 2.0], top: 2.14 };
const PLANK_T = 0.028;
const ISLAND = { x0: 52.6, x1: 67.4, z0: 5.0, z1: 6.4, top: 0.9 };
const PLINTH = { x0: 50.3, x1: 52.2, z0: 4.9, z1: 6.9, h: 0.12 };
const CEILING = 4.4;
const ZONE = { x0: 46, x1: 72, z0: 0, z1: 9.6 };
/** overview fixtures the close-up replaces */
export const HIDE_FIXTURES = ["f-bulk-wall", "f-bulk-island", "f-bulk-display"];

const cellOfShape = (shape: (typeof GRAIN_SHAPES)[number]): Rect => {
  const i = GRAIN_SHAPES.indexOf(shape);
  const c = i % 4;
  const r = Math.floor(i / 4);
  const inset = 6 / 1024;
  return [c / 4 + inset, 1 - (r + 1) / 4 + inset, (c + 1) / 4 - inset, 1 - r / 4 - inset];
};
const grainOf = (b: BinItem) => GRAINS[b.grain];

// ---------------------------------------------------------------- light
function lightSetup(): BakeSetup {
  const spots: Spot[] = [];
  // track A over the wall aisle: one spot per 1.8 m, aimed at the shelf face at bin height
  for (let k = 0; k < 10; k++) {
    const x = 50.9 + k * 1.8;
    spots.push({ pos: [x, CEILING - 0.12, 3.05], target: [x, 1.25, SHELF.zFront], angle: 0.42, penumbra: 0.5, intensity: 1.3 });
  }
  // track B over the island (and the centerpiece at its west end)
  spots.push({ pos: [51.2, CEILING - 0.12, 4.6], target: [51.25, 0.35, 5.9], angle: 0.42, penumbra: 0.5, intensity: 1.1 });
  for (let k = 0; k < 8; k++) {
    const x = 53.6 + k * 1.8;
    spots.push({ pos: [x, CEILING - 0.12, 4.6], target: [x, ISLAND.top, 5.5], angle: 0.42, penumbra: 0.5, intensity: 1.15 });
  }
  const tierTops = SHELF.tiers.map((y) => y + PLANK_T);
  return {
    spots,
    warm: WARM_3000K,
    ambient: [0.3, 0.255, 0.215],
    reference: 2.6,
    occlusion: (p, n) => {
      let o = 1;
      const inShelf = p.x > SHELF.x0 - 0.05 && p.x < SHELF.x1 + 0.05 && p.z < SHELF.zFront + 0.02;
      if (inShelf && p.y < SHELF.top) {
        // the dark under each plank, and the back of the shelving
        for (const t of SHELF.tiers) if (p.y < t && t - p.y < 0.16) o *= 0.55 + ((t - p.y) / 0.16) * 0.45;
        if (p.z < SHELF.zBack + 0.05) o *= 0.7;
      }
      // the floor's contact shadow at the shelving, the island and the plinth
      if (n.y > 0.9 && p.y < 0.05) {
        const near = (x0: number, x1: number, z0: number, z1: number, r: number) => Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(z0 - p.z, 0, p.z - z1)) < r;
        if (near(SHELF.x0, SHELF.x1, WALL_Z, SHELF.zFront, 0.18)) o *= 0.62;
        if (near(ISLAND.x0, ISLAND.x1, ISLAND.z0, ISLAND.z1, 0.14)) o *= 0.6;
        if (near(PLINTH.x0, PLINTH.x1, PLINTH.z0, PLINTH.z1, 0.1)) o *= 0.7;
      }
      void tierTops;
      return o;
    },
  };
}

// ---------------------------------------------------------------- instancing
export interface InstanceSet {
  name: string;
  geo: BufferGeometry;
  material: keyof KitMaterials;
  matrices: Matrix4[];
  colors: V3[];
  /** atlas cell per instance (u0, v0, du, dv), for materials with cells */
  cells?: [number, number, number, number][];
}

class Instances {
  sets = new Map<string, InstanceSet>();
  private bake: BakeSetup;
  constructor(bake: BakeSetup) {
    this.bake = bake;
  }
  define(name: string, geo: BufferGeometry, material: keyof KitMaterials) {
    this.sets.set(name, { name, geo, material, matrices: [], colors: [], cells: [] });
  }
  /** add one copy; returns its index. The light is sampled at `lightAt` facing `facing` (z direction). */
  add(name: string, m: Matrix4, lightAt: V3, facing: 1 | -1, opts: { tint?: V3; cell?: Rect } = {}): number {
    const set = this.sets.get(name)!;
    const c = irradiance(this.bake, new Vector3(...lightAt), new Vector3(0, 0.35, facing).normalize());
    const t = opts.tint ?? [1, 1, 1];
    set.matrices.push(m);
    set.colors.push([c[0] * t[0], c[1] * t[1], c[2] * t[2]]);
    const r = opts.cell ?? [0, 0, 1, 1];
    set.cells!.push([r[0], r[1], r[2] - r[0], r[3] - r[1]]);
    return set.matrices.length - 1;
  }
}

const M = (pos: V3, rotY = 0, scale: V3 = [1, 1, 1], lean = 0) => new Matrix4().compose(new Vector3(...pos), new Quaternion().setFromEuler(new Euler(0, rotY, lean)), new Vector3(...scale));

// ---------------------------------------------------------------- targets: where a stop's camera looks
export interface Target {
  category: string;
  name: string;
  /** the instance sets and index of this bin's parts, to lift it */
  parts: { set: string; index: number }[];
  /** the bin's centre and size, for the lit slot */
  center: V3;
  size: V3;
  /** which way the bin faces (z): the shopper stands on that side */
  facing: 1 | -1;
}

export interface ZoneBuild {
  statics: Map<MaterialKey, BufferGeometry>;
  instances: InstanceSet[];
  targets: Target[];
  /** where an eye-level camera may pan: x range, and the aisle's z on each side */
  bounds: { x0: number; x1: number };
  triangles: number;
}

export function buildBulkZone(outline: [number, number][] | undefined): ZoneBuild {
  const bake = lightSetup();
  const batch = new Batch();
  const tints = new Map<BufferGeometry, V3>();
  const add = (pieces: Piece[]) => {
    for (const p of pieces) {
      batch.add(p.key, p.geo);
      if (p.tint) tints.set(p.geo, p.tint);
    }
  };
  const rand = rng(5435);
  const { labels } = labelCells();
  const labelIndex = new Map(labels.map((l, i) => [l.name, i]));
  const tagNames = [...SECTIONS.flatMap((s) => s.bins.map((b) => b.name)), ...SCOOP_BINS.map((b) => b.name)];

  // ---- shell: the clay-plaster wall behind the shelving, the zone's ceiling and floor, and the room around
  add([{ key: "plaster", geo: place(gridPlane(19.2, CEILING, 0.12, 1.6), { pos: [59, CEILING / 2, WALL_Z] }) }]);
  const floor = gridPlane(ZONE.x1 - ZONE.x0, ZONE.z1 - ZONE.z0, 0.2, 2.4);
  floor.rotateX(-Math.PI / 2);
  add([{ key: "concrete", geo: place(floor, { pos: [(ZONE.x0 + ZONE.x1) / 2, 0.002, (ZONE.z0 + ZONE.z1) / 2] }) }]);
  const ceil = gridPlane(ZONE.x1 - ZONE.x0, ZONE.z1 - ZONE.z0, 0.4, 2.4);
  ceil.rotateX(Math.PI / 2);
  add([{ key: "ceiling", geo: place(ceil, { pos: [(ZONE.x0 + ZONE.x1) / 2, CEILING, (ZONE.z0 + ZONE.z1) / 2] }) }]);
  if (outline) {
    // the rest of the store's floor and ceiling, with the zone cut out, and its outer walls
    const shape = new Shape(outline.map(([x, y]) => ({ x, y }) as never));
    const hole = new Path([
      { x: ZONE.x0, y: ZONE.z0 },
      { x: ZONE.x1, y: ZONE.z0 },
      { x: ZONE.x1, y: ZONE.z1 },
      { x: ZONE.x0, y: ZONE.z1 },
    ] as never);
    shape.holes.push(hole);
    for (const [key, y, up] of [
      ["concrete", 0.002, true],
      ["ceiling", CEILING, false],
    ] as const) {
      const g = clean(new ShapeGeometry(shape));
      // ShapeGeometry lies in x / y; turn it onto the floor (map y → z)
      const pos = g.getAttribute("position");
      const uv = g.getAttribute("uv");
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getY(i);
        pos.setXYZ(i, x, y, z);
        uv.setXY(i, x / 2.4, z / 2.4);
      }
      const nor = g.getAttribute("normal");
      for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, up ? 1 : -1, 0);
      // ShapeGeometry's triangles face +z; laid onto the floor (map y → z) they face down: flip the floor's
      if (up) flipWinding(g);
      add([{ key, geo: g }]);
    }
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const wall = gridPlane(len, CEILING, 2, 1.6);
      // facing into the store: the outline runs clockwise on the map (y down), so inward is to the right
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      wall.rotateY(-ang);
      add([{ key: "plaster", geo: place(wall, { pos: [(a[0] + b[0]) / 2, CEILING / 2, (a[1] + b[1]) / 2] }) }]);
    }
  }

  // ---- overhead: copper conduit and the two black tracks
  add(
    conduit([
      [ZONE.x0 + 3.4, CEILING - 0.1, WALL_Z + 0.08],
      [ZONE.x1 - 3.4, CEILING - 0.1, WALL_Z + 0.08],
    ]),
  );
  add(
    conduit([
      [49.8, 2.6, WALL_Z + 0.08],
      [49.8, CEILING - 0.1, WALL_Z + 0.08],
      [59, CEILING - 0.1, WALL_Z + 0.16],
      [59, CEILING - 0.1, 9.0],
    ]),
  );
  add(
    conduit([
      [68.2, 2.6, WALL_Z + 0.08],
      [68.2, CEILING - 0.1, WALL_Z + 0.08],
    ]),
  );
  for (const [z, from] of [
    [3.05, 0],
    [4.6, 10],
  ] as const) {
    const heads = bake.spots.slice(from, from === 0 ? 10 : undefined).map((s) => ({ x: s.pos[0], target: s.target }));
    add(track({ x0: 49.8, x1: 68.2, y: CEILING - 0.04, z, heads }));
  }

  // ---- the wall shelving and its header boards
  add(shelving(SHELF));
  SECTIONS.forEach((s, i) => {
    const x0 = SHELF.x0 + i * 3.6 + 0.04;
    add(headerBoard({ x0, x1: x0 + 3.52, y0: SHELF.top + 0.04, y1: SHELF.top + 0.33, z: SHELF.zFront + 0.02, rect: [...headerRectOf(i)] as Rect }));
  });

  // ---- instanced templates
  const inst = new Instances(bake);
  const gb = gravityBin();
  inst.define("bin-acrylic", gb.acrylic, "acrylic");
  inst.define("bin-fill", gb.fill, "grainCells");
  inst.define("bin-trim", gb.trim, "binTrim");
  inst.define("bin-tag", gb.tag, "label");
  const sb = scoopBin();
  inst.define("scoop-acrylic", sb.acrylic, "acrylic");
  inst.define("scoop-fill", sb.fill, "grainCells");
  inst.define("scoop-trim", sb.trim, "binTrim");
  inst.define("scoop-tag", sb.tag, "label");
  inst.define("pouch", pouch(), "label");
  inst.define("kraft", kraftBag(), "label");
  const j = jar();
  inst.define("jar-glass", j.glass, "glass");
  inst.define("jar-fill", j.fill, "grainCells");
  inst.define("jar-label", j.label, "label");
  inst.define("jar-lid", j.lid, "lid");
  inst.define("tin", tin(), "label");

  const targets: Target[] = [];
  const bay = (SHELF.x1 - SHELF.x0) / SHELF.bays;
  const front = SHELF.zFront;
  const tierY = (t: number) => SHELF.tiers[t] + PLANK_T;
  const labelCell = (name: string): Rect => labelRect(labelIndex.get(name) ?? 0);

  /** a row of packs along a bay's tier: varied spacing, lean, fill and the odd gap, so no two bays repeat */
  const row = (template: "pouch" | "kraft" | "jar" | "tin" | "mixed", items: BinItem[], x0: number, x1: number, y: number, z: number, step: number) => {
    let x = x0 + step / 2 + rand() * 0.02;
    let k = Math.floor(rand() * items.length);
    while (x < x1 - step / 2 + 0.01) {
      if (rand() < 0.07) {
        x += step;
        continue; // a gap: someone just took one
      }
      const it = items[k++ % items.length];
      const kind = template === "mixed" ? (rand() < 0.7 ? "jar" : "tin") : template;
      const yaw = (rand() - 0.5) * 0.18;
      const lean = (rand() - 0.5) * 0.05;
      const jx = (rand() - 0.5) * 0.015;
      const cell = labelCell(it.name);
      const pos: V3 = [x + jx, y, z];
      if (kind === "jar") {
        const m = M(pos, yaw);
        const g = grainOf(it);
        inst.add("jar-glass", m, [pos[0], y + 0.08, z], 1);
        inst.add("jar-fill", m, [pos[0], y + 0.08, z], 1, { tint: hex(g.tint), cell: cellOfShape(g.shape) });
        inst.add("jar-label", m, [pos[0], y + 0.08, z], 1, { cell });
        inst.add("jar-lid", m, [pos[0], y + 0.15, z], 1);
      } else {
        const fill = kind === "tin" ? 1 : 0.86 + rand() * 0.16;
        inst.add(kind, M(pos, yaw, [1, fill, 1], kind === "tin" ? 0 : lean), [pos[0], y + 0.12, z], 1, { cell });
      }
      x += step * (0.94 + rand() * 0.14);
    }
  };

  for (let b = 0; b < SHELF.bays; b++) {
    const s = SECTIONS[Math.floor(b / 3)];
    const items = s.bins.slice((b % 3) * 3, (b % 3) * 3 + 3);
    const x0 = SHELF.x0 + b * bay + 0.04;
    const x1 = x0 + bay - 0.08;
    // tier 0: big kraft bags; tier 1: pouches, two rows; tier 2: jars and tins
    row("kraft", items, x0, x1, tierY(0), front - 0.1, 0.26);
    row("kraft", items, x0 + 0.08, x1, tierY(0), front - 0.36, 0.3);
    row("pouch", items, x0, x1, tierY(1), front - 0.07, 0.165);
    row("pouch", items, x0 + 0.05, x1, tierY(1), front - 0.25, 0.18);
    row("mixed", items, x0, x1, tierY(2), front - 0.08, 0.125);
    // tier 3, eye level: three gravity bins
    items.forEach((it, k) => {
      const cx = x0 + 0.2 + k * ((x1 - x0 - 0.4) / 2);
      const cz = front - BIN.d / 2 - 0.02;
      const y = tierY(3);
      const g = grainOf(it);
      const level = 0.4 + ((b * 3 + k) % 5) * 0.035 + rand() * 0.04;
      const at: V3 = [cx, y + 0.35, front];
      const tagI = tagNames.indexOf(it.name);
      const parts = [
        { set: "bin-acrylic", index: inst.add("bin-acrylic", M([cx, y, cz]), at, 1) },
        { set: "bin-fill", index: inst.add("bin-fill", M([cx, y, cz], 0, [1, level, 1]), at, 1, { tint: hex(g.tint), cell: cellOfShape(g.shape) }) },
        { set: "bin-trim", index: inst.add("bin-trim", M([cx, y, cz]), at, 1) },
        { set: "bin-tag", index: inst.add("bin-tag", M([cx, y, cz]), [cx, y + 0.16, front], 1, { cell: tagRect(tagI) }) },
      ];
      targets.push({ category: s.category, name: it.name, parts, center: [cx, y + 0.36, cz], size: [BIN.w + 0.06, 0.74, BIN.d + 0.04], facing: 1 });
    });
    // tier 4, the top: a clay pot or two and some tins, sparse
    const yTop = tierY(4);
    if (b % 2 === 0) add(clayPot({ x: x0 + 0.25 + rand() * 0.2, y: yTop, z: front - 0.3, r: 0.1 + rand() * 0.03, h: 0.2 + rand() * 0.06 }));
    if (b % 3 !== 1) add(clayPot({ x: x1 - 0.2 - rand() * 0.15, y: yTop, z: front - 0.32, r: 0.08, h: 0.16 }));
    row("tin", items.slice(0, 1), x0 + 0.5, x0 + 0.85, yTop, front - 0.12, 0.13);
  }

  // ---- the island: a pine body on a black steel frame, scoop bins on both long faces
  const iw = ISLAND.x1 - ISLAND.x0;
  const id = ISLAND.z1 - ISLAND.z0;
  const icx = (ISLAND.x0 + ISLAND.x1) / 2;
  const icz = (ISLAND.z0 + ISLAND.z1) / 2;
  add([{ key: "pine", geo: place(tiledBox(iw - 0.1, ISLAND.top - 0.14, id - 0.1, 1.2), { pos: [icx, 0.1 + (ISLAND.top - 0.14) / 2, icz] }) }]);
  add([{ key: "pine", geo: place(tiledBox(iw, 0.04, id, 1.2), { pos: [icx, ISLAND.top - 0.02, icz] }) }]);
  add([{ key: "steel", geo: place(tiledBox(iw - 0.12, 0.1, id - 0.12, 1), { pos: [icx, 0.05, icz] }) }]);
  for (const x of [ISLAND.x0 + 0.02, ISLAND.x1 - 0.02])
    for (const z of [ISLAND.z0 + 0.02, ISLAND.z1 - 0.02]) add([{ key: "steel", geo: place(tiledBox(0.04, ISLAND.top, 0.04, 1), { pos: [x, ISLAND.top / 2, z] }) }]);
  for (const z of [ISLAND.z0 + 0.02, ISLAND.z1 - 0.02]) add([{ key: "steel", geo: beam([ISLAND.x0, ISLAND.top - 0.05, z], [ISLAND.x1, ISLAND.top - 0.05, z], 0.04) }]);
  // the island's sign on two posts at its middle
  for (const x of [icx - 1.6, icx + 1.6]) add([{ key: "steel", geo: place(tiledBox(0.04, 0.9, 0.04, 1), { pos: [x, ISLAND.top + 0.45, icz] }) }]);
  add(headerBoard({ x0: icx - 1.7, x1: icx + 1.7, y0: ISLAND.top + 0.78, y1: ISLAND.top + 1.02, z: icz, rect: [...headerRectOf(HEADERS.length - 1)] as Rect, facing: -1 }));
  add(headerBoard({ x0: icx - 1.7, x1: icx + 1.7, y0: ISLAND.top + 0.78, y1: ISLAND.top + 1.02, z: icz + 0.03, rect: [...headerRectOf(HEADERS.length - 1)] as Rect, facing: 1 }));
  const perRow = 28;
  const step = (iw - 0.3) / perRow;
  for (const [facing, z] of [
    [-1, ISLAND.z0 + SCOOP.d / 2 + 0.04],
    [1, ISLAND.z1 - SCOOP.d / 2 - 0.04],
  ] as const) {
    for (let k = 0; k < perRow; k++) {
      const it = SCOOP_BINS[(k + (facing === 1 ? 3 : 0)) % SCOOP_BINS.length];
      const cx = ISLAND.x0 + 0.15 + (k + 0.5) * step;
      const y = ISLAND.top;
      const rot = facing === 1 ? 0 : Math.PI;
      const g = grainOf(it);
      const at: V3 = [cx, y + 0.2, z + facing * SCOOP.d * 0.5];
      const parts = [
        { set: "scoop-acrylic", index: inst.add("scoop-acrylic", M([cx, y, z], rot), at, facing) },
        { set: "scoop-fill", index: inst.add("scoop-fill", M([cx, y, z], rot), at, facing, { tint: hex(g.tint), cell: cellOfShape(g.shape) }) },
        { set: "scoop-trim", index: inst.add("scoop-trim", M([cx, y, z], rot), at, facing) },
        { set: "scoop-tag", index: inst.add("scoop-tag", M([cx, y, z], rot), at, facing, { cell: tagRect(tagNames.indexOf(it.name)) }) },
      ];
      targets.push({ category: SCOOP_CATEGORY, name: it.name, parts, center: [cx, y + 0.2, z], size: [SCOOP.w + 0.04, 0.46, SCOOP.d + 0.04], facing });
    }
  }

  // ---- the centerpiece: a pine plinth, four open sacks, a chakki, a clay pot of dried wheat
  add([{ key: "pine", geo: place(tiledBox(PLINTH.x1 - PLINTH.x0, PLINTH.h, PLINTH.z1 - PLINTH.z0, 1.2), { pos: [(PLINTH.x0 + PLINTH.x1) / 2, PLINTH.h / 2, (PLINTH.z0 + PLINTH.z1) / 2] }) }]);
  const sackAt: [number, number][] = [
    [50.72, 5.32],
    [51.32, 5.24],
    [50.78, 5.92],
    [51.42, 5.86],
  ];
  SACKS.forEach((it, i) => {
    const g = grainOf(it);
    const pieces = sack({ x: sackAt[i][0], z: sackAt[i][1], r: 0.2 + (i % 2) * 0.02, h: 0.4 + (i % 3) * 0.04, grainRect: cellOfShape(g.shape), tint: hex(g.tint) });
    for (const p of pieces) place(p.geo, { pos: [0, PLINTH.h, 0] });
    add(pieces);
  });
  const ch = chakki({ x: 51.72, z: 6.48 });
  for (const p of ch) place(p.geo, { pos: [0, PLINTH.h, 0] });
  add(ch);
  add(clayPot({ x: 50.68, y: PLINTH.h, z: 6.5, r: 0.21, h: 0.52 }));
  add(wheatBundle({ x: 50.68, y: PLINTH.h + 0.5, z: 6.5, count: 46, height: 0.62, rand }));

  // ---- bake and merge
  for (const key of batch.keys()) for (const g of batch.get(key)) bakeVertexColors(g, bake, tints.get(g) ?? [1, 1, 1]);
  const statics = batch.merged() as Map<MaterialKey, BufferGeometry>;
  const instances = [...inst.sets.values()];
  const tri = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  const triangles = [...statics.values()].reduce((s, g) => s + tri(g), 0) + instances.reduce((s, i) => s + tri(i.geo) * i.matrices.length, 0);
  return { statics, instances, targets, bounds: { x0: SHELF.x0 - 0.4, x1: SHELF.x1 + 0.4 }, triangles: Math.round(triangles) };
}

const headerRectOf = (i: number): Rect => {
  const top = i * 80 + 4;
  return [0, 1 - (top + 72) / 512, 1, 1 - top / 512];
};

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
