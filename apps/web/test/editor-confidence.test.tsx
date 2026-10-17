import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { demoSupercenter } from "@grosher/stores";
import { bandCounts, isStale, locationMarks } from "../src/editor/confidence.ts";
import { App } from "../src/App.tsx";
import { dbClearMemoryFallback } from "../src/lib/db.ts";
import { saveLearning } from "../src/lib/learning.ts";

const { store, catalog } = demoSupercenter;
const DAY = 86_400_000;
const NOW = 1000 * DAY;

beforeEach(() => {
  localStorage.clear();
  dbClearMemoryFallback();
});

describe("editor confidence view", () => {
  test("marks per location: the weakest band wins, misses add up, stale when old or a guess", () => {
    const loc = catalog[0].locationIds[0];
    const memory = [
      { name: "x", locationId: loc, confidence: 0.6, confirms: 1, misses: 2, lastConfirmed: NOW - DAY },
      { name: "y", locationId: loc, confidence: 0.95, confirms: 4, misses: 1, lastConfirmed: NOW - 100 * DAY }, // 100 days: stale
    ];
    const marks = locationMarks(store, catalog, memory, NOW);
    const atLoc = catalog.filter((s) => s.locationIds.includes(loc)).length;
    expect(marks.get(loc)).toEqual({ band: "likely", misses: 3, stale: true, entries: atLoc + 2 }); // the catalog entries (confirmed) + two rows
    const guess = [{ name: "z", locationId: loc, confidence: 0.4, confirms: 0, lastConfirmed: NOW }];
    expect(locationMarks(store, catalog, guess, NOW).get(loc)?.band).toBe("guess");
    expect(isStale({ confidence: 0.9, lastConfirmed: NOW - 91 * DAY }, NOW)).toBe(true);
    expect(isStale({ confidence: 0.9, lastConfirmed: NOW - 90 * DAY }, NOW)).toBe(false);
    expect(isStale({ confidence: 0.45 }, NOW)).toBe(true);
    expect(isStale({}, NOW)).toBe(false); // a surveyed entry
    const unknownLoc = locationMarks(store, [], [{ name: "q", locationId: "nope", confidence: 1, confirms: 1, lastConfirmed: NOW }], NOW);
    expect(unknownLoc.size).toBe(0);
  });

  test("band counts over catalog and memory", () => {
    const c = bandCounts(catalog, [{ name: "a", locationId: "A1-8", confidence: 0.6, confirms: 1, lastConfirmed: NOW }, { name: "b", locationId: "A1-8", confidence: 0.3, confirms: 0, lastConfirmed: NOW }], NOW);
    expect(c).toEqual({ confirmed: catalog.length, likely: 1, guess: 1, stale: 1, total: catalog.length + 2 });
  });

  test("the editor's Confidence and Stale toggles, and the counts under Validate", async () => {
    await saveLearning("demo-supercenter", {
      pending: [],
      llm: [],
      memory: [
        { name: "ghee", locationId: "A7-L11", confidence: 0.45, confirms: 0, misses: 2, lastConfirmed: Date.now() },
        { name: "saffron", locationId: "A5-L1", confidence: 0.95, confirms: 5, lastConfirmed: Date.now() - 120 * DAY },
      ],
    });
    location.hash = "#/edit";
    try {
      render(<App />);
      // the memory rows load asynchronously
      await screen.findByText(/map v/i);
      fireEvent.click(screen.getByRole("button", { name: /^confidence$/i }));
      const dots = () => document.querySelectorAll('[data-layer="locations"] [data-location]');
      await new Promise((r) => setTimeout(r, 50));
      expect(dots().length).toBe(store.locations.length);
      const ghee = () => document.querySelector('[data-location="A7-L11"]')!;
      expect(ghee().getAttribute("data-band")).toBe("guess");
      expect(ghee().querySelector("[data-misses]")?.textContent).toBe("2");
      expect(document.querySelector('[data-location="A5-L1"]')!.getAttribute("data-stale")).toBe("1");
      expect(document.querySelector('[data-location="A5-L1"]')!.getAttribute("data-band")).toBe("confirmed"); // decayed .95 → .85, still confirmed, but stale
      fireEvent.click(screen.getByRole("button", { name: /^stale$/i }));
      expect([...dots()].map((d) => d.getAttribute("data-location")).sort()).toEqual(["A5-L1", "A7-L11"]);
      fireEvent.click(screen.getByRole("button", { name: /^validate$/i }));
      const counts = screen.getByTestId("band-counts").textContent!;
      expect(counts).toMatch(new RegExp(`${catalog.length + 2} entries · ${catalog.length + 1} confirmed · 0 likely · 1 guess · 2 stale`));
    } finally {
      location.hash = "";
    }
  });
});
