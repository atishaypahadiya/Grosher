import { describe, expect, test } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { DEFAULT_TILT, DEFAULT_YAW, solveFraming, verticalFov } from "../src/map3d/CameraRig.tsx";

const aspect = 390 / 844;

function ndcY(p: { x: number; y: number }, f: { tx: number; tz: number; distance: number }, flat: boolean) {
  const cam = new PerspectiveCamera(verticalFov(aspect), aspect, 0.5, 400);
  const tilt = ((flat ? 2 : DEFAULT_TILT) * Math.PI) / 180;
  const yaw = ((flat ? 0 : DEFAULT_YAW) * Math.PI) / 180;
  cam.position.set(f.tx + f.distance * Math.sin(tilt) * Math.sin(yaw), f.distance * Math.cos(tilt), f.tz + f.distance * Math.sin(tilt) * Math.cos(yaw));
  cam.lookAt(f.tx, 0, f.tz);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return new Vector3(p.x, 0.6, p.y).project(cam);
}

describe("camera framing", () => {
  test("42° horizontal field: vertical fov grows on portrait, clamped", () => {
    expect(verticalFov(1)).toBeCloseTo(42, 0);
    expect(verticalFov(aspect)).toBeGreaterThan(70);
    expect(verticalFov(0.2)).toBe(80);
  });

  test("next stop is pinned at the upper third; you falls as low as the 36 m floor allows", () => {
    const you = { x: 30, y: 50 };
    const next = { x: 34, y: 20 };
    const f = solveFraming({ you, next }, false, aspect);
    expect(f.distance).toBeGreaterThanOrEqual(36);
    const yn = ndcY(next, f, false);
    const yy = ndcY(you, f, false);
    expect(yn.y).toBeGreaterThan(0.2);
    expect(yn.y).toBeLessThan(0.5);
    expect(yy.y).toBeLessThan(yn.y - 0.25); // clearly below the next stop, never centred on it
    expect(Math.abs((yn.x + yy.x) / 2)).toBeLessThan(0.25);
  });

  test("a deep leg puts you in the lower third", () => {
    const you = { x: 30, y: 66 };
    const next = { x: 30, y: 12 };
    const f = solveFraming({ you, next }, false, aspect);
    expect(ndcY(next, f, false).y).toBeGreaterThan(0.2);
    expect(ndcY(you, f, false).y).toBeLessThan(-0.2);
  });

  test("a leg with no depth still keeps both points in the upper half, clear of the sheet", () => {
    const you = { x: 10, y: 20 };
    const next = { x: 14, y: 20 };
    const f = solveFraming({ you, next }, false, aspect);
    expect(f.distance).toBe(36);
    expect(ndcY(next, f, false).y).toBeGreaterThan(0.2);
    expect(ndcY(you, f, false).y).toBeGreaterThan(0.1);
  });

  test("flat view keeps the same bias", () => {
    const f = solveFraming({ you: { x: 10, y: 60 }, next: { x: 20, y: 20 } }, true, aspect);
    expect(ndcY({ x: 20, y: 20 }, f, true).y).toBeGreaterThan(0.2);
    expect(ndcY({ x: 10, y: 60 }, f, true).y).toBeLessThan(-0.1);
  });

  test("no next stop: you alone, at the minimum distance", () => {
    const f = solveFraming({ you: { x: 5, y: 5 } }, false, aspect);
    expect(f.distance).toBe(36);
    expect(Math.abs(ndcY({ x: 5, y: 5 }, f, false).y)).toBeLessThan(0.2);
  });
});
