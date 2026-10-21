// POST /resolve  {items: string[], categories: {id, name}[]} → {results: Guess[], degraded?: true}
// POST /dishes   {dishes: string[]} → {results: {dish, ingredients | null}[], degraded?: true}  (cook mode: each dish's
//                ingredients for two servings from the local model, one call a dish; ollama provider only, never Claude)
// POST /sign     {image: base64 JPEG} → {words: string[], degraded?: true}  (survey mode's aisle signs,
//                read by the vision model OLLAMA_VISION_MODEL on the Mac; ollama provider only)
// Two upstreams, chosen by the PROVIDER var: "ollama" forwards to the Mac's
// model through Tailscale Funnel and the gate (OLLAMA_UPSTREAM + OLLAMA_TOKEN secrets),
// "anthropic" asks Claude (ANTHROPIC_API_KEY secret). Secrets live in the
// worker's store (wrangler secret put …); the web app only ever sees this
// endpoint. When the upstream is unreachable the answer is still 200: every
// item unknown and `degraded: true`, never an error.
// GET /health probes the upstream (ollama: one authenticated GET /api/ps
// through the gate, 4 s) and answers 503 `degraded` with a fixed reason
// when it fails.

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import Anthropic from "@anthropic-ai/sdk";
import { classify, type ClassifyRequest, type Guess } from "./classify.ts";
import { DISH_MAX, DISH_MAX_CHARS, type DishReply } from "@grosher/core";
import { classifyOllama, dishesOllama, probeOllama, readSignOllama } from "./ollama.ts";
import { waitlist, type WaitlistEnv } from "./waitlist.ts";

export type Provider = "anthropic" | "ollama";

export interface Env extends WaitlistEnv {
  /** which upstream answers; wrangler.toml sets "ollama" */
  PROVIDER?: Provider | string;
  ANTHROPIC_API_KEY?: string;
  /** ollama: the Funnel URL of the Mac's gate (secret) and the shared bearer token the gate checks (secret) */
  OLLAMA_UPSTREAM?: string;
  OLLAMA_TOKEN?: string;
  OLLAMA_MODEL?: string;
  /** the vision model that reads aisle signs (default qwen2.5vl:7b) */
  OLLAMA_VISION_MODEL?: string;
  /** exact origin of the web app in production ("https://grosher.app"); "*" only in dev */
  ALLOWED_ORIGIN?: string;
  /** optional Cloudflare rate-limit binding (wrangler.toml [[unsafe.bindings]]); keyed by client IP */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

// Hard caps: one call is one Claude request, so the request body is the cost.
export const MAX_ITEMS = 40;
export const MAX_ITEM_CHARS = 60;
/** a store's shelf categories: ~300 of {id, name} */
export const MAX_CATEGORIES = 400;
export const MAX_CATEGORY_CHARS = 48;
export const MAX_BODY_BYTES = 48 * 1024;
/** one sign photo: 1024 px JPEG, base64 (the app sends ~150–400 KB) */
export const MAX_SIGN_BYTES = 1_500_000;

export type Classifier = (req: ClassifyRequest) => Promise<Guess[]>;
/** cook mode's dish answers (injectable for tests) */
export type DishAsker = (dishes: string[]) => Promise<DishReply[]>;

export const providerOf = (env: Env | undefined): Provider => (env?.PROVIDER === "ollama" ? "ollama" : "anthropic");

/** The upstream for this environment; a misconfigured one rejects, which degrades like an outage. */
export function classifierFor(env: Env | undefined, fetchImpl: typeof fetch = fetch): Classifier {
  if (providerOf(env) === "ollama") {
    const url = env?.OLLAMA_UPSTREAM;
    const token = env?.OLLAMA_TOKEN;
    if (!url || !token) return async () => Promise.reject(new Error("ollama upstream not configured"));
    return (req) => classifyOllama({ url, token, model: env?.OLLAMA_MODEL }, req, fetchImpl);
  }
  const apiKey = env?.ANTHROPIC_API_KEY;
  if (!apiKey) return async () => Promise.reject(new Error("anthropic key not configured"));
  return (req) => classify(new Anthropic({ apiKey }), req);
}

const unknownRows = (items: string[]): Guess[] => items.map((item) => ({ item, category: null, confidence: 0 }));

/** origin (when an exact one is configured, browsers must send it) and the per-IP rate limit; a Response when refused */
async function guard(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  const allowed = c.env?.ALLOWED_ORIGIN ?? "*";
  if (allowed !== "*" && c.req.header("origin") !== allowed) return c.json({ error: "forbidden" }, 403);
  if (c.env?.RATE_LIMITER) {
    const { success } = await c.env.RATE_LIMITER.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" });
    if (!success) return c.json({ error: "too many requests" }, 429);
  }
  return null;
}

/** The app, with the classifier and the health probe's fetch injectable for tests. */
export function createApp(classifier?: Classifier, fetchImpl: typeof fetch = (...a) => fetch(...a), waitlistMinMs?: number, dishAsker?: DishAsker) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", async (c, next) => cors({ origin: c.env?.ALLOWED_ORIGIN ?? "*", allowMethods: ["GET", "POST", "OPTIONS"] })(c, next));
  app.get("/health", async (c) => {
    const provider = providerOf(c.env);
    // each call reaches the Mac, so it shares the per-IP limit (its own bucket)
    if (c.env?.RATE_LIMITER) {
      const { success } = await c.env.RATE_LIMITER.limit({ key: `health:${c.req.header("cf-connecting-ip") ?? "unknown"}` });
      if (!success) return c.json({ error: "too many requests" }, 429);
    }
    const degraded = (reason: string) => c.json({ ok: false, provider, degraded: true, reason }, 503);
    if (provider === "anthropic") return c.env?.ANTHROPIC_API_KEY ? c.json({ ok: true, provider, upstream: "not probed" }) : degraded("ANTHROPIC_API_KEY not set");
    const url = c.env?.OLLAMA_UPSTREAM;
    const token = c.env?.OLLAMA_TOKEN;
    if (!url || !token) return degraded("OLLAMA_UPSTREAM or OLLAMA_TOKEN not set");
    const model = c.env?.OLLAMA_MODEL || "qwen3:8b";
    const p = await probeOllama({ url, token, model }, fetchImpl);
    return p.ok ? c.json({ ok: true, provider, upstream: "ok", ms: p.ms, model, modelLoaded: p.modelLoaded }) : degraded(p.reason);
  });
  app.post("/sign", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    if (Number(c.req.header("content-length") ?? 0) > MAX_SIGN_BYTES) return c.json({ error: "body too large" }, 413);
    let image: unknown;
    try {
      const text = await c.req.text();
      if (text.length > MAX_SIGN_BYTES) return c.json({ error: "body too large" }, 413);
      image = (JSON.parse(text) as { image?: unknown }).image;
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    if (typeof image !== "string" || image.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) return c.json({ error: "image must be base64 JPEG" }, 400);
    const url = c.env?.OLLAMA_UPSTREAM;
    const token = c.env?.OLLAMA_TOKEN;
    try {
      if (providerOf(c.env) !== "ollama" || !url || !token) throw new Error("sign reading needs the ollama upstream");
      return c.json({ words: await readSignOllama({ url, token, model: c.env?.OLLAMA_VISION_MODEL }, image, fetchImpl) });
    } catch (e) {
      // like /resolve: the app queues the photo and retries; the upstream's text stays here
      console.error("sign degraded", e instanceof Error ? e.message : e);
      return c.json({ words: [], degraded: true });
    }
  });
  // cook mode: the dishes the app's table does not know, each answered by the local model on the Mac. Local only by
  // design: with the anthropic provider every dish comes back unanswered, and the app says the laptop's model is needed
  app.post("/dishes", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    let body: { dishes?: unknown };
    try {
      const text = await c.req.text();
      if (text.length > 4096) return c.json({ error: "body too large" }, 413);
      body = JSON.parse(text);
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    if (!Array.isArray(body.dishes)) return c.json({ error: "dishes must be strings" }, 400);
    const dishes = [...new Set(body.dishes.filter((s): s is string => typeof s === "string").map((s) => s.trim().replace(/\s+/g, " ").slice(0, DISH_MAX_CHARS)).filter(Boolean))].slice(0, DISH_MAX);
    if (!dishes.length) return c.json({ results: [] });
    const none = () => dishes.map((dish) => ({ dish, ingredients: null }));
    const url = c.env?.OLLAMA_UPSTREAM;
    const token = c.env?.OLLAMA_TOKEN;
    const ask = dishAsker ?? (providerOf(c.env) === "ollama" && url && token ? (d: string[]) => dishesOllama({ url, token, model: c.env?.OLLAMA_MODEL }, d, fetchImpl) : null);
    const results = ask ? await ask(dishes).catch(none) : none();
    return c.json(results.some((r) => !r.ingredients) ? { results, degraded: true } : { results });
  });
  // the project page's "Get notified" form (src/waitlist.ts): its own origin check and limit, not the resolver's
  app.post("/waitlist", (c) => waitlist(c, fetchImpl, waitlistMinMs));

  app.post("/resolve", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const len = Number(c.req.header("content-length") ?? 0);
    if (len > MAX_BODY_BYTES) return c.json({ error: "body too large" }, 413);
    let body: Partial<ClassifyRequest>;
    try {
      const text = await c.req.text();
      if (text.length > MAX_BODY_BYTES) return c.json({ error: "body too large" }, 413);
      body = JSON.parse(text);
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    if (!Array.isArray(body.items) || !Array.isArray(body.categories)) return c.json({ error: "items must be strings and categories {id, name} objects" }, 400);
    const items = body.items
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim().slice(0, MAX_ITEM_CHARS))
      .filter(Boolean)
      .slice(0, MAX_ITEMS);
    const categories = (body.categories as unknown[])
      .filter((o): o is { id: unknown; name: unknown } => !!o && typeof o === "object")
      .map((o) => ({ id: String(o.id ?? "").trim().slice(0, MAX_CATEGORY_CHARS), name: String(o.name ?? "").trim().slice(0, MAX_CATEGORY_CHARS) }))
      .filter((o) => o.id)
      .slice(0, MAX_CATEGORIES);
    if (!items.length || !categories.length) return c.json({ results: [] });
    const run = classifier ?? classifierFor(c.env);
    try {
      const results = await run({ items, categories });
      return c.json({ results });
    } catch (e) {
      // the upstream is down, slow, misconfigured or rate-limited: the client gets its items back
      // unknown with a flag, never an error, and never the upstream's error text
      console.error("resolve degraded", e instanceof Error ? e.message : e);
      return c.json({ results: unknownRows(items), degraded: true });
    }
  });
  return app;
}

export default createApp();
