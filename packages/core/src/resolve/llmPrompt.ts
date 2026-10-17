// The LLM layer's prompt, output schema and parser, shared by every
// provider (local Ollama, the Anthropic worker) so they return one shape.
// The model picks one of the store's ~300 shelf categories per item. The
// category list lives in the system message so it is a constant prefix
// (Ollama caches it after the first call); the user message is only the
// items. The schema is terse on purpose: {name, cat, sub, conf, tags}
// keeps a local model under ~30 output tokens per item.

import type { ItemTag } from "../types.ts";

export const LLM_TAGS: readonly ItemTag[] = ["frozen", "chilled", "heavy", "fragile", "produce"];

/** what the provider needs to know about a category: its id and the name on the sign */
export interface LlmCategoryOption {
  id: string;
  name: string;
}

export const LLM_RULES = `Classify grocery list items by the shelf category they are found in at this store.
Reply with JSON only: {"results":[{"name":"<item as given>","cat":"<category id or null>","sub":"<shelf category, 3 words max>","conf":<0..1>,"tags":[]}]}.
cat must be one of the category ids listed; null for things this store does not sell.
conf: 0.9 obvious, 0.6 could be two places, 0.3 guessing.
tags, usually empty: frozen (freezer case), chilled (fridge), heavy (over 3 kg), fragile (eggs, chips, glass), produce (fresh fruit or veg).`;

/** the system message: the rules and then the category list, one "id: name" per line */
export function llmSystemPrompt(categories: LlmCategoryOption[]): string {
  return `${LLM_RULES}\ncategories (id: name):\n${categories.map((c) => `${c.id}: ${c.name}`).join("\n")}`;
}

/** @deprecated the rules alone; providers use llmSystemPrompt(categories) */
export const LLM_SYSTEM = LLM_RULES;

export function llmUserMessage(items: string[]): string {
  return `items:\n${items.map((i) => `- ${i}`).join("\n")}`;
}

/** JSON schema of the answer; `cat` is an enum of this store's category ids plus null. */
export function llmResultSchema(categoryIds: string[]) {
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
          required: ["name", "cat", "sub", "conf", "tags"],
          properties: {
            name: { type: "string" },
            cat: { type: ["string", "null"], enum: [...categoryIds, null] },
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

/** Handling tags implied by a department, for a category that carries none. */
export function tagsForDepartment(dept: string | undefined): ItemTag[] {
  switch (dept) {
    case "dairy":
    case "meat":
    case "deli":
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
  /** the category id chosen, null when not placeable */
  category: string | null;
  subcategory?: string;
  canonicalName?: string;
  tags?: ItemTag[];
  confidence: number; // banded .5–.7, or 0 when not placeable
}

const titleCase = (s: string) => s.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase());
const threeWords = (s: string) => s.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 3).join(" ");

/**
 * Map a raw model answer back onto the items (by lowercase name, then by
 * position), drop categories the store does not have, band confidence into
 * the wire range. Tolerant of partial answers: every item gets a row.
 */
export function parseLlmResults(raw: unknown, items: string[], categoryIds: string[]): LlmWire[] {
  type Row = { name?: unknown; cat?: unknown; sub?: unknown; conf?: unknown; tags?: unknown };
  const results = (raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results) ? (raw as { results: unknown[] }).results : []) as Row[];
  const byName = new Map<string, Row>();
  results.forEach((g) => {
    if (g && typeof g.name === "string") byName.set(g.name.trim().toLowerCase(), g);
  });
  const known = new Set(categoryIds);
  return items.map((item, i) => {
    const g = byName.get(item.trim().toLowerCase()) ?? (results[i] && typeof results[i] === "object" && typeof results[i].name !== "string" ? results[i] : undefined);
    if (!g || typeof g.cat !== "string" || !known.has(g.cat)) return { item, category: null, confidence: 0 };
    const c = typeof g.conf === "number" && Number.isFinite(g.conf) ? g.conf : 0.5;
    const modelTags = Array.isArray(g.tags) ? (g.tags.filter((t): t is ItemTag => (LLM_TAGS as readonly string[]).includes(t as string)) as ItemTag[]) : [];
    return {
      item,
      category: g.cat,
      subcategory: typeof g.sub === "string" && g.sub.trim() ? threeWords(g.sub) : undefined,
      canonicalName: titleCase(item),
      tags: modelTags.length ? [...new Set(modelTags)] : undefined,
      confidence: 0.5 + 0.2 * Math.max(0, Math.min(1, c)),
    };
  });
}
