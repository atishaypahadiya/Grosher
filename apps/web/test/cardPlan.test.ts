import { describe, expect, test } from "vitest";
import { CARD_COUNT, edgeAnchor, inside, mayShowCard, overlaps, planCards, type Box, type Placement, type StopInput } from "../src/map3d/cardPlan.ts";

// a 390 × 844 phone: the map area sits between the progress strip and the sheet
const area: Box = { x0: 12, y0: 131, x1: 378, y1: 528 };
const card = { w: 100, h: 30 };
const chip = { w: 150, h: 28 };
const stop = (key: string, x: number, y: number, behind = false): StopInput => ({ key, point: { x, y }, behind, card, chip });
const lime: Box = { x0: 100, y0: 160, x1: 290, y1: 256 }; // the next-stop card
const byKey = (ps: Placement[]) => Object.fromEntries(ps.map((p) => [p.key, p]));
const boxes = (ps: Placement[]) => ps.flatMap((p) => ("box" in p ? [p.box] : []));

describe("3D map card plan", () => {
  test("the next stop and the two after it are the only cards; every later stop is a dot", () => {
    expect(CARD_COUNT).toBe(3);
    expect([0, 1, 2, 3, 9].map(mayShowCard)).toEqual([true, true, false, false, false]);
  });

  test("a clear stop gets its card above its point, slid sideways inside the map area", () => {
    const [a, b] = planCards({ area, fixed: [{ key: "next", box: lime }], stops: [stop("s2", 200, 400), stop("s3", 20, 480)] });
    expect(a).toEqual({ key: "s2", mode: "card", box: { x0: 150, x1: 250, y0: 364, y1: 394 } });
    expect(b.mode).toBe("card");
    expect((b as { box: Box }).box.x0).toBe(12); // slid right off the left edge, still above its point
  });

  test("stack before fold: a card that hits the lime card goes directly below it, with a leader to its dot", () => {
    const [a] = planCards({ area, fixed: [{ key: "next", box: lime }], stops: [stop("s2", 150, 270)] });
    expect(a.mode).toBe("stacked");
    if (a.mode !== "stacked") return;
    expect(a.under).toBe("next");
    expect(a.box.y0).toBe(lime.y1 + 4);
    expect(a.box.x0).toBe(lime.x0); // directly below the lime card, on the dot's side
    expect(overlaps(a.box, lime)).toBe(false);
    expect(a.leader).toEqual({ x0: 150, y0: 270, x1: 150, y1: 270 }); // the dot is inside the stacked card's span here
  });

  test("a stacked card keeps clear of the lime leader line: dot side first, then centred, then the far side", () => {
    const leader: Box = { x0: 190, y0: 256, x1: 200, y1: 320 }; // the lime line under the lime card
    const narrow = { w: 80, h: 30 };
    const right = planCards({ area, fixed: [{ key: "next", box: lime }], stops: [{ ...stop("s2", 280, 270), card: narrow }], obstacles: [leader] })[0];
    expect(right.mode === "stacked" && right.box.x1).toBe(lime.x1); // dot on the right: right-aligned
    // a 90 px card with only 86 px left of the leader steps out past the lime card's edge, still right below it
    const [w] = planCards({ area, fixed: [{ key: "next", box: lime }], stops: [{ ...stop("s2", 110, 270), card: { w: 90, h: 30 } }], obstacles: [leader] });
    expect(w.mode).toBe("stacked");
    if (w.mode === "stacked") expect([w.box.x1, w.box.y0]).toEqual([leader.x0 - 4, lime.y1 + 4]);
    // too wide for the area on either side of the leader: fold
    const [f] = planCards({ area: { ...area, x0: 100, x1: 290 }, fixed: [{ key: "next", box: lime }], stops: [{ ...stop("s2", 150, 270), card: { w: 120, h: 30 } }], obstacles: [leader] });
    expect(f.mode).toBe("dot");
    for (const p of [right, w]) if ("box" in p) expect(overlaps(p.box, leader)).toBe(false);
  });

  test("the leader runs from the dot to the nearest point of the stacked card", () => {
    const [a] = planCards({ area, fixed: [{ key: "next", box: lime }], stops: [stop("s2", 110, 200)] });
    expect(a.mode).toBe("stacked");
    if (a.mode !== "stacked") return;
    expect(a.leader.x0).toBe(110);
    expect(a.leader.y0).toBe(200);
    expect(a.leader.y1).toBe(a.box.y0); // meets the card's top edge
  });

  test("a second card stacks below the first; a card that hits the checkout callout stacks under it", () => {
    const checkout: Box = { x0: 250, y0: 420, x1: 370, y1: 452 };
    const ps = planCards({
      area,
      fixed: [{ key: "next", box: lime }, { key: "checkout", box: checkout }],
      stops: [stop("s2", 150, 270), stop("s3", 200, 270)],
    });
    const [a, b] = ps;
    expect([a.mode, b.mode]).toEqual(["stacked", "stacked"]);
    expect((b as { box: Box }).box.y0).toBe((a as { box: Box }).box.y1 + 4);
    const [c] = planCards({ area, fixed: [{ key: "checkout", box: checkout }], stops: [stop("s2", 300, 470)] });
    expect(c.mode === "stacked" && c.under).toBe("checkout");
  });

  test("fold only when stacking fails: no room below the lime card, or the card hit another stop's card", () => {
    const low: Box = { x0: 100, y0: 440, x1: 290, y1: 520 }; // the lime card sits on the sheet's edge
    expect(planCards({ area, fixed: [{ key: "next", box: low }], stops: [stop("s2", 150, 470)] })[0].mode).toBe("dot");
    // s3's card hits s2's card (not a fixed label): fold, as before
    const ps = planCards({ area, fixed: [], stops: [stop("s2", 200, 400), stop("s3", 220, 405)] });
    expect(ps.map((p) => p.mode)).toEqual(["card", "dot"]);
  });

  test("an off-map stop gets an edge chip on the ray from the centre, inside the map area", () => {
    const centre = { x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 };
    const [a] = planCards({ area, fixed: [], stops: [stop("s2", -300, centre.y)] }); // far left, level with the centre
    expect(a.mode).toBe("chip");
    if (a.mode !== "chip") return;
    expect(a.box.x0).toBe(area.x0); // pinned to the left edge
    expect((a.box.y0 + a.box.y1) / 2).toBeCloseTo(centre.y);
    expect(Math.abs(a.angle)).toBeCloseTo(Math.PI); // the arrow points left
    expect(inside(a.box, area)).toBe(true);
    // under the sheet counts as off the map: the chip sits on the bottom edge, never over the sheet
    const [b] = planCards({ area, fixed: [], stops: [stop("s2", 195, 700)] });
    expect(b.mode === "chip" && b.box.y1).toBe(area.y1);
    expect(b.mode === "chip" && b.angle).toBeCloseTo(Math.PI / 2);
  });

  test("a stop behind the camera flips the ray (its projection is mirrored)", () => {
    const c = { x: 195, y: 330 };
    const ahead = edgeAnchor(c, { x: 600, y: 330 }, chip, area);
    const behind = edgeAnchor(c, { x: 600, y: 330 }, chip, area, true);
    expect(ahead.c.x).toBeGreaterThan(c.x);
    expect(behind.c.x).toBeLessThan(c.x);
    const [a] = planCards({ area, fixed: [], stops: [stop("s2", 250, 300, true)] }); // on screen, but behind: still a chip
    expect(a.mode).toBe("chip");
  });

  test("two chips on the same edge never overlap each other, a card, or the header and sheet", () => {
    const ps = planCards({
      area,
      fixed: [{ key: "next", box: lime }],
      stops: [stop("s2", -400, 300), stop("s3", -420, 305)],
    });
    expect(ps.map((p) => p.mode)).toEqual(["chip", "chip"]);
    const [a, b] = boxes(ps);
    expect(overlaps(a, b)).toBe(false);
    for (const x of [a, b]) {
      expect(inside(x, area)).toBe(true);
      expect(overlaps(x, lime)).toBe(false);
    }
  });

  test("chips go after the cards on the map, and slide clear of them", () => {
    const ps = planCards({ area, fixed: [], stops: [stop("s2", 60, 345), stop("s3", -500, 330)] });
    expect(ps.map((p) => p.mode)).toEqual(["card", "chip"]);
    const [cardBox, chipBox] = boxes(ps);
    expect(overlaps(cardBox, chipBox)).toBe(false);
  });
});
