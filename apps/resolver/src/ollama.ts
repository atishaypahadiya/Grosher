// The ollama provider: the worker forwards the batch to an Ollama on the
// Mac, reached through a Cloudflare Tunnel (OLLAMA_UPSTREAM) and gated by a
// shared bearer token (OLLAMA_TOKEN, checked by scripts/ollama-gate.mjs in
// front of Ollama). Same prompt, schema and parser as the web client's
// direct provider, so the rows are identical whichever path answered.

import { LLM_SYSTEM, llmMaxTokens, llmResultSchema, llmUserMessage, parseLlmResults } from "@grosher/core";
import type { ClassifyRequest, Guess } from "./classify.ts";

export const OLLAMA_DEFAULT_MODEL = "qwen3:8b";
/** the tunnel adds latency to a ~3 s generation; a cold model load would not fit and is the Mac's job (keep_alive) */
export const OLLAMA_TIMEOUT_MS = 25_000;
export const OLLAMA_KEEP_ALIVE = "24h";

export interface OllamaUpstream {
  url: string;
  token: string;
  model?: string;
}

export async function classifyOllama(up: OllamaUpstream, req: ClassifyRequest, fetchImpl: typeof fetch = fetch): Promise<Guess[]> {
  const items = [...new Set(req.items.map((s) => s.trim()).filter(Boolean))];
  if (!items.length) return [];
  const departments = req.departments.filter(Boolean);
  const res = await fetchImpl(`${up.url.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${up.token}` },
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    body: JSON.stringify({
      model: up.model || OLLAMA_DEFAULT_MODEL,
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
  if (!res.ok) throw new Error(`ollama upstream ${res.status}`);
  const body = (await res.json()) as { message?: { content?: string } };
  const content = body.message?.content;
  if (typeof content !== "string") throw new Error("ollama upstream: no message content");
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("ollama upstream: response is not JSON");
  }
  return parseLlmResults(raw, items, departments);
}
