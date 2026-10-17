// The LLM layer's transport. Two providers behind one interface, chosen at
// runtime by the resolver settings (lib/settings.ts, the gear on the list):
//   ollama  a local model over POST {ollamaUrl}/api/chat, strict JSON via
//           `format`, no thinking, one call for the list (dev, plain http)
//   worker  the Cloudflare worker at {workerUrl} (apps/resolver), which
//           forwards to the Mac's model through its tunnel, or to Claude
// Both use the prompt, schema and parser from @grosher/core, so the app
// caches the same shape whichever answered. Failures throw; the caller
// degrades to "unknown" and shows a one-line note. A worker answer flagged
// `degraded` (its upstream was down) throws too, so nothing is cached.

import { LLM_SYSTEM, llmMaxTokens, llmResultSchema, llmUserMessage, parseLlmResults, type LlmGuess, type LlmWire } from "@grosher/core";
import { DEFAULT_SETTINGS, loadSettings, OLLAMA_DEFAULT_MODEL, type ProviderName, type ResolverSettings } from "./settings.ts";

export { OLLAMA_DEFAULT_MODEL, type ProviderName };

export interface ClassifyOptions {
  /** the model is not loaded yet: allow a cold load inside this one call */
  coldStart?: boolean;
}

export interface LlmProvider {
  name: ProviderName;
  /** one call for the whole list; rejects on any failure */
  classify(items: string[], departments: string[], opts?: ClassifyOptions): Promise<LlmWire[]>;
  /** what the list header says when this provider is unreachable */
  offlineNote: string;
  /** optional: load the model before the first real call; never throws */
  warmUp?(): Promise<void>;
  /** optional: is the model resident right now? (unknown → true) */
  isLoaded?(): Promise<boolean>;
}

/** the build-time defaults (VITE_ variables); the settings sheet can override them per device */
export const PROVIDER: ProviderName = DEFAULT_SETTINGS.provider;
export const OLLAMA_URL = DEFAULT_SETTINGS.ollamaUrl;
export const OLLAMA_MODEL = DEFAULT_SETTINGS.model;
export const RESOLVER_URL = DEFAULT_SETTINGS.workerUrl;
export const OLLAMA_TIMEOUT_MS = 20_000;
/** a cold load of the model happens inside the call: allow it once */
export const OLLAMA_COLD_TIMEOUT_MS = 60_000;
/** keep the model loaded all day */
export const OLLAMA_KEEP_ALIVE = "24h";

const DEV = !!(import.meta.env as { DEV?: boolean }).DEV;

interface OllamaChat {
  message?: { content?: string };
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaTarget {
  url: string;
  model: string;
}

export function ollamaProvider(fetchImpl: typeof fetch = fetch, timeoutMs = OLLAMA_TIMEOUT_MS, coldTimeoutMs = OLLAMA_COLD_TIMEOUT_MS, target: OllamaTarget = { url: OLLAMA_URL, model: OLLAMA_MODEL }): LlmProvider {
  const OLLAMA_URL = target.url.replace(/\/$/, "");
  const OLLAMA_MODEL = target.model || OLLAMA_DEFAULT_MODEL;
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
    async isLoaded() {
      try {
        const res = await fetchImpl(`${OLLAMA_URL}/api/ps`);
        if (!res.ok) return true;
        const body = (await res.json()) as { models?: { name?: string; model?: string }[] };
        return (body.models ?? []).some((m) => m.name === OLLAMA_MODEL || m.model === OLLAMA_MODEL);
      } catch {
        return true;
      }
    },
    async classify(items, departments, opts = {}) {
      const ctrl = new AbortController();
      const t0 = performance.now();
      const timer = setTimeout(() => ctrl.abort(), opts.coldStart ? coldTimeoutMs : timeoutMs);
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
            options: { temperature: 0, num_predict: llmMaxTokens(items.length) },
            messages: [
              { role: "system", content: LLM_SYSTEM },
              { role: "user", content: llmUserMessage(items, departments) },
            ],
          }),
        });
        if (!res.ok) throw new Error(`ollama ${res.status}`);
        const body = (await res.json()) as OllamaChat;
        const content = body.message?.content;
        if (typeof content !== "string") throw new Error("ollama: no message content");
        let raw: unknown;
        try {
          raw = JSON.parse(content);
        } catch {
          throw new Error("ollama: response is not JSON");
        }
        if (DEV) {
          const ms = (ns?: number) => Math.round((ns ?? 0) / 1e6);
          const evalTokens = body.eval_count ?? 0;
          console.info(
            `[resolve] ollama ${OLLAMA_MODEL} · ${items.length} items · wall ${Math.round(performance.now() - t0)} ms · load ${ms(body.load_duration)} ms · prompt ${body.prompt_eval_count ?? 0} tok / ${ms(body.prompt_eval_duration)} ms · gen ${evalTokens} tok / ${ms(body.eval_duration)} ms (${(evalTokens / Math.max(1, items.length)).toFixed(0)} tok/item)${opts.coldStart ? " · cold" : ""}`,
          );
        }
        return parseLlmResults(raw, items, departments);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function workerProvider(fetchImpl: typeof fetch = fetch, url: string = RESOLVER_URL): LlmProvider {
  const base = url.replace(/\/$/, "");
  return {
    name: "worker",
    offlineNote: "Resolver offline · unknown items need a tap",
    async classify(items, departments) {
      const t0 = performance.now();
      const res = await fetchImpl(`${base}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, departments }),
      });
      if (!res.ok) throw new Error(`resolver ${res.status}`);
      const body = (await res.json()) as { results: LlmWire[]; degraded?: boolean };
      // the worker could not reach its model: unknown rows with a flag; do not cache them
      if (body.degraded) throw new Error("resolver degraded: upstream unreachable");
      if (DEV) console.info(`[resolve] worker · ${items.length} items · wall ${Math.round(performance.now() - t0)} ms`);
      // the worker already parsed and banded: keep its rows, every item present
      const byItem = new Map(body.results.map((r) => [r.item.trim().toLowerCase(), r]));
      return items.map((item) => byItem.get(item.trim().toLowerCase()) ?? { item, department: null, confidence: 0 });
    },
  };
}

/** the provider the settings name, pointed at their URL and model */
export function providerFor(s: ResolverSettings, fetchImpl: typeof fetch = fetch): LlmProvider {
  return s.provider === "worker" ? workerProvider(fetchImpl, s.workerUrl) : ollamaProvider(fetchImpl, OLLAMA_TIMEOUT_MS, OLLAMA_COLD_TIMEOUT_MS, { url: s.ollamaUrl, model: s.model });
}

export function defaultProvider(): LlmProvider {
  return providerFor(loadSettings());
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

export async function fetchGuesses(items: string[], departments: string[], provider: LlmProvider = defaultProvider(), opts?: ClassifyOptions): Promise<Map<string, LlmGuess | null>> {
  return toGuessMap(await provider.classify(items, departments, opts));
}
