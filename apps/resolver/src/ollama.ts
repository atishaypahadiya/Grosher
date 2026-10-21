// The ollama provider: the worker forwards the batch to an Ollama on the
// Mac, reached through Tailscale Funnel (OLLAMA_UPSTREAM) and gated by a
// shared bearer token (OLLAMA_TOKEN, checked by scripts/ollama-gate.mjs in
// front of Ollama). Same prompt, schema and parser as the web client's
// direct provider, so the rows are identical whichever path answered.

import {
  DISH_MAX_TOKENS,
  dishSchema,
  dishSystemPrompt,
  dishUserMessage,
  llmMaxTokens,
  llmResultSchema,
  llmSystemPrompt,
  llmUserMessage,
  parseDishAnswer,
  parseDishJson,
  parseLlmResults,
  parseSignWords,
  SIGN_DEFAULT_MODEL,
  SIGN_MAX_TOKENS,
  SIGN_PROMPT,
  SIGN_SCHEMA,
  type DishReply,
} from "@grosher/core";
import type { ClassifyRequest, Guess } from "./classify.ts";

export const OLLAMA_DEFAULT_MODEL = "qwen3:8b";
/** the Funnel adds latency to a ~3 s generation; a cold model load would not fit and is the Mac's job (keep_alive) */
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
  const categories = req.categories.filter((c) => c && c.id);
  const ids = categories.map((c) => c.id);
  const res = await fetchImpl(`${up.url.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${up.token}` },
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    body: JSON.stringify({
      model: up.model || OLLAMA_DEFAULT_MODEL,
      stream: false,
      think: false,
      keep_alive: OLLAMA_KEEP_ALIVE,
      format: llmResultSchema(ids),
      options: { temperature: 0, num_predict: llmMaxTokens(items.length) },
      messages: [
        { role: "system", content: llmSystemPrompt(categories) },
        { role: "user", content: llmUserMessage(items) },
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
  return parseLlmResults(raw, items, ids);
}

/** one dish, a ceiling: ~4 s warm on the Mac with the compact format (qwen3:8b, ~130 output tokens), longer when
 *  it shares the GPU with other dishes (Ollama runs three at once, OLLAMA_NUM_PARALLEL), plus the Funnel */
export const DISH_TIMEOUT_MS = 40_000;

/**
 * Cook mode: each dish's ingredients from the local model, one call a dish, all at once through the gate's /api/chat
 * (Ollama runs three together and queues the rest), so a slow dish holds up no other. A dish that fails or times out
 * is answered with null; never rejects. The app sends one dish a request, so each arrives on its own.
 */
export async function dishesOllama(up: OllamaUpstream, dishes: string[], fetchImpl: typeof fetch = fetch, timeoutMs = DISH_TIMEOUT_MS): Promise<DishReply[]> {
  return Promise.all(
    dishes.map(async (dish): Promise<DishReply> => {
      if (timeoutMs <= 0) return { dish, ingredients: null };
      try {
        const res = await fetchImpl(`${up.url.replace(/\/$/, "")}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${up.token}` },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model: up.model || OLLAMA_DEFAULT_MODEL,
            stream: false,
            think: false,
            keep_alive: OLLAMA_KEEP_ALIVE,
            format: dishSchema(),
            options: { temperature: 0, num_predict: DISH_MAX_TOKENS },
            messages: [
              { role: "system", content: dishSystemPrompt() },
              { role: "user", content: dishUserMessage(dish) },
            ],
          }),
        });
        if (!res.ok) throw new Error(`ollama upstream ${res.status}`);
        const content = ((await res.json()) as { message?: { content?: string } }).message?.content;
        return { dish, ingredients: typeof content === "string" ? parseDishAnswer(parseDishJson(content)) : null };
      } catch (e) {
        console.error("dish unanswered", e instanceof Error ? e.message : e);
        return { dish, ingredients: null };
      }
    }),
  );
}

/** a vision model reading one 1024 px sign: a cold load (~6 GB) plus the read fits, a hung Mac does not */
export const SIGN_TIMEOUT_MS = 90_000;
/** the vision model stays loaded through a survey walk, not all day beside the text model */
export const SIGN_KEEP_ALIVE = "30m";

/** One aisle-sign photo (base64 JPEG, no data: prefix) → the lines printed on it. Rejects on any failure. */
export async function readSignOllama(up: OllamaUpstream, imageB64: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchImpl(`${up.url.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${up.token}` },
    signal: AbortSignal.timeout(SIGN_TIMEOUT_MS),
    body: JSON.stringify({
      model: up.model || SIGN_DEFAULT_MODEL,
      stream: false,
      keep_alive: SIGN_KEEP_ALIVE,
      format: SIGN_SCHEMA,
      options: { temperature: 0, num_predict: SIGN_MAX_TOKENS },
      messages: [{ role: "user", content: SIGN_PROMPT, images: [imageB64] }],
    }),
  });
  if (!res.ok) throw new Error(`ollama upstream ${res.status}`);
  const body = (await res.json()) as { message?: { content?: string } };
  if (typeof body.message?.content !== "string") throw new Error("ollama upstream: no message content");
  return parseSignWords(body.message.content);
}

/** /health's probe: one authenticated GET /api/ps through the Funnel and the gate, short so a monitor is not kept waiting */
export const OLLAMA_PROBE_MS = 4_000;

export type Probe = { ok: true; ms: number; modelLoaded: boolean } | { ok: false; reason: string };

/** Fixed reasons only: the upstream's own text never leaves the worker. */
export async function probeOllama(up: OllamaUpstream, fetchImpl: typeof fetch = fetch): Promise<Probe> {
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetchImpl(`${up.url.replace(/\/$/, "")}/api/ps`, { headers: { authorization: `Bearer ${up.token}` }, signal: AbortSignal.timeout(OLLAMA_PROBE_MS) });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, reason: timedOut ? `upstream timed out after ${OLLAMA_PROBE_MS / 1000} s` : "upstream unreachable: Funnel down or the Mac asleep" };
  }
  if (res.status === 401) return { ok: false, reason: "the gate rejected the token (401): OLLAMA_TOKEN differs from the gate's" };
  if (res.status === 404) return { ok: false, reason: "upstream 404: OLLAMA_UPSTREAM does not point at the gate" };
  // the gate marks its answers; a 502 without the mark is Tailscale's, whose backend (the gate) is gone
  if (res.status === 502) return { ok: false, reason: res.headers.get("x-grosher-gate") ? "the gate is up but Ollama is not answering (502)" : "the Funnel is up but the gate is not answering (502)" };
  if (!res.ok) return { ok: false, reason: `upstream ${res.status}` };
  let models: { name?: string; model?: string }[] = [];
  try {
    models = ((await res.json()) as { models?: { name?: string; model?: string }[] }).models ?? [];
  } catch {
    return { ok: false, reason: "upstream answered, but not with Ollama's JSON" };
  }
  const want = up.model || OLLAMA_DEFAULT_MODEL;
  return { ok: true, ms: Date.now() - t0, modelLoaded: models.some((m) => m.name === want || m.model === want) };
}
