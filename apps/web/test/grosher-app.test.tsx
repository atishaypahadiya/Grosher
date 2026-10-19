// The app as shipped: Grosher is the default store. Its header, its shipped hero lists (offered once), its
// chips, and its saved state kept apart from the demo Supercenter's.

import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../src/App.tsx";
import { dbClearMemoryFallback, dbGet } from "../src/lib/db.ts";
import { saveLearning } from "../src/lib/learning.ts";
import { load } from "../src/lib/storage.ts";
import { offerShipped, offeredKey } from "../src/lib/useLists.ts";
import { laneName } from "../src/lib/format.ts";
import type { List } from "../src/lib/lists.ts";

beforeEach(() => {
  localStorage.clear();
  dbClearMemoryFallback();
});

const find = (re: RegExp) => screen.findByText(re, {}, { timeout: 10_000 });
const openLists = async () => fireEvent.click((await screen.findAllByRole("button", { name: /^lists$/i }))[0]);
const loadList = async (name: string) => {
  await openLists();
  const sheet = screen.getByRole("dialog", { name: /^lists$/i });
  // a tap is a pointer down and up on the row (a long press renames, a swipe deletes)
  const row = within(sheet).getByText(name).closest(".ls-main")!;
  fireEvent.pointerDown(row, { clientX: 100, clientY: 10 });
  fireEvent.pointerUp(row, { clientX: 100, clientY: 10 });
  const replace = within(sheet).queryByRole("button", { name: /replace/i });
  if (replace) fireEvent.click(replace);
};

describe("Grosher, the default store", () => {
  test("the header names Grosher; the four hero lists are in the Lists sheet", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Grosher" })).toBeTruthy();
    await openLists();
    const sheet = screen.getByRole("dialog", { name: /^lists$/i });
    for (const name of ["Weeknight dal-chawal", "Weekly staples", "Friday night in", "Quick pharmacy run"]) expect(within(sheet).getByText(name)).toBeTruthy();
    expect(load<string[]>(offeredKey("grosher"), [])).toEqual(["dal-chawal", "weekly-staples", "friday-night", "pharmacy-run"]);
  });

  test("Friday night in: every item placed, the hot and cold ones last, and a route", async () => {
    render(<App />);
    await loadList("Friday night in");
    expect(await find(/9 items · 9 placed/i)).toBeTruthy();
    const chip = (name: RegExp) => within(screen.getByRole("list")).getAllByText(name)[0].closest("li")!.textContent ?? "";
    expect(chip(/sushi platter/i)).toMatch(/Sushi · last/);
    expect(chip(/ice cream/i)).toMatch(/Frozen · last/);
    // the sign answers first ("A12 · Red wine"); the catalog's own row, once the full catalog is in, names the shelf
    await waitFor(() => expect(chip(/red wine/i)).toMatch(/A12 · beer & wine/), { timeout: 10_000 });
    expect(chip(/bouquet/i)).toMatch(/Floral/);
    expect(screen.getByRole("button", { name: /route 9 items/i })).toBeTruthy();
  });

  test("a trip in progress is saved under Grosher's own key", async () => {
    render(<App />);
    await loadList("Quick pharmacy run");
    fireEvent.click(await screen.findByRole("button", { name: /route 5 items/i }, { timeout: 10_000 }));
    expect(screen.getByText(/next · 1 of 5/i)).toBeTruthy();
    await waitFor(() => expect(load<{ remaining: string[] } | null>("grosher.trip.grosher", null)?.remaining).toHaveLength(5));
    expect(localStorage.getItem("grosher.trip")).toBeNull();
  });

  test("nothing from the demo store leaks into Grosher's placement", async () => {
    // the demo's own memory says milk is in its aisle 7: Grosher never reads it
    await saveLearning("demo-supercenter", { pending: [], llm: [], memory: [{ name: "milk", locationId: "A7-L11", confidence: 0.95, confirms: 5, lastConfirmed: Date.now() }] });
    localStorage.setItem("grosher.trip", JSON.stringify({ original: ["milk"], remaining: ["milk"], got: [], skipped: [], positionNodeId: "ENTRANCE", walkedM: 0, startedAt: 1 }));
    render(<App />);
    fireEvent.change(screen.getByLabelText(/add items/i), { target: { value: "milk" } });
    fireEvent.submit(screen.getByLabelText(/add items/i).closest("form")!);
    expect(await find(/1 item · 1 placed/i)).toBeTruthy();
    const row = within(screen.getByRole("list")).getAllByRole("listitem")[0];
    expect(row.getAttribute("data-source")).toBe("exact");
    expect(row.textContent).toMatch(/Dairy · last/);
    // the demo's paused trip is not resumed on Grosher's map
    expect(screen.queryByText(/next · 1 of/i)).toBeNull();
    expect((await dbGet<{ memory: unknown[] } | null>("learning:grosher", null))?.memory ?? []).toEqual([]);
  });
});

test("shipped lists are offered once: a deleted one does not come back", () => {
  const shipped = [{ id: "a", name: "A", items: ["milk"] }];
  const first = offerShipped([], "grosher", shipped, []);
  expect(first.lists.map((l) => l.id)).toEqual(["grosher:a"]);
  const again = offerShipped([] as List[], "grosher", shipped, first.offered);
  expect(again.lists).toEqual([]);
});

test("lane names read the way the shopper does", () => {
  expect([laneName("L3"), laneName("LANE1"), laneName("EXPRESS"), laneName("SELF"), laneName(null)]).toEqual(["lane 4", "lane 1", "express lane", "self-checkout", null]);
});

test("without WebGL, a stop in the Bulk hero zone shows its flat shelf image; Close hides it for that stop", async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText(/add items/i), { target: { value: "toor dal (bulk)" } });
  fireEvent.submit(screen.getByLabelText(/add items/i).closest("form")!);
  fireEvent.click(await screen.findByRole("button", { name: /route 1 item/i }, { timeout: 10_000 }));
  const fig = await screen.findByTestId("flat-shelf");
  expect(fig.querySelector("img")!.getAttribute("src")).toMatch(/hero\/bulk\/bulk-pulses\.webp$/);
  fireEvent.click(within(fig).getByRole("button", { name: /close/i }));
  expect(screen.queryByTestId("flat-shelf")).toBeNull();
});
