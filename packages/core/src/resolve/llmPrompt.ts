// The LLM layer's prompt, output schema and parser, shared by every
// provider (local Ollama, the Anthropic worker) so they return one shape.

import type { ItemTag } from "../types.ts";

export const LLM_TAGS: readonly ItemTag[] = ["frozen", "chilled", "heavy", "fragile", "produce"];

export const LLM_SYSTEM = `You classify grocery shopping list items for an in-store navigation app.
For each item pick the department it is shelved in at a large US supermarket, from the given list only.
Use null for things a supermarket does not sell (gifts, services, nonsense). Keep confidence honest:
0.9 when the department is obvious, 0.6 when it could be in two places, 0.3 when guessing.
Tags: frozen (freezer case), chilled (refrigerated), heavy (bulk, > 3 kg), fragile (eggs, chips, bread, glass), produce (fresh fruit and veg).
Answer with JSON only.`;

export function llmUserMessage(items: string[], departments: string[]): string {
  return `Departments: ${departments.join(", ")}\nItems:\n${items.map((i) => `- ${i}`).join("\n")}\nReturn {"results": [...]} with one entry per item, in order.`;
}

/** JSON schema of the answer; `department` is an enum of this store's departments plus null. */
export function llmResultSchema(departments: string[]) {
  return {
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
            tags: { type: "array", items: { type: "string", enum: [...LLM_TAGS] } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
  } as const;
}

/** One answer per item, the wire shape both providers return. */
export interface LlmWire {
  item: string;
  department: string | null;
  subcategory?: string;
  canonicalName?: string;
  tags?: ItemTag[];
  confidence: number; // banded .5–.7, or 0 when not placeable
}

/**
 * Map a raw model answer back onto the items (by lowercase item text, then by
 * position), drop departments the store does not have, band confidence into
 * the resolver's llm range. Tolerant of partial answers: every item gets a row.
 */
export function parseLlmResults(raw: unknown, items: string[], departments: string[]): LlmWire[] {
  const results = (raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results) ? (raw as { results: unknown[] }).results : []) as Partial<LlmWire>[];
  const byItem = new Map<string, Partial<LlmWire>>();
  results.forEach((g) => {
    if (g && typeof g.item === "string") byItem.set(g.item.trim().toLowerCase(), g);
  });
  return items.map((item, i) => {
    const g = byItem.get(item.trim().toLowerCase()) ?? (results[i] && typeof results[i] === "object" && !results[i].item ? results[i] : undefined);
    if (!g || typeof g.department !== "string" || !departments.includes(g.department)) return { item, department: null, confidence: 0 };
    const c = typeof g.confidence === "number" && Number.isFinite(g.confidence) ? g.confidence : 0.5;
    return {
      item,
      department: g.department,
      subcategory: typeof g.subcategory === "string" && g.subcategory ? g.subcategory : undefined,
      canonicalName: typeof g.canonicalName === "string" && g.canonicalName ? g.canonicalName : undefined,
      tags: Array.isArray(g.tags) ? g.tags.filter((t): t is ItemTag => (LLM_TAGS as readonly string[]).includes(t as string)) : [],
      confidence: 0.5 + 0.2 * Math.max(0, Math.min(1, c)),
    };
  });
}
