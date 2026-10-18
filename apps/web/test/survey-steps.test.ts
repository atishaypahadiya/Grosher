import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { angleDiff, circularMean, countSteps, headingOf, StepDetector, type MotionTrace } from "../src/survey/steps.ts";

// test/fixtures/motion: synthetic traces (scripts/gen-motion-fixtures.mjs). The named ones were the tuning
// set; heldout-* were generated afterwards from their own seeds and are never tuned against.
// (jsdom gives import.meta.url an http scheme; the tests run from apps/web)
const DIR = join(process.cwd(), "test/fixtures/motion");
const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, ...(JSON.parse(readFileSync(join(DIR, f), "utf8")) as MotionTrace & { steps: number; rate: number }) }));
const tuned = fixtures.filter((f) => !f.file.startsWith("heldout"));
const heldout = fixtures.filter((f) => f.file.startsWith("heldout"));

describe("step detector on recorded motion traces", () => {
  test.each(tuned.map((f) => [f.file, f] as const))("%s: exact", (_name, f) => {
    expect(countSteps(f).length).toBe(f.steps);
  });

  test("held out: within 5% overall, no trace off by more than a quarter", () => {
    const rows = heldout.map((f) => ({ file: f.file, rate: f.rate, truth: f.steps, got: countSteps(f).length }));
    console.table(rows);
    const truth = rows.reduce((s, r) => s + r.truth, 0);
    const got = rows.reduce((s, r) => s + r.got, 0);
    expect(Math.abs(got - truth) / truth).toBeLessThanOrEqual(0.05);
    for (const r of rows) expect(Math.abs(r.got - r.truth) / r.truth).toBeLessThanOrEqual(0.25);
  });

  test("never two steps within 250 ms; a lone bump while standing is not a step", () => {
    const d = new StepDetector();
    const g = 9.81;
    // two sharp bumps 120 ms apart, then nothing
    for (let t = 0; t < 3000; t += 16) {
      const bump = Math.exp(-(((t - 1000) / 40) ** 2)) * 3 + Math.exp(-(((t - 1120) / 40) ** 2)) * 3;
      d.push(t, 0, 0, g + bump);
    }
    expect(d.count).toBe(0);
  });
});

describe("headings", () => {
  test("circular mean across north, signed differences, the event's heading", () => {
    expect(circularMean([350, 10])).toBeCloseTo(0, 6);
    expect(circularMean([80, 100])).toBeCloseTo(90, 6);
    expect(circularMean([])).toBeNull();
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(-20);
    expect(headingOf({ webkitCompassHeading: 271.5, alpha: 3 })).toBe(271.5);
    expect(headingOf({ alpha: 90, absolute: true })).toBe(270);
    expect(headingOf({ alpha: 90, absolute: false })).toBeNull();
  });
});
