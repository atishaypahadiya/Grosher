import { describe, expect, test } from "vitest";
import { demoSupercenter } from "@grosher/stores";
import { chipFor } from "../src/lib/chips.ts";

const store = demoSupercenter.store;

describe("the list chip's last is the shelf's storage", () => {
  test("shelf-stable oat milk in A17 drinks is not last, whatever its tags say; the dairy case is", () => {
    expect(chipFor(store, { id: "oat", name: "Oat milk", locationIds: ["A17-R11"], tags: ["chilled"] }).text).toBe("A17 · drinks");
    expect(chipFor(store, { id: "oat", name: "Oat milk", locationIds: ["DAIRY-L5"] }).text).toBe("Dairy · last");
    // the freezer aisle by its shelf, hot food never
    const pizza = demoSupercenter.categories.find((c) => c.id === "frozen-pizza")!.locationId;
    const hot = demoSupercenter.categories.find((c) => c.id === "rotisserie")!.locationId;
    expect(chipFor(store, { id: "p", name: "Frozen pizza", locationIds: [pizza] }).text).toMatch(/· last$/);
    expect(chipFor(store, { id: "r", name: "Rotisserie chicken", locationIds: [hot], tags: ["chilled"] }).text).not.toMatch(/last/);
  });
});
