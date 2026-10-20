// The Bulk hero zone builds from the shelf kit: every section's bins are targets and an item finds its own
// bin; every walk in starts outside the zone's ceiling; the light is per pixel with sharp pools, darker
// between, and the shelf planks' shadows (checked through the TypeScript twin of the shader, light.ts); no two
// neighbouring packs are alike; grains are at their real size; the geometry fits the close-up budget.

import { expect, test } from "vitest";
import { MeshBasicMaterial } from "three";
import { grosher } from "@grosher/stores";
import { buildBulkZone, bulkRig, CEIL, EYE, grainSurface, HIDE_FIXTURES, MOUTH, pickTarget, SHELF, shapeOf } from "../src/hero/bulk/zone.ts";
import { GRAINS, GRAIN_SHAPES, LABEL_COLS, LABEL_ROWS, SECTIONS, TAG_COLS, TAG_ROWS, labelCells, labelKey } from "../src/hero/bulk/recipe.ts";
import { HERO_ZONES } from "../src/hero/index.ts";
import { lightAt, shadowAt } from "../src/hero/kit/light.ts";
import { GRAIN_TRIANGLES, grainLayer } from "../src/hero/kit/grains.ts";
import { hex } from "../src/hero/kit/bake.ts";
import { CLOSE_UP_BUDGET } from "../src/hero/budget.ts";

const zone = buildBulkZone(grosher.store.outline);
const rig = bulkRig();

test("every bin is a target; an item finds its own bin, a category without a match its first", () => {
  expect(zone.targets.filter((t) => t.category !== "bulk-snacks")).toHaveLength(45);
  // the south run: two scoop bins a bay, 13 bays
  expect(zone.targets.filter((t) => t.category === "bulk-snacks")).toHaveLength(26);
  expect(pickTarget(zone.targets, "bulk-pulses", "Bulk toor dal")?.name).toBe("Toor Dal");
  expect(pickTarget(zone.targets, "bulk-pulses", "toor dal (bulk)")?.name).toBe("Toor Dal");
  expect(pickTarget(zone.targets, "bulk-rice-grains", "Bulk basmati rice")?.name).toBe("Basmati Rice");
  expect(pickTarget(zone.targets, "bulk-nuts-seeds", "Bulk cashews")?.name).toBe("Cashews");
  expect(pickTarget(zone.targets, "bulk-dried-fruit", "Bulk medjool dates")?.name).toBe("Medjool Dates");
  expect(pickTarget(zone.targets, "bulk-flours", "Bulk whole wheat atta")?.name).toBe("Whole Wheat Atta");
  expect(pickTarget(zone.targets, "bulk-snacks", "bulk granola")?.name).toBe("House Granola");
  expect(pickTarget(zone.targets, "bulk-pulses", "something else")?.name).toBe(SECTIONS[0].bins[0].name);
  expect(pickTarget(zone.targets, "dairy", "milk")).toBeNull();
  const bulk = new Set(grosher.categories.filter((c) => c.aisle === "BULK").map((c) => c.id));
  for (const t of zone.targets) expect(bulk.has(t.category)).toBe(true);
  // the overview fixtures the close-up replaces exist, and the 3D map hides the same ones
  for (const id of HIDE_FIXTURES) expect(grosher.store.fixtures!.some((f) => f.id === id)).toBe(true);
  expect(HERO_ZONES.find((z) => z.id === "bulk")!.hideFixtures).toEqual(HIDE_FIXTURES);
});

test("every walk in starts at eye level outside the zone's ceiling and never goes through the centerpiece", () => {
  const under = (x: number, z: number) => x > CEIL.x0 && x < CEIL.x1 && z > CEIL.z0 && z < CEIL.z1;
  const inMouth = (x: number, z: number) => x > MOUTH.x0 - 0.05 && x < MOUTH.x1 + 0.05 && z > MOUTH.z0 - 0.05 && z < MOUTH.z1 + 0.05;
  for (const t of zone.targets) {
    expect(t.door[1]).toBe(EYE);
    expect(under(t.door[0], t.door[2]), t.name).toBe(false);
    // the walk: the door, its turns, where the shopper stands; sampled every 5 cm
    const stand: [number, number] = [t.center[0], t.center[2] + t.facing * t.stand];
    const pts: [number, number][] = [[t.door[0], t.door[2]], ...t.via.map((v) => [v[0], v[2]] as [number, number]), stand];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05);
      for (let k = 0; k <= n; k++) expect(inMouth(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n), `${t.name} walks through the centerpiece`).toBe(false);
    }
    // and panning along the aisle from where they stand never does either
    if (stand[1] > MOUTH.z0 - 0.05 && stand[1] < MOUTH.z1 + 0.05) expect(t.bounds.x0, t.name).toBeGreaterThan(MOUTH.x1);
    // the arrival's walk stays short enough for its 760 ms
    expect(Math.hypot(t.door[0] - stand[0], t.door[2] - stand[1])).toBeLessThan(12);
  }
});

test("light per pixel: sharp warm pools on the shelf, darker between; the planks shadow what is under them", () => {
  // along the bin tier's front, 30 cm under the plank above: a pool under each spot, falloff between
  const y = SHELF.tiers[3] + 0.4;
  const row = Array.from({ length: 181 }, (_, i) => {
    const x = SHELF.x0 + 0.1 * i;
    return lightAt(rig, [x, y, SHELF.zFront + 0.001], [0, 0, 1]);
  });
  const reds = row.slice(5, -5).map((c) => c[0]);
  expect(Math.max(...reds) / Math.max(Math.min(...reds), 1e-3)).toBeGreaterThan(2);
  const top = row.reduce((a, b) => (b[0] > a[0] ? b : a));
  expect(top[0] / top[2]).toBeGreaterThan(2); // ~3000 K
  // a downlight's pool on the floor has a sharp edge: lit inside, dark 20 cm out
  const dl = rig.lights.find((l) => l.pos[1] === 4.4)!;
  const r = dl.pos[1] * Math.tan(dl.angle);
  const at = (d: number) => lightAt(rig, [dl.pos[0] + d, 0, dl.pos[2]], [0, 1, 0])[0];
  expect(at(r - 0.15) / Math.max(at(r + 0.2), 1e-3)).toBeGreaterThan(3);
  // shadows: the wall behind the shelf just under a plank is dark to the spot in front, the plank's top is not
  const spot = rig.lights[0].pos;
  expect(shadowAt(rig, [spot[0], SHELF.tiers[2] - 0.03, SHELF.zBack + 0.05], spot)).toBeLessThan(0.05);
  expect(shadowAt(rig, [spot[0], SHELF.tiers[2] + 0.04, SHELF.zFront - 0.05], spot)).toBe(1);
});

test("packs: every kind on the shelves, no two neighbours alike, every one labelled", () => {
  const kinds = new Set(zone.facings.map((f) => f.kind));
  for (const k of ["pouchS", "pouchM", "pouchL", "kraft", "sack1", "sack5", "sack10", "carton", "jar", "spiceJar", "gheeTin", "oilBottle", "tin"]) expect(kinds.has(k as never), k).toBe(true);
  expect(zone.facings.length).toBeGreaterThan(500); // 584 on 19 Oct 2026, from 382
  const rows = new Map<string, typeof zone.facings>();
  for (const f of zone.facings) rows.set(f.row, [...(rows.get(f.row) ?? []), f]);
  for (const r of rows.values()) for (let i = 1; i < r.length; i++) expect(labelKey(r[i].kind, r[i].name)).not.toBe(labelKey(r[i - 1].kind, r[i - 1].name));
  const { labels, tags, index } = labelCells();
  expect(labels.length).toBeLessThanOrEqual(LABEL_COLS * LABEL_ROWS);
  expect(tags.length).toBeLessThanOrEqual(TAG_COLS * TAG_ROWS);
  for (const f of zone.facings) expect(index.has(labelKey(f.kind, f.name)), `${f.kind} ${f.name}`).toBe(true);
});

test("grains at their real size: every bin's grain has a shape; the target's real grains fit their budget", () => {
  for (const g of Object.values(GRAINS)) expect(GRAIN_SHAPES.some((s) => s.id === g.shape), g.id).toBe(true);
  // a masoor lentil is 4.2 mm and a cell covers 6 cm: ~18 px of 256 per lentil
  const masoor = GRAIN_SHAPES.find((s) => s.id === "masoor")!;
  expect((masoor.size[0] / (masoor.cellM * 1000)) * 256).toBeCloseTo(17.9, 0);
  for (const name of ["Toor Dal", "Masoor Dal", "Rajma", "Basmati Rice", "House Granola", "Coffee Beans"]) {
    const t = zone.targets.find((x) => x.name === name)!;
    const layer = grainLayer({ surface: grainSurface(t), shape: shapeOf(t.grain), tint: hex(GRAINS[t.grain].tint) }, new MeshBasicMaterial());
    if (!layer) continue; // flakes and powders show their texture only
    const tris = (layer.geometry.getAttribute("position").count / 3) * layer.count;
    expect(tris, name).toBeLessThanOrEqual(GRAIN_TRIANGLES);
    expect(layer.count, name).toBeGreaterThan(300);
  }
});

test("the zone, its real grains and the overview around it fit the close-up budget", () => {
  // the overview's dimmed fixtures cost ~15–25k more; the gate measures the whole frame
  expect(zone.triangles + GRAIN_TRIANGLES).toBeLessThan(CLOSE_UP_BUDGET.triangles - 30_000);
  const counts = Object.fromEntries(zone.instances.map((i) => [i.name, i.matrices.length]));
  expect(counts["bin-fill"]).toBe(45);
  expect(counts["scoop-fill"]).toBe(26);
});

test("the Basis transcoder served from /basis/ is the one this three.js expects", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  // vitest runs in apps/web (jsdom's import.meta.url is not a file URL)
  for (const f of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
    const ours = readFileSync(resolve(process.cwd(), "public/basis", f));
    const theirs = readFileSync(resolve(process.cwd(), "../../node_modules/three/examples/jsm/libs/basis", f));
    expect(ours.equals(theirs), `${f}: copy it again from node_modules/three/examples/jsm/libs/basis/`).toBe(true);
  }
});
