// The LLM layer's transport: POST the unknown items to the resolver worker.
// VITE_RESOLVER_URL is the worker's base URL ("" / "/api" in dev, where Vite
// proxies /api/resolve to wrangler dev). No key lives here.

import type { LlmGuess } from "@grosher/core";

export interface GuessWire {
  item: string;
  department: string | null;
  subcategory?: string;
  canonicalName?: string;
  tags?: LlmGuess["tags"];
  confidence: number;
}

export const RESOLVER_URL = (import.meta.env.VITE_RESOLVER_URL as string | undefined) ?? "/api";

export async function fetchGuesses(items: string[], departments: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, LlmGuess | null>> {
  const res = await fetchImpl(`${RESOLVER_URL.replace(/\/$/, "")}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items, departments }),
  });
  if (!res.ok) throw new Error(`resolver ${res.status}`);
  const body = (await res.json()) as { results: GuessWire[] };
  const out = new Map<string, LlmGuess | null>();
  for (const g of body.results) {
    const key = g.item.trim().toLowerCase().replace(/\s+/g, " ");
    out.set(key, g.department ? { department: g.department, subcategory: g.subcategory, canonicalName: g.canonicalName, tags: g.tags, confidence: g.confidence } : null);
  }
  return out;
}
