// One Claude call for the whole list: each item → department + sub-category
// + tags, or null when it is not something a grocery store sells. Pure over
// an injected client, so the worker is testable without the network.

import type Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-haiku-5-5";
export const TAGS = ["frozen", "chilled", "heavy", "fragile", "produce"] as const;
export type Tag = (typeof TAGS)[number];

export interface Guess {
  item: string;
  department: string | null;
  subcategory?: string;
  canonicalName?: string;
  tags?: Tag[];
  confidence: number; // 0.5..0.7
}

export interface ClassifyRequest {
  items: string[];
  departments: string[];
}

const TOOL_NAME = "classify_items";

export function buildTool(departments: string[]): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: "Report, for every item, the grocery department it is shelved in at this store, a short sub-category, a clean canonical name, handling tags, and your confidence.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["results"],
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["item", "department", "subcategory", "canonicalName", "tags", "confidence"],
            properties: {
              item: { type: "string", description: "the item exactly as given" },
              department: { type: ["string", "null"], enum: [...departments, null], description: "one of this store's departments, or null when the item is not sold in a grocery store" },
              subcategory: { type: "string", description: "a two-word shelf category, lowercase, e.g. 'plant milk', 'hot sauce'" },
              canonicalName: { type: "string", description: "the item in plain store wording, e.g. 'Oat milk'" },
              tags: { type: "array", items: { type: "string", enum: [...TAGS] } },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
  };
}

export const SYSTEM = `You classify grocery shopping list items for an in-store navigation app.
For each item pick the department it is shelved in at a large US supermarket, from the given list only.
Use null for things a supermarket does not sell (gifts, services, nonsense). Keep confidence honest:
0.9 when the department is obvious, 0.6 when it could be in two places, 0.3 when guessing.
Tags: frozen (freezer case), chilled (refrigerated), heavy (bulk, > 3 kg), fragile (eggs, chips, bread, glass), produce (fresh fruit and veg).`;

export async function classify(client: Anthropic, req: ClassifyRequest): Promise<Guess[]> {
  const items = [...new Set(req.items.map((s) => s.trim()).filter(Boolean))].slice(0, 100);
  if (!items.length) return [];
  const departments = req.departments.filter(Boolean);
  const tool = buildTool(departments);
  // Haiku 5.5: adaptive thinking is on by default; classification needs little, so effort low.
  // tool_choice stays "auto" with the instruction naming the tool (the 5.5 family rejects forced tool choice).
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM,
    output_config: { effort: "low" },
    tools: [tool],
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    messages: [{ role: "user", content: `Call ${TOOL_NAME} once with every item below.\nDepartments: ${departments.join(", ")}\nItems:\n${items.map((i) => `- ${i}`).join("\n")}` }],
  });
  const use = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!use) return items.map((item) => ({ item, department: null, confidence: 0 }));
  const parsed = use.input as { results: Guess[] };
  const byItem = new Map(parsed.results.map((g) => [g.item.trim().toLowerCase(), g]));
  return items.map((item) => {
    const g = byItem.get(item.toLowerCase());
    if (!g || !g.department || !departments.includes(g.department)) return { item, department: null, confidence: 0 };
    // the resolver's llm layer runs .5–.7: map the model's 0..1 into that band
    const confidence = 0.5 + 0.2 * Math.max(0, Math.min(1, g.confidence));
    return { item, department: g.department, subcategory: g.subcategory || undefined, canonicalName: g.canonicalName || undefined, tags: (g.tags ?? []).filter((t): t is Tag => (TAGS as readonly string[]).includes(t)), confidence };
  });
}
