# @grosher/resolver

Cloudflare Worker (Hono) with one endpoint, `POST /resolve`, that takes `{items: string[], departments: string[]}`
and asks Claude (`claude-haiku-4-5`, one call for the whole list, strict tool output) which department each item is
shelved in. The web app calls it through `VITE_RESOLVER_URL`; nothing in the client bundle ever holds the key.

```bash
cp .dev.vars.example .dev.vars        # put a real ANTHROPIC_API_KEY in it (git-ignored)
npm run dev -w @grosher/resolver      # http://localhost:8787; the web app's Vite proxy forwards /api/resolve here
npm test -w @grosher/resolver         # Hono app + classifier with a fake Anthropic client

npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY   # the production key
npm run deploy -w @grosher/resolver         # prints the workers.dev URL → VITE_RESOLVER_URL in the web app's .env.production
```
