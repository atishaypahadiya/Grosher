import { describe, expect, test } from "vitest";
import { moveBy, scaleAbout, withWidth, type Underlay } from "../src/editor/underlay.ts";

const u: Underlay = { url: "", x: 10, y: 20, w: 40, h: 20, opacity: 0.5, aspect: 2, locked: false };

describe("underlay gestures", () => {
  test("drag moves by map metres", () => {
    expect(moveBy(u, { x: 2.5, y: -1 })).toMatchObject({ x: 12.5, y: 19 });
  });
  test("scaling about a point keeps that point fixed and the aspect ratio", () => {
    const at = { x: 30, y: 30 }; // the image centre
    const s = scaleAbout(u, 2, at);
    expect(s).toMatchObject({ w: 80, h: 40, x: -10, y: 10 });
    // the centre is still the centre
    expect(s.x + s.w / 2).toBe(30);
    expect(s.y + s.h / 2).toBe(30);
    const corner = scaleAbout(u, 0.5, { x: 10, y: 20 });
    expect(corner).toMatchObject({ x: 10, y: 20, w: 20, h: 10 });
  });
  test("width is clamped and height follows", () => {
    expect(scaleAbout(u, 100, { x: 0, y: 0 }).w).toBe(500);
    expect(withWidth(u, 0)).toMatchObject({ w: 1, h: 0.5 });
  });
});
