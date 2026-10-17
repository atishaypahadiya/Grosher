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
