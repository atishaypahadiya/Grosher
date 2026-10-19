// The Bulk hero zone builds from the shelf kit: every section's bins are targets, an item finds its own bin,
// the light is baked into every static vertex, and the geometry stays inside the close-up budget.

import { expect, test } from "vitest";
import { grosher } from "@grosher/stores";
import { buildBulkZone, HIDE_FIXTURES, pickTarget } from "../src/hero/bulk/zone.ts";
import { SECTIONS, labelCells } from "../src/hero/bulk/recipe.ts";
import { CLOSE_UP_BUDGET } from "../src/hero/budget.ts";

const zone = buildBulkZone(grosher.store.outline);

test("every bin is a target; an item finds its own bin, a category without a match its first", () => {
  expect(zone.targets.filter((t) => t.category !== "bulk-snacks")).toHaveLength(45);
  expect(zone.targets.filter((t) => t.category === "bulk-snacks")).toHaveLength(56);
  expect(pickTarget(zone.targets, "bulk-pulses", "Bulk toor dal")?.name).toBe("Toor Dal");
  expect(pickTarget(zone.targets, "bulk-pulses", "toor dal (bulk)")?.name).toBe("Toor Dal");
  expect(pickTarget(zone.targets, "bulk-rice-grains", "Bulk basmati rice")?.name).toBe("Basmati Rice");
  expect(pickTarget(zone.targets, "bulk-nuts-seeds", "Bulk cashews")?.name).toBe("Cashews");
  expect(pickTarget(zone.targets, "bulk-dried-fruit", "Bulk medjool dates")?.name).toBe("Medjool Dates");
  expect(pickTarget(zone.targets, "bulk-flours", "Bulk whole wheat atta")?.name).toBe("Whole Wheat Atta");
  expect(pickTarget(zone.targets, "bulk-snacks", "bulk granola")?.name).toBe("House Granola");
  expect(pickTarget(zone.targets, "bulk-pulses", "something else")?.name).toBe(SECTIONS[0].bins[0].name);
  expect(pickTarget(zone.targets, "dairy", "milk")).toBeNull();
  // every target's category is one of Grosher's, on the bulk shelves
  const bulk = new Set(grosher.categories.filter((c) => c.aisle === "BULK").map((c) => c.id));
  for (const t of zone.targets) expect(bulk.has(t.category)).toBe(true);
  for (const id of HIDE_FIXTURES) expect(grosher.store.fixtures!.some((f) => f.id === id)).toBe(true);
});

test("the light is baked into every static vertex: warm pools on the shelves, darker between", () => {
  for (const [key, g] of zone.statics) expect(g.getAttribute("color"), key).toBeTruthy();
  // along the bin tier's plank fronts, x 50–68: a pool under each spot, falloff between
  const pine = zone.statics.get("pine")!;
  const pos = pine.getAttribute("position");
  const col = pine.getAttribute("color");
  const row: { x: number; r: number; b: number }[] = [];
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - 1.294) < 0.012 && pos.getZ(i) > 2.15) row.push({ x: pos.getX(i), r: col.getX(i), b: col.getZ(i) });
  expect(row.length).toBeGreaterThan(40);
  const reds = row.map((v) => v.r);
  expect(Math.max(...reds) / Math.min(...reds)).toBeGreaterThan(1.6);
  // warm: red well over blue in the pools (3000 K)
  const top = row.reduce((a, b) => (b.r > a.r ? b : a));
  expect(top.r / Math.max(top.b, 1e-3)).toBeGreaterThan(1.8);
});

test("every product label and bin tag is in the atlas; the geometry fits the close-up budget", () => {
  const { labels, tags } = labelCells();
  expect(labels).toHaveLength(48);
  expect(tags.length).toBeLessThanOrEqual(64);
  expect(new Set(labels.map((l) => l.name)).size).toBe(48);
  expect(zone.triangles).toBeLessThan(CLOSE_UP_BUDGET.triangles);
  const counts = Object.fromEntries(zone.instances.map((i) => [i.name, i.matrices.length]));
  expect(counts["bin-fill"]).toBe(45);
  expect(counts["scoop-fill"]).toBe(56);
  expect(counts.pouch).toBeGreaterThan(100);
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
