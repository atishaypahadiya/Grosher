import { describe, expect, test } from "vitest";
import { createApp } from "../src/index.ts";
import { buildTool, classify, type Guess } from "../src/classify.ts";

describe("resolver worker", () => {
  test("POST /resolve validates and returns the classifier's guesses", async () => {
    const app = createApp(async ({ items, departments }) => items.map((item): Guess => ({ item, department: departments[0], subcategory: "x", confidence: 0.6 })));
    const res = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: ["oat milk", "ghee"], departments: ["dairy", "dry"] }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Guess[] };
    expect(body.results.map((g) => g.item)).toEqual(["oat milk", "ghee"]);
    expect(body.results[0].department).toBe("dairy");
    const bad = await app.request("/resolve", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
    const notJson = await app.request("/resolve", { method: "POST", body: "nope" });
    expect(notJson.status).toBe(400);
  });

  test("caps, origin check, rate limit and generic errors", async () => {
    let seen: string[] = [];
    const app = createApp(async ({ items }) => {
      seen = items;
      return items.map((item) => ({ item, department: null, confidence: 0 }));
    });
    const many = Array.from({ length: 80 }, (_, i) => `item ${i} ${"x".repeat(100)}`);
    const res = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: many, departments: ["dairy"] }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(413); // over the body cap
    const some = Array.from({ length: 50 }, (_, i) => `item ${i}`);
    const res2 = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: some, departments: ["dairy"] }), headers: { "content-type": "application/json" } });
    expect(res2.status).toBe(200);
    expect(seen).toHaveLength(40);
    // origin enforced when configured
    const env = { ANTHROPIC_API_KEY: "x", ALLOWED_ORIGIN: "https://grosher.app" };
    const bad = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: ["a"], departments: ["dairy"] }), headers: { origin: "https://evil.example" } }, env);
    expect(bad.status).toBe(403);
    const good = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: ["a"], departments: ["dairy"] }), headers: { origin: "https://grosher.app" } }, env);
    expect(good.status).toBe(200);
    // rate limiter binding
    const limited = await app.request("/resolve", { method: "POST", body: JSON.stringify({ items: ["a"], departments: ["dairy"] }) }, { ANTHROPIC_API_KEY: "x", RATE_LIMITER: { limit: async () => ({ success: false }) } });
    expect(limited.status).toBe(429);
    // upstream failures never leak their text
    const failing = createApp(async () => {
      throw new Error("sk-ant-secret leaked in message");
    });
    const err = await failing.request("/resolve", { method: "POST", body: JSON.stringify({ items: ["a"], departments: ["dairy"] }) });
    expect(err.status).toBe(500);
    expect(await err.text()).not.toMatch(/sk-ant/);
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
                  { item: "oat milk", department: "dairy", subcategory: "plant milk", canonicalName: "Oat milk", tags: ["chilled", "bogus"], confidence: 1 },
                  { item: "ghee", department: "international", subcategory: "", canonicalName: "", tags: [], confidence: 0.5 },
                  { item: "birthday card", department: null, subcategory: "", canonicalName: "", tags: [], confidence: 0.9 },
                ],
              },
            },
          ],
        }),
      },
    } as unknown as import("@anthropic-ai/sdk").default;
    const out = await classify(fake, { items: ["oat milk", "ghee", "birthday card", "oat milk"], departments: ["dairy", "dry"] });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ department: "dairy", subcategory: "plant milk", canonicalName: "Oat milk", tags: ["chilled"], confidence: 0.7 });
    expect(out[1].department).toBeNull(); // not one of this store's departments
    expect(out[2].department).toBeNull();
    const tool = buildTool(["dairy", "dry"]);
    expect(tool.strict).toBe(true);
    expect((tool.input_schema as { properties: { results: { items: { properties: { department: { enum: unknown[] } } } } } }).properties.results.items.properties.department.enum).toEqual(["dairy", "dry", null]);
  });
});
