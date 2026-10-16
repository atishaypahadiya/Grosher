import { describe, expect, test } from "vitest";
import { demoSupercenter } from "@grosher/stores";
import { parseList, resolveItems } from "../src/lib/resolve.ts";

const { catalog } = demoSupercenter;

describe("parseList", () => {
  test("trims, drops blanks, dedupes case-insensitively", () => {
    expect(parseList("  Milk \n\neggs\nmilk\nEGGS\n")).toEqual(["Milk", "eggs"]);
  });
});

describe("resolveItems", () => {
  test("matches ids and names exactly, then case-insensitively", () => {
    const { stops, notFound } = resolveItems(["milk", "Eggs", "BANANAS", "greek yogurt"], catalog);
    expect(stops.map((s) => s.id)).toEqual(["milk", "eggs", "bananas", "yogurt"]);
    expect(notFound).toEqual([]);
  });
  test("reports unknown names and keeps the first of duplicates", () => {
    const { stops, notFound } = resolveItems(["milk", "Milk", "unicorn tears"], catalog);
    expect(stops.map((s) => s.id)).toEqual(["milk"]);
    expect(notFound).toEqual(["unicorn tears"]);
  });
});
