import { describe, expect, test } from "vitest";
import { ollamaProvider, OLLAMA_DEFAULT_MODEL, OLLAMA_MODEL, PROVIDER, providerFor, toGuessMap, workerProvider } from "../src/lib/resolver.ts";

// a developer's .env.local may override the model and the URL; the tests respect it
const MODEL = (import.meta.env as Record<string, string | undefined>).VITE_OLLAMA_MODEL ?? OLLAMA_DEFAULT_MODEL;

const depts = ["dairy", "dry", "household"];
const answer = { results: [{ name: "oat milk", dept: "dairy", sub: "plant milk", conf: 0.9 }, { name: "ghee", dept: null, sub: "", conf: 0.2 }] };

describe("llm providers", () => {
  test("default provider is ollama; the default model is qwen3:8b unless .env overrides it", () => {
    expect(PROVIDER).toBe("ollama");
    expect(OLLAMA_DEFAULT_MODEL).toBe("qwen3:8b");
    expect(OLLAMA_MODEL).toBe(MODEL);
  });

  test("ollama: strict JSON format, no thinking, one call; parsed into the shared shape", async () => {
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const fake = (async (url: RequestInfo | URL, init?: RequestInit) => {
      sent = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ message: { content: JSON.stringify(answer) } }), { status: 200 });
    }) as typeof fetch;
    const rows = await ollamaProvider(fake).classify(["oat milk", "ghee"], depts);
    expect(sent!.url).toMatch(/\/api\/chat$/);
    expect(sent!.body.model).toBe(MODEL);
    expect(sent!.body.think).toBe(false);
    expect(sent!.body.stream).toBe(false);
    expect(sent!.body.keep_alive).toBe("24h");
    expect((sent!.body.options as { num_predict: number }).num_predict).toBe(32 + 45 * 2);
    const schema = sent!.body.format as { properties: { results: { items: { required: string[] } } } };
    expect(schema.properties.results.items.required).toEqual(["name", "dept", "sub", "conf", "tags"]);
    expect(rows[0]).toMatchObject({ item: "oat milk", department: "dairy", subcategory: "plant milk", tags: ["chilled"] });
    expect(rows[0].confidence).toBeCloseTo(0.68, 5);
    expect(rows[1]).toMatchObject({ item: "ghee", department: null, confidence: 0 });
    const map = toGuessMap(rows);
    expect(map.get("oat milk")?.department).toBe("dairy");
    expect(map.get("ghee")).toBeNull();
  });

  test("ollama: warmUp loads the model with keep_alive and never throws", async () => {
    let sent: Record<string, unknown> | null = null;
    const fake = (async (_: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await ollamaProvider(fake).warmUp!();
    expect(sent).toMatchObject({ model: MODEL, messages: [], keep_alive: "24h" });
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(ollamaProvider(down).warmUp!()).resolves.toBeUndefined();
  });

  test("ollama: isLoaded reads /api/ps; a cold start gets the long timeout", async () => {
    const ps = (async (url: RequestInfo | URL) => (/\/api\/ps$/.test(String(url)) ? new Response(JSON.stringify({ models: [{ name: MODEL }] })) : new Response("{}"))) as typeof fetch;
    expect(await ollamaProvider(ps).isLoaded!()).toBe(true);
    const empty = (async () => new Response(JSON.stringify({ models: [] }))) as typeof fetch;
    expect(await ollamaProvider(empty).isLoaded!()).toBe(false);
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await ollamaProvider(down).isLoaded!()).toBe(true); // unknown → assume loaded, the normal timeout applies
    // a slow answer that beats the cold timeout but not the normal one
    const slow = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((res, rej) => {
        const t = setTimeout(() => res(new Response(JSON.stringify({ message: { content: JSON.stringify({ results: [] }) } }))), 60);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          rej(new DOMException("aborted", "AbortError"));
        });
      })) as typeof fetch;
    await expect(ollamaProvider(slow, 20, 200).classify(["a"], depts)).rejects.toThrow();
    await expect(ollamaProvider(slow, 20, 200).classify(["a"], depts, { coldStart: true })).resolves.toHaveLength(1);
  });

  test("ollama failures reject: unreachable, timeout, bad JSON, non-JSON content", async () => {
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(ollamaProvider(down).classify(["a"], depts)).rejects.toThrow();
    const slow = ((_: unknown, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    await expect(ollamaProvider(slow, 20).classify(["a"], depts)).rejects.toThrow();
    const garbage = (async () => new Response("<html>", { status: 200 })) as typeof fetch;
    await expect(ollamaProvider(garbage).classify(["a"], depts)).rejects.toThrow();
    const notJson = (async () => new Response(JSON.stringify({ message: { content: "sure! here you go" } }), { status: 200 })) as typeof fetch;
    await expect(ollamaProvider(notJson).classify(["a"], depts)).rejects.toThrow(/not JSON/);
  });

  test("worker: the rows come through unchanged; a degraded answer throws so nothing is cached", async () => {
    let url = "";
    const fake = (async (u: RequestInfo | URL) => {
      url = String(u);
      return new Response(JSON.stringify({ results: [{ item: "oat milk", department: "dairy", subcategory: "plant milk", tags: ["chilled"], confidence: 0.66 }] }), { status: 200 });
    }) as typeof fetch;
    const rows = await workerProvider(fake, "https://w.example/").classify(["oat milk"], depts);
    expect(url).toBe("https://w.example/resolve");
    expect(rows[0]).toMatchObject({ department: "dairy", confidence: 0.66 });
    const degraded = (async () => new Response(JSON.stringify({ results: [{ item: "oat milk", department: null, confidence: 0 }], degraded: true }), { status: 200 })) as typeof fetch;
    await expect(workerProvider(degraded).classify(["oat milk"], depts)).rejects.toThrow(/degraded/);
  });

  test("providerFor follows the settings: provider, URL and model", async () => {
    let sent: { url: string; model?: string } | null = null;
    const fake = (async (u: RequestInfo | URL, init?: RequestInit) => {
      sent = { url: String(u), model: init?.body ? (JSON.parse(String(init.body)) as { model?: string }).model : undefined };
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ results: [] }) }, results: [] }));
    }) as typeof fetch;
    const o = providerFor({ provider: "ollama", ollamaUrl: "http://10.0.0.9:11434/", model: "qwen3:14b", workerUrl: "/api" }, fake);
    expect(o.name).toBe("ollama");
    await o.classify(["a"], depts);
    expect(sent).toEqual({ url: "http://10.0.0.9:11434/api/chat", model: "qwen3:14b" });
    const w = providerFor({ provider: "worker", ollamaUrl: "http://localhost:11434", model: "qwen3:8b", workerUrl: "https://r.example" }, fake);
    expect(w.name).toBe("worker");
    await w.classify(["a"], depts);
    expect(sent!.url).toBe("https://r.example/resolve");
  });
});
