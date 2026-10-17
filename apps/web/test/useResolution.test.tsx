import { beforeEach, describe, expect, test } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { demoSupercenter } from "@grosher/stores";
import { useResolution } from "../src/lib/useResolution.ts";
import { dbClearMemoryFallback } from "../src/lib/db.ts";
import { loadLearning } from "../src/lib/learning.ts";

beforeEach(() => dbClearMemoryFallback());

describe("learning loop", () => {
  test("an llm answer becomes a pending catalog entry that resolves offline next time", async () => {
    const { result, unmount } = renderHook(() => useResolution(demoSupercenter, ["oat milk", "birthday card"]));
    await waitFor(() => expect(result.current.results.map((r) => r.source)).toEqual(["llm", "unknown"]), { timeout: 3000 });
    expect(result.current.results[0].locationIds.length).toBeGreaterThan(0);
    expect(result.current.results[0].tags).toEqual(["chilled"]);
    await waitFor(async () => expect((await loadLearning("demo-supercenter")).pending).toHaveLength(1));
    unmount();
    // a fresh hook with the network gone still resolves it from the pending entry
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    try {
      const again = renderHook(() => useResolution(demoSupercenter, ["Oat Milk"]));
      await waitFor(() => expect(again.result.current.results[0]?.source).toBe("llm"), { timeout: 3000 });
      expect(again.result.current.results[0].confidence).toBe(0.6);
      again.unmount();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("Got it confirms, Not here demotes until the item is re-asked, Pick aisle promotes to the catalog", async () => {
    const { result } = renderHook(() => useResolution(demoSupercenter, ["ghee"]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(result.current.results[0]?.source).toBe("unknown"), { timeout: 3000 });
    act(() => result.current.place("ghee", "A1-20"));
    await waitFor(() => expect(result.current.results[0]?.source).toBe("memory"), { timeout: 3000 });
    expect(result.current.results[0].confidence).toBe(0.9);
    act(() => result.current.gotIt("ghee", "A1-20"));
    await waitFor(() => expect(result.current.memory[0].confirms).toBe(2));
    expect(result.current.memory[0].confidence).toBeCloseTo(0.95, 5);
    act(() => {
      result.current.notHere("ghee");
      result.current.notHere("ghee");
    });
    await waitFor(() => expect(result.current.results[0]?.source).toBe("unknown"), { timeout: 3000 }); // .35 < .6: re-asks
    act(() => result.current.place("ghee", "A2-8", undefined, true));
    await waitFor(() => expect(result.current.catalog.some((s) => s.id === "mem:ghee" && s.source === "memory")).toBe(true));
    await waitFor(() => expect(result.current.results[0]?.locationIds).toEqual(["A2-8"]), { timeout: 3000 });
  });
});
