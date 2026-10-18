import { beforeEach, describe, expect, test, vi } from "vitest";
import { ENVELOPE, localKeys, QUARANTINE_LS, unwrap, wrap } from "../src/lib/persist.ts";
import { load, save } from "../src/lib/storage.ts";
import { dbClearMemoryFallback, dbGet, dbKeys, dbSetRaw } from "../src/lib/db.ts";

beforeEach(() => {
  localStorage.clear();
  dbClearMemoryFallback();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const quarantined = () => localKeys().filter((k) => k.startsWith(QUARANTINE_LS));

describe("persisted state: versioned, migrated, quarantined", () => {
  test("values are written in an envelope with the key's version and read back", () => {
    save("grosher.notes", ["Ghee"]);
    expect(JSON.parse(localStorage.getItem("grosher.notes")!)).toEqual({ [ENVELOPE]: 1, v: 1, data: ["Ghee"] });
    expect(load("grosher.notes", [])).toEqual(["Ghee"]);
  });

  test("a bare value from an older build is version 0: migrated, then rewritten in the envelope", () => {
    localStorage.setItem("grosher.flat", "true");
    expect(load("grosher.flat", false)).toBe(true);
    expect(JSON.parse(localStorage.getItem("grosher.flat")!).v).toBe(1);
    // an early trip snapshot without got / skipped / original gets them
    localStorage.setItem("grosher.trip", JSON.stringify({ remaining: ["milk"], positionNodeId: "n1", walkedM: 3 }));
    expect(load("grosher.trip", null)).toMatchObject({ original: ["milk"], got: [], skipped: [], remaining: ["milk"] });
  });

  test("the shape that blanked the live app (notes: 42) is quarantined, not crashed on", () => {
    localStorage.setItem("grosher.notes", "42");
    expect(load("grosher.notes", [])).toEqual([]);
    expect(localStorage.getItem("grosher.notes")).toBeNull();
    expect(quarantined()).toHaveLength(1);
    expect(localStorage.getItem(quarantined()[0])).toBe("42"); // the raw value is kept
  });

  test("corrupt JSON and a version newer than this build are quarantined too", () => {
    localStorage.setItem("grosher.trip", "{oops");
    expect(load("grosher.trip", null)).toBeNull();
    localStorage.setItem("grosher.flat", JSON.stringify({ [ENVELOPE]: 1, v: 9, data: true }));
    expect(load("grosher.flat", false)).toBe(false);
    expect(quarantined()).toHaveLength(2);
    expect(unwrap("grosher.flat", { [ENVELOPE]: 1, v: 9, data: true })).toMatchObject({ ok: false, reason: /newer/ });
  });

  test("IndexedDB: a list with a bad row keeps its good rows; garbage moves to quarantine:*", async () => {
    const good = { id: "l1", name: "Draft", items: ["Milk"], storeId: "s", createdAt: 1, updatedAt: 1, kind: "draft" };
    // written by an older build: bare, one row broken
    await dbSetRaw("lists:s", [good, { id: 3, items: "nope" }]);
    expect(await dbGet("lists:s", [])).toEqual([good]);
    await dbSetRaw("learning:s", "garbage");
    expect(await dbGet("learning:s", { pending: [], llm: [], memory: [] })).toEqual({ pending: [], llm: [], memory: [] });
    expect((await dbKeys()).some((k) => k.startsWith("quarantine:learning:s:"))).toBe(true);
  });

  test("wrap uses the key's schema version", () => {
    expect(wrap("history:s", [])).toEqual({ [ENVELOPE]: 1, v: 1, data: [] });
  });
});

