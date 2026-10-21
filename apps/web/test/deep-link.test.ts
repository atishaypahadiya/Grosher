// A list in the URL (lib/deepLink.ts): the project page's "Open this in the app" links route it at once.
import { describe, expect, test } from "vitest";
import { linkedList, MAX_CHARS, MAX_ITEMS, withoutLink } from "../src/lib/deepLink.ts";

const lists = [
  { id: "weekly-staples", name: "Weekly staples", items: ["milk", "eggs", "bread"] },
  { id: "dal-chawal", name: "Weeknight dal-chawal", items: ["toor dal (bulk)", "basmati rice"] },
];

describe("a list in the URL", () => {
  test("?sample= names a shipped list by id or by name, any case", () => {
    expect(linkedList("?sample=weekly-staples", lists)).toEqual(["milk", "eggs", "bread"]);
    expect(linkedList("?sample=Weeknight%20Dal-Chawal", lists)).toEqual(["toor dal (bulk)", "basmati rice"]);
    expect(linkedList("?sample=nope", lists)).toBeNull();
  });

  test("?list= splits on commas, semicolons and new lines, trims, drops blanks and repeats", () => {
    expect(linkedList("?list=" + encodeURIComponent("toor dal, moong dal;dal\n bananas ,, dal"))).toEqual(["toor dal", "moong dal", "dal", "bananas"]);
  });

  test("the resolver's limits: 40 items of 60 characters", () => {
    const many = Array.from({ length: 50 }, (_, i) => `item ${i}`).join(",");
    expect(linkedList("?list=" + encodeURIComponent(many))).toHaveLength(MAX_ITEMS);
    expect(linkedList("?list=" + "x".repeat(100))![0]).toHaveLength(MAX_CHARS);
  });

  test("no link, no list; the URL drops the link once routed and keeps the rest", () => {
    expect(linkedList("?tier=hi")).toBeNull();
    expect(linkedList("?list=")).toBeNull();
    expect(withoutLink("https://grosher.pages.dev/?list=milk&tier=hi#/x")).toBe("/?tier=hi#/x");
    expect(withoutLink("https://grosher.pages.dev/?sample=weekly-staples")).toBe("/");
  });
});
