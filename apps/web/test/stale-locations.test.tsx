// A device that saved answers against an older map must still boot, with every item it can place routed
// and the rest as "Needs a place". The live bug: a model answer cached on 16 Oct as oat milk → DAIRY-8 (map
// v2); map v3 (17 Oct) has no DAIRY-8, and the solver threw "stop llm:oatmilk: unknown location DAIRY-8".

import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { demoSupercenter } from "@grosher/stores";
import { App } from "../src/App.tsx";
import { dbClearMemoryFallback, dbGet, dbSetRaw } from "../src/lib/db.ts";
import { revalidateLearning, type Learning } from "../src/lib/learning.ts";

const STORE = demoSupercenter.store;
const locations = new Set(STORE.locations.map((l) => l.id));

// as the phone stored them: bare (pre-envelope) values, locations from map v2
const oatMilk = { id: "llm:oatmilk", name: "Oat Milk", locationIds: ["DAIRY-8"], source: "llm", department: "dairy", subcategory: "plant milk", confidence: 0.86, confirms: 2, misses: 0, lastConfirmed: Date.now() - 86_400_000 }; // confirmed twice, as on the phone
const gizmo = { id: "llm:qwzxgizmo", name: "Qwzx Gizmo", locationIds: ["DAIRY-8"], source: "llm", department: "dairy", confidence: 0.4, confirms: 0, misses: 0 };
const paneerMemory = { name: "Paneer", locationId: "DAIRY-11", confirms: 2, confidence: 0.86, tags: [], typedForms: ["paneer"], lastUsed: 1, lastConfirmed: 1 };

beforeEach(() => {
  localStorage.clear();
  dbClearMemoryFallback();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const add = (text: string) => {
  const input = screen.getByLabelText(/add items/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
};

describe("saved locations from an older map", () => {
  test("revalidation: re-placed by category where one names it, else asks; nothing deleted", () => {
    const saved: Learning = { pending: [oatMilk, gizmo] as Learning["pending"], memory: [paneerMemory, { ...paneerMemory, name: "Qwzx Gadget", typedForms: [] }] as Learning["memory"], llm: [["oat milk", { category: "dairy", confidence: 0.6 }], ["old thing", { category: "a-category-v3-lacks", confidence: 0.6 }]] };
    const { learning, report, changed } = revalidateLearning(saved, { locations, categories: demoSupercenter.categories, departments: (STORE.departments ?? []).map((d) => d.id) });
    expect(changed).toBe(true);
    expect(learning.pending.find((p) => p.id === "llm:oatmilk")?.locationIds).toEqual(["DAIRY-L5"]); // Milk alternatives
    expect(learning.pending.find((p) => p.id === "llm:qwzxgizmo")?.locationIds).toEqual([]); // kept, asks
    expect(learning.memory).toHaveLength(2);
    expect(learning.memory[0].locationId).not.toBe("DAIRY-11");
    expect(learning.memory[0].confidence).toBeLessThan(0.5);
    expect(report).toMatchObject({ pendingRemapped: ["Oat Milk"], pendingAsk: ["Qwzx Gizmo"], memoryRemapped: ["Paneer"], memoryAsk: ["Qwzx Gadget"], llmDropped: ["old thing"] });
    for (const p of learning.pending) for (const l of p.locationIds) expect(locations.has(l)).toBe(true);
  });

  test("the app boots; the stale item that nothing names shows Needs a place; the route covers the rest", async () => {
    await dbSetRaw("learning:demo-supercenter", { pending: [oatMilk, gizmo], llm: [], memory: [paneerMemory] });
    render(<App />);
    add("oat milk, qwzx gizmo, paneer, bananas");
    expect(await screen.findByText(/4 items · 3 placed/i, {}, { timeout: 15_000 })).toBeTruthy();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    const row = (re: RegExp) => rows.find((r) => re.test(r.textContent ?? ""))!;
    expect(row(/qwzx/i).getAttribute("data-source")).toBe("unknown");
    expect(within(row(/qwzx/i)).getByText(/needs a place/i, { selector: ".sub" })).toBeTruthy();
    expect(row(/oat milk/i).getAttribute("data-source")).not.toBe("unknown");
    expect(row(/paneer/i).getAttribute("data-source")).not.toBe("unknown");
    fireEvent.click(screen.getByRole("button", { name: /route 3 items/i }));
    expect(await screen.findByText(/next · 1 of 3/i, {}, { timeout: 10_000 })).toBeTruthy();
    // the device's saved state was rewritten onto this map, the stale entry kept
    await waitFor(async () => {
      const l = await dbGet<Learning | null>("learning:demo-supercenter", null);
      expect(l?.pending.find((p) => p.id === "llm:oatmilk")?.locationIds).toEqual(["DAIRY-L5"]);
      expect(l?.pending.find((p) => p.id === "llm:qwzxgizmo")?.locationIds).toEqual([]);
    });
  });

  test("a map change mid-trip: the saved trip resumes without the removed location's stop, which checkout asks about", async () => {
    await dbSetRaw("learning:demo-supercenter", { pending: [gizmo], llm: [], memory: [] });
    // a trip saved under the old map: its next stop's only location is gone
    localStorage.setItem("grosher.trip", JSON.stringify({ original: ["llm:qwzxgizmo", "milk", "bananas"], remaining: ["llm:qwzxgizmo", "milk", "bananas"], got: [], skipped: [], positionNodeId: STORE.entranceId, walkedM: 0, startedAt: 1 }));
    render(<App />);
    expect(await screen.findByText(/next · 1 of 2/i, {}, { timeout: 15_000 })).toBeTruthy();
    const progress = screen.getByRole("progressbar", { name: /trip progress/i });
    expect(progress.getAttribute("aria-valuemax")).toBe("2");
  });
});
