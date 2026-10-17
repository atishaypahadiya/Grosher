import { describe, expect, test } from "vitest";
import { CARD_COUNT, collapseColliding, mayShowCard, type Box } from "../src/map3d/cardPlan.ts";

const box = (x0: number, y0: number, w = 100, h = 30): Box => ({ x0, y0, x1: x0 + w, y1: y0 + h });
const area: Box = { x0: 12, y0: 100, x1: 378, y1: 520 };

describe("3D map card plan", () => {
  test("the next stop and the two after it are the only cards; every later stop is a dot", () => {
    expect(CARD_COUNT).toBe(3);
    expect([0, 1, 2, 3, 9].map(mayShowCard)).toEqual([true, true, false, false, false]);
  });

  test("a card that would collide with an earlier one collapses; the earlier one stays", () => {
    const collapsed = collapseColliding(
      [
        { key: "next", box: box(100, 150, 160, 70), fixed: true },
        { key: "s2", box: box(120, 200) }, // overlaps the next-stop card
        { key: "s3", box: box(40, 400) }, // clear
      ],
      area,
    );
    expect([...collapsed]).toEqual(["s2"]);
  });

  test("route order decides between two stop cards: the later one collapses", () => {
    const collapsed = collapseColliding([{ key: "s2", box: box(60, 300) }, { key: "s3", box: box(90, 310) }], area);
    expect([...collapsed]).toEqual(["s3"]);
  });

  test("the gap counts as a collision; fixed labels never collapse, even onto each other", () => {
    expect([...collapseColliding([{ key: "s2", box: box(60, 300) }, { key: "s3", box: box(162, 300) }], area, 4)]).toEqual(["s3"]); // 2 px apart
    expect(collapseColliding([{ key: "s2", box: box(60, 300) }, { key: "s3", box: box(170, 300) }], area, 4).size).toBe(0); // 10 px apart
    expect(collapseColliding([{ key: "next", box: box(60, 300), fixed: true }, { key: "checkout", box: box(70, 305), fixed: true }], area).size).toBe(0);
  });

  test("a card that would leave the map area collapses; off-screen candidates are skipped", () => {
    const collapsed = collapseColliding(
      [
        { key: "s2", box: box(330, 300) }, // runs past the right edge (378)
        { key: "s3", box: box(40, 80) }, // above the map area (under the progress strip)
        { key: "s4", box: null },
      ],
      area,
    );
    expect([...collapsed].sort()).toEqual(["s2", "s3"]);
  });
});
