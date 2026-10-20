// Every stop has a close-up: Bulk's are the hero zone, every other location a standard close-up generated
// from the store data (src/hero/standard). Each builds within the close-up budget (the worst is the one the
// close-up gate opens), shares one light layout (so one set of shader programs), lights its own slot, and is
// framed so the slot sits between the progress strip and the bottom card, a low shelf by crouching. The
// arrival and the way out keep DESIGN.md §7's numbers.

import { expect, test } from "vitest";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { grosher } from "@grosher/stores";
import { closeUpAt, type HeroTargetInfo } from "../src/hero/index.ts";
import { buildStandardZone, faceCategories, STD_LIGHTS, STD_SLABS, type StandardBuild } from "../src/hero/standard/zone.ts";
import { bulkZoneFor } from "../src/hero/bulk/zone.ts";
import { CARD_MIN, closeUpFov, CROUCH_HEIGHT, DESCENT_MS, EXIT_RISE_MS, EXIT_WALK_MS, EYE_HEIGHT, eyePose, walkMs } from "../src/hero/CloseUpCamera.tsx";
import { CLOSE_UP_BUDGET } from "../src/hero/budget.ts";
import { styleOf, VARIANTS } from "../src/hero/standard/styles.ts";

const { store, categories } = grosher;
const builds = new Map<string, StandardBuild>();
for (const loc of store.locations) {
  const h = closeUpAt(store, categories, loc.id);
  if (h?.zone.quality === "standard") builds.set(loc.id, buildStandardZone(store, categories, h.zone.plan!));
}

test("every location opens a close-up: Bulk's the hero zone, every other a standard one", () => {
  for (const loc of store.locations) {
    const h = closeUpAt(store, categories, loc.id);
    expect(h, loc.id).not.toBeNull();
    expect(h!.zone.quality).toBe(loc.aisle === "BULK" ? "hero" : "standard");
    if (h!.zone.quality === "standard") {
      expect(h!.zone.id).toBe(`std:${loc.id}`);
      // it hides the fixture it redraws, and the one across the corridor when it redraws that too
      for (const id of h!.zone.hideFixtures) expect(store.fixtures!.some((f) => f.id === id)).toBe(true);
      expect(h!.zone.flatImage(h!.category)).toBeNull();
    }
  }
  expect(builds.size).toBe(store.locations.filter((l) => l.aisle !== "BULK").length);
  // every kind of fixture has its build
  const kinds = new Set([...builds.values()].map((b) => b.kind));
  for (const k of ["gondola", "chiller", "doors", "coffin", "service", "bar", "produce", "producewall", "counter"]) expect(kinds.has(k as StandardBuild["kind"]), k).toBe(true);
});

test("every standard close-up fits the budget beside the overview; the worst is the one the gate opens", () => {
  // the overview's fixtures stay drawn around a close-up (dimmed): leave them ~70k of the 250k
  let worst: [string, number] = ["", 0];
  for (const [id, b] of builds) {
    expect(b.triangles, id).toBeLessThan(CLOSE_UP_BUDGET.triangles - 70_000);
    // draw calls: one per material, the decals, the lit slot and its rim (the gate counts the frame)
    expect(b.statics.size + 3, id).toBeLessThanOrEqual(16);
    if (b.triangles > worst[1]) worst = [id, b.triangles];
  }
  expect(worst[0]).toBe("A4-R16");
});

test("one light layout for every standard zone: their shader programs are shared", () => {
  for (const [id, b] of builds) {
    expect(b.rig.lights, id).toHaveLength(STD_LIGHTS);
    expect(b.rig.slabs, id).toHaveLength(STD_SLABS);
  }
});

test("a face carries its categories, each in its own house style; the slot holds its own category", () => {
  const faces = faceCategories(store, categories);
  let runs = 0;
  for (const list of faces.values()) runs += list.length;
  expect(runs).toBe(categories.length);
  for (const c of categories) expect(styleOf(c.id, c.department)).toBeTruthy();
  expect(VARIANTS.length).toBeGreaterThanOrEqual(6);
  // what each face's runs say is at the slot: the stop's own category
  for (const c of categories) {
    const loc = store.locations.find((l) => l.id === c.locationId)!;
    if (loc.aisle === "BULK") continue;
    const h = closeUpAt(store, categories, loc.id)!;
    const key = `${h.zone.plan!.face.fixtureId}:${["west", "east", "north", "south"][[h.zone.plan!.face.n[0] < -0.5, h.zone.plan!.face.n[0] > 0.5, h.zone.plan!.face.n[1] < -0.5, true].indexOf(true)]}`;
    expect(faces.get(key)?.some((r) => r.id === c.id), c.id).toBe(true);
  }
});

/** the lit slot's corners, as fractions of the screen (0 top … 1 bottom), from the eye's pose */
function onScreen(t: HeroTargetInfo, box: Box3, aspect = 390 / 844) {
  const safe = { top: 0.16, bottom: 0.36 };
  const pose = eyePose(t, { yaw: 0, pitch: 0, pan: 0, dolly: 0 }, safe, aspect);
  const cam = new PerspectiveCamera(pose.fov, aspect, 0.05, 100);
  cam.position.copy(pose.position);
  cam.quaternion.copy(pose.quaternion);
  cam.updateMatrixWorld(true);
  const ys: number[] = [];
  const xs: number[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const p = new Vector3(x, y, z).project(cam);
        ys.push((1 - p.y) / 2);
        xs.push((1 + p.x) / 2);
      }
  const c = new Vector3(...t.center).project(cam);
  return { top: Math.min(...ys), bottom: Math.max(...ys), cx: (1 + c.x) / 2, eyeY: pose.position.y };
}

test("every slot is framed above the bottom card and below the strip; a low shelf by crouching", () => {
  let crouched = 0;
  for (const [id, b] of builds) {
    const t = b.target;
    const info: HeroTargetInfo = { center: t.center, facing: 1, out: t.out, axis: t.axis, height: t.size[1], side: t.side, name: id, bounds: t.bounds, door: t.door, via: t.via, stand: t.stand };
    // the slot's box, turned with its face
    const half = new Vector3(t.size[0] / 2, t.size[1] / 2, t.size[2] / 2);
    const turned = new Vector3(Math.abs(Math.cos(t.rotY)) * half.x + Math.abs(Math.sin(t.rotY)) * half.z, half.y, Math.abs(Math.sin(t.rotY)) * half.x + Math.abs(Math.cos(t.rotY)) * half.z);
    const box = new Box3(new Vector3(...t.center).sub(turned), new Vector3(...t.center).add(turned));
    const s = onScreen(info, box);
    expect(s.top, `${id} top`).toBeGreaterThanOrEqual(0.16 - 0.005);
    expect(s.bottom, `${id} bottom`).toBeLessThanOrEqual(1 - CARD_MIN + 0.005);
    expect(s.cx, `${id} centre`).toBeGreaterThan(0.2);
    expect(s.cx, `${id} centre`).toBeLessThan(0.8);
    if (s.eyeY < EYE_HEIGHT - 0.01) crouched++;
    expect(s.eyeY).toBeGreaterThanOrEqual(CROUCH_HEIGHT);
  }
  // the bottom shelves are many: their eye comes down
  expect(crouched).toBeGreaterThan(50);
  // Bulk's bins too
  for (const t of bulkZoneFor(store).targets) {
    const info: HeroTargetInfo = { center: t.center, facing: t.facing, height: t.size[1], name: t.name, bounds: t.bounds, door: t.door, via: t.via, stand: t.stand };
    const half = new Vector3(...t.size).multiplyScalar(0.5);
    const s = onScreen(info, new Box3(new Vector3(...t.center).sub(half), new Vector3(...t.center).add(half)));
    expect(s.top, `${t.name} top`).toBeGreaterThanOrEqual(0.16 - 0.005);
    expect(s.bottom, `${t.name} bottom`).toBeLessThanOrEqual(1 - CARD_MIN + 0.005);
  }
});

test("the arrival takes about 1.0 s down and 1.2–1.5 s in; the way out 0.8 s", () => {
  expect(DESCENT_MS).toBe(1000);
  for (const m of [0.5, 2, 4, 8, 20]) {
    expect(walkMs(m)).toBeGreaterThanOrEqual(1200);
    expect(walkMs(m)).toBeLessThanOrEqual(1500);
  }
  expect(EXIT_WALK_MS + EXIT_RISE_MS).toBe(800);
  // the field of view never drops below 50° (portrait) nor past 75°
  expect(closeUpFov(390 / 844)).toBeLessThanOrEqual(75);
  expect(closeUpFov(16 / 9)).toBeGreaterThanOrEqual(50);
});
