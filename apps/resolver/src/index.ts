// POST /resolve  {items: string[], categories: {id, name}[]} → {results: Guess[], degraded?: true}
// Two upstreams, chosen by the PROVIDER var: "ollama" forwards to the Mac's
// model through its tunnel (OLLAMA_UPSTREAM + OLLAMA_TOKEN secrets),
// "anthropic" asks Claude (ANTHROPIC_API_KEY secret). Secrets live in the
// worker's store (wrangler secret put …); the web app only ever sees this
// endpoint. When the upstream is unreachable the answer is still 200: every
// item unknown and `degraded: true`, never an error.

import { Hono } from "hono";
import { cors } from "hono/cors";
import Anthropic from "@anthropic-ai/sdk";
import { classify, type ClassifyRequest, type Guess } from "./classify.ts";
import { classifyOllama } from "./ollama.ts";

export type Provider = "anthropic" | "ollama";

export interface Env {
  /** which upstream answers; wrangler.toml sets "ollama" */
  PROVIDER?: Provider | string;
  ANTHROPIC_API_KEY?: string;
  /** ollama: the tunnel URL to the Mac (secret) and the shared bearer token the gate checks (secret) */
  OLLAMA_UPSTREAM?: string;
  OLLAMA_TOKEN?: string;
  OLLAMA_MODEL?: string;
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

export type Classifier = (req: ClassifyRequest) => Promise<Guess[]>;

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

/** The app, with the classifier injectable for tests. */
export function createApp(classifier?: Classifier) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", async (c, next) => cors({ origin: c.env?.ALLOWED_ORIGIN ?? "*", allowMethods: ["POST", "OPTIONS"] })(c, next));
  app.get("/health", (c) => c.json({ ok: true, provider: providerOf(c.env) }));
  app.post("/resolve", async (c) => {
    // origin: when an exact origin is configured, browsers must send it
    const allowed = c.env?.ALLOWED_ORIGIN ?? "*";
    const origin = c.req.header("origin");
    if (allowed !== "*" && origin !== allowed) return c.json({ error: "forbidden" }, 403);
    // rate limit per client IP when the binding exists
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    if (c.env?.RATE_LIMITER) {
      const { success } = await c.env.RATE_LIMITER.limit({ key: ip });
      if (!success) return c.json({ error: "too many requests" }, 429);
    }
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
