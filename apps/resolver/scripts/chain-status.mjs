// One line per link of the resolver chain, ✓ or ✗ with the fix:
//   Ollama up (and on loopback only) → model loaded → gate up → Funnel live (public, no token → 401) → worker /health (probes the upstream)
//
//   npm run chain:status -w @grosher/resolver
//
// The Funnel URL comes from `tailscale status --json` (GROSHER_FUNNEL_URL overrides), the worker from
// GROSHER_WORKER_URL (default the deployed one). The Funnel is checked from outside: its hostname is
// resolved through public DNS (1.1.1.1), so the request leaves the tailnet and comes back in through
// Tailscale's ingress rather than short-cutting over MagicDNS. Exit code 1 when any link is down.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { Resolver } from "node:dns/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const OLLAMA = "http://127.0.0.1:11434";
const GATE = "http://127.0.0.1:11435";
const MODEL = process.env.GROSHER_MODEL ?? "qwen3:8b";
const WORKER = (process.env.GROSHER_WORKER_URL ?? "https://grosher-resolver.atishaypahadiya3.workers.dev").replace(/\/$/, "");
const TOKEN_FILE = process.env.OLLAMA_TOKEN_FILE ?? join(homedir(), ".config/grosher/ollama-token");
const UID = userInfo().uid;
const TAILSCALE = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
  } catch {
    return null;
  }
};
const loaded = (label) => run("/bin/launchctl", ["print", `gui/${UID}/${label}`]) !== null;
const kick = (label) => (loaded(label) ? `launchctl kickstart -k gui/${UID}/${label}` : "npm run chain:install -w @grosher/resolver");
const get = async (url, init = {}, ms = 3000) => {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { status: 0, error: e instanceof Error ? e.name : String(e) };
  }
};

const lines = [];
const line = (ok, name, detail, fix) => lines.push({ ok, text: `${ok ? "✓" : "✗"} ${name.padEnd(13)} ${detail}${ok || !fix ? "" : `\n  fix: ${fix}`}` });

// 1. Ollama
const version = await get(`${OLLAMA}/api/version`);
// loopback only: the gate is Ollama's one client; anything else listening on :11434 is open to the network
const listening = (run("/usr/sbin/lsof", ["-nP", "-iTCP:11434", "-sTCP:LISTEN"]) ?? "").split("\n").slice(1).map((l) => l.trim().split(/\s+/)[8]).filter(Boolean);
const exposed = listening.filter((a) => !a.startsWith("127.0.0.1:") && !a.startsWith("[::1]:"));
const maxModels = run("/bin/launchctl", ["getenv", "OLLAMA_MAX_LOADED_MODELS"]) || "default";
const parallel = run("/bin/launchctl", ["getenv", "OLLAMA_NUM_PARALLEL"]) || "1";
if (version.status !== 200) line(false, "Ollama", "not answering on :11434", `${kick("dev.grosher.ollama")}  (log: ~/Library/Logs/grosher-ollama.log)`);
else if (exposed.length) line(false, "Ollama", `${JSON.parse(version.body).version}, but listening on ${exposed.join(", ")}: open to the network`, `Ollama → Settings: turn off "Expose Ollama to the network" (it overrides OLLAMA_HOST), then ${kick("dev.grosher.ollama")}`);
else line(true, "Ollama", `${JSON.parse(version.body).version} on 127.0.0.1:11434 only · ${maxModels} models resident at most · ${parallel} requests at once`);

// 2. Model resident
if (version.status === 200) {
  const ps = JSON.parse((await get(`${OLLAMA}/api/ps`)).body || "{}").models ?? [];
  const m = ps.find((x) => x.name === MODEL || x.model === MODEL);
  if (m) line(true, "Model", `${MODEL} loaded, until ${new Date(m.expires_at).toLocaleString()}`);
  else {
    const tags = JSON.parse((await get(`${OLLAMA}/api/tags`)).body || "{}").models ?? [];
    const pulled = tags.some((x) => x.name === MODEL || x.model === MODEL);
    line(false, "Model", `${MODEL} ${pulled ? "pulled but not loaded" : "not pulled"}`, pulled ? `${kick("dev.grosher.ollama")}  (warms it)` : `ollama pull ${MODEL}`);
  }
} else line(false, "Model", "unknown (Ollama is down)", "fix Ollama first");

// 3. Gate: with the token → 200, without → 401
let token = null;
try {
  token = readFileSync(TOKEN_FILE, "utf8").trim();
} catch {}
const gateNo = await get(`${GATE}/api/ps`);
const gateYes = token ? await get(`${GATE}/api/ps`, { headers: { authorization: `Bearer ${token}` } }) : { status: 0 };
if (!token) line(false, "Gate", `no token at ${TOKEN_FILE}`, "see apps/resolver/README.md: Token");
else if (gateNo.status === 401 && gateYes.status === 200) line(true, "Gate", `127.0.0.1:11435, token required (launchd: ${loaded("dev.grosher.gate") ? "dev.grosher.gate" : "not loaded"})`);
else if (gateNo.status === 0) line(false, "Gate", "not listening on :11435", `${kick("dev.grosher.gate")}  (log: ~/Library/Logs/grosher-gate.log)`);
else line(false, "Gate", `answers ${gateYes.status} with the token, ${gateNo.status} without`, gateYes.status === 502 ? "Ollama is down: fix it first" : `${kick("dev.grosher.gate")}  (log: ~/Library/Logs/grosher-gate.log)`);

// 4. Funnel: public, no token → 401 from the gate
let funnel = process.env.GROSHER_FUNNEL_URL ?? null;
let tsNote = "";
if (!funnel) {
  for (const ts of TAILSCALE) {
    const out = run(ts, ["status", "--json"]);
    if (!out) continue;
    const s = JSON.parse(out);
    if (s.BackendState !== "Running") tsNote = `Tailscale is ${s.BackendState}`;
    else if (s.Self?.DNSName) funnel = `https://${s.Self.DNSName.replace(/\.$/, "")}`;
    break;
  }
}
if (!funnel) line(false, "Funnel", tsNote || "Tailscale not found", "open -a Tailscale, then: tailscale funnel --bg 11435");
else {
  const hostname = new URL(funnel).hostname;
  const dns = new Resolver();
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
  const status = await dns
    .resolve4(hostname)
    .then(
      (ips) =>
        new Promise((done) => {
          const req = request(
            { host: hostname, servername: hostname, path: "/api/chat", method: "POST", headers: { "content-type": "application/json", "content-length": 2 }, lookup: (_h, opts, cb) => (opts?.all ? cb(null, [{ address: ips[0], family: 4 }]) : cb(null, ips[0], 4)), timeout: 8000 },
            (res) => {
              res.resume();
              done(res.statusCode);
            },
          );
          req.on("timeout", () => req.destroy(new Error("timeout")));
          req.on("error", () => done(0));
          req.end("{}");
        }),
    )
    .catch(() => -1);
  if (status === 401) line(true, "Funnel", `${funnel} answers 401 without the token (public DNS)`);
  else if (status === -1) line(false, "Funnel", `${hostname} not in public DNS`, "tailscale funnel --bg 11435  (Funnel must be on, not only Serve)");
  else line(false, "Funnel", `public POST /api/chat → ${status || "no answer"}, expected 401`, status === 502 ? "the gate is down: fix it first" : "tailscale funnel --bg 11435; tailscale funnel status");
}

// 5. Worker /health: probes the upstream itself
const h = await get(`${WORKER}/health`, {}, 10000);
let hb = {};
try {
  hb = JSON.parse(h.body ?? "{}");
} catch {}
if (h.status === 200 && hb.ok) line(true, "Worker", `${WORKER}/health ok (${hb.provider}${hb.upstream === "ok" ? `, upstream ${hb.ms} ms, model ${hb.modelLoaded ? "loaded" : "cold"}` : ""})`);
else if (!hb.reason) line(false, "Worker", `${WORKER}/health → ${h.status || h.error}`, "npm run deploy -w @grosher/resolver");
else {
  const fix = /token/.test(hb.reason) ? "npx wrangler secret put OLLAMA_TOKEN  (paste the token file's value)" : /not set|not point/.test(hb.reason) ? `npx wrangler secret put OLLAMA_UPSTREAM  (paste ${funnel ?? "the Funnel URL"})` : "fix the lines above";
  line(false, "Worker", `degraded: ${hb.reason}`, fix);
}

for (const l of lines) console.log(l.text);
process.exitCode = lines.every((l) => l.ok) ? 0 : 1;
