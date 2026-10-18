// A bearer-token gate in front of the Mac's Ollama, for the Tailscale Funnel
// the deployed worker calls through. Ollama itself has no auth, so the
// Funnel points here, not at :11434.
//
//   umask 077; openssl rand -hex 24 | tr -d '\n' > ~/.config/grosher/ollama-token   # the same value goes into: wrangler secret put OLLAMA_TOKEN
//   npm run gate -w @grosher/resolver                    # listens on 127.0.0.1:11435 (launchd runs it: npm run chain:install)
//   tailscale funnel --bg 11435                          # https://<machine>.<tailnet>.ts.net for: wrangler secret put OLLAMA_UPSTREAM
//
// The token comes from OLLAMA_TOKEN if set, else from the file at
// OLLAMA_TOKEN_FILE (default ~/.config/grosher/ollama-token), which must be
// readable by its owner only. Only POST /api/chat and GET /api/ps pass, with
// the exact token, bodies capped at 2 MB (a survey's sign photo is a 1024 px
// JPEG, ~0.5 MB as base64). Everything else is 404 / 401.
// Node ≥ 22, no dependencies.

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.GATE_PORT ?? 11435);
const UPSTREAM = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "");
const TOKEN_FILE = process.env.OLLAMA_TOKEN_FILE ?? join(homedir(), ".config/grosher/ollama-token");
const MAX_BODY = 2 * 1024 * 1024;
const ALLOWED = new Set(["POST /api/chat", "GET /api/ps"]);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const fail = (...a) => console.error(new Date().toISOString(), ...a);

function readToken() {
  if (process.env.OLLAMA_TOKEN) return process.env.OLLAMA_TOKEN;
  let st;
  try {
    st = statSync(TOKEN_FILE);
  } catch {
    fail(`no OLLAMA_TOKEN and no token file at ${TOKEN_FILE}`);
    process.exit(1);
  }
  if (st.mode & 0o077) {
    fail(`${TOKEN_FILE} is readable by others: chmod 600 it`);
    process.exit(1);
  }
  return readFileSync(TOKEN_FILE, "utf8").trim();
}

const TOKEN = readToken();
if (!TOKEN || TOKEN.length < 16) {
  fail("the token (16+ characters) is required");
  process.exit(1);
}

const expected = Buffer.from(`Bearer ${TOKEN}`);
const authorized = (header) => {
  const got = Buffer.from(header ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
};

createServer(async (req, res) => {
  // marks the gate's own answers, so the worker's /health can tell its 502 (Ollama down) from the Funnel's (gate down)
  res.setHeader("x-grosher-gate", "1");
  const path = (req.url ?? "/").split("?")[0];
  if (!ALLOWED.has(`${req.method} ${path}`)) return res.writeHead(404).end();
  if (!authorized(req.headers.authorization)) return res.writeHead(401).end();
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) return res.writeHead(413).end();
    chunks.push(c);
  }
  const t0 = performance.now();
  try {
    const up = await fetch(UPSTREAM + path, { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "POST" ? Buffer.concat(chunks) : undefined });
    const body = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json", "content-length": body.length });
    res.end(body);
    log(`${req.method} ${path} ${up.status} ${Math.round(performance.now() - t0)} ms`);
  } catch (e) {
    fail(`${req.method} ${path} upstream failed: ${e instanceof Error ? e.message : e}`);
    res.writeHead(502).end();
  }
}).listen(PORT, "127.0.0.1", () => log(`ollama gate on http://127.0.0.1:${PORT} → ${UPSTREAM}`));
