# @grosher/resolver

Cloudflare Worker (Hono) with one endpoint, `POST /resolve`, taking `{items: string[], departments: string[]}` and
returning `{results: Guess[], degraded?: true}`: for every item the department it is shelved in at this store (or
null), a short shelf category, tags and a confidence. The web app calls it when it is installed (https), because
an installed app cannot fetch a plain-http Ollama on the LAN.

Two upstreams, chosen by `PROVIDER` in `wrangler.toml`:

- `ollama` (default): forwards the batch to the Mac's Ollama through a Cloudflare Tunnel, `OLLAMA_UPSTREAM`,
  with a shared bearer `OLLAMA_TOKEN` that `scripts/ollama-gate.mjs` checks in front of Ollama.
- `anthropic`: one Claude call (`claude-haiku-5-5`, strict tool output), `ANTHROPIC_API_KEY`.

Same prompt, schema and parser as the client's direct path (`@grosher/core`). Origin check (`ALLOWED_ORIGIN`),
per-IP rate limit (30 per minute), body and item caps. When the upstream is unreachable the answer is still 200
with every item unknown and `degraded: true`; nothing upstream ever reaches the client.

```bash
npm test -w @grosher/resolver                 # Hono app, both upstreams with fakes
npm run dev -w @grosher/resolver              # http://localhost:8787 (anthropic: needs .dev.vars); the web app's Vite proxy forwards /api
npx wrangler deploy --dry-run --outdir /tmp/w # bundle check, no login

# the Mac side of the ollama upstream
OLLAMA_TOKEN=$(openssl rand -hex 24) npm run gate -w @grosher/resolver   # 127.0.0.1:11435 → localhost:11434
cloudflared tunnel --url http://localhost:11435                           # prints the https URL

# deploy
npx wrangler login
npx wrangler secret put OLLAMA_UPSTREAM       # the tunnel URL
npx wrangler secret put OLLAMA_TOKEN          # the gate's token
npm run deploy -w @grosher/resolver           # prints the workers.dev URL → VITE_RESOLVER_URL on Pages
```
