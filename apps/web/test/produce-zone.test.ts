// The Produce hero zone builds from the shelf kit: every display variety and every wall bay is a target and
// an item finds its own; every way in comes down through a skylight pane (clear of the mullions, over the
// islands) and lands on the walkway for a short stroll, never through an island,
// and neither does a walk from one stop to the next; fruit are packed into their crates without touching;
// what is drawn one by one around any stop fits the close-up budget; the room is lit by daylight (a pool under
// the skylight, the mullions' shadows, never blue) and the wet wall by its lip lights; every display carries a
// chalkboard; the round template's shapes come out distinct.

import { expect, test } from "vitest";
import { grosher } from "@grosher/stores";
import { Vector3 } from "three";
import { buildProduceZone, CASE, CEILING, CRATE, DECKS, DETAIL_TRIANGLES, EYE, HIDE_FIXTURES, ISLANDS, pickProduceTarget, produceRig, selectDetail, SKY, walkOver, WALK_IN_MAX, WALK_SPEED } from "../src/hero/produce/zone.ts";
import { descentPath, paceMs } from "../src/hero/CloseUpCamera.tsx";
import { DISPLAYS, KINDS, signCells, WALL, type KindId } from "../src/hero/produce/recipe.ts";
import { deform, packCrate, shapeOf, type Pile } from "../src/hero/produce/fruit.ts";
import { HERO_ZONES, closeUpAt } from "../src/hero/index.ts";
import { lightAt } from "../src/hero/kit/light.ts";
import { CLOSE_UP_BUDGET } from "../src/hero/budget.ts";
import type { V3 } from "../src/hero/kit/geom.ts";

const { store, categories } = grosher;
const zone = buildProduceZone(store.outline);
const rig = produceRig();

test("every display and bay is a target; an item finds its own; the zone hides what it redraws", () => {
  const produce = new Set(categories.filter((c) => c.aisle === "PRODUCE").map((c) => c.id));
  for (const t of zone.targets) expect(produce.has(t.category), t.category).toBe(true);
  for (const c of produce) expect(zone.targets.some((t) => t.category === c), c).toBe(true);
  // 10 island faces with a category × 5 varieties, and the wall's 28 bays
  expect(zone.targets).toHaveLength(78);
  const pick = (cat: string, item: string) => pickProduceTarget(zone.targets, cat, item)?.name;
  expect(pick("apples-pears", "honeycrisp apples")).toBe("Honeycrisp Apples");
  expect(pick("apples-pears", "pears")).toBe("Bartlett Pears");
  expect(pick("citrus", "lemons")).toBe("Lemons");
  expect(pick("bananas", "bananas")).toBe("Bananas");
  expect(pick("tomatoes-peppers", "tomatoes")).toBe("Vine Tomatoes");
  expect(pick("tomatoes-peppers", "bell peppers")).toBe("Bell Peppers");
  expect(pick("tropical-fruit", "mango")).toBe("Ataulfo Mangoes");
  expect(pick("fresh-herbs", "cilantro")).toBe("Cilantro");
  expect(pick("cut-fruit-juice", "cold pressed juice")).toBe("Grosher Press Cold-Pressed Juice J01–J07");
  expect(pick("cut-fruit-juice", "cut fruit")).toBe("Cut Fruit Medley");
  expect(pick("salad-greens", "salad kit")).toBe("Salad Kits");
  // nothing matches: the category's first
  expect(pick("potatoes-roots", "something else")).toBe("Russet Potatoes");
  expect(pickProduceTarget(zone.targets, "dairy", "milk")).toBeNull();
  // every produce location opens this zone; the fixtures it hides exist and the 3D map hides the same
  for (const loc of store.locations.filter((l) => l.aisle === "PRODUCE")) expect(closeUpAt(store, categories, loc.id)?.zone.id, loc.id).toBe("produce");
  for (const id of HIDE_FIXTURES) expect(store.fixtures!.some((f) => f.id === id), id).toBe(true);
  expect(HERO_ZONES.find((z) => z.id === "produce")!.hideFixtures).toEqual(HIDE_FIXTURES);
  // and the islands are the map's
  for (const [i, [x0, x1, z0, z1]] of ISLANDS.entries()) {
    const f = store.fixtures!.find((x) => x.id === `f-island${i + 1}`)!;
    const xs = f.polygon.map((p) => p[0]);
    const ys = f.polygon.map((p) => p[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([x0, x1, z0, z1]);
  }
});

const inIsland = (x: number, z: number) => ISLANDS.some(([x0, x1, z0, z1]) => x > x0 - 0.15 && x < x1 + 0.15 && z > z0 - 0.15 && z < z1 + 0.15);
const sampled = (pts: [number, number][], f: (x: number, z: number) => void) => {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
    for (let k = 0; k <= n; k++) f(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n);
  }
};
const standOf = (t: (typeof zone.targets)[number]): [number, number] => [t.center[0] + t.side, t.center[2] + t.facing * t.stand];

test("every way in comes down through a skylight pane, clear of the mullions and over the islands, and lands for a short stroll", () => {
  // the overview's camera is wherever the shopper left it: from the south (the usual framing), the west, the east
  const highs = [new Vector3(30, 34, 52), new Vector3(-12, 28, 12), new Vector3(78, 30, 24)];
  const mullionsX = [SKY.x0, 18, 22, 26, 30, 34, 38, 42, SKY.x1];
  const mullionsZ = [SKY.z0, 8, SKY.z1];
  for (const t of zone.targets) {
    // it lands at eye level on the stop's own walking line, under the skylight
    expect(t.door[1]).toBe(EYE);
    expect(t.door[2], t.name).toBe(t.walkZ);
    expect(t.door[0] > SKY.x0 && t.door[0] < SKY.x1, t.name).toBe(true);
    expect(inIsland(t.door[0], t.door[2]), t.name).toBe(false);
    // the walk: along the line to where the shopper stands, 1.2–4 m, at a stroll
    const stand = standOf(t);
    const walk = Math.hypot(stand[0] - t.door[0], stand[1] - t.door[2]);
    expect(walk, t.name).toBeGreaterThanOrEqual(1.1);
    expect(walk, t.name).toBeLessThanOrEqual(WALK_IN_MAX);
    expect(paceMs(walk, WALK_SPEED), t.name).toBeLessThanOrEqual(3000);
    expect(inIsland(...stand), t.name).toBe(false);
    for (const high of highs) {
      const at = descentPath(high, new Vector3(...t.door), t.descent);
      let crossed = 0;
      let prev = at(0);
      for (let k = 1; k <= 2000; k++) {
        const p = at(k / 2000);
        // through the glass: inside the opening, half a metre and more from every mullion and the rim
        if ((prev.y - SKY.y) * (p.y - SKY.y) <= 0) {
          crossed++;
          expect(p.x > SKY.x0 && p.x < SKY.x1 && p.z > SKY.z0 && p.z < SKY.z1, `${t.name}: through the roof at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`).toBe(true);
          for (const x of mullionsX) expect(Math.abs(p.x - x), `${t.name}: near the mullion at x ${x}`).toBeGreaterThan(0.5);
          for (const z of mullionsZ) expect(Math.abs(p.z - z), `${t.name}: near the mullion at z ${z}`).toBeGreaterThan(0.5);
        }
        // under the ceiling's margins it never goes (the roof is solid there)
        if (p.y < CEILING && p.y > EYE + 0.1) expect(p.x > SKY.x0 - 0.2 && p.x < SKY.x1 + 0.2 && p.z > SKY.z0 - 0.6 && p.z < SKY.z1 + 0.2, `${t.name}: under the ceiling at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`).toBe(true);
        // and never through an island: over one it stays well above the crates
        if (inIsland(p.x, p.z)) expect(p.y, `${t.name}: over an island at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`).toBeGreaterThan(1.6);
        prev = p;
      }
      expect(crossed, t.name).toBe(1);
    }
  }
});

test("from one stop to the next in the zone the walk keeps to the walking lines and the cross aisles", () => {
  const sample = zone.targets.filter((_, i) => i % 3 === 0);
  for (const a of sample)
    for (const b of sample) {
      if (a === b) continue;
      const from: V3 = [standOf(a)[0], EYE, standOf(a)[1]];
      const way = walkOver(from, { x: standOf(b)[0], walkZ: b.walkZ });
      const pts: [number, number][] = [[from[0], from[2]], ...way.map((p) => [p[0], p[2]] as [number, number]), standOf(b)];
      sampled(pts, (x, z) => expect(inIsland(x, z), `${a.name} → ${b.name}`).toBe(false));
    }
});

test("fruit are packed into their crates: inside the walls, on the pile, never through each other", () => {
  const w = CRATE.w - 0.05;
  const d = CRATE.d - 0.05;
  const pile: Pile = { w, d, height: (x, z) => 0.085 + 0.045 * Math.sin((Math.max(0, 1 - Math.max(Math.abs(x) / (w / 2), Math.abs(z) / (d / 2))) * Math.PI) / 2) ** 1.4 };
  let checked = 0;
  for (const id of Object.keys(KINDS) as KindId[]) {
    const k = KINDS[id];
    if (k.model !== "round" || k.loose) continue;
    for (const seed of [1, 7, 31]) {
      const ps = packCrate(id, pile, seed);
      if (k.size[0] < 0.2) expect(ps.length, id).toBeGreaterThan(0);
      for (const p of ps) {
        // inside the crate's walls
        expect(Math.abs(p.pos[0]) + p.foot[0] / 2, id).toBeLessThanOrEqual(w / 2 + 1e-6);
        expect(Math.abs(p.pos[2]) + p.foot[2] / 2, id).toBeLessThanOrEqual(d / 2 + 1e-6);
        // settled into the pile: its underside below the surface, its top above it
        const surface = pile.height(p.pos[0], p.pos[2]);
        expect(p.pos[1] - p.foot[1] / 2, id).toBeLessThan(surface);
        expect(p.pos[1] + p.foot[1] / 2, id).toBeGreaterThan(surface);
      }
      const long = k.size[1] > Math.max(k.size[0], k.size[2]) * 1.5;
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) {
          const [a, b] = [ps[i], ps[j]];
          const apart = long
            ? Math.abs(a.pos[0] - b.pos[0]) >= ((a.foot[0] + b.foot[0]) / 2) * 0.96 || Math.abs(a.pos[2] - b.pos[2]) >= ((a.foot[2] + b.foot[2]) / 2) * 0.96
            : Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) >= ((Math.min(a.foot[0], a.foot[2]) + Math.min(b.foot[0], b.foot[2])) / 2) * 0.97;
          expect(apart, `${id}: ${i} and ${j} overlap`).toBe(true);
          checked++;
        }
    }
  }
  expect(checked).toBeGreaterThan(10_000);
  // no two apples quite alike: every one its own colour
  const apples = packCrate("apple", pile, 3);
  expect(new Set(apples.map((p) => p.color.map((c) => c.toFixed(3)).join())).size).toBe(apples.length);
});

test("what is drawn one by one around any stop fits the close-up budget, the stop's own display always", () => {
  // the overview's dimmed fixtures cost ~25–35k more; the gate measures the whole frame
  let worst = 0;
  for (const t of zone.targets) {
    const s = selectDetail(zone, t);
    expect(s.detail, t.name).toBeLessThanOrEqual(DETAIL_TRIANGLES + 1);
    worst = Math.max(worst, s.detail);
    // the stop's own crates or deck are in detail, and lift
    expect(s.lift.length, t.name).toBeGreaterThan(0);
    // far wall decks show their row instead of their stock
    expect(s.sets.get("row")!.length, t.name).toBeGreaterThan(0);
  }
  expect(zone.triangles + worst).toBeLessThan(CLOSE_UP_BUDGET.triangles - 50_000);
});

test("the daylit room: a pool under the skylight, the mullions' shadows in it, never blue; the wet wall's lip lights", () => {
  const up: V3 = [0, 1, 0];
  const under = lightAt(rig, [30, 0, 9.5], up);
  const margin = lightAt(rig, [30, 0, 14.2], up);
  expect(under[0]).toBeGreaterThan(margin[0] * 1.5);
  // daylight: neutral, warm-white at most (DESIGN.md: never blue)
  expect(under[0]).toBeGreaterThanOrEqual(under[1]);
  expect(under[1]).toBeGreaterThanOrEqual(under[2]);
  // the sun through the panes: across the floor under the skylight the light dips where a mullion's shadow falls
  const row = Array.from({ length: 321 }, (_, i) => lightAt(rig, [SKY.x0 + 0.1 * i, 0, 9.5], up)[0]);
  const inner = row.slice(30, -30);
  expect(Math.max(...inner) / Math.min(...inner)).toBeGreaterThan(1.25);
  // the lip lights: a deck under its strip is lit; the same point outside the case is not
  const deck = DECKS[2];
  const p: V3 = [30, deck.lip + 0.05, CASE.zBack + deck.depth - 0.1];
  const inCase = lightAt({ ...rig, lights: [] }, p, up);
  const outCase = lightAt({ ...rig, lights: [] }, [10, p[1], p[2]], up);
  expect(inCase[0]).toBeGreaterThan(0.2);
  expect(outCase[0]).toBe(0);
});

test("every display and every bay carries its chalkboard", () => {
  const cells = signCells();
  expect(cells.length).toBe(DISPLAYS.length * 5 + WALL.reduce((s, w) => s + w.bays.length, 0));
  for (const d of DISPLAYS) for (const v of d.varieties) expect(zone.signs.some((s) => s.name === v.name), v.name).toBe(true);
  for (const w of WALL) for (const b of w.bays) expect(zone.signs.some((s) => s.name === b.name), b.name).toBe(true);
});

test("one round template, distinct silhouettes: a stem hollow, a lemon's two points, a pepper's lobes, a pumpkin's ribs", () => {
  const top = (id: KindId) => deform([0, 1, 0], shapeOf(KINDS[id]))[1];
  const bottom = (id: KindId) => deform([0, -1, 0], shapeOf(KINDS[id]))[1];
  // an apple's top sits down in its hollow; a sphere's would be at 0.5
  expect(top("apple")).toBeLessThan(0.45);
  // a lemon is drawn out at both ends, an onion at its top only
  expect(top("lemon")).toBeGreaterThan(0.55);
  expect(bottom("lemon")).toBeLessThan(-0.55);
  expect(top("onion")).toBeGreaterThan(0.6);
  expect(bottom("onion")).toBeGreaterThan(-0.51);
  // round the middle: a pepper's four lobes and a pumpkin's ten ribs, an orange smooth
  const spread = (id: KindId) => {
    const r = Array.from({ length: 72 }, (_, i) => {
      const a = (i / 72) * Math.PI * 2;
      const p = deform([Math.cos(a), 0, Math.sin(a)], shapeOf(KINDS[id]));
      return Math.hypot(p[0], p[2]);
    });
    return Math.max(...r) / Math.min(...r);
  };
  expect(spread("bellPepper")).toBeGreaterThan(1.08);
  expect(spread("pumpkin")).toBeGreaterThan(1.06);
  expect(spread("orange")).toBeLessThan(1.01);
  // a pear and a butternut narrow toward the top
  const at = (id: KindId, y: number) => {
    const p = deform([Math.sqrt(1 - y * y), y, 0], shapeOf(KINDS[id]));
    return p[0];
  };
  expect(at("pear", 0.6) / at("pear", -0.4)).toBeLessThan(0.75);
  expect(at("butternut", 0.6) / at("butternut", -0.4)).toBeLessThan(0.6);
});
