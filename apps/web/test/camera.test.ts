import { describe, expect, test } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { DEFAULT_SAFE, DEFAULT_TILT, DEFAULT_YAW, minFramingDistance, solveFraming, verticalFov } from "../src/map3d/CameraRig.tsx";

const aspect = 390 / 844;
const ndcTop = 1 - 2 * DEFAULT_SAFE.top;
const ndcBot = -1 + 2 * DEFAULT_SAFE.bottom;
const third = (ndcTop - ndcBot) / 3;
const padY = ((ndcTop - ndcBot) * 0.15) / 2;

function ndcOf(p: { x: number; y: number }, f: { tx: number; tz: number; distance: number }, flat: boolean) {
  const cam = new PerspectiveCamera(verticalFov(aspect), aspect, 0.5, 400);
  const tilt = ((flat ? 2 : DEFAULT_TILT) * Math.PI) / 180;
  const yaw = ((flat ? 0 : DEFAULT_YAW) * Math.PI) / 180;
  cam.position.set(f.tx + f.distance * Math.sin(tilt) * Math.sin(yaw), f.distance * Math.cos(tilt), f.tz + f.distance * Math.sin(tilt) * Math.cos(yaw));
  cam.lookAt(f.tx, 0, f.tz);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return new Vector3(p.x, 0.6, p.y).project(cam);
}
const inside = (q: Vector3) => q.x >= -0.85 - 1e-3 && q.x <= 0.85 + 1e-3 && q.y >= ndcBot + padY - 1e-3 && q.y <= ndcTop - padY + 1e-3;

describe("camera framing", () => {
  test("42° horizontal field: vertical fov grows on portrait, clamped", () => {
    expect(verticalFov(1)).toBeCloseTo(42, 0);
    expect(verticalFov(aspect)).toBeGreaterThan(70);
    expect(verticalFov(0.2)).toBe(80);
  });

  test("the floor is a visible span: 30 m across the frame ≈ 39 m of distance", () => {
    expect(minFramingDistance()).toBeCloseTo(39.1, 0);
    const f = solveFraming({ you: { x: 5, y: 5 } }, false, aspect);
    expect(f.distance).toBeCloseTo(minFramingDistance(), 3);
  });

  test("a 30 m leg: next stop in the upper third band, you below it, both inside the padded area", () => {
    const you = { x: 30, y: 50 };
    const next = { x: 34, y: 20 };
    const f = solveFraming({ you, next }, false, aspect);
    const yn = ndcOf(next, f, false);
    const yy = ndcOf(you, f, false);
    expect(Math.abs(yn.y - (ndcTop - third))).toBeLessThan(third / 2 + 1e-3);
    expect(yy.y).toBeLessThan(yn.y - 0.2);
    expect(inside(yn)).toBe(true);
    expect(inside(yy)).toBe(true);
  });

  test("a deep leg puts you in the lower third", () => {
    const you = { x: 30, y: 66 };
    const next = { x: 30, y: 12 };
    const f = solveFraming({ you, next }, false, aspect);
    expect(ndcOf(next, f, false).y).toBeGreaterThan(0.2);
    expect(ndcOf(you, f, false).y).toBeLessThan(ndcBot + third + 0.05);
  });

  test("a leg with no depth keeps both points in the upper third band", () => {
    const you = { x: 10, y: 20 };
    const next = { x: 14, y: 20 };
    const f = solveFraming({ you, next }, false, aspect);
    expect(f.distance).toBeCloseTo(minFramingDistance(), 3);
    expect(ndcOf(next, f, false).y).toBeGreaterThan(0.2);
    expect(inside(ndcOf(you, f, false))).toBe(true);
  });

  test("hard constraints: a long diagonal leg keeps both endpoints inside the padded area", () => {
    const you = { x: 60, y: 68 }; // entrance corner
    const next = { x: 4, y: 14 }; // far produce corner
    const path = [you, { x: 60, y: 52 }, { x: 4, y: 52 }, next];
    const f = solveFraming({ you, next, points: path, footprint: { x: 31, z: 38, w: 66, d: 62 } }, false, aspect);
    expect(inside(ndcOf(you, f, false))).toBe(true);
    expect(inside(ndcOf(next, f, false))).toBe(true);
    for (const p of path) {
      const q = ndcOf(p, f, false);
      expect(q.x).toBeGreaterThan(-1);
      expect(q.x).toBeLessThan(1);
    }
  });

  test("flat view keeps the same rules", () => {
    const you = { x: 10, y: 60 };
    const next = { x: 20, y: 20 };
    const f = solveFraming({ you, next }, true, aspect);
    expect(ndcOf(next, f, true).y).toBeGreaterThan(0.2);
    expect(ndcOf(you, f, true).y).toBeLessThan(0.15);
    expect(inside(ndcOf(you, f, true))).toBe(true);
  });
});

describe("footprint slide", () => {
  test("a short leg near the back wall: store fills the width as far as the leg's padding allows, next stays in its band", () => {
    const you = { x: 10, y: 20 };
    const next = { x: 14, y: 20 };
    const footprint = { x: 31, z: 38, w: 66, d: 62 };
    const focus = { you, next, points: [you, { x: 10, y: 12 }, { x: 14, y: 12 }, next] };
    const plain = solveFraming(focus, false, aspect);
    const biased = solveFraming({ ...focus, footprint }, false, aspect);
    const n = ndcOf(next, biased, false);
    expect(Math.abs(n.y - (ndcTop - third))).toBeLessThan(third / 2 + 1e-3);
    expect(inside(ndcOf(you, biased, false))).toBe(true);
    const left = ndcOf({ x: footprint.x - footprint.w / 2, y: 20 }, biased, false).x;
    const plainLeft = ndcOf({ x: footprint.x - footprint.w / 2, y: 20 }, plain, false).x;
    expect(ndcOf({ x: footprint.x + footprint.w / 2, y: 20 }, biased, false).x).toBeGreaterThan(0.95);
    expect(left).toBeLessThan(plainLeft - 0.1);
  });

  test("vertical slack is used upward: a small store behind a short leg is lifted toward the strip", () => {
    const you = { x: 12, y: 38 };
    const next = { x: 16, y: 32 };
    const footprint = { x: 12, z: 30, w: 30, d: 20 }; // store spans y 20..40, its back wall sits below the strip at the plain solve
    const focus = { you, next, points: [you, next] };
    const plain = solveFraming(focus, false, aspect);
    const biased = solveFraming({ ...focus, footprint }, false, aspect);
    const backPlain = ndcOf({ x: 12, y: 20 }, plain, false).y;
    const backBiased = ndcOf({ x: 12, y: 20 }, biased, false).y;
    expect(backPlain).toBeLessThan(ndcTop); // there was slack
    expect(backBiased).toBeGreaterThan(backPlain + 0.02);
    expect(inside(ndcOf(you, biased, false))).toBe(true);
    expect(inside(ndcOf(next, biased, false))).toBe(true);
  });
});
