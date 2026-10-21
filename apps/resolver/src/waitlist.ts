// POST /waitlist: the project page's "Get notified" form. Email only, behind Cloudflare Turnstile, stored in D1.
//
//   request   {email, token, list?: "updates" | "pilot"}   (token: the Turnstile widget's response)
//   stored    waitlist(email, list, created_at), UNIQUE (email, list)   (no IP address, no user agent, nothing else)
//   answers   200 {ok: true} for a new sign-up and for an address already on that list alike: the same status, the
//             same body and the same time (the insert is one query either way, and the answer waits out MIN_ANSWER_MS
//             from its start), so the form cannot be used to learn who is on the list;
//             400 a bad email or a missing token; 403 a foreign origin or a failed Turnstile check;
//             429 over the per-IP limit (WAITLIST_LIMITER, 5 a minute); 503 not configured (no secret or no database)
//
// Deleting an address on request: npx wrangler d1 execute grosher-waitlist --remote --command
// "DELETE FROM waitlist WHERE email = 'name@example.com'"

import type { Context } from "hono";

export interface D1Like {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<{ meta?: { changes?: number } }> } };
}

export interface WaitlistEnv {
  /** the D1 database (wrangler.toml [[d1_databases]] binding = "WAITLIST") */
  WAITLIST?: D1Like;
  /** the Turnstile widget's secret key (npx wrangler secret put TURNSTILE_SECRET) */
  TURNSTILE_SECRET?: string;
  /** the page allowed to post (default the project page's origin) */
  WAITLIST_ORIGIN?: string;
  /** per-IP limit for this route alone (wrangler.toml [[unsafe.bindings]] WAITLIST_LIMITER) */
  WAITLIST_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

export const WAITLIST_LISTS = ["updates", "pilot"] as const;
const DEFAULT_ORIGIN = "https://grosher.pages.dev";
/** every accepted sign-up answers no sooner than this after its insert starts (a write and a skipped duplicate take
 *  slightly different times; this hides the difference) */
export const MIN_ANSWER_MS = 400;
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** a plain address: something@something.tld, no spaces, at most 254 characters */
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

export const normalEmail = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const e = s.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
};

const originOk = (origin: string | undefined, allowed: string) => origin === allowed || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin ?? "");

export async function waitlist(c: Context<{ Bindings: WaitlistEnv }>, fetchImpl: typeof fetch, minAnswerMs = MIN_ANSWER_MS): Promise<Response> {
  const env = c.env ?? {};
  if (!originOk(c.req.header("origin"), env.WAITLIST_ORIGIN ?? DEFAULT_ORIGIN)) return c.json({ error: "forbidden" }, 403);
  if (env.WAITLIST_LIMITER) {
    const { success } = await env.WAITLIST_LIMITER.limit({ key: `waitlist:${c.req.header("cf-connecting-ip") ?? "unknown"}` });
    if (!success) return c.json({ error: "too many requests" }, 429);
  }
  if (!env.TURNSTILE_SECRET || !env.WAITLIST) return c.json({ error: "not configured" }, 503);
  const raw = await c.req.text();
  if (raw.length > 4096) return c.json({ error: "too large" }, 413);
  let body: { email?: unknown; token?: unknown; list?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: "bad request" }, 400);
  }
  const email = normalEmail(body.email);
  const token = typeof body.token === "string" && body.token.length <= 2048 ? body.token : null;
  const list = WAITLIST_LISTS.includes(body.list as (typeof WAITLIST_LISTS)[number]) ? (body.list as string) : "updates";
  if (!email) return c.json({ error: "that does not look like an email address" }, 400);
  if (!token) return c.json({ error: "missing check" }, 400);
  // Turnstile: the token is good once, for this site; the visitor's IP goes to Cloudflare's check only
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = c.req.header("cf-connecting-ip");
  if (ip) form.set("remoteip", ip);
  let verified = false;
  try {
    const r = await fetchImpl(SITEVERIFY, { method: "POST", body: form });
    verified = ((await r.json()) as { success?: boolean }).success === true;
  } catch {
    return c.json({ error: "the check could not be verified; try again" }, 503);
  }
  if (!verified) return c.json({ error: "the check failed; try again" }, 403);
  // UNIQUE (email, list): a repeat changes no row; the answer does not say which happened, in what it says or when
  const started = Date.now();
  await env.WAITLIST.prepare("INSERT INTO waitlist (email, list, created_at) VALUES (?, ?, ?) ON CONFLICT (email, list) DO NOTHING").bind(email, list, new Date().toISOString()).run();
  const wait = minAnswerMs - (Date.now() - started);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return c.json({ ok: true });
}
