// The LLM layer's transport. Two providers behind one interface:
//   ollama    (default) a local model over POST {VITE_OLLAMA_URL}/api/chat,
//             strict JSON via `format`, no thinking, one call for the list
//   anthropic the Cloudflare worker at VITE_RESOLVER_URL (apps/resolver)
// Both use the prompt, schema and parser from @grosher/core, so the app
// caches the same shape whichever answered. Failures throw; the caller
// degrades to "unknown" and shows a one-line note.

import { LLM_SYSTEM, llmResultSchema, llmUserMessage, parseLlmResults, type LlmGuess, type LlmWire } from "@grosher/core";

export type ProviderName = "ollama" | "anthropic";

export interface LlmProvider {
  name: ProviderName;
  /** one call for the whole list; rejects on any failure */
  classify(items: string[], departments: string[]): Promise<LlmWire[]>;
  /** what the list header says when this provider is unreachable */
  offlineNote: string;
  /** optional: load the model before the first real call (a cold 14B load is ~20 s; warm calls ~10 s) */
  warmUp?(): Promise<void>;
}

const env = import.meta.env as Record<string, string | undefined>;
export const PROVIDER: ProviderName = env.VITE_RESOLVER_PROVIDER === "anthropic" ? "anthropic" : "ollama";
export const OLLAMA_URL = (env.VITE_OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "");
export const OLLAMA_MODEL = env.VITE_OLLAMA_MODEL ?? "qwen3:14b";
export const OLLAMA_TIMEOUT_MS = 20_000;
/** keep the model loaded for a shopping session */
export const OLLAMA_KEEP_ALIVE = "30m";
export const RESOLVER_URL = (env.VITE_RESOLVER_URL ?? "/api").replace(/\/$/, "");

export function ollamaProvider(fetchImpl: typeof fetch = fetch, timeoutMs = OLLAMA_TIMEOUT_MS): LlmProvider {
  return {
    name: "ollama",
    offlineNote: "Local model offline · unknown items need a tap",
    async warmUp() {
      // an empty messages array makes Ollama load the model and return at once
      await fetchImpl(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_MODEL, messages: [], keep_alive: OLLAMA_KEEP_ALIVE }),
      }).catch(() => undefined);
    },
    async classify(items, departments) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${OLLAMA_URL}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            stream: false,
            think: false,
            keep_alive: OLLAMA_KEEP_ALIVE,
            format: llmResultSchema(departments),
            options: { temperature: 0 },
            messages: [
              { role: "system", content: LLM_SYSTEM },
              { role: "user", content: llmUserMessage(items, departments) },
            ],
          }),
        });
        if (!res.ok) throw new Error(`ollama ${res.status}`);
        const body = (await res.json()) as { message?: { content?: string } };
        const content = body.message?.content;
        if (typeof content !== "string") throw new Error("ollama: no message content");
        let raw: unknown;
        try {
          raw = JSON.parse(content);
        } catch {
          throw new Error("ollama: response is not JSON");
        }
        return parseLlmResults(raw, items, departments);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function anthropicProvider(fetchImpl: typeof fetch = fetch): LlmProvider {
  return {
    name: "anthropic",
    offlineNote: "Resolver offline · unknown items need a tap",
    async classify(items, departments) {
      const res = await fetchImpl(`${RESOLVER_URL}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, departments }),
      });
      if (!res.ok) throw new Error(`resolver ${res.status}`);
      const body = (await res.json()) as { results: LlmWire[] };
      // the worker already parsed and banded; run it through the parser again so both paths are identical
      return parseLlmResults({ results: body.results }, items, departments).map((w, i) => ({ ...w, confidence: body.results[i]?.department ? body.results[i].confidence : 0 }));
    },
  };
}

export function defaultProvider(): LlmProvider {
  return PROVIDER === "anthropic" ? anthropicProvider() : ollamaProvider();
}

/** Wire rows → the resolver's cache entries, keyed by normalised item text. */
export function toGuessMap(rows: LlmWire[]): Map<string, LlmGuess | null> {
  const out = new Map<string, LlmGuess | null>();
  for (const g of rows) {
    const key = g.item.trim().toLowerCase().replace(/\s+/g, " ");
    out.set(key, g.department ? { department: g.department, subcategory: g.subcategory, canonicalName: g.canonicalName, tags: g.tags, confidence: g.confidence } : null);
  }
  return out;
}

/** Back-compat helper used by the hook: classify with the default provider. */
export async function fetchGuesses(items: string[], departments: string[], provider: LlmProvider = defaultProvider()): Promise<Map<string, LlmGuess | null>> {
  return toGuessMap(await provider.classify(items, departments));
}
