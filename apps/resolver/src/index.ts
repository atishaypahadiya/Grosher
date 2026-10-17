// POST /resolve  {items: string[], departments: string[]} → {results: Guess[]}
// The Anthropic key lives in the worker's secret store (wrangler secret put
// ANTHROPIC_API_KEY); the web app only ever sees this endpoint.

import { Hono } from "hono";
import { cors } from "hono/cors";
import Anthropic from "@anthropic-ai/sdk";
import { classify, type ClassifyRequest, type Guess } from "./classify.ts";

export interface Env {
  ANTHROPIC_API_KEY: string;
  /** exact origin of the web app in production ("https://grosher.app"); "*" only in dev */
  ALLOWED_ORIGIN?: string;
  /** optional Cloudflare rate-limit binding (wrangler.toml [[unsafe.bindings]]); keyed by client IP */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

// Hard caps: one call is one Claude request, so the request body is the cost.
export const MAX_ITEMS = 40;
export const MAX_ITEM_CHARS = 60;
export const MAX_DEPARTMENTS = 24;
export const MAX_DEPARTMENT_CHARS = 32;
export const MAX_BODY_BYTES = 8 * 1024;

export type Classifier = (req: ClassifyRequest) => Promise<Guess[]>;

/** The app, with the classifier injectable for tests. */
export function createApp(classifier?: Classifier) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", async (c, next) => cors({ origin: c.env?.ALLOWED_ORIGIN ?? "*", allowMethods: ["POST", "OPTIONS"] })(c, next));
  app.get("/health", (c) => c.json({ ok: true }));
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
    if (!Array.isArray(body.items) || !Array.isArray(body.departments)) return c.json({ error: "items and departments must be arrays of strings" }, 400);
    const items = body.items
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim().slice(0, MAX_ITEM_CHARS))
      .filter(Boolean)
      .slice(0, MAX_ITEMS);
    const departments = body.departments
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim().slice(0, MAX_DEPARTMENT_CHARS))
      .filter(Boolean)
      .slice(0, MAX_DEPARTMENTS);
    if (!items.length || !departments.length) return c.json({ results: [] });
    const run = classifier ?? ((req: ClassifyRequest) => classify(new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY }), req));
    try {
      const results = await run({ items, departments });
      return c.json({ results });
    } catch (e) {
      // never echo upstream error text to the client
      console.error("resolve failed", e instanceof Error ? e.message : e);
      const status = e instanceof Anthropic.RateLimitError ? 429 : e instanceof Anthropic.APIError ? 502 : 500;
      return c.json({ error: "resolver unavailable" }, status);
    }
  });
  return app;
}

export default createApp();
