import { describe, expect, test } from "vitest";
import { classifierFor, createApp } from "../src/index.ts";
import { buildTool, classify, type Guess } from "../src/classify.ts";
import { classifyOllama, probeOllama } from "../src/ollama.ts";

describe("resolver worker", () => {
  test("POST /resolve validates and returns the classifier's guesses", async () => {
    const app = createApp(async ({ items, categories }) => items.map((item): Guess => ({ item, category: categories[0].id, subcategory: "x", confidence: 0.6 })));
    const res = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: ["oat milk", "ghee"], categories: [{ id: "dairy", name: "Dairy" }, { id: "dry", name: "Dry goods" }] }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Guess[] };
    expect(body.results.map((g) => g.item)).toEqual(["oat milk", "ghee"]);
    expect(body.results[0].category).toBe("dairy");
    const bad = await app.request("/resolve", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
    const notJson = await app.request("/resolve", { method: "POST", body: "nope" });
    expect(notJson.status).toBe(400);
  });

  test("caps, origin check, rate limit and generic errors", async () => {
    let seen: string[] = [];
    const app = createApp(async ({ items }) => {
      seen = items;
      return items.map((item) => ({ item, category: null, confidence: 0 }));
    });
    const many = Array.from({ length: 500 }, (_, i) => `item ${i} ${"x".repeat(120)}`); // ~64 KB, over the 48 KB body cap
    const res = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: many, categories: [{ id: "dairy", name: "Dairy" }] }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(413); // over the body cap
    const some = Array.from({ length: 50 }, (_, i) => `item ${i}`);
    const res2 = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: some, categories: [{ id: "dairy", name: "Dairy" }] }), headers: { "content-type": "application/json" } });
    expect(res2.status).toBe(200);
    expect(seen).toHaveLength(40);
    // origin enforced when configured
    const env = { ANTHROPIC_API_KEY: "x", ALLOWED_ORIGIN: "https://grosher.app" };
    const bad = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: ["a"], categories: [{ id: "dairy", name: "Dairy" }] }), headers: { origin: "https://evil.example" } }, env);
    expect(bad.status).toBe(403);
    const good = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: ["a"], categories: [{ id: "dairy", name: "Dairy" }] }), headers: { origin: "https://grosher.app" } }, env);
    expect(good.status).toBe(200);
    // rate limiter binding
    const limited = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: ["a"], categories: [{ id: "dairy", name: "Dairy" }] }) }, { ANTHROPIC_API_KEY: "x", RATE_LIMITER: { limit: async () => ({ success: false }) } });
    expect(limited.status).toBe(429);
    // an upstream failure degrades to unknown rows with a flag, never an error, and never its text
    const failing = createApp(async () => {
      throw new Error("sk-ant-secret leaked in message");
    });
    const err = await failing.request("/resolve", { method: "POST", body: JSON.stringify({ items: ["a", "b"], categories: [{ id: "dairy", name: "Dairy" }] }) });
    expect(err.status).toBe(200);
    const text = await err.text();
    expect(text).not.toMatch(/sk-ant/);
    expect(JSON.parse(text)).toEqual({ results: [{ item: "a", category: null, confidence: 0 }, { item: "b", category: null, confidence: 0 }], degraded: true });
  });

  test("ollama upstream: bearer token, terse schema, parsed rows; a missing secret degrades", async () => {
    let sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
    const fake = (async (url: RequestInfo | URL, init?: RequestInit) => {
      sent = { url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ results: [{ name: "oat milk", cat: "dairy", sub: "plant milk", conf: 0.9, tags: ["chilled"] }] }) } }));
    }) as typeof fetch;
    const rows = await classifyOllama({ url: "https://tunnel.example/", token: "t0k", model: "qwen3:8b" }, { items: ["oat milk"], categories: [{ id: "dairy", name: "Dairy" }, { id: "dry", name: "Dry goods" }] }, fake);
    expect(sent!.url).toBe("https://tunnel.example/api/chat");
    expect(sent!.headers.authorization).toBe("Bearer t0k");
    expect(sent!.body).toMatchObject({ model: "qwen3:8b", think: false, stream: false, keep_alive: "24h", options: { temperature: 0, num_predict: 32 + 45 } });
    expect(rows[0]).toMatchObject({ item: "oat milk", category: "dairy", subcategory: "plant milk", tags: ["chilled"] });
    expect((sent!.body.messages as { content: string }[])[0].content).toMatch(/dairy: Dairy/);
    // the worker picks the upstream from the env; secrets missing → the request degrades
    const env = { PROVIDER: "ollama", OLLAMA_UPSTREAM: "https://tunnel.example", OLLAMA_TOKEN: "t0k" };
    await expect(classifierFor(env, fake)({ items: ["oat milk"], categories: [{ id: "dairy", name: "Dairy" }] })).resolves.toHaveLength(1);
    const app = createApp();
    const res = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: ["a"], categories: [{ id: "dairy", name: "Dairy" }] }) }, { PROVIDER: "ollama" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { degraded?: boolean }).degraded).toBe(true);
    const health = await app.request("/health", {}, { PROVIDER: "ollama" });
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ ok: false, provider: "ollama", degraded: true, reason: "OLLAMA_UPSTREAM or OLLAMA_TOKEN not set" });
    // upstream 502 / non-JSON content reject (→ degraded at the route)
    const bad = (async () => new Response("nope", { status: 502 })) as typeof fetch;
    await expect(classifyOllama({ url: "https://t", token: "x" }, { items: ["a"], categories: [{ id: "dairy", name: "Dairy" }] }, bad)).rejects.toThrow(/502/);
    const prose = (async () => new Response(JSON.stringify({ message: { content: "sure thing" } }))) as typeof fetch;
    await expect(classifyOllama({ url: "https://t", token: "x" }, { items: ["a"], categories: [{ id: "dairy", name: "Dairy" }] }, prose)).rejects.toThrow(/not JSON/);
  });

  test("/health probes the upstream through the gate and degrades with a fixed reason", async () => {
    const env = { PROVIDER: "ollama", OLLAMA_UPSTREAM: "https://mac.example.ts.net/", OLLAMA_TOKEN: "t0k", OLLAMA_MODEL: "qwen3:8b" };
    let seen: { url: string; auth: string } | null = null;
    const up = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(url), auth: (init?.headers as Record<string, string>).authorization };
      return new Response(JSON.stringify({ models: [{ name: "qwen3:8b", model: "qwen3:8b" }] }));
    }) as typeof fetch;
    const ok = await createApp(undefined, up).request("/health", {}, env);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, provider: "ollama", upstream: "ok", model: "qwen3:8b", modelLoaded: true });
    expect(seen).toEqual({ url: "https://mac.example.ts.net/api/ps", auth: "Bearer t0k" });
    const status = (code: number, headers: Record<string, string> = {}) => (async () => new Response("secret upstream text", { status: code, headers })) as typeof fetch;
    const reason = async (f: typeof fetch) => {
      const res = await createApp(undefined, f).request("/health", {}, env);
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).not.toMatch(/secret upstream text/);
      return (JSON.parse(text) as { reason: string }).reason;
    };
    expect(await reason(status(401))).toMatch(/token/);
    expect(await reason(status(502, { "x-grosher-gate": "1" }))).toMatch(/Ollama is not answering/);
    expect(await reason(status(502))).toMatch(/gate is not answering/);
    expect(await reason(status(404))).toMatch(/not point at the gate/);
    expect(await reason((async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch)).toMatch(/unreachable/);
    const slow = (async () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" }))) as typeof fetch;
    expect(await reason(slow)).toMatch(/timed out/);
    // the model not resident is still healthy, and says so
    expect(await probeOllama({ url: "https://m", token: "t" }, (async () => new Response(JSON.stringify({ models: [] }))) as typeof fetch)).toMatchObject({ ok: true, modelLoaded: false });
    // anthropic is not probed (a probe would be a paid call)
    expect(await (await createApp().request("/health", {}, { ANTHROPIC_API_KEY: "x" })).json()).toEqual({ ok: true, provider: "anthropic", upstream: "not probed" });
  });

  test("POST /sign: one photo to the vision model through the gate; degraded, never an error", async () => {
    const env = { PROVIDER: "ollama", OLLAMA_UPSTREAM: "https://mac.example.ts.net", OLLAMA_TOKEN: "t0k", OLLAMA_VISION_MODEL: "qwen2.5vl:7b" };
    const image = "A".repeat(400);
    let sent: Record<string, unknown> | null = null;
    const up = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ words: ["Aisle 12", "Cereal", "Coffee"] }) } }));
    }) as typeof fetch;
    const post = (app: ReturnType<typeof createApp>, body: unknown, e: object = env) => app.request("/sign", { method: "POST", body: JSON.stringify(body) }, e);
    const ok = await post(createApp(undefined, up), { image });
    expect(await ok.json()).toEqual({ words: ["Aisle 12", "Cereal", "Coffee"] });
    expect(sent).toMatchObject({ model: "qwen2.5vl:7b", stream: false, format: { required: ["words"] } });
    expect((sent!.messages as { images: string[] }[])[0].images).toEqual([image]);
    expect((await post(createApp(undefined, up), { image: "data:image/jpeg;base64,xx" })).status).toBe(400);
    expect((await post(createApp(undefined, up), { image: "A".repeat(1_600_000) })).status).toBe(413);
    const down = (async () => new Response("boom", { status: 502 })) as typeof fetch;
    expect(await (await post(createApp(undefined, down), { image })).json()).toEqual({ words: [], degraded: true });
    expect(await (await post(createApp(undefined, up), { image }, { PROVIDER: "anthropic", ANTHROPIC_API_KEY: "x" })).json()).toEqual({ words: [], degraded: true });
  });

  test("classify maps the tool call back onto the items, drops unknown departments, bands confidence", async () => {
    const fake = {
      messages: {
        create: async () => ({
          content: [
            {
              type: "tool_use",
              name: "classify_items",
              id: "t1",
              input: {
                results: [
                  { name: "oat milk", cat: "dairy", sub: "plant based milk alternatives", conf: 1, tags: ["chilled"] },
                  { name: "ghee", cat: "international", sub: "", conf: 0.5 },
                  { name: "birthday card", cat: null, sub: "", conf: 0.9 },
                ],
              },
            },
          ],
        }),
      },
    } as unknown as import("@anthropic-ai/sdk").default;
    const out = await classify(fake, { items: ["oat milk", "ghee", "birthday card", "oat milk"], categories: [{ id: "dairy", name: "Dairy" }, { id: "dry", name: "Dry goods" }] });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ category: "dairy", subcategory: "plant based milk", canonicalName: "Oat milk", tags: ["chilled"] });
    expect(out[0].confidence).toBeCloseTo(0.7, 5);
    expect(out[1].category).toBeNull(); // not one of this store's categories
    expect(out[2].category).toBeNull();
    const tool = buildTool(["dairy", "dry"]);
    expect(tool.strict).toBe(true);
    expect((tool.input_schema as { properties: { results: { items: { properties: { cat: { enum: unknown[] } } } } } }).properties.results.items.properties.cat.enum).toEqual(["dairy", "dry", null]);
  });
});
