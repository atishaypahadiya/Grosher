# @grosher/resolver

Cloudflare Worker (Hono) with one endpoint, `POST /resolve`, taking `{items: string[], categories: {id, name}[]}`
and returning `{results: Guess[], degraded?: true}`: for every item the store's shelf category it is on (or null),
tags and a confidence. The web app calls it when it is installed (https), because an installed app cannot fetch a
plain-http Ollama on the LAN.

Two upstreams, chosen by `PROVIDER` in `wrangler.toml`:

- `ollama` (default): forwards the batch to the Mac's Ollama through Tailscale Funnel, `OLLAMA_UPSTREAM`
  (`https://<machine>.<tailnet>.ts.net`), with a shared bearer `OLLAMA_TOKEN` that `scripts/ollama-gate.mjs`
  checks in front of Ollama.
- `anthropic`: one Claude call (`claude-haiku-5-5`, strict tool output), `ANTHROPIC_API_KEY`.

Same prompt, schema and parser as the client's direct path (`@grosher/core`). Origin check (`ALLOWED_ORIGIN`),
per-IP rate limit (30 per minute), body and item caps. When the upstream is unreachable the answer is still 200
with every item unknown and `degraded: true`; nothing upstream ever reaches the client. `GET /health` probes the
upstream (one authenticated `GET /api/ps` through the Funnel and the gate, 4 s) and answers 503 with
`degraded: true` and a fixed reason when it fails.

```bash
npm test -w @grosher/resolver                 # Hono app, both upstreams and the health probe with fakes
npm run dev -w @grosher/resolver              # http://localhost:8787 (anthropic: needs .dev.vars); the web app's Vite proxy forwards /api
npx wrangler deploy --dry-run --outdir /tmp/w # bundle check, no login
```

## The Mac side: worker → Funnel → gate (127.0.0.1:11435) → Ollama (:11434)

Ollama has no auth, so the Funnel points at the gate, never at Ollama.

```bash
# 1. token: owner-only, never in a plist, an env file or the repo
mkdir -p ~/.config/grosher && chmod 700 ~/.config/grosher
umask 077; openssl rand -hex 24 | tr -d '\n' > ~/.config/grosher/ollama-token

# 2. Tailscale: the Mac app, logged in, Funnel allowed for the tailnet (admin console: HTTPS on, funnel node attribute)
tailscale funnel --bg 11435                   # stored in tailscaled, survives reboots; prints https://<machine>.<tailnet>.ts.net

# 3. LaunchAgents (stops a gate started by hand on :11435 first)
ollama pull qwen3:8b
npm run chain:install -w @grosher/resolver    # --uninstall removes them

# 4. the worker
npx wrangler login
npx wrangler secret put OLLAMA_UPSTREAM       # https://<machine>.<tailnet>.ts.net
npx wrangler secret put OLLAMA_TOKEN          # the token file's contents
npm run deploy -w @grosher/resolver           # prints the workers.dev URL → VITE_RESOLVER_URL on Pages

# any time
npm run chain:status -w @grosher/resolver     # one ✓ / ✗ line per link, with the fix
```

`chain:install` writes two agents to `~/Library/LaunchAgents`:

- `dev.grosher.ollama` runs `scripts/ollama-login.sh` at login: `launchctl setenv` OLLAMA_HOST=0.0.0.0,
  OLLAMA_ORIGINS=*, OLLAMA_KEEP_ALIVE=24h, then opens the Ollama menu-bar app (which reads launchd's environment),
  waits for it and sends one 1-token `qwen3:8b` request so the first real one is warm.
  Log: `~/Library/Logs/grosher-ollama.log`.
- `dev.grosher.gate` runs the gate with node's absolute path (launchd has no PATH), `RunAtLoad` and `KeepAlive`;
  the token comes from `OLLAMA_TOKEN_FILE`, and the gate refuses a file anyone else can read.
  Log: `~/Library/Logs/grosher-gate.log`.

Run by hand instead (no launchd): `npm run gate -w @grosher/resolver` reads the same token file (or
`OLLAMA_TOKEN`).
