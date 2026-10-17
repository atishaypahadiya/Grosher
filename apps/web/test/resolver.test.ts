import { describe, expect, test } from "vitest";
import { anthropicProvider, ollamaProvider, OLLAMA_MODEL, PROVIDER, toGuessMap } from "../src/lib/resolver.ts";

const depts = ["dairy", "dry", "household"];
const answer = { results: [{ item: "oat milk", department: "dairy", subcategory: "plant milk", canonicalName: "Oat milk", tags: ["chilled"], confidence: 0.9 }, { item: "ghee", department: null, subcategory: "", canonicalName: "", tags: [], confidence: 0.2 }] };

describe("llm providers", () => {
  test("default provider is ollama with qwen3:14b", () => {
    expect(PROVIDER).toBe("ollama");
    expect(OLLAMA_MODEL).toBe("qwen3:14b");
  });

  test("ollama: strict JSON format, no thinking, one call; parsed into the shared shape", async () => {
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const fake = (async (url: RequestInfo | URL, init?: RequestInit) => {
      sent = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ message: { content: JSON.stringify(answer) } }), { status: 200 });
    }) as typeof fetch;
    const rows = await ollamaProvider(fake).classify(["oat milk", "ghee"], depts);
    expect(sent!.url).toMatch(/\/api\/chat$/);
    expect(sent!.body.model).toBe("qwen3:14b");
    expect(sent!.body.think).toBe(false);
    expect(sent!.body.stream).toBe(false);
    expect((sent!.body.format as { properties: unknown }).properties).toBeTruthy();
    expect(rows[0]).toMatchObject({ item: "oat milk", department: "dairy", subcategory: "plant milk", tags: ["chilled"] });
    expect(rows[0].confidence).toBeCloseTo(0.68, 5);
    expect(rows[1]).toMatchObject({ item: "ghee", department: null, confidence: 0 });
    const map = toGuessMap(rows);
    expect(map.get("oat milk")?.department).toBe("dairy");
    expect(map.get("ghee")).toBeNull();
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

  test("anthropic: the worker's rows come through unchanged", async () => {
    const fake = (async () => new Response(JSON.stringify({ results: [{ item: "oat milk", department: "dairy", subcategory: "plant milk", tags: ["chilled"], confidence: 0.66 }] }), { status: 200 })) as typeof fetch;
    const rows = await anthropicProvider(fake).classify(["oat milk"], depts);
    expect(rows[0]).toMatchObject({ department: "dairy", confidence: 0.66 });
  });
});
