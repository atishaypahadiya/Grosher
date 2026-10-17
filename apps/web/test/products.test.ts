import { describe, expect, test } from "vitest";
import { Color } from "three";
import { demoSupercenter } from "@grosher/stores";
import { layoutProducts, LOD_M, MAX_VISIBLE } from "../src/map3d/Products.tsx";

const { store } = demoSupercenter;
const colors = (dept: string | undefined) => [new Color(dept === "dairy" ? "#F2EAD2" : "#E2C9A2")];

describe("products layout", () => {
  test("every non-counter fixture gets products, deterministic, inside its footprint, above its deck", () => {
    const a = layoutProducts(store, colors);
    const b = layoutProducts(store, colors);
    expect(a.length).toBe((store.fixtures ?? []).filter((f) => f.department !== "checkout").length);
    expect(a.map((f) => f.items.length)).toEqual(b.map((f) => f.items.length));
    for (const fx of a) {
      expect(fx.items.length).toBeGreaterThan(10);
      for (const it of fx.items) {
        expect(Math.abs(it.x - fx.cx)).toBeLessThanOrEqual(fx.w / 2 + 0.01);
        expect(Math.abs(it.z - fx.cz)).toBeLessThanOrEqual(fx.d / 2 + 0.01);
        expect(it.y).toBeGreaterThan(0.1);
        expect(it.sx).toBeGreaterThan(0);
      }
    }
    const total = a.reduce((s, f) => s + f.items.length, 0);
    expect(total).toBeGreaterThan(MAX_VISIBLE); // the LOD budget has to do real work on the demo store
    expect(LOD_M).toBe(25);
  });
});
