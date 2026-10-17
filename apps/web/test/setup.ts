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
const MOCK_DEPTS: Record<string, { category: string; subcategory: string; tags?: string[] }> = {
  "oat milk": { category: "milk-alternatives", subcategory: "plant milk", tags: ["chilled"] },
  "almond milk": { category: "milk-alternatives", subcategory: "plant milk", tags: ["chilled"] },
  "ripple milk": { category: "milk-alternatives", subcategory: "plant milk", tags: ["chilled"] },
  "dish soap": { category: "dish-soap", subcategory: "dish soap" },
  sriracha: { category: "hot-sauce", subcategory: "hot sauce" },
  "frozen waffles": { category: "frozen-breakfast", subcategory: "breakfast", tags: ["frozen"] },
  "thai basil chicken kit": { category: "asian-sauces", subcategory: "meal kit" },
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  // the Anthropic worker (already parsed rows)
  if (/\/resolve$/.test(url)) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { items: string[] };
    const results = body.items.map((item) => {
      const g = MOCK_DEPTS[item.trim().toLowerCase()];
      return g ? { item, category: g.category, subcategory: g.subcategory, canonicalName: item.replace(/\b\w/g, (c) => c.toUpperCase()), tags: g.tags ?? [], confidence: 0.66 } : { item, category: null, confidence: 0 };
    });
    return new Response(JSON.stringify({ results }), { status: 200, headers: { "content-type": "application/json" } });
  }
  // a local Ollama: /api/ps says the model is loaded; /api/chat answers in the terse schema inside message.content
  if (/\/api\/ps$/.test(url)) {
    const model = (import.meta.env as Record<string, string | undefined>).VITE_OLLAMA_MODEL ?? "qwen3:8b";
    return new Response(JSON.stringify({ models: [{ name: model, model }] }), { status: 200 });
  }
  if (/\/api\/chat$/.test(url)) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { role: string; content: string }[] };
    if (!body.messages.length) return new Response("{}", { status: 200 }); // warm-up
    const user = body.messages.find((m) => m.role === "user")?.content ?? "";
    const items = [...user.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    const results = items.map((name) => {
      const g = MOCK_DEPTS[name.trim().toLowerCase()];
      return g ? { name, cat: g.category, sub: g.subcategory, conf: 0.8, tags: g.tags ?? [] } : { name, cat: null, sub: "", conf: 0, tags: [] };
    });
    return new Response(JSON.stringify({ message: { role: "assistant", content: JSON.stringify({ results }) }, eval_count: 40 * items.length, eval_duration: 1e9 }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new TypeError(`fetch blocked in tests: ${url}`);
}) as typeof fetch;

// jsdom has no PointerEvent: testing-library then fires a bare Event without coordinates. Give it one.
if (typeof window !== "undefined" && typeof (window as { PointerEvent?: unknown }).PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}
