import { describe, expect, test } from "vitest";
import { classifierFor, createApp } from "../src/index.ts";
import { buildTool, classify, type Guess } from "../src/classify.ts";
import { classifyOllama, dishesOllama, probeOllama } from "../src/ollama.ts";

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

  test("POST /dishes: one local-model call a dish through the gate, unanswered dishes flagged, never Claude", async () => {
    const env = { PROVIDER: "ollama", OLLAMA_UPSTREAM: "https://mac.example.ts.net", OLLAMA_TOKEN: "t0k" };
    const sent: Record<string, unknown>[] = [];
    const line = (name: string) => ({ name, quantity: 1, unit: "piece", optional: false, pantryStaple: false });
    const up = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sent.push({ url: String(url), auth: (init?.headers as Record<string, string>).authorization, ...body });
      const dish = body.messages[1].content as string;
      if (dish.includes("Broken")) return new Response(JSON.stringify({ message: { content: "not json" } }));
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ ingredients: [line(`${dish} thing`)] }) } }));
    }) as typeof fetch;
    const post = (app: ReturnType<typeof createApp>, body: unknown, e: object = env) => app.request("/dishes", { method: "POST", body: JSON.stringify(body) }, e);
    const ok = await post(createApp(undefined, up), { dishes: ["Ratatouille", " ratatouille ", "Moussaka", 3] });
    const json = (await ok.json()) as { results: { dish: string; ingredients: { name: string }[] | null }[]; degraded?: boolean };
    expect(json.degraded).toBeUndefined();
    expect(json.results.map((r) => [r.dish, r.ingredients?.[0].name])).toEqual([
      ["Ratatouille", "Dish: Ratatouille thing"],
      ["ratatouille", "Dish: ratatouille thing"],
      ["Moussaka", "Dish: Moussaka thing"],
    ]);
    expect(sent[0]).toMatchObject({ url: "https://mac.example.ts.net/api/chat", auth: "Bearer t0k", model: "qwen3:8b", think: false, stream: false, format: { required: ["ingredients"] } });
    // a dish the model botched is unanswered, the rest stand
    const partial = (await (await post(createApp(undefined, up), { dishes: ["Broken pie", "Moussaka"] })).json()) as typeof json;
    expect(partial).toMatchObject({ degraded: true, results: [{ dish: "Broken pie", ingredients: null }, { dish: "Moussaka" }] });
    // the Mac asleep: every dish unanswered, none waiting on another
    const gone = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const asleep = (await (await post(createApp(undefined, gone), { dishes: ["A", "B", "C"] })).json()) as typeof json;
    expect(asleep).toEqual({ degraded: true, results: [{ dish: "A", ingredients: null }, { dish: "B", ingredients: null }, { dish: "C", ingredients: null }] });
    // the dishes are asked at once: a slow one does not hold up the others
    const started: number[] = [];
    const slowFirst = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      started.push(Date.now());
      const dish = JSON.parse(String(init?.body)).messages[1].content as string;
      await new Promise((r) => setTimeout(r, dish.includes("Slow") ? 300 : 10));
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ ingredients: [{ name: dish, amount: "1 piece" }] }) } }));
    }) as typeof fetch;
    const t0 = Date.now();
    const both = await dishesOllama({ url: "https://m", token: "t" }, ["Slow stew", "Quick salad"], slowFirst);
    expect(Math.max(...started) - t0).toBeLessThan(50);
    expect(both.map((r) => r.ingredients?.[0])).toEqual([
      { name: "Dish: Slow stew", quantity: 1, unit: "piece", optional: false, pantryStaple: false },
      { name: "Dish: Quick salad", quantity: 1, unit: "piece", optional: false, pantryStaple: false },
    ]);
    // no time left: unanswered
    expect(await dishesOllama({ url: "https://m", token: "t" }, ["A", "B"], up, 0)).toEqual([{ dish: "A", ingredients: null }, { dish: "B", ingredients: null }]);
    // local only: the anthropic provider never answers a dish, and no request leaves
    sent.length = 0;
    expect(await (await post(createApp(undefined, up), { dishes: ["A"] }, { PROVIDER: "anthropic", ANTHROPIC_API_KEY: "x" })).json()).toEqual({ degraded: true, results: [{ dish: "A", ingredients: null }] });
    expect(sent).toHaveLength(0);
    // caps and shape
    expect((await post(createApp(undefined, up), { dishes: "Ratatouille" })).status).toBe(400);
    expect((await post(createApp(undefined, up), { dishes: ["x".repeat(5000)] })).status).toBe(413);
    const many = (await (await post(createApp(undefined, up), { dishes: Array.from({ length: 12 }, (_, i) => `Dish ${i} ${"y".repeat(80)}`) })).json()) as typeof json;
    expect(many.results).toHaveLength(6);
    expect(many.results[0].dish).toHaveLength(60);
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

describe("POST /waitlist", () => {
  const rows: unknown[][] = [];
  // like D1 with UNIQUE (email, list): a repeat changes nothing
  const db = {
    prepare: () => ({
      bind: (...v: unknown[]) => ({
        run: async () => {
          if (rows.some((r) => r[0] === v[0] && r[1] === v[1])) return { meta: { changes: 0 } };
          rows.push(v);
          return { meta: { changes: 1 } };
        },
      }),
    }),
  };
  const verify = (ok: boolean) => (async () => new Response(JSON.stringify({ success: ok }))) as unknown as typeof fetch;
  const post = (app: ReturnType<typeof createApp>, body: unknown, env: Record<string, unknown>, origin = "https://grosher.pages.dev") =>
    app.request("/waitlist", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin } }, env);
  const env = { TURNSTILE_SECRET: "s", WAITLIST: db };

  test("stores the address, lower-cased, once per list; a repeat gets the very same answer, status and time", async () => {
    const app = createApp(undefined, verify(true), 120);
    const timed = async (body: unknown) => {
      const t0 = Date.now();
      const r = await post(app, body, env);
      return { status: r.status, text: await r.text(), ms: Date.now() - t0 };
    };
    const first = await timed({ email: "  Shopper@Example.com ", token: "t", list: "pilot" });
    expect(rows.at(-1)!.slice(0, 2)).toEqual(["shopper@example.com", "pilot"]);
    const repeat = await timed({ email: "SHOPPER@example.com", token: "t", list: "pilot" });
    expect(rows.filter((r) => r[0] === "shopper@example.com" && r[1] === "pilot")).toHaveLength(1);
    // identical: status and body byte for byte, and both held to the floor (no faster answer for a repeat)
    expect(repeat.status).toBe(first.status);
    expect(repeat.status).toBe(200);
    expect(repeat.text).toBe(first.text);
    expect(JSON.parse(first.text)).toEqual({ ok: true });
    expect(first.ms).toBeGreaterThanOrEqual(115);
    expect(repeat.ms).toBeGreaterThanOrEqual(115);
    // the other list is a separate sign-up
    await post(app, { email: "shopper@example.com", token: "t", list: "updates" }, env);
    expect(rows.filter((r) => r[0] === "shopper@example.com")).toHaveLength(2);
  });

  test("refuses a bad address, a missing or failed check, a foreign origin, too many tries, and runs only when configured", async () => {
    const ok = createApp(undefined, verify(true), 0);
    expect((await post(ok, { email: "not an email", token: "t" }, env)).status).toBe(400);
    expect((await post(ok, { email: "a@b.co" }, env)).status).toBe(400);
    expect((await post(createApp(undefined, verify(false)), { email: "a@b.co", token: "t" }, env)).status).toBe(403);
    expect((await post(ok, { email: "a@b.co", token: "t" }, env, "https://evil.example")).status).toBe(403);
    expect((await post(ok, { email: "a@b.co", token: "t" }, { ...env, WAITLIST_LIMITER: { limit: async () => ({ success: false }) } })).status).toBe(429);
    expect((await post(ok, { email: "a@b.co", token: "t" }, { WAITLIST: db })).status).toBe(503);
    expect((await post(ok, { email: "a@b.co", token: "t" }, env, "http://localhost:4173")).status).toBe(200);
  });
});
