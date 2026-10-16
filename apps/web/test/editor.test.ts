import { describe, expect, test } from "vitest";
import { demoSupercenter } from "@grosher/stores";
import {
  addEdge,
  addFixtureRect,
  addItemAt,
  addLocation,
  addNode,
  cloneDraft,
  deleteNode,
  itemsAt,
  nearestEdge,
  pick,
  setDoor,
  stats,
  updateLocation,
  validateDraft,
  type Draft,
} from "../src/editor/model.ts";

const base: Draft = { store: demoSupercenter.store, catalog: demoSupercenter.catalog };

describe("editor model", () => {
  test("the demo store validates clean", () => {
    expect(validateDraft(base).filter((i) => i.level === "error")).toEqual([]);
    const s = stats(base);
    expect(s.nodes).toBe(base.store.nodes.length);
    expect(s.textures).toBe(9);
    expect(s.unreachable).toBe(0);
  });

  test("corridor tool: nodes snap, edges chain and dedupe, one-way sticks", () => {
    let d = cloneDraft(base);
    const a = addNode(d, { x: 70, y: 30 });
    d = a.draft;
    const again = addNode(d, { x: 70.3, y: 30.2 });
    expect(again.id).toBe(a.id); // snapped
    const b = addNode(d, { x: 70, y: 40 });
    d = b.draft;
    const e1 = addEdge(d, a.id, b.id);
    d = e1.draft;
    const e2 = addEdge(d, b.id, a.id);
    expect(e2.id).toBe(e1.id); // two-way edge already covers it
    const e3 = addEdge(d, a.id, b.id, true);
    expect(e3.id).toBe(e1.id);
    expect(d.store.edges.length).toBe(base.store.edges.length + 1);
  });

  test("a floating node is reported, deleting it clears the report", () => {
    let d = addNode(cloneDraft(base), { x: 80, y: 80 }).draft;
    expect(validateDraft(d).some((i) => /not connected/.test(i.text))).toBe(true);
    d = deleteNode(d, d.store.nodes.at(-1)!.id);
    expect(validateDraft(d).filter((i) => i.level === "error")).toEqual([]);
  });

  test("fixture rect, location on an edge with default aisle, item placed there", () => {
    let d = cloneDraft(base);
    const f = addFixtureRect(d, { x: 2, y: 54 }, { x: 5, y: 58 }, { department: "bakery", aisle: "B1", height: 1.2 });
    d = f.draft;
    expect(d.store.fixtures!.at(-1)).toMatchObject({ kind: "shelf", department: "bakery", aisle: "B1", height: 1.2 });
    // a point in aisle A3's corridor, mid-way
    const hit = nearestEdge(d.store, { x: 18.2, y: 30 }, 1.5)!;
    expect(hit.edge.from).toBe("A3T");
    const l = addLocation(d, hit.edge.id, hit.offsetM);
    d = l.draft;
    const loc = d.store.locations.find((x) => x.id === l.id)!;
    expect(loc.aisle).toBe("A3"); // from the nearest labelled fixture
    expect(loc.offsetM).toBeCloseTo(18, 0);
    d = updateLocation(d, l.id, { side: "R", bay: "012", modular: "3", zone: "GR", tags: ["heavy"] });
    d = addItemAt(d, l.id, "Dog food 20 lb");
    const items = itemsAt(d.catalog, l.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "dog-food-20-lb", tags: ["heavy"], confidence: 0.6 });
    expect(validateDraft(d).filter((i) => i.level === "error")).toEqual([]);
  });

  test("picking prefers nodes, then locations, then edges, then fixtures", () => {
    expect(pick(base.store, { x: 10, y: 12 }, 0.6)).toEqual({ kind: "node", id: "A1T" });
    expect(pick(base.store, { x: 10, y: 20.2 }, 0.6)).toEqual({ kind: "location", id: "A1-8" });
    expect(pick(base.store, { x: 10.1, y: 26 }, 0.6)?.kind).toBe("edge");
    expect(pick(base.store, { x: 12, y: 30 }, 0.6)).toEqual({ kind: "fixture", id: "f-A1-A2" });
    expect(pick(base.store, { x: 100, y: 100 }, 0.6)).toBeNull();
  });

  test("doors: entrance moves, checkout toggles", () => {
    let d = setDoor(cloneDraft(base), "FR", "entrance");
    expect(d.store.entranceId).toBe("FR");
    expect(d.store.nodes.find((n) => n.id === "ENTRANCE")!.type).toBe("junction");
    d = setDoor(d, "L0", "checkout");
    expect(d.store.checkoutIds).not.toContain("L0");
    d = setDoor(d, "L0", "checkout");
    expect(d.store.checkoutIds).toContain("L0");
  });
});
