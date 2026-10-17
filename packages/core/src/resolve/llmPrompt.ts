// The LLM layer's prompt, output schema and parser, shared by every
// provider (local Ollama, the Anthropic worker) so they return one shape.
// The schema is terse on purpose: {name, dept, sub, conf, tags} keeps a local
// model under ~30 output tokens per item.

import type { ItemTag } from "../types.ts";

export const LLM_TAGS: readonly ItemTag[] = ["frozen", "chilled", "heavy", "fragile", "produce"];

export const LLM_SYSTEM = `Classify grocery list items by the supermarket department they are shelved in.
Reply with JSON only: {"results":[{"name":"<item as given>","dept":"<department id or null>","sub":"<shelf category, 3 words max>","conf":<0..1>,"tags":[]}]}.
dept must be one of the given department ids; null for things a supermarket does not sell.
conf: 0.9 obvious, 0.6 could be two places, 0.3 guessing.
tags, usually empty: frozen (freezer case), chilled (fridge), heavy (over 3 kg), fragile (eggs, chips, glass), produce (fresh fruit or veg).`;

export function llmUserMessage(items: string[], departments: string[]): string {
  return `departments: ${departments.join(", ")}\nitems:\n${items.map((i) => `- ${i}`).join("\n")}`;
}

/** JSON schema of the answer; `dept` is an enum of this store's departments plus null. */
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
          required: ["name", "dept", "sub", "conf", "tags"],
          properties: {
            name: { type: "string" },
            dept: { type: ["string", "null"], enum: [...departments, null] },
            sub: { type: "string", maxLength: 40 },
            conf: { type: "number", minimum: 0, maximum: 1 },
            tags: { type: "array", items: { type: "string", enum: [...LLM_TAGS] }, maxItems: 3 },
          },
        },
      },
    },
  } as const;
}

/** Output-token ceiling for a list: ~45 per item plus the envelope (measured ~28 per item with tags). */
export const llmMaxTokens = (itemCount: number) => Math.min(4096, 32 + 45 * itemCount);

/** Handling tags implied by a department, since the terse schema carries none. */
export function tagsForDepartment(dept: string): ItemTag[] {
  switch (dept) {
    case "dairy":
    case "meat":
      return ["chilled"];
    case "frozen":
      return ["frozen"];
    case "produce":
      return ["produce"];
    case "bakery":
      return ["fragile"];
    default:
      return [];
  }
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

const titleCase = (s: string) => s.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase());
const threeWords = (s: string) => s.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 3).join(" ");

/**
 * Map a raw model answer back onto the items (by lowercase name, then by
 * position), drop departments the store does not have, band confidence into
 * the resolver's llm range, derive tags from the department. Tolerant of
 * partial answers: every item gets a row.
 */
export function parseLlmResults(raw: unknown, items: string[], departments: string[]): LlmWire[] {
  type Row = { name?: unknown; dept?: unknown; sub?: unknown; conf?: unknown; tags?: unknown };
  const results = (raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results) ? (raw as { results: unknown[] }).results : []) as Row[];
  const byName = new Map<string, Row>();
  results.forEach((g) => {
    if (g && typeof g.name === "string") byName.set(g.name.trim().toLowerCase(), g);
  });
  return items.map((item, i) => {
    const g = byName.get(item.trim().toLowerCase()) ?? (results[i] && typeof results[i] === "object" && typeof results[i].name !== "string" ? results[i] : undefined);
    if (!g || typeof g.dept !== "string" || !departments.includes(g.dept)) return { item, department: null, confidence: 0 };
    const c = typeof g.conf === "number" && Number.isFinite(g.conf) ? g.conf : 0.5;
    // the model's tags when it gave any valid ones, else what the department implies
    const modelTags = Array.isArray(g.tags) ? (g.tags.filter((t): t is ItemTag => (LLM_TAGS as readonly string[]).includes(t as string)) as ItemTag[]) : [];
    return {
      item,
      department: g.dept,
      subcategory: typeof g.sub === "string" && g.sub.trim() ? threeWords(g.sub) : undefined,
      canonicalName: titleCase(item),
      tags: modelTags.length ? [...new Set(modelTags)] : tagsForDepartment(g.dept),
      confidence: 0.5 + 0.2 * Math.max(0, Math.min(1, c)),
    };
  });
}
