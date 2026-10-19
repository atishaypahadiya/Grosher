// The derived catalog is cached under its key (Grosher's carried rows), and a saved model guess takes its
// shelf's tags on load.

import { beforeEach, expect, test, vi } from "vitest";
import { grosher, demoSupercenter, type StoreBundle } from "@grosher/stores";
import { dbClearMemoryFallback, dbGet } from "../src/lib/db.ts";
import { catalogCacheKey, loadFullCatalog } from "../src/lib/catalogCache.ts";
import { revalidateLearning, type Learning } from "../src/lib/learning.ts";

beforeEach(() => dbClearMemoryFallback());

test("a keyed catalog is derived once, then read from the cache under its key", async () => {
  const load = vi.fn(grosher.loadCatalog);
  const bundle: StoreBundle = { ...grosher, loadCatalog: load };
  const first = await loadFullCatalog(bundle);
  expect(first.source).toBe("loaded");
  expect(first.key).toBe(grosher.catalogKey);
  await vi.waitFor(async () => expect((await dbGet<{ key: string } | null>(catalogCacheKey("grosher"), null))?.key).toBe(grosher.catalogKey));
  const second = await loadFullCatalog(bundle);
  expect(second.source).toBe("cache");
  expect(second.rows.length).toBe(first.rows.length);
  expect(load).toHaveBeenCalledTimes(1);
  // a new key (a regenerated store) derives again
  const third = await loadFullCatalog({ ...bundle, catalogKey: `${grosher.catalogKey}:next` });
  expect(third.source).toBe("loaded");
  // a bundle without a key is loaded as is, never cached
  expect((await loadFullCatalog(demoSupercenter)).source).toBe("loaded");
});

test("a saved model guess takes its shelf's tags on load, not the model's", () => {
  const shelf = grosher.categories.find((c) => c.id === "bulk-pulses")!;
  const saved: Learning = { pending: [{ id: "llm:x", name: "Moong chilka", locationIds: [shelf.locationId], source: "llm", tags: ["heavy", "chilled"], confidence: 0.4 }], llm: [], memory: [], llmVersion: 2 };
  const { learning, report, changed } = revalidateLearning(saved, { locations: new Set(grosher.store.locations.map((l) => l.id)), categories: grosher.categories });
  expect(changed).toBe(true);
  expect(report.pendingRetagged).toEqual(["Moong chilka"]);
  expect(learning.pending[0].tags).toEqual(shelf.tags ?? []);
});
