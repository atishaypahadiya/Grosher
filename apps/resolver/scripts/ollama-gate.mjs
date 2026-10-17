// A bearer-token gate in front of the Mac's Ollama, for the Cloudflare
// Tunnel the deployed worker calls through. Ollama itself has no auth, so
// the tunnel points here, not at :11434.
//
//   OLLAMA_TOKEN=$(openssl rand -hex 24)        # the same value goes into: wrangler secret put OLLAMA_TOKEN
//   OLLAMA_TOKEN=… npm run gate -w @grosher/resolver     # listens on 127.0.0.1:11435
//   cloudflared tunnel --url http://localhost:11435       # prints the https URL for: wrangler secret put OLLAMA_UPSTREAM
//
// Only POST /api/chat and GET /api/ps pass, with the exact token, bodies
// capped at 64 KB. Everything else is 404 / 401. Node ≥ 22, no dependencies.

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.GATE_PORT ?? 11435);
const UPSTREAM = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "");
const TOKEN = process.env.OLLAMA_TOKEN;
const MAX_BODY = 64 * 1024;
const ALLOWED = new Set(["POST /api/chat", "GET /api/ps"]);

if (!TOKEN || TOKEN.length < 16) {
  console.error("OLLAMA_TOKEN (16+ characters) is required");
  process.exit(1);
}

const expected = Buffer.from(`Bearer ${TOKEN}`);
const authorized = (header) => {
  const got = Buffer.from(header ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
};

createServer(async (req, res) => {
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
    console.log(`${req.method} ${path} ${up.status} ${Math.round(performance.now() - t0)} ms`);
  } catch (e) {
    console.error(`${req.method} ${path} upstream failed: ${e instanceof Error ? e.message : e}`);
    res.writeHead(502).end();
  }
}).listen(PORT, "127.0.0.1", () => console.log(`ollama gate on http://127.0.0.1:${PORT} → ${UPSTREAM}`));
