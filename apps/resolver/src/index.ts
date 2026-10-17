// POST /resolve  {items: string[], departments: string[]} → {results: Guess[]}
// The Anthropic key lives in the worker's secret store (wrangler secret put
// ANTHROPIC_API_KEY); the web app only ever sees this endpoint.

import { Hono } from "hono";
import { cors } from "hono/cors";
import Anthropic from "@anthropic-ai/sdk";
import { classify, type ClassifyRequest, type Guess } from "./classify.ts";

export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGIN?: string;
}

export type Classifier = (req: ClassifyRequest) => Promise<Guess[]>;

/** The app, with the classifier injectable for tests. */
export function createApp(classifier?: Classifier) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", async (c, next) => cors({ origin: c.env?.ALLOWED_ORIGIN ?? "*", allowMethods: ["POST", "OPTIONS"] })(c, next));
  app.get("/health", (c) => c.json({ ok: true }));
  app.post("/resolve", async (c) => {
    let body: Partial<ClassifyRequest>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    if (!Array.isArray(body.items) || !Array.isArray(body.departments)) return c.json({ error: "items and departments must be arrays of strings" }, 400);
    const items = body.items.filter((s): s is string => typeof s === "string").slice(0, 100);
    const departments = body.departments.filter((s): s is string => typeof s === "string");
    const run = classifier ?? ((req: ClassifyRequest) => classify(new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY }), req));
    try {
      const results = await run({ items, departments });
      return c.json({ results });
    } catch (e) {
      const status = e instanceof Anthropic.RateLimitError ? 429 : e instanceof Anthropic.AuthenticationError ? 500 : e instanceof Anthropic.APIError ? 502 : 500;
      return c.json({ error: e instanceof Error ? e.message : "resolver failed" }, status);
    }
  });
  return app;
}

export default createApp();
