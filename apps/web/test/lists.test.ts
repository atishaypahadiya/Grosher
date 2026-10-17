import { describe, expect, test } from "vitest";
import { draftIsUnsaved, loadOntoDraft, mergeImported, newList, predictUsual, rename, saveUsualFromTrip, setDraftItems, withDraft } from "../src/lib/lists.ts";

const SUNDAY = new Date("2026-10-18T10:00:00").getTime(); // a Sunday
const DAY = 86_400_000;

describe("lists", () => {
  test("the draft is created on demand and takes items", () => {
    const l = setDraftItems(withDraft([], "demo"), ["milk"]);
    expect(l[0].kind).toBe("draft");
    expect(l[0].items).toEqual(["milk"]);
    expect(draftIsUnsaved(l)).toBe(true);
  });

  test("loading a list replaces the draft and counts as used; an identical draft is not unsaved", () => {
    let l = withDraft([newList("demo", "saved", "Weekly", ["milk", "eggs"], 1)], "demo");
    l = setDraftItems(l, ["bread"]);
    l = loadOntoDraft(l, l[1].id, 5);
    expect(l[0].items).toEqual(["milk", "eggs"]);
    expect(l[1].usedAt).toEqual([5]);
    expect(draftIsUnsaved(l)).toBe(false);
    expect(rename(l, l[1].id, "  Big shop ")[1].name).toBe("Big shop");
  });

  test("save as usual names the list after the weekday and updates it in place", () => {
    const a = saveUsualFromTrip(withDraft([], "demo"), "demo", ["milk", "eggs"], SUNDAY);
    expect(a.list).toMatchObject({ kind: "usual", name: "Sunday trip", items: ["milk", "eggs"], usedAt: [SUNDAY] });
    const b = saveUsualFromTrip(a.lists, "demo", ["milk", "bread"], SUNDAY + 7 * DAY);
    expect(b.lists.filter((x) => x.kind === "usual")).toHaveLength(1);
    expect(b.list.items).toEqual(["milk", "bread"]);
    expect(b.list.usedAt).toEqual([SUNDAY, SUNDAY + 7 * DAY]);
  });

  test("predictUsual picks the list used most on this weekday, else the most recent", () => {
    const sunday = { ...newList("demo", "usual", "Sunday trip", ["a"], 1), usedAt: [SUNDAY, SUNDAY + 7 * DAY] };
    const wednesday = { ...newList("demo", "usual", "Wednesday trip", ["b"], 2), usedAt: [SUNDAY + 3 * DAY] };
    const lists = withDraft([sunday, wednesday], "demo");
    expect(predictUsual(lists, SUNDAY + 14 * DAY)?.name).toBe("Sunday trip");
    expect(predictUsual(lists, SUNDAY + 17 * DAY)?.name).toBe("Wednesday trip");
    expect(predictUsual(lists, SUNDAY + 15 * DAY)?.name).toBe("Sunday trip"); // Monday: nobody's day → most recently used
    expect(predictUsual(withDraft([], "demo"))).toBeUndefined();
  });

  test("import merges by id, never a draft", () => {
    const l = withDraft([], "demo");
    const merged = mergeImported(l, [{ id: "x", name: "From phone", items: ["tea"], kind: "saved" }, { id: "d", name: "Draft", items: ["z"], kind: "draft" }, { bad: true }]);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ id: "x", kind: "saved", items: ["tea"] });
  });
});
