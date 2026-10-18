import { describe, expect, test } from "vitest";
import { Router, WalkGraph, matchSign, type SignReading } from "@grosher/core";
import { demoSupercenter } from "@grosher/stores";
import { validateDraft } from "../src/editor/model.ts";
import { buildDraft, derive } from "../src/survey/derive.ts";
import { addPhoto, aisleOfPhoto, dropPin, endAisle, newSurvey, parseSurveyFile, startAisle, tagAisle, tapEntrance, undo, updatePhoto, type PinLabel, type Survey } from "../src/survey/model.ts";

const ref = { categories: demoSupercenter.categories, departments: demoSupercenter.store.departments ?? [] };
const REF = 30; // the store's front wall faces 30° east of north
const STRIDE = 0.75;

/** A walk recorded the way the sensors record it: a step every 0.55 s, a compass sample every 0.5 s. */
function simulate() {
  let s = newSurvey({ storeId: "walmart-5435", name: "Walmart Story Rd", calibration: { distanceM: 10, steps: 13, durationMs: 9000, strideM: STRIDE, paceMps: 1.25, at: 0 }, now: 0 });
  let t = 1_000_000;
  const walk = (steps: number, rel: number, wobble = 3) => {
    for (let i = 0; i < steps; i++) {
      t += 550;
      s.steps.push(t - 275);
      s.headings.push([t - 400, (REF + rel + (i % 2 ? wobble : -wobble) + 360) % 360], [t - 100, (REF + rel + 360) % 360]);
    }
    t += 100;
  };
  s.headings.push([t, REF]);
  s = tapEntrance(s, t, REF);
  const aisle = (approach: number, approachRel: number, len: number, rel: number, sign?: SignReading, tags?: Parameters<typeof tagAisle>[2]) => {
    walk(approach, approachRel);
    // the sign photo, taken at the aisle head before Start
    const photoId = `ph${s.photos.length}`;
    s = addPhoto(s, { id: photoId, t: t - 50, w: 1024, h: 768 });
    if (sign) s = updatePhoto(s, photoId, { status: "done", reading: sign, words: [] });
    s = startAisle(s, t);
    const start = s.events.at(-1)!.id;
    if (tags) s = tagAisle(s, start, tags);
    walk(len, rel);
    s = endAisle(s, t);
    return start;
  };
  const pin = (steps: number, rel: number, label: PinLabel) => {
    walk(steps, rel);
    s = dropPin(s, t, label);
  };
  const a1 = aisle(8, 0, 40, 0, matchSign(["Aisle 12", "Cereal & Breakfast", "Coffee · Tea"], ref.categories)); // up 30 m
  const a2 = aisle(4, 90, 40, 180, matchSign(["13", "Chips / Pretzels", "Popcorn"], ref.categories)); // across 3 m, down 30 m
  const a3 = aisle(4, 90, 30, 0, undefined, { number: "14", oneSide: true, endcap: true }); // across 3 m, up 22.5 m
  pin(4, 90, "Dairy wall");
  walk(30, 180);
  pin(4, 180, "Checkout lane");
  pin(8, 270, "Exit");
  return { s, a1, a2, a3 };
}

describe("survey derivation", () => {
  test("steps × stride, headings relative to the entrance, squared to the grid", () => {
    const { s } = simulate();
    const d = derive(s);
    expect(d.strideM).toBe(STRIDE);
    expect(d.aisles.map((a) => [a.code, a.lengthM, a.rel])).toEqual([
      ["A12", 30, 0],
      ["A13", 30, 180],
      ["A14", 22.5, 0],
    ]);
    // cross walks between aisle heads: the spacing
    expect(d.aisles.map((a) => a.spacingM)).toEqual([null, 3, 3]);
    const [a1, a2, a3] = d.aisles;
    expect(a1.head).toEqual({ x: 0, y: -6 });
    expect(a1.tail.y).toBeCloseTo(-36, 6);
    expect(a2.head.x).toBeCloseTo(3, 6);
    expect(a2.tail.y).toBeCloseTo(-6, 6);
    expect(a3.tail.y).toBeCloseTo(-28.5, 6);
    expect(d.pins.map((p) => p.label)).toEqual(["Dairy wall", "Checkout lane", "Exit"]);
    expect(d.warnings).toEqual([]);
    // the sign's words became the aisle's categories; its number the code
    expect(a1.categories.map((c) => c.name)).toEqual(expect.arrayContaining(["Cereal", "Tea"]));
    expect(a3.oneSide && a3.endcap).toBe(true);
  });

  test("re-derive with a corrected stride: every length scales, nothing else moves", () => {
    const { s } = simulate();
    const d = derive(s, { strideM: 0.8 });
    expect(d.aisles.map((a) => a.lengthM)).toEqual([32, 32, 24]);
    expect(d.aisles[1].spacingM).toBeCloseTo(3.2, 6);
  });

  test("without motion every leg is timed at the calibrated pace", () => {
    const { s } = simulate();
    const d = derive({ ...s, motion: false });
    // 40 steps at 0.55 s + 0.1 s: 22.1 s at 1.25 m/s
    expect(d.aisles[0].lengthM).toBeCloseTo(27.63, 2);
    expect(d.warnings.join(" ")).toMatch(/timed at 1.25 m\/s/);
  });

  test("a leg far off the grid is not squared, and says so", () => {
    const { s } = simulate();
    const skew: Survey = { ...s, headings: s.headings.map(([t, h]) => [t, t > s.events[1].t && t < s.events[2].t ? (h + 45) % 360 : h]) };
    const d = derive(skew);
    expect(d.aisles[0].rel).toBeCloseTo(45, 0);
    expect(d.warnings.some((w) => /A12 ran 45° off/.test(w))).toBe(true);
  });

  test("a photo belongs to the aisle walked when it was taken, else the next one started", () => {
    const { s, a1, a2 } = simulate();
    expect(aisleOfPhoto(s, s.photos[0])).toBe(a1);
    expect(aisleOfPhoto(s, { t: s.events[1].t + 1 })).toBe(a1); // during the walk
    expect(aisleOfPhoto(s, { t: s.events[2].t + 1 })).toBe(a2); // after it ended: the next one
  });

  test("undo reverses exactly one tap", () => {
    const { s } = simulate();
    const last = s.events.at(-1)!;
    expect(undo(s, { kind: "event", id: last.id }).events).toHaveLength(s.events.length - 1);
    const start = s.events.find((e) => e.kind === "start")!;
    // undoing a start takes its end with it
    expect(undo(s, { kind: "event", id: start.id }).events.some((e) => e.kind === "end" && e.startId === start.id)).toBe(false);
    expect(undo(s, { kind: "photo", id: "ph0" }).photos.map((p) => p.id)).not.toContain("ph0");
  });

  test("the draft: aisles as corridors at their lengths, pins as nodes, categories on the aisles; it validates and routes", () => {
    const { s } = simulate();
    const { draft, report } = buildDraft(s, derive(s), ref);
    const st = draft.store;
    expect(st.storeId).toBe("walmart-5435");
    const errors = validateDraft(draft).filter((i) => i.level === "error");
    expect(errors).toEqual([]);
    // the doors
    expect(st.nodes.find((n) => n.id === st.entranceId)?.type).toBe("entrance");
    expect(st.nodes.find((n) => n.id === st.checkoutIds[0])?.type).toBe("checkout");
    expect(st.nodes.find((n) => n.id === st.exitId)?.type).toBe("exit");
    // the front ends of all three aisles are chained into a cross aisle
    const front = st.nodes.filter((n) => Math.abs(n.y - (6 + 36 - 6)) < 0.01).map((n) => n.id);
    expect(front.length).toBeGreaterThanOrEqual(3);
    // shelves: both sides of A12 and A13, one side of A14, 0.6 m deep in a 3 m spacing
    expect(st.fixtures!.map((f) => f.id).sort()).toEqual(["f_A12_L", "f_A12_R", "f_A13_L", "f_A13_R", "f_A14_L"]);
    expect(report.droppedFixtures).toBe(0);
    // categories from the signs, on locations along their aisle
    const cereal = draft.categories!.find((c) => c.name === "Cereal")!;
    expect(cereal.aisle).toBe("A12");
    expect(st.locations.find((l) => l.id === cereal.locationId)?.aisle).toBe("A12");
    expect(st.locations.some((l) => l.id === "A14-E")).toBe(true);
    // the dairy pin anchors the dairy label
    expect(st.departments!.find((x) => x.id === "dairy")?.anchor).toBeDefined();
    // the WalkGraph builds and a route to a sign's category exists
    const router = new Router(new WalkGraph(st));
    const plan = router.solve({ stops: [{ id: "cereal", name: "Cereal", locationIds: [cereal.locationId] }] });
    expect(Number.isFinite(plan.distanceM)).toBe(true);
    expect(plan.distanceM).toBeGreaterThan(6);
  });

  test("the file round-trips; a newer version or another format is refused", () => {
    const { s } = simulate();
    const back = parseSurveyFile(JSON.parse(JSON.stringify({ ...s, photoData: { ph0: "data:image/jpeg;base64,AAA" } })));
    expect(back.survey.events).toEqual(s.events);
    expect(back.photoData.ph0).toMatch(/^data:image/);
    expect(() => parseSurveyFile({ ...s, version: 99 })).toThrow(/newer/);
    expect(() => parseSurveyFile({ format: "other" })).toThrow(/Not a Grosher survey/);
  });
});
