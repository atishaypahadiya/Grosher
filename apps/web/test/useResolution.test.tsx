import { beforeEach, describe, expect, test } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { demoSupercenter } from "@grosher/stores";
import { useResolution } from "../src/lib/useResolution.ts";
import { dbClearMemoryFallback } from "../src/lib/db.ts";
import { loadLearning } from "../src/lib/learning.ts";

beforeEach(() => dbClearMemoryFallback());

describe("learning loop", () => {
  test("an llm answer becomes a pending catalog entry that resolves offline next time", async () => {
    const { result, unmount } = renderHook(() => useResolution(demoSupercenter, ["ripple milk", "birthday card"]));
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
      const again = renderHook(() => useResolution(demoSupercenter, ["Ripple Milk"]));
      await waitFor(() => expect(again.result.current.results[0]?.source).toBe("llm"), { timeout: 3000 });
      expect(again.result.current.results[0].confidence).toBeCloseTo(0.452, 3); // the guess band: wire .66 → .452
      again.unmount();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("Got it on an llm guess lifts the pending entry out of the guess band; Not here lowers it", async () => {
    const { result } = renderHook(() => useResolution(demoSupercenter, ["ripple milk"]));
    await waitFor(() => expect(result.current.results[0]?.source).toBe("llm"), { timeout: 3000 });
    await waitFor(() => expect(result.current.learning.pending).toHaveLength(1));
    const before = result.current.learning.pending[0].confidence!;
    expect(before).toBeLessThan(0.5);
    act(() => result.current.gotIt("Ripple milk", result.current.results[0].locationIds[0]));
    await waitFor(() => expect(result.current.learning.pending[0].confirms).toBe(1));
    expect(result.current.learning.pending[0].confidence).toBeCloseTo(before + (1 - before) * 0.3, 5);
    act(() => result.current.notHere("ripple milk"));
    await waitFor(() => expect(result.current.learning.pending[0].misses).toBe(1));
    expect(result.current.learning.pending[0].confidence).toBeCloseTo(before + (1 - before) * 0.3 - 0.3, 5);
  });

  test("Got it confirms, Not here demotes until the item is re-asked, Pick aisle promotes to the catalog", async () => {
    const { result } = renderHook(() => useResolution(demoSupercenter, ["ghee"]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    // "ghee" is an alias of the ghee & Indian oils category: the sign places it at likely before anyone asks
    await waitFor(() => expect(result.current.results[0]?.source).toBe("category"), { timeout: 3000 });
    act(() => result.current.place("ghee", "A7-L11"));
    await waitFor(() => expect(result.current.results[0]?.source).toBe("memory"), { timeout: 3000 });
    expect(result.current.results[0].confidence).toBe(0.9);
    act(() => result.current.gotIt("ghee", "A7-L11"));
    await waitFor(() => expect(result.current.memory[0].confirms).toBe(2));
    expect(result.current.memory[0].confidence).toBeCloseTo(0.93, 5); // 30% of the gap
    act(() => {
      result.current.notHere("ghee");
      result.current.notHere("ghee");
    });
    await waitFor(() => expect(result.current.results[0]?.source).toBe("category"), { timeout: 3000 }); // .93 → .63 → .33 < .6: the memory is distrusted, the sign stands
    expect(result.current.memory[0].misses).toBe(2);
    act(() => result.current.place("ghee", "A5-L1", undefined, true));
    await waitFor(() => expect(result.current.catalog.some((s) => s.id === "mem:ghee" && s.source === "memory")).toBe(true));
    await waitFor(() => expect(result.current.results[0]?.locationIds).toEqual(["A5-L1"]), { timeout: 3000 });
  });
});

describe("provider failures", () => {
  test("a dead local model degrades to unknown with the one-line note, never an error", async () => {
    const dead = { name: "ollama" as const, offlineNote: "Local model offline · unknown items need a tap", classify: async () => { throw new TypeError("Failed to fetch"); } };
    const { result } = renderHook(() => useResolution(demoSupercenter, ["milk", "ripple milk"], dead));
    await waitFor(() => expect(result.current.offline).toBe(true), { timeout: 3000 });
    expect(result.current.results.map((r) => r.source)).toEqual(["exact", "unknown"]);
    expect(result.current.offlineNote).toMatch(/local model offline/i);
    expect(result.current.asking).toBe(false);
  });
});
