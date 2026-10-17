// Node 22+ exposes a stub `localStorage` global that shadows jsdom's and has
// no working methods. Replace it with a small in-memory Storage for tests.
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}
Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true, writable: true });
if (typeof document === "undefined") {
  // the bundle test runs in a plain Node environment; nothing below applies
}

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(cleanup);

// jsdom has no canvas: make the WebGL check return "unavailable" quietly so the flat map is used.
if (typeof HTMLCanvasElement !== "undefined") HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];

// The resolver worker, mocked: a tiny classifier for the llm layer so tests
// never touch the network. Anything else fetched fails fast.
const MOCK_DEPTS: Record<string, { department: string; subcategory: string; tags?: string[] }> = {
  "oat milk": { department: "dairy", subcategory: "plant milk", tags: ["chilled"] },
  "almond milk": { department: "dairy", subcategory: "plant milk", tags: ["chilled"] },
  "dish soap": { department: "household", subcategory: "dish soap" },
  sriracha: { department: "dry", subcategory: "hot sauce" },
  "frozen waffles": { department: "frozen", subcategory: "breakfast", tags: ["frozen"] },
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/\/resolve$/.test(url)) throw new TypeError(`fetch blocked in tests: ${url}`);
  const body = JSON.parse(String(init?.body ?? "{}")) as { items: string[] };
  const results = body.items.map((item) => {
    const g = MOCK_DEPTS[item.trim().toLowerCase()];
    return g ? { item, ...g, canonicalName: item.replace(/\b\w/g, (c) => c.toUpperCase()), confidence: 0.66 } : { item, department: null, confidence: 0 };
  });
  return new Response(JSON.stringify({ results }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
