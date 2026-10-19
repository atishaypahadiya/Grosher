# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Grosher is

Grocery navigation: a shopping list in, the shortest walk through the store out, with live reroute as
items are checked off. The app opens **Grosher**, our own designed Whole Foods-style market in
`packages/stores/grosher` (`design/store-grosher.md` is its spec; 85 × 70 m with a cut corner, produce under a
skylight, bulk, 10 centre aisles, beer and wine, the service counters and dairy on the far east wall, frozen,
a food hall, 324 shelf categories). The synthetic Walmart-style Supercenter in `packages/stores/demo` (30
aisles, 298 categories) is kept for the tests and as the Walmart reference taxonomy a Walmart survey matches
its signs against; the app never offers it. Both share one 47,000-item catalog (the Instacart 2017 product
list plus a seeded remainder), which resolves most everyday items at aisle precision without a survey. Real stores get surveyed with the built-in map editor. `DESIGN.md` is the visual contract; its boards are in
`design/boards/`. The boards win on feel, `DESIGN.md` wins on numbers. The boards predate the "Papaya" warm
half and are kept as drawn: for colour, ink and plates `DESIGN.md` is the reference, and the README shows
screenshots of the app as built (`apps/web/public/project/img/`), not the boards.

## Layout

```
package.json          npm workspaces: packages/*, apps/*. Root scripts: test, typecheck, bench, dev.
packages/core         @grosher/core  routing engine + item resolution. Zero deps, no build step, Node ≥ 22.18 runs the .ts.
packages/stores       @grosher/stores store data: grosher/ (the default store), demo/{store,catalog}.json, demo/textures/, departments,
                      slots, geometry validation, generator scripts.
apps/web              @grosher/web   Vite + React 19 + TypeScript PWA: list, 3D trip, checkout, editor.
apps/resolver         @grosher/resolver optional Cloudflare Worker (Hono) that asks Claude for departments.
docs/superpowers/specs design notes from earlier sessions.
```

Dependency direction: `web → core, stores`; `resolver → core` (the shared LLM prompt); `stores → core`
(types, and the engine in its tests); core's tests take the demo store from stores as a devDependency.
Workspace packages resolve by symlink; `exports` point straight at `src/index.ts`, so nothing is compiled.

## Commands

```bash
npm install                              # once, at the root
npm test                                 # core (node --test), stores (node --test), web (vitest)
npm run typecheck                        # tsc --noEmit in every workspace
npm run dev                              # Vite dev server for apps/web, http://localhost:5173 (host: true for phones)
cd apps/web && node scripts/contrast-gate.mjs http://localhost:4173 --report   # contrast gate against vite preview (CI runs it)
npm run bench                            # core: route vs. list-order baseline, 5–30 stops, with each row's saved p10–p90, then a 14-stop range on its own seed (-- --store grosher: the same 30 items on Grosher)

cd packages/core && node --test --test-name-pattern="reroute" test/solver.test.ts     # one core test
cd apps/web && npx vitest run test/trip.test.ts                                      # one web file
cd apps/web && npm run build && npx vite preview                                     # production build + SW
npm run gen:demo -w @grosher/stores      # regenerate demo/store.json, categories.json and the base catalog rows from scripts/taxonomy.ts
npm run gen:grosher -w @grosher/stores   # regenerate grosher/{store,categories,catalog.base,rehome,lists}.json + finish textures (run after gen:demo or a demo catalog change)
cd packages/stores && UPDATE_SNAPSHOTS=1 node --test test/grosher.test.ts   # after a deliberate Grosher map edit: rewrite the hero-route snapshot
npm run import:instacart -w @grosher/stores  # products.csv → catalog.instacart.json through aisle-map.json (needs the CSVs)
npm run seed:catalog -w @grosher/stores      # fill catalog.seeded.json from the local model, resumable (--only a,b · --redo · --reconcile [--file])
npm run merge:catalog -w @grosher/stores     # base + import + seeded → catalog.json, reconciled, sources in the header
npm run eval:everyday -w @grosher/stores     # the blind 150-item fixture, offline and with the model (--catalog f [--catalog g] · --offline · --store grosher)
npm run gen:textures -w @grosher/stores  # regenerate the placeholder textures + textures.json
cd packages/core && node --test test/resolution-fixture.test.ts   # prints the per-layer hit-rate tables
npm run dev -w @grosher/resolver         # wrangler dev on :8787 (anthropic provider only; needs .dev.vars)
npm run chain:status -w @grosher/resolver   # the Mac → worker chain, one ✓ / ✗ line per link with the fix
cd apps/web && node scripts/boot-resilience.mjs     # stale worker + old state + a deploy → the app renders (CI runs it)
cd apps/web && node scripts/survey-flow.mjs http://localhost:4173 --shots /tmp/s   # survey mode end to end, mocked sensors (CI runs it)
```

Web tests run in jsdom, where WebGL does not exist, so the trip screen under test always uses the flat
map fallback. Node's own `localStorage` stub shadows jsdom's; `apps/web/test/setup.ts` replaces it and
stubs `canvas.getContext`.

## Routing engine (`packages/core`)

Read `src/types.ts`, then `graph.ts`, then `solver.ts`.

- `StoreGraph`: nodes in local metres (y down), edges (optionally one-way: turnstiles, checkout lanes),
  `ShelfLocation`s pinned to an edge at an offset (plus Walmart aisle / section / modular, side L / R / E,
  `shelf` 0 = bottom, zone, tags), one entrance, many checkout lanes, one exit. Rendering-only additions:
  `fixtures` (polygons with height, department, aisle sign, and `bays` / `shelves` / `depth`) and
  `departments` (color, texture file, `fixtureKind`: gondola, coldcase, produce, bakery, counter).
  A `Stop` is a list item resolved to one or more candidate locations plus tags
  (`frozen|chilled|hot|heavy|bulky|fragile|produce`; `bulky` is big and light, rides under or on top of the
  cart, no penalty, and the trip sheet says "bulky, under the cart"). Rendering-only: `outline` (the building's wall, Grosher's cut
  corner), `skylights` (daylight in 3D), a department's `finish` (wood / stainless), a fixture's own
  `fixtureKind` (the cold-beer doors in the beer aisle), and the kinds `servicecase`, `coffin`, `bins`.
- `WalkGraph` splits each edge at its shelf locations into virtual `loc:<id>` nodes and runs heap Dijkstra;
  `Router` caches one single-source run per node.
- `Router.solve({stops, fromNodeId?, weights?, mode?})`: up to `EXACT_LIMIT` (13) stops → Held–Karp over
  (visited mask, last stop, candidate point), exact with penalties and multi-location items; above that →
  2-opt + Or-opt from three starts (greedy, then two seeded shuffles; `HEURISTIC_RESTARTS`) with candidates
  chosen by a layered shortest path. The local search uses **delta evaluation**: with each stop's point fixed
  to the last DP choice, a move is scored by the edges it changes (plus the reversed interior for 2-opt,
  since walking distances need not be symmetric) and by the penalties of the positions whose preceding set
  or position changed; an accepted move is followed by one DP to re-pick points. Median solve on the demo
  store: 18 stops 3.6 ms, 25 stops 8 ms, 30 stops 18 ms (was 30 / 131 / 306 ms with full re-evaluation);
  three starts keep the 12-stop gap to exact under 10% (one start sat at 16.8%). The end cost picks the best
  checkout lane. `routeForOrder` scores a fixed order (the "vs. your list in order" baseline); `reroute`
  re-solves the remaining stops from the current node.
- **Never throws on a location.** `Router.placeable(stops)` keeps each stop's locations the map has and
  leaves out a stop with none (warned on the console); `solve`, `reroute` and `routeForOrder` route the rest
  and list the left-out stop ids in `Route.unplaced`. The trip (`lib/trip.ts` `routed()`) moves those stops
  from `remaining` to `unplaced` (checkout asks "Where did you find …?"), at start, Got it, Skip, add and
  restore; the progress strip counts only the routed ones.
- Constraints are penalty metres (`DEFAULT_WEIGHTS`): ambient-after-cold 60/stop (cold = any storage tag:
  chilled, frozen or hot, `STORAGE_TAGS`), heavy-late 4/position,
  fragile-early 3/position, produce-after-fragile 15/stop. A new penalty must depend only on (stop being
  added, set already visited, position) or Held–Karp stops being exact. Add it in `prepare()`'s `penalty`
  closure and extend the brute-force comparison test. Bitmasks cap stops at 31 (heuristic) and 20 (exact).

## Item resolution (`packages/core/src/resolve`, `apps/web/src/lib/useResolution.ts`)

A typed list line becomes a `Stop` through these layers, in order; the first hit with confidence ≥ 0.6 wins,
a weaker hit falls through to the next layer, and the llm layer is last so its guess stands even when weak:

| Layer | Source | How | Confidence |
| --- | --- | --- | --- |
| a | `exact` | ids, names and `aliases` (brands too), case / punctuation / quantity ("12 pack", "1 gallon") / plural-insensitive. The shopper's memory overrides it only when it is about that very item (same name or slot): a seeded catalog can be wrong about a shelf | 1 |
| b | `memory` | the shopper's own per-store table (name → location, confirms, confidence), match ≥ .9 | the record's, decayed |
| c | `category` (exact) | a category's name, alias or id names the query outright ("tp", "atta", "strawberries"): that sign's one slot | .79 |
| d | `fuzzy` | trigram Dice and Damerau–Levenshtein over the item labels, threshold .72; token containment only when the query is the shorter side ("yogurt" ⊂ "greek yogurt", never "oat milk" → "milk") | .6–.95 |
| e | `category` (fuzzy) | a near-identical spelling of a category label, threshold .9 ("birthday card" must not become cakes) | .6–.79 |
| f | `llm` | the model picked a category id from the store's list → that category's slot (a department-id fallback keeps the old mocks working) | .30–.49 (the guess band; the wire's .5–.7 mapped down) |
| g | `unknown` | no location; the row says "Needs a place" and offers "Tell me where" | 0 |

The item labels live in a `CandidateIndex` (exact forms by text, trigram postings for the fuzzy shortlist,
word postings for token containment), stored as flat typed-array postings (CSR) plus the form strings: the
47,000-item catalog is ~146,000 forms, 27 MB of heap, ~1 s to build, ~6 ms a query. It serialises to
`IndexParts` (structured-clonable, transferable) and `CandidateIndex.fromParts` rebuilds it in tens of ms.
**In the app** the full catalog's index is built in a Web Worker (`apps/web/src/lib/indexWorker.ts`, driven
by `lib/indexer.ts`) and cached in IndexedDB under `index:<storeId>` keyed by `catalogHash` (cyrb53 over
ids, names, aliases and slots), so a new catalog version pays one build and every later visit a lookup.
Measured on the production build in headless Chromium at 390×844: the list screen is interactive at 117 ms cold
and 89 ms warm; the index is ready at 990 ms
cold (924 in the worker) and 141 ms warm (59 in the worker). Until it lands the resolver works from the
base rows, the pending rows and the signs (`ResolveContext.index` is the prebuilt index, searched before
`catalog`'s own small one), and the model's batch waits. Where there is no Worker (jsdom) the build is
synchronous. Categories have the same index, built on the main thread (298 rows).

**Every answer is checked against the active map** (`ResolveContext.locations`, the store's location ids;
core's `onMap()` wraps every layer): a location the map does not have is dropped; an answer left with none
is re-placed through the category its shelf name or canonical name names (`categoryLayer`, exact), else it
does not count and the item falls through, ending as unknown ("Needs a place"). So no stale id reaches the
solver or storage. The model never names locations: it picks a category id from the store's list, enforced
by the schema's enum and by `parseLlmResults` (anything else is null); the app maps the category to its slot.
**Storage comes from the shelf**, never from the item's words, its aisle or its department: chilled /
frozen / hot (`STORAGE_TAGS` in core types, one list every reader uses) are the storage of the category at
the item's location; all three are picked late (the cold-last penalty) and read "· last" on the chip. The
deli's hot case (`rotisserie`, Rotisserie chicken & hot food) is the demo's one hot category, pinned with
the cold set in the test; the trip sheet says "hot, so it's near the end". Every shelf location carries its
category's tags (`gen-demo` writes `tags` on all 298, `[]` for ambient; survey drafts copy them), and three
readers use them: `withStorage` in core on every answer, `Router.placeable` (so the cold-last penalty sees
the shelf's storage even for a restored trip's or a catalog row's stale tags), and the list chip's "· last".
Heavy / fragile / produce stay the item's. The demo's cold set is pinned in `packages/core/test/storage.test.ts`
(62 cold categories: the dairy case, A18–A21 freezers, A22 cheese and chilled dips, meat, deli cold cases,
cut fruit and cut vegetables; 1 hot: rotisserie); shelf-stable milk and plant milk (A17), every drink,
coconut and evaporated milk, shelf-stable creamer, and salads & greens, mushrooms and fresh herbs are
ambient. **A department id answer
places nothing** in a store with categories (it used to land non-grocery items in dry goods); the prompt
says null when no listed category fits (measured: sunglasses, a phone charger, motor oil, a birthday card,
flip flops → null; gochujang, furikake, kombucha, dashi still placed). **Answer versions**
(`LLM_ANSWERS_VERSION` in `llmPrompt.ts`, stored as `Learning.llmVersion`): 1 = department ids, 2 =
category ids or null; on load, model guesses saved under an older version and confirmed at most once are
asked again (with the memory row one Got it made of such a guess), twice-confirmed ones stay.
**Saved state on load** (`revalidateLearning` in `lib/learning.ts`, every load, logged when it changes
anything): pending catalog entries at locations the map lacks are re-placed by category or emptied (kept,
they ask); memory rows are re-placed by category at guess confidence (≤ .49) or kept as they are (they
resolve as "Needs a place"); model answers naming a category the store lacks are dropped so the item is
asked again; lists (names) are never touched. Why: on 16 Oct the model picked a *department* and the app
cached that department's first location (oat milk → `DAIRY-8`, map v2); map v3 (17 Oct, `81b01d5`) renamed
every location (`DAIRY-L1`…), and a confirmed (≥ .6) stale entry that answered before the full index was in
made the solver throw at startup ("stop llm:oatmilk: unknown location DAIRY-8"). `test/stale-locations.test.tsx`
and boot-resilience G / H keep it fixed.

`text.ts` holds normalisation and similarity; `index.ts` the layers, the index, `pendingEntry()` (an llm
result as a catalog entry with `source: "llm"` so it resolves offline next time) and the memory rules;
`llmPrompt.ts` the prompt, the JSON schema (category-id enum per store) and `parseLlmResults()` shared by
every provider. Pure and synchronous: the app owns I/O.

**In the app** (`useResolution`): learning state per store lives in IndexedDB (`lib/db.ts`, in-memory
fallback): pending catalog entries, the llm answer cache (including "not placeable"), item memory. The list
re-resolves 150 ms after any change; once the list has been idle 1.5 s, unknowns that were never asked go to
the LLM provider in one batch.
Learning loop: "Got it" → `confirmMemory` (the confirm rule below) on the memory row and on a matching
pending catalog entry, except on the trip for a stop the **model guessed** (`stop.source === "llm"`): that
moves only the pending guess up its ladder and writes no memory row, because tapping Got it to move on is
not the shopper saying where the item lives, and a memory row reads "yours" at once (how "Sunglasses ·
A5 · yours" happened). "Yours" therefore only comes from the shopper's own word: the picker ("It's here",
a shelf tapped), checkout's "Pick aisle", or Got it on an answer that was not a model guess; "Not here" → `demoteMemory` (the miss rule; below .6 the next trip re-asks);
"Tell me where" / "Pick aisle" → `placeMemory` (.9), and from the checkout screen also a confirmed catalog
entry (`source: "memory"`). The picker opens with the map's current guess pre-highlighted and a one-tap
"It's here" that confirms it (Got it rules), so confirming is faster than correcting.

**Confidence model** (`packages/core/src/confidence.ts`, pure, `now` passed in). Every catalog entry and
memory row carries `{confidence, confirms, misses, lastConfirmed, lastMissed}`; a surveyed package entry
has none of them and reads as 1.

| Rule | Effect |
| --- | --- |
| "Got it" (`confirmed`) | confidence moves toward 1 by 30% of the gap; confirms +1; lastConfirmed = now |
| "Not here" (`missed`) | confidence −0.3, floor 0.05; misses +1; lastMissed = now |
| time decay (`decayed`, on read, never stored) | not confirmed in 90 days → −0.1 per further 30 days, floor 0.4; a record never confirmed does not decay |
| bands (`band`) | ≥ .8 confirmed · .5–.8 likely · < .5 guess; the edges belong to the higher band |

A fresh llm answer is a guess by nature: the layer maps the wire's .5–.7 onto .30–.49 and the pending entry
carries that, so three Got its take it guess → likely → likely → confirmed. `ResolveContext.now` feeds the
decay (tests freeze it: the fixture rows were confirmed at t = 1). Surfaces: list chips at full opacity
(confirmed), 80% (likely) or amber "probably A4 · cereal" (guess, `data-band` on the row); the trip sheet
says "Probably here · tell me if not" under a guess; checkout's Make the map better rows say "A guess that
was wrong" for a missed guess. In the editor, the Locations layer's **Confidence** toggle fills each dot by
the weakest band of the entries at that location (solid soil, soil 55%, amber with a rim; hollow when the
map has nothing there) with the miss count beside it, **Stale** keeps only locations with an entry not
confirmed in 90 days or in the guess band, and Validate reports entries per band and the stale count
(`editor/confidence.ts`).

**Reset detection** (`apps/web/src/lib/reset.ts`, pure over a finished trip). A miss is a "Not here", or an
item found on a different aisle than the map's first choice (another shelf in the same aisle is not one).
The store is flagged "possibly reset" when ≥ 3 misses land in one aisle, or ≥ 25% of the trip's placed items
missed. One flag per trip (`id = t_<startedAt>`), stored per store in localStorage
(`grosher.reset.<storeId>` with `dismissedId`), raised at the once-per-trip moment the record is written.
The list screen shows a deep-glass banner ("Demo Supercenter may have moved things · 4 misses on Thursday")
with Review and Dismiss; dismissed stays dismissed until a later trip raises a new flag. Review opens
`#/edit?aisle=A4&items=…&misses=4&date=…`; the editor highlights that aisle's fixtures in lime and lists the
items in a closable panel.

**Brand memory.** An `ItemMemory` row is `{name (canonical), locationId, confirms, confidence, tags,
typedForms[] (every exact string typed for it, first spelling kept, most recent last, max 8), lastUsed,
lastConfirmed}`. "Got it" and the picker pass the typed string through (`Stop.query` carries it onto the
trip). `suggestFromMemory(query, memory)` offers the fullest remembered form whose words contain the query
("yogurt" → "Chobani greek yogurt"; spelling variants count; exact word matches rank first, then recency,
then length); never the LLM. The list row shows it as a dashed lime chip ending in "?"; tapping replaces
the row's text. Typed forms also resolve through the memory layer.

**LLM providers** (`lib/resolver.ts`). Chosen at runtime by the resolver settings (`lib/settings.ts`: the
gear on the list screen opens `SettingsSheet`; `{provider, ollamaUrl, model, workerUrl}` in localStorage
under `grosher.resolver`, defaults from `VITE_RESOLVER_PROVIDER` (`ollama` | `worker`), `VITE_OLLAMA_URL`,
`VITE_OLLAMA_MODEL`, `VITE_RESOLVER_URL` at build time). `providerFor(settings)` builds the provider:

The model picks from the store's ~300 shelf categories, not its departments: the category list (`id: name`,
one per line) rides in the **system message** so it is a constant prefix Ollama caches after the first
call (~3,400 prompt tokens), and the user message is only the items. The schema is `{name, cat, sub, conf,
tags}`; the department comes from the category.

- `ollama` (dev): `POST {ollamaUrl}/api/chat` (default `http://localhost:11434`), model `VITE_OLLAMA_MODEL`
  (default `qwen3:8b`), `think: false`, `format` = that terse schema with the category-id enum, so output
  is strict and short (`num_predict` = 32 + 45 per item; measured 26.6 output tokens per item), temperature 0,
  one call for the whole list after a 1.5 s idle debounce, never per keystroke, 20 s timeout. On mount the
  list screen sends a one-token chat with the system prompt and `keep_alive: 24h`, so the model loads and the
  category prefix is cached before the user types; before
  each call `/api/ps` is checked, and if the model is not resident that one call gets a 60 s timeout and the
  header says "warming up the local model…". In dev every call logs `[resolve] …` with load, prompt-eval and
  generation timings to the console. Measured on an M-series Mac with qwen3:8b: ~2.7 s generation for 5
  items, ~5 s from typing to placed rows. Setup on the Mac: `ollama pull qwen3:8b`; the dev server
  on the Mac calls `http://localhost:11434` (`VITE_OLLAMA_URL`), which Ollama's default origins allow
  (`http://localhost:*`, `http://127.0.0.1:*`), so no `OLLAMA_ORIGINS`. Ollama listens on loopback only (see
  "Resolver uptime"), so this path works on the Mac and nowhere else: a phone, on the Wi-Fi or installed, uses
  the worker. Keep `VITE_OLLAMA_MODEL` on qwen3:8b: a third model resident evicts one of the two the chain
  keeps loaded.
- `worker` (production): the worker in `apps/resolver` at `workerUrl` (dev: `/api`, proxied to `wrangler
  dev` on :8787); the request is `{items, categories: {id, name}[]}` (caps: 48 KB body, 40 items, 400
  categories). The worker's `PROVIDER` var picks its upstream: `ollama` forwards the same batch to the
  Mac's model through Tailscale Funnel and the gate (`OLLAMA_UPSTREAM` + `OLLAMA_TOKEN` secrets, 25 s timeout), or
  `anthropic` makes one Claude call (`claude-haiku-5-5`, effort low, strict tool output in the same terse
  schema). Both return the parsed rows; when the upstream is unreachable, misconfigured or rate-limited the
  worker still answers 200 with every item unknown and `degraded: true`, and the client treats that like an
  outage (note in the header, nothing cached). `tags[]` in the schema comes from the fixed set; when the
  model gives none, the department implies handling only (produce → produce, bakery → fragile), never
  chilled or frozen: storage is the shelf's (below).

Any provider failure (unreachable, timeout, bad JSON) leaves the items unknown and shows the provider's
one-line note in the list header ("Local model offline · unknown items need a tap"). Never an error state.
No key ever ships in the client: `apps/web/test/bundle.test.ts` builds the app and fails on any `sk-ant`.

**Worker deploy** (`apps/resolver`, `wrangler.toml` is committed: `PROVIDER = "ollama"`, `OLLAMA_MODEL`,
`ALLOWED_ORIGIN`, the `[[unsafe.bindings]]` rate limiter at 30 calls per IP per minute; secrets stay in the
CLI). The chain is worker → Tailscale Funnel (`https://<machine>.<tailnet>.ts.net`, a stable hostname) →
the gate on 127.0.0.1:11435 → Ollama on :11434. Ollama has no auth, so the Funnel points at the gate, never
at :11434. Setup, once:

```bash
# token: owner-only file, never in a plist, an env file or the repo
mkdir -p ~/.config/grosher && chmod 700 ~/.config/grosher
umask 077; openssl rand -hex 24 | tr -d '\n' > ~/.config/grosher/ollama-token

# Tailscale (the Mac app, logged in); Funnel enabled for the tailnet in the admin console (HTTPS + funnel attr)
tailscale funnel --bg 11435                 # persists in tailscaled across reboots; `tailscale funnel status` shows the URL

# LaunchAgents: dev.grosher.ollama (setenv, open the app, warm qwen3:8b) + dev.grosher.gate (KeepAlive)
npm run chain:install -w @grosher/resolver  # stops a hand-run gate on :11435 first; --uninstall removes both

# the worker, from apps/resolver
npx wrangler login
npx wrangler secret put OLLAMA_UPSTREAM     # paste https://<machine>.<tailnet>.ts.net
npx wrangler secret put OLLAMA_TOKEN        # paste the token file's contents
npm run deploy -w @grosher/resolver         # prints https://grosher-resolver.<account>.workers.dev → VITE_RESOLVER_URL on Pages

npm run chain:status -w @grosher/resolver   # ✓ / ✗ per link, with the fix (Ollama must be on loopback only)
```

**Resolver uptime.** Nothing is started by hand; after a reboot and login the chain comes back on its own:

| Link | Started by | Notes |
| --- | --- | --- |
| Ollama | `~/Library/LaunchAgents/dev.grosher.ollama.plist` → `apps/resolver/scripts/ollama-login.sh` at login | `launchctl setenv OLLAMA_HOST=127.0.0.1 OLLAMA_KEEP_ALIVE=24h OLLAMA_MAX_LOADED_MODELS=2`, `unsetenv OLLAMA_ORIGINS` (setenv does not survive a reboot, hence every login), then `open -ga Ollama` (a server running with other settings, listening beyond loopback or with a different environment, is restarted to read them), waits for `/api/version`, sends one 1-token `qwen3:8b` chat so the first real request is warm. Log `~/Library/Logs/grosher-ollama.log`. |
| Gate | `~/Library/LaunchAgents/dev.grosher.gate.plist` | `RunAtLoad`, `KeepAlive`, `ThrottleInterval` 5: killed, it is back in under a second (measured 0.3 s). Node by its absolute PATH name (`/opt/homebrew/bin/node`, not the Cellar path). Token from `OLLAMA_TOKEN_FILE` (`~/.config/grosher/ollama-token`; the gate refuses a file others can read). Log `~/Library/Logs/grosher-gate.log`, one timestamped line per request. |
| Funnel | tailscaled (the Tailscale app at login) | `tailscale funnel --bg` is stored in the node's serve config. |
| Worker | Cloudflare | `/health` probes the chain, see below. |

`npm run chain:status -w @grosher/resolver` prints one line each: Ollama up, model loaded, gate up (200 with
the token, 401 without), Funnel live (a public `POST /api/chat` without the token returns 401; the hostname is
resolved through 1.1.1.1 so the request comes back in through Tailscale's ingress, not over MagicDNS) and the
worker's `/health`; each ✗ carries its fix, and the exit code is 1. If the Mac sleeps the worker answers
`degraded: true`, the installed app shows "Resolver offline · unknown items need a tap", and everything the
catalog and memory can place still works. Lid closed = no resolver: keep the Mac awake (`caffeinate -s`).
**Ollama is loopback only** (`OLLAMA_HOST=127.0.0.1`): the gate is its one client, nothing on the LAN or the
tailnet reaches :11434 (it has no auth), and no other device can load a model into the Mac's memory; only
the gate is on the Funnel. The Ollama app's **Settings → Expose Ollama to the network** must stay off: it
overrides `OLLAMA_HOST` with 0.0.0.0 and `OLLAMA_ORIGINS` with `*` whatever launchd says (it was on, in the
app's `~/Library/Application Support/Ollama/db.sqlite` `settings.expose`, and is now off); the login script
logs a warning and `chain:status` fails if anything listens beyond loopback. **Two models resident**
(`OLLAMA_MAX_LOADED_MODELS=2`): on this 24 GB Mac Ollama's Metal budget is 17.8 GiB; qwen3:8b loads at 6.1 GB
and qwen2.5vl:7b at 8.0 GB (4096 context), 14.1 GB together, so a survey's sign reads leave the resolver
model loaded (measured: both resident after a read). A third model (another client, a dev server set to
qwen3:14b at 10 GB) would evict the least recently used one: keep the dev server on qwen3:8b.

The gate only passes `POST /api/chat` and `GET /api/ps` with the exact bearer token
(constant-time compare, 64 KB bodies); everything else is 404 / 401. Set `ALLOWED_ORIGIN` in `wrangler.toml`
to the Pages origin before deploying for real (the `*` is for local dev only; the worker returns 403 to any
other origin once it is set). For Claude instead: `PROVIDER = "anthropic"` and `npx wrangler secret put
ANTHROPIC_API_KEY` (`cp .dev.vars.example .dev.vars` for `wrangler dev`). Payload caps: 8 KB body, 40 items ×
60 chars, 24 departments. Upstream error text never reaches the client. `GET /health` probes the upstream:
for `ollama` one authenticated `GET /api/ps` through the Funnel and the gate (4 s timeout), 200
`{ok, provider, upstream: "ok", ms, model, modelLoaded}` or 503 `{ok: false, degraded: true, reason}` with a
fixed reason (not configured, timeout, unreachable, the gate rejected the token, Ollama down behind the gate,
the gate down behind the Funnel: the gate marks its own answers with `x-grosher-gate`, so a 502 without it is
Tailscale's); `anthropic` is not probed (a probe would be a paid call). It shares the per-IP limiter.
`npx wrangler deploy --dry-run --outdir /tmp/w` validates the bundle without logging in.

**Fixtures** (`packages/core/test/fixtures/`): `resolution.json` is the tuned set, 60 items (20 exact,
12 fuzzy, 8 memory, 12 llm mocked, 8 unknown); the fuzzy threshold was tuned on it and the test asserts
zero misses. `resolution-heldout.json` is 30 items written blind after it (Indian grocery items, brands,
different typos, multi-word); the test prints its table but never asserts, and nothing is ever tuned
against it. These two run over the world they were tuned in: the 30 hand-kept base catalog rows, no
categories, llm mocks keyed by department. Both are 100%. If the held-out fuzzy rate drops below 85%, say
so and leave it. `resolution-everyday.json` is the third: 150 everyday items written blind before the
seeded catalog existed (60 food, 24 brands, 17 household, 19 pharmacy, 18 Indian staples, 12
misspellings), each with the aisle it should land in; `resolution-everyday.test.ts` scores aisle-level
accuracy per source and kind over the full catalog and categories and only reports;
`npm run eval:everyday -w @grosher/stores` repeats it with the local model answering the unknowns. On
17 Oct 2026: **94% without the model, 95% with it** (targets 85 / 95), household, pharmacy and typos 100%,
Indian staples 94%, food 93%. The misses are honest ones ("salmon fillet" to canned salmon, "strawberry jam"
to strawberries). Never tune against it.

## Lists, history and personal data (`apps/web/src/lib/lists.ts`, `history.ts`, `useLists.ts`, `useHistory.ts`)

All of it is per store, in IndexedDB (`lists:<storeId>`, `history:<storeId>`, `learning:<storeId>`; versioned
and validated, see "Never a blank screen" under PWA), with
the in-memory fallback of `lib/db.ts` where IndexedDB is blocked.

- `List` = `{id, name, items: string[], storeId, createdAt, updatedAt, kind: "draft" | "saved" | "usual",
  usedAt: number[]}`. Exactly one `draft` exists; it is the current list and autosaves (the old localStorage
  items and usual trip migrated into it once). `usedAt` is appended whenever a list is loaded onto the draft
  or saved from a trip, capped at 60. "Save as usual trip" writes a `usual` list named after the trip's
  weekday ("Saturday trip") from the bought items only; a second save on that weekday updates it in place.
  `predictUsual` picks, for today's weekday, the usual list used most often on that weekday, else the most
  recently used or updated; the list screen offers it in a deep-glass row when the draft is empty.
- The Lists sheet (`components/ListsSheet`): usual trips, saved lists, history. Tap loads onto the draft
  (Replace / Keep mine when the draft has items matching no saved list), swipe left reveals Delete,
  long-press (500 ms) renames, "Save this list" names the draft as `saved`.
- `TripRecord` = `{id ("t_" + the trip's startedAt, so a trip is recorded once), storeId, date, bought[],
  skipped[], unknown[], walkedM, baselineM, savedM, timeMs, lane, aislesNever, aislesTotal}`, newest first.
  Recorded when the checkout screen shows a finished trip. The card's "vs your last trip" compares time and
  walked metres with the previous record at the store. A history row reopens the checkout screen read-only
  from the record (Share and Save as usual trip work; the map-better questions do not show).
- **Export / import.** The editor's "Include my item memory, lists and trip history" box (off by default:
  this is the shopper's own data) adds `memory.json` (`ItemMemory[]`) and `lists.json`
  (`{lists: List[] without the draft, history: TripRecord[]}`) to Export JSON and Write to package. Import
  JSON recognises both shapes and merges by id (a `draft` is never imported). `buildExport` takes a
  `Personal` = `{memory, lists, history}`.

**Voice entry** (`lib/speech.ts`). Hold the mic, release to stop: Web Speech API (`SpeechRecognition` or
`webkitSpeechRecognition`), `interimResults` and `continuous` on; interim words show in the add pill in
warm ink with a lime underline, each final result (a pause) is split on "and", "then", commas and semicolons and added as items.
Permission denial shows "Microphone not allowed · type instead"; other failures "Voice entry stopped · type
instead"; never an error state. Caveats: the mic is hidden when the API is missing, and hidden in **iOS
standalone (home-screen) mode** by our own rule (`isIosStandalone`, not a missing API: the constructor may
well exist there), because WebKit's recogniser has been reported not to start in home-screen apps; that is
unverified on a device. In its place the list shows "Voice works in Safari, or use the keyboard mic." and,
when the recogniser exists, **Try it here**, which shows the mic on that phone from then on
(`grosher.voice.standalone`); `VITE_SPEECH_STANDALONE=1` shows it for every build. Keyboard dictation covers voice entry wherever the mic is hidden. Headless Chromium exposes a
native `SpeechRecognition`, so a test double must replace both names (the Vitest setup and the Playwright
scripts do).

## Store data (`packages/stores`)

**Grosher** (`scripts/gen-grosher.ts` from `scripts/grosher-taxonomy.ts`; spec `design/store-grosher.md`, its "As
built" section has every refinement) is the default store (`DEFAULT_STORE`, `STORES[0]`). 115 nodes, 159 edges,
122 fixtures, 324 locations and categories. The walk graph is built from corridor centrelines (every crossing a
node, every corridor split there): the west walkway (x 12), produce and bulk aisles, the north walkway, aisles
1–10 (runs east–west at 3.1 m pitch, 2.0 m clear, end caps both ends), the cross aisle (x 52.5), beer / wine /
spirits aisles 11–13, the east walkway in front of the counters (x 73.5), the frozen walkway and frozen aisle
(the runs break once, at x 42.8), the food hall walkway and the café / food hall / bakery aisle, five spurs
into the pharmacy and body care runs. Eight staffed lanes, express and self-checkout (`LANE1`…`LANE8`,
`EXPRESS`, `SELF`) are one-way west onto the front walkway, which runs down to the exit; the solver ends at
whichever is cheapest (every hero list: self-checkout, the southernmost). Locations sit on the corridor in
front of each face, one per category at the centre of its bay run; ids are `A4-L3` on the centre aisles and
`<FACE>-<bay>` elsewhere (`DAIRY-8` is a real Grosher bay; saved state is per store, so the demo's old ids
never meet it). Departments are one per sign or counter ("A4 · world foods", "Sushi · last") and carry a
`finish` (wood / stainless) for the 3D material. Storage (pinned in `test/grosher.test.ts`): hot = rotisserie,
hot bar, soups; 40 chilled (the fresh counters, dairy, cheese, deli, cut fruit and vegetables, sushi, the salad
bar, cold beer); 25 frozen; beer, wine, the café, greens, herbs and mushrooms ambient. **Handling by the
shelf** (`HEAVY` / `BULKY` in `grosher-taxonomy.ts`, `src/handling.ts`, pinned in the test): heavy = about 2 kg
or more for the typical unit, 29 shelves (cases of water, soda, sparkling water, sports drinks, beer and cider;
gallon jugs of milk, iced tea, shelf juice, bleach, detergent and fabric softener; big rice and atta bags, flour,
sugar; ghee and cooking oil; pet food and litter; charcoal; melons, 5 lb potatoes; ice, whole turkeys); bulky = 10
(toilet paper, paper towels, tissues, diapers, incontinence, mops, chips and popcorn). Every carried and base row
takes heavy / bulky from its shelf (the source catalog had 9,785 heavy rows: every soup can and paper towel),
plus heavy for a multipack or case of cans or bottles that says so in its name (`MULTIPACK`, a handful: the
import stripped pack sizes from names, so canned multipacks mostly cannot be told apart from single cans). A
model's guess keeps its own tags. The demo Supercenter keeps its old tags (tests only).
- **Catalog carry-over** (`src/carry.ts`): Grosher's full catalog is the demo's `catalog.json` moved onto
  Grosher's shelves at load time through the shared category ids (the 7 MB file ships once), plus
  `grosher/rehome.json` (964 rows the Walmart taxonomy had to shelve wrong: Instacart's beer, wine and spirits
  were on the bar mixers, its flowers among the batteries, prepared sushi in party trays; name rules in
  `REHOME`, the product's own words only) and 71 base rows (`catalog.base.json`: the demo's 30 with their
  stable ids, then Grosher's own for bulk, flowers, cookware, the food hall and café, fresh green chilies and
  papad, which win an exact tie because they come first). `CATEGORY_PATCHES` adds or removes aliases on reused
  categories for Grosher only ("green chilies" is produce here).
- **Hero lists** (`grosher/lists.json`, `bundle.lists`): four demo lists as a person would jot them. The app
  offers them once per browser as saved lists (`offerShipped`, `grosher.offered.<storeId>`; a deleted one is
  not offered again). `test/grosher.test.ts` resolves every item offline, solves each (Held–Karp, 0.1–2 ms),
  and compares items, order, lane and metres with `test/fixtures/grosher-hero-routes.json`, so a map edit
  shows up as a diff. On 18 Oct 2026, with heavy by the shelf: dal-chawal 315 m vs 445 in list order,
  weekly staples 359 vs 513 (produce first now; before, dish soap and paper towels counted as heavy and pulled
  it to aisle 8 first, 387 m), Friday night 289 vs 523, pharmacy run 256 vs 331. Dal-chawal still leaves produce
  for basmati, atta and ghee, which are heavy.
- **Resolver on Grosher** (`eval:everyday --store grosher`; the blind fixture's demo aisles are translated to
  the Grosher aisles holding their categories): 99% offline (149 / 150) against the demo's 98%. The
  new-shelves set (`test/fixtures/grosher-new-shelves.json`, 33 things Walmart grocery had no shelf for, NOT
  blind) is 29 / 33 offline and 32 / 33 with qwen3:8b on Grosher, 1 / 33 on the demo (sunglasses, nowhere in
  either).
- **What still depends on the demo Supercenter:** the catalog file and its categories (the carry-over), the
  demo department textures Grosher's products sample, survey mode and the surveyed editor (the Walmart
  reference taxonomy), most unit tests and `npm run bench` (default), and the stale-location tests. The
  project page's media and numbers are Grosher's (`capture-project.mjs` runs on the default store).

**The demo Supercenter** (`scripts/gen-demo.ts`, 100 nodes, 151 edges, 65 fixtures, 298 locations) mirrors
a Walmart grocery side plus the near general-merchandise aisles: produce wall by the entrance (right), deli
and bakery on the left wall, meat & seafood and dairy on the back wall, 30 aisles numbered from the produce
side (A1 bread … A7 Asian · Indian · Mediterranean … A12–A15 snacks, A16–A17 drinks, A18–A21 frozen in cold
cases, A22 cheese and lunch meat, A23–A25 paper, cleaning, laundry, A26 pet, A27 baby, A28–A30 health &
beauty), a pharmacy counter front-left and ten lanes. Departments: the nine plus deli, pet, baby and
pharmacy (tinted placeholder textures).

**Taxonomy** (`scripts/taxonomy.ts` → `demo/categories.json`): 298 `Category` rows under 36 aisle signs
the way the signs read ("Cereal · Breakfast"), each `{id, name, group (the sign), aisle, side, bays [from,
to] counted from the entrance-facing end, locationId, department, tags, aliases}`. gen-demo lays each sign's
categories along its aisle side in equal bay runs (25 bays a side) and makes one shelf location per category
at the centre of its run (`A7-L11` = aisle A7, left side, bay 11). Indian staples are named individually
(atta, basmati, dal, ghee, the spices by their Hindi names). A real store replaces this file; see "How to
map a new store".

**Where the catalog's data comes from, and its terms.** `demo/catalog.json` (47,612 items, 7.3 MB,
1.5 MB gzipped, its own precached chunk) is the merge of three sources, each row tagged `origin`:

| Origin | Rows | Source | Terms |
| --- | ---: | --- | --- |
| `instacart` | 44,531 | The Instacart Online Grocery Shopping Dataset 2017 (`products.csv`, `aisles.csv`, `departments.csv`), via the Kaggle *Instacart Market Basket Analysis* competition. Imported by `scripts/import-instacart.ts` through the hand-written `data/instacart/aisle-map.json` (134 aisles → our categories, 21 departments → ours). No model. | **Non-commercial use with attribution** under Instacart's dataset terms; see `data/instacart/README.md`. The CSVs are git-ignored and fetched by hand; only product names and their aisle / department labels are used. Anything commercial must replace this. |
| `seeded` | 3,051 | Generated by the local model `qwen3:8b` on 17 Oct 2026 from the taxonomy (`scripts/seed-catalog.ts` → `demo/catalog.seeded.json`, kept in git because it cannot be regenerated identically). | Model output; no third-party terms. Only the names the import did not already cover. |
| base | 30 | Hand-kept rows in `scripts/gen-demo.ts` (`demo/catalog.base.json`), the ids the tests use. | Ours. |

The layout (`store.json`), the taxonomy (`categories.json`) and the placeholder textures are ours. Memory,
lists and history are the shopper's own, in their browser. `scripts/merge-catalogs.ts` builds the merge
(base, then import, then seeded; the first to claim a normalised name wins), runs the reconcile pass and
writes the header that lists these sources; `demo/catalog.instacart.json` and `demo/catalog.merged.json`
are ignored intermediates. On the blind everyday fixture: import alone 96%, seeded alone 94%, merged 98%
at aisle level without the model.

**Instacart import** (`scripts/import-instacart.ts`): each product's canonical name is the product name
cleaned of pack sizes, counts and marketing words ("Organic", "Family Size" become aliases) and of a leading
brand where one is detectable (a known list or a possessive first word; the full name stays an alias); the
product lands in the mapped category whose labels its words match, else the first; near-identical names merge
on the resolver's key; products in Instacart's "other" / "missing" aisles fall back to their department's
default, and the 1,806 with neither are dropped. Wine, beer and spirits map to the bar mixers (no alcohol
aisle in this store).

**Seeded catalog** (`scripts/seed-catalog.ts` → `demo/catalog.seeded.json`, a `{generatedAt, model, seeded,
items}` file): the local model, category by category, up to 25 products each with 2–5 aliases and tags
under a strict JSON schema; retries on bad JSON; the file is rewritten after every category so a run
resumes (`--only a,b`, `--redo`). The 8b model fills to the schema's maximum whatever the prompt says and
pads narrow categories with flavours, hence the cap and the "X with Y" fold; 298 categories took 85 min and
gave 4,064 items. **Reconcile** (`src/reconcile.ts`; `seed-catalog.ts --reconcile [--file path]` runs it
alone, and the merge runs it last): an item's name votes for its shelves, so when signs name it, their
slots are its locations and shelves that merely generated it are dropped; a multi-word name inside a
sign's name counts, a lone word does not; aliases that are another sign's name or another item's name
elsewhere go; frozen / chilled tags stay only where a kept shelf has them; duplicates by the resolver's key
merge. The 30 hand-kept base rows are never touched; a duplicate of one is dropped. On the import this took
the everyday fixture from 87% to 96%.

- `demo/store.json` (StoreGraph with 65 fixtures and the department table), `demo/categories.json`,
  `demo/catalog.base.json` (30 rows, the synchronous `bundle.catalog`), `demo/catalog.json` (the merge,
  behind `bundle.loadCatalog()`), `demo/catalog.seeded.json`, `demo/textures/<dept>.jpg` + `textures.json`
  (`{dept: {file, w, h, shotAt, repeatMeters}}`).
- `src/index.ts` exports `StoreBundle` = `{store, catalog, loadCatalog(), categories, catalogMeta, textures,
  textureUrl(file)}`: `catalog` is the synchronous base rows, `loadCatalog()` the full file through a dynamic
  import (its own Vite chunk, precached; `maximumFileSizeToCacheInBytes` is 12 MB for it), base rows first.
  `parseStoreBundle` accepts a bare array or a file with a header and checks every category points at a
  real location. The app and the editor load the full catalog on mount; the editor keeps it as a read layer
  under the editable draft (the autosave never holds it). `textureUrl` is a
  `new URL(..., import.meta.url)` so Vite emits the JPEGs as hashed assets (precached by the PWA) and Node
  resolves the same files.
- `src/departments.ts` is the canonical table from DESIGN.md §2; each store carries a copy.
- `src/geometry.ts`: simple-polygon and segment-overlap checks; `fixtureProblems(store)` is used by the
  tests and the editor's Validate.
- `src/resolveContext.ts`: `categoryLocations(categories)`, `llmOptions(categories)` (the `{id, name}` list
  the providers send) and `departmentLocations(store)` (department id → location ids via the fixtures, the
  llm layer's fallback); core stays free of fixture geometry.
- `src/slots.ts`: `fixtureParams` (bays, shelves, depth, height defaults by kind), `slotFor(store, location)`
  → fixture, bay (counted from the entrance-facing end), face, shelf, flat-map rect, shelf height;
  `offsetForBay` moves a location to a bay's centre. Shared by the editor picker, the lit slot, the stop
  cards and the product layout.
- `scripts/gen-demo.ts` derives the demo fixtures from the aisle edges (1.4 m blocks each side, merged where
  they meet and share a department; 1.0 m counters); a counter stays a counter whatever department staffs
  it. Real stores are not generated; they are surveyed.

## Web app (`apps/web/src`)

Screens are state-driven in `App.tsx`: list → trip → checkout, plus `#/edit` (hash route; path routes need a
host rewrite, deliberately not done yet). The ground gradient and blooms sit behind every phone screen in a
centred 430px column.

- The list's footer (`.cta-wrap`): the Route CTA and its "% shorter" line on one full-width plate (the
  ground's deep green, fading in over its top 28 px), and the list pads its bottom by the footer's measured
  height (`--footer-h`, a ResizeObserver), so rows pass under it covered and the last one scrolls clear. The
  contrast gate checks it on a 14-item list at the top and scrolled to the end: no two text runs from
  different blocks overlap, no list text shows through the plate (rows tinted magenta, the plate sampled),
  the last row ends above the footer.
- `components/ListScreen` shows the resolved rows (`useResolution`): a source glyph per row (exact check,
  fuzzy wave, memory clock, llm star, unknown mark), chip opacity = confidence, llm guesses in the amber
  guess colour ("probably A4 · cereal"), brand suggestion chips, "Tell me where" opening `PickerSheet` (the
  flat map, tap a shelf), the Lists pill and sheet, the gear opening `SettingsSheet` (resolver provider,
  URL, model), the usual-trip row, hold-to-speak (`lib/speech.ts`) and the lime Route CTA.
- `lib/trip.ts` is the pure trip state: `gotIt` / `skipStop` / `addItem` reroute from the last checked-off
  node; `summarize` compares walked + to-go against `routeForOrder` of the collected items; snapshots (ids
  only) persist across reloads.
- `components/TripScreen` + `map3d/` is the trip view; `components/CheckoutScreen` + `ShareCard` the share
  card (1080×1920 PNG via html-to-image, off-screen copy; fonts embed because they are same-origin).
- `components/StoreMap` is the flat SVG map (DESIGN.md §4): editor renderer and WebGL fallback. Everything
  in it is sized in screen pixels via the current units-per-px so markers never scale with zoom.
- `editor/` is the map editor, see below.

### 3D stack (`apps/web/src/map3d`)

three + @react-three/fiber + drei + @react-three/postprocessing, loaded lazily (the chunk is ~1 MB, 285 KB
gzipped). The store stays 2D; the scene maps `(x, y) → (x, 0, y)`.

- `fixtures/generators.ts` + `parts.ts`: detailed geometry per department fixture kind (gondola carcass with
  uprights and shelf planes, cold case with glass doors and glow, produce table, bakery table, counter),
  built in a fixture-local frame and placed. `Fixtures.tsx` merges per department: one textured opaque mesh
  plus glass / frame / glow meshes where needed, a hull outline, and the sign atlas mesh.
- `Products.tsx`: one `InstancedMesh` per primitive; `layoutProducts` is deterministic per fixture; the
  visible set is rebuilt on camera settle or leg change: leg-adjacent fixtures and the next stop's first,
  then anything within 25 m, capped at 12,000 instances. `productStats` feeds the perf readout.
- `LitSlot.tsx`: the next stop's bay × shelf × face as a translucent lime volume with a 2 px rim, depth
  test off; it is the selective bloom's selection together with the ribbon's glow line.
- `Ribbon.tsx`: walked / current (with a wide copy for the bloom) / ahead (dashed) as drei `Line`.
- `Overlay.tsx`: markers, stop cards and the two labels are plain DOM outside the Canvas, projected every
  rendered frame by `OverlayProjector`, labels clamped into the map area. Cards (`planCards` in
  `cardPlan.ts`, pure and unit-tested): the next stop's lime card and the two stops after it; every later
  stop is a numbered dot, done stops a ring + check. Each frame the next-stop card, the checkout callout and
  the lime dot + leader are placed; then each of the two stops, in route order: on the map, a card above its
  point (slid sideways inside the area), else stacked directly below the label it hit (dot's side first,
  flush beside the lime leader if needed) with a 1 px leader, else its dot; off the map (off screen, under
  the strip or sheet, behind the camera), an edge chip (number, name, walking distance, arrow) on the ray
  from the area's centre, placed after the cards and slid along its edge to clear them. Boxes keep 4 px
  apart. The projector writes `data-mode` (card / stacked / chip / dot) on the stop's item and places its
  parts in screen pixels. No distance switch: the same at every zoom and flattened. Never use drei `Html` here: one React root per marker, and React 19 warns on each
  unmount. Never `createPortal` DOM from inside the Canvas: R3F's reconciler rejects it.
- `CameraRig.tsx`: 42° **horizontal** field (`verticalFov(aspect)`, clamped 42–80°), tilt 58°, yaw −18°.
  `solveFraming` works in screen space on a scratch camera: fits the leg (padded 15%) into the area the
  trip screen measures between the progress strip and the sheet, next stop at that area's upper third, the
  you-dot at its lower third when the leg has the depth; both endpoints are hard constraints; the floor is
  a 30 m visible span (≈39 m); slack slides the store up first, then toward the footprint. Zoom 12–90 m,
  eases 480 ms. Drag pans, shift-drag or two-finger twist orbits ±25°, pinch/wheel zooms, flatten tweens to
  top-down and persists in `localStorage`.
- `Scene.tsx`: gradient background texture, `fogExp2` in haze (0.006), hemisphere + directional light,
  floor at white 8% with a white 30% edge, one selective bloom pass over the lit fixture and the ribbon glow
  with intensity driven by camera distance. The vignette is CSS on the trip screen (`.trip-vignette`).
- `frameloop="demand"`: anything that should repaint must `invalidate()`.

**Perf gate** (DESIGN.md §3: ≤ 70 draw calls, ≤ 12,000 product instances): open the trip with `?perf=1`;
`Perf.tsx` writes `window.__grosherPerf = {calls, triangles, programs, frameMs, instances, productFixtures,
distance, tilt, lit}` with `gl.info` accumulated across all passes. Hull outlines of every fixture are one line batch (one call for the store, not one per department).
Last measured by the CI perf gate (`apps/web/scripts/perf-gate.mjs`, run 39063622947, 17 Oct 2026, DPR 1, the
30-aisle demo store with the 47,612-item catalog): default framing 38 calls / 520 instances; down an aisle after
two items 44 calls / 10,373; flattened 43 calls / 10,373. Frame time from headless Chromium is SwiftShader (software)
and is not a device number; measure that on a phone.
The Playwright scripts that drove these checks live outside the repo; the pattern is: `vite dev`, fill the
list, Route, `waitForFunction(() => window.__grosherPerf.frames > 100)`, read the object, screenshot.

### Hero close-ups (`apps/web/src/hero`): full-detail aisles

Two zoom levels. The overview stays as above; a zone that has a **hero close-up** (`HERO_ZONES` in
`src/hero/index.ts`: today Grosher's Bulk & pulses, `aisle: "BULK"`) opens at eye level when the next stop is
in it (or a stop in it is tapped: `stopUnder` hit-tests the overlay's `data-key` items). The scene keeps the
overview until the zone's chunk and textures are in, its programs compiled (`compileAsync`) and every buffer
uploaded (one draw into a 1 × 1 target from the door), so no frame of the arrival stalls (measured on an M4
Pro at 390 × 844 × 3: a 120–450 ms pause before the camera moves, then 84 frames none over 17 ms).
- **The arrival** (`CloseUpCamera`, two moves, each eased on its own): a descent of 480 ms on a curve that
  stays out over the walkway, never above the zone, its view on a point gliding from where the overview
  looked to the aisle mouth (never the sky), to the **door** (`Target.door`: eye level, outside the zone's
  ceiling, at the nearer open end of the aisle, or 2.1 m out from a south-facing island bin); then a walk in
  (360–760 ms by its length, a 1.2 cm head bob, both off under reduced motion, which cuts) to stand 2.45 m
  from the bin, turned to face it, the bin in the middle of the band between the strip and the sheet. The
  way out walks back to the door and rises to the overview's pose. `envRef` (0 overview … 1 eye level, from
  the camera's height between 9 m and 2.2 m) blends the scene: the fog and background to a warm dark
  (`#2A1F17`, .03), the overview's lights and skylight spots down (lights fade, never leave the scene: that
  recompiles every program), the overview's fixtures to 40% (`Fixtures dimRef`). Look ±57° yaw / ±17° pitch,
  pan along the zone, dolly −0.9…+1.75 m (to arm's length, 0.7 m); no free flight. Back: the pill or a flick
  down (> 90 px in < 450 ms), remembered for that stop; the next stop leaving the zone walks out on its own.
  While it is open the products, ribbon, lit slot and overlay are off, the zone's and its backdrop's overview
  fixtures (`hideFixtures`) are left out, and the trip header and sheet turn to plates and warm deep glass.
- **Light is per pixel** (`kit/light.ts`, one patch on every kit material): 35 lights (19 track spots aimed at
  the shelf and island at 3000 K, 2 on the centerpiece, 10 recessed downlights, the skylight's daylight over
  produce, 3 washes on the aisle 1 gondola), each a cone with a sharp edge (softness 6–12% of its angle)
  through three's own `RE_Direct`, so the pools are crisp and the polished concrete and glass catch real
  highlights; shadows are analytic: a fragment is dark where its line to a light crosses a listed slab (the
  five shelf planks, the island top), so every plank throws a shadow line onto what is under it. No shadow
  maps, no extra passes. Contact shadows are decals (`kit/decals.ts`: one instanced, multiplied quad per
  pack on its plank, per sack and pot, at the foot of the shelving and the island; one draw call). Vertex /
  instance colours carry only a tint and corner occlusion. The ambient is one hemisphere (warm bounce); the
  ceiling has a little light of its own (the reference's ceiling is lit by bounce). `lightAt` / `shadowAt`
  are the same maths in TypeScript, for the tests.
- **Grain at its real size**: the grains atlas (8 × 4 cells of 256 px, `GRAIN_SHAPES` in `bulk/recipe.ts`)
  draws each shape at its size in mm within a cell of `cellM` metres (a 4.2 mm masoor lentil in a 6 cm cell,
  ~18 px; rajma 15 mm in 14 cm), flat grains at random tilts so a pile of lentils reads as tilted discs. The
  `tiles` patch maps it from the world along the surface's main axis (no stretch when a bin's fill is
  scaled) with `textureGrad` across the cell's wrap, and lays a bin's front and sides in bands 3–5 cm deep, a
  shade apart, against the acrylic. The **target** bin also gets real grains (`kit/grains.ts`): low-poly
  solids at real size over its visible surface (its front behind the acrylic, or a scoop bin's mound), each
  a shade apart, capped at 40,000 triangles; powders and flakes stay texture.
- **The shelf kit** (`src/hero/kit`, procedural in code: no Blender here or in CI, deterministic, the zone a
  46 KB chunk): `geom.ts`, `pieces.ts` (square-steel shelving, thick pine planks each cut from a different
  part of the board, header boards tilted toward the aisle, jute sacks slumped with folds, a lumpy rolled rim,
  frayed fringe and a mill's stencil, clay pots and stacked matkas, a dark clay pot with a rope lip and a
  sheaf of wheat with real ears, the chakki: two dressed granite wheels, grain round the eye, a pale peg, a
  spout, a round wooden tray on four posts; conduit, tracks with lit lenses, downlights; for backdrops,
  produce stands and a gondola), `products.ts` (pouches in three sizes, kraft bags, woven 1 / 5 / 10 kg
  sacks, cartons, jars, spice jars, ghee tins, glass oil bottles, tins: built once, placed and **merged per
  material**, so 584 packs are a few draw calls; labels through a per-vertex `aCell`, contents through
  `aGrain`), `templates.ts` (the instanced bins: they are the targets, lifted 3 cm and pulled 6 cm), `bake.ts`
  (tint and occlusion), `materials.ts` (KTX2, tiers, the patches; steel, copper, paint, caps and tin lids are
  one white material coloured per vertex), `light.ts`, `decals.ts`, `grains.ts`.
- **The recipe** (`src/hero/bulk/recipe.ts`, pure data; `zone.ts` assembles it): five wall sections west to
  east under PULSES & DALS · RICE & GRAINS · FLOURS & ATTA · NUTS & SEEDS · DRIED FRUIT, each three 1.2 m bays:
  per section what its floor tier, its two middle tiers and its top stock (`Section.tiers`, `top`), front row
  and a second row behind, no two neighbours alike (the test checks every row), sizes, lean and gaps
  varied; three gravity bins at eye level; matkas, some stacked and lidded, on top. The island's 56 scoop
  bins; the centerpiece on the floor (four sacks: white, green, yellow and orange as in the reference, the
  chakki, the pot of wheat); the clay-plaster wall; a ceiling over the zone only (x 49.4–68.6, y 1.5–7.6) with
  a fascia round its open sides, facing down only (from above it is not there). **The backdrop**: beyond it,
  the four produce stands nearest (tilted crates of fruit drawn as grain piles at fruit size) under the
  skylight's frame and glow, the produce wall's near end, the aisle 1 gondola's face full of packs, the beer
  aisle's cases; the rest of the store's floor; everything further fades into the warm dark.
- **Textures** (`scripts/gen-hero-textures.mjs` → `src/hero/assets/*.ktx2`, committed; needs `basisu`): drawn
  on canvases in headless Chromium, `-y_flip`: pine, tan clay plaster + normal, khaki polished concrete, pale
  jute (a 2.5 mm weave with slubs) + normal, terracotta, dressed granite + normal (ETC1S, normals too), the
  grains atlas 2048 × 1024 (+ normals at half size, ETC1S), labels 2048 × 1280 (138 house-brand labels each
  drawn at its pack's front aspect so lettering reads true, and 55 bin tags; UASTC), header boards (UASTC),
  cutouts 1024 × 512 RGBA (sack stencils, the jute fringe, wheat ears; UASTC, alpha-tested). Hi 1.84 MB, lo
  0.61 MB. Tier: `?tier=hi|lo` pins it; lo on ≤ 3 GB memory or ≤ 4 cores, or after a close-up whose arrival
  ran under ~30 fps (remembered in `grosher.heroTier`). Precached; on the GPU only while a zone is open.
- **Fallback**: no WebGL, or a zone that fails to load, shows the flat shelf image
  (`public/hero/bulk/<category>.webp`, `scripts/capture-hero-flat.mjs`, rendered from the close-up itself).
- **Close-up budget** (`src/hero/budget.ts`, `scripts/hero-gate.mjs` in CI): ≤ 70 draw calls, ≤ 250,000
  triangles, ≤ 16 MB GPU textures, ≤ 2,500 KB download, nothing fetched before a close-up opens. The gate reads
  the worst frame of the arrival (the page's clock slowed 40×), eye level, down the aisle, and a scoop bin
  facing out over the store. Measured 19 Oct 2026: arriving 61 calls / 206k triangles, eye level 47 / 184k
  (with the target's real grains), down the aisle 47 / 154k, scoop bins 56 / 166k; 7.5 MB textures (BC on a
  desktop; ASTC on an iPhone can be up to twice); 2,140 KB download. On the M4 Pro's GPU (Metal) at 390 × 844
  × 3, uncapped: 2.5 ms a frame median, 3.8 ms p95 (an iPhone's GPU is several times slower: check it there
  with `?debug=perf`). SwiftShader frame times (CI) are software rendering, not a device number.
- **References** for the look are kept in `design/refs/` (git-ignored: third-party photos, not ours to
  publish); `.work/` is the ignored place for local captures and comparison images.
- **The next aisle**: a recipe beside `bulk/` (sections, tiers, labels), its lights and slabs, an entry in
  `HERO_ZONES` (its aisle, the overview fixtures it and its backdrop replace), its labels in the generator,
  its flat images. The kit, the light, the camera and the gate carry over.

### Texture pipeline

One 512×512 JPEG (q80) per department, tiled every 2 m on every shelf of that department. Placeholders
come from `npm run gen:textures -w @grosher/stores` (color + grain + soft shelf bands). Real photos replace
them file for file: shoot straight on from ~1.5 m, square crop. Two ways in:

1. Editor → texture tool (or the Fixture texture slot on a location) → Replace: any image is cover-cropped
   and re-encoded to 512² JPEG in the browser, shown immediately in the Textures layer and in Preview in 3D,
   and included in Export / Write to package together with an updated `textures.json` (`shotAt` = today).
2. Drop the file into `packages/stores/<store>/textures/` and edit `textures.json` by hand.

Budget: 9 × ~30 KB today; keep the set under ~1.2 MB. Everything in `textures/` is precached by the PWA.

### Editor (`apps/web/src/editor`, route `#/edit`, desktop 1280)

`model.ts` is pure: hit-testing (`pick` prefers node → location → edge → fixture), operations that return a
new draft (nodes snap within 0.8 m, corridors chain and dedupe, doors, fixture rectangles, locations with the
corridor's aisle as default, items on shelves, department textures, `assignCategory`: a category's slot
becomes a location and its aisle, side, bay and department follow) and `validateDraft` (doors, fixture
geometry and departments, catalog references, reachability of every location and lane from the entrance to
the exit, and the category report: categories without a slot, slots without a category, the counts).
The draft is `{store, catalog, categories}`. `io.ts` builds the export (`store.json` with `version + 1`,
`catalog.json`, `categories.json`, `textures/textures.json`, new images) and writes it; Import JSON
recognises `categories.json` by its `locationId` + `group` rows. Layers: graph, fixtures, locations,
**Categories** (each sign's name beside its slot), Confidence, Stale, textures, underlay. Tools: select,
corridor, fixture, shelf location, doors, **Category** (search the signs, pick one, tap the slot), texture,
measure. The location inspector lists the categories at the slot with their sign and bay run.

**Write-to-package flow.** Drafts autosave per store in `localStorage` (`grosher.editor.<storeId>`). "Write
to package" (Chrome / Edge only: File System Access API) opens a directory picker; choose
`packages/stores/<storeId>` and the editor writes the files in place, then `git diff` shows the survey.
Elsewhere, "Export JSON" downloads the same files to copy in by hand. "Import JSON" accepts a store, a
catalog, or a `{store, catalog}` bundle. "Reset draft to the package" discards local edits.

### Survey mode (`apps/web/src/survey`, route `#/survey`, phone first)

Map a real store (Walmart Story Rd #5435 is the default) in one walk; the draft map comes out of the
survey, and the editor fixes it on the Mac.

- **Calibrate** once ("Walk 10 m", Start / Stop): stride = 10 / steps, pace = 10 / seconds, saved per phone
  in `grosher.calibration`, with the walk's raw accelerometer samples (`trace`: a real trace can become a
  detector fixture). **Walk:** Entrance (origin (0, 0); its compass heading is the reference axis, "into
  the store", up on the map); per aisle Sign photo → Start → walk → End, quick tags (aisle number on a big
  numpad, End cap, One side only) on the aisle being walked or the last one; Pin (Produce, Dairy wall,
  Meat, Frozen, Bakery, Deli, Pharmacy, Checkout lane, Exit, Custom); Undo reverses exactly the last tap
  (`SurveyAction`: an event, a photo, a tag change; event ids are made before the update so updaters stay
  pure). Finish and Build save at once; otherwise the survey autosaves 600 ms behind the taps.
- **Sensors** (`sensors.ts`, `steps.ts`): `requestSensors()` inside the tap (iOS asks for motion and
  orientation then); steps from the magnitude of `accelerationIncludingGravity`: low-pass 4 Hz, minus a
  0.4 Hz baseline, peaks above max(0.3 m/s², 1.6 × the high-frequency noise RMS, 0.4 × the running step
  peak), ≥ 250 ms and ≥ 60% of the recent interval apart, re-armed below the baseline, and only in rhythm (a
  peak counts with a neighbour within 1.5 s: a lone bump while standing is not a step). Heading:
  `webkitCompassHeading` (iOS) or `deviceorientationabsolute` alpha, ≤ 2 Hz, circular mean per leg. No
  accelerometer sample within 2.5 s of starting: the survey is timed (`motion: false`), every leg seconds ×
  pace. **Fixtures** `test/fixtures/motion/*.json` are SYNTHETIC (`scripts/gen-motion-fixtures.mjs`, a
  seeded walking model): six named traces were the tuning set and must be exact; eight `heldout-*` traces
  (own seeds, random cadence 1.4–2.1 Hz, amplitude, noise, tilt, 30–60 Hz) were never tuned against:
  156 of 160 steps, the miss is heldout-3 (fast walking, 2.06 Hz, sampled at 30 Hz: 14 of 18). Add real
  phone traces as `recorded-*.json` (the calibration walk's `trace`).
- **The survey file** (`model.ts`, versioned `{format: "grosher.survey", version: 1}`): raw `steps` (every
  step's time), `headings` ([time, degrees]), `events` (the taps), `photos` (by id with status and reading),
  the calibration; derived metres are never stored, always recomputed. In IndexedDB as `survey:<storeId>`,
  photos as `survey-photo:<id>` (≤ 1024 px JPEG, q .82). Export = one JSON with the photos inline as data:
  URLs, through the share sheet where there is one (AirDrop to the Mac) or a download; Import on any
  browser.
- **Signs** (`signQueue.ts`): capture never waits; photos queue and are read one at a time whenever online
  (5 s backoff doubling to 5 min, at once on `online`), with a per-photo status in the list. The reader
  (`signReaderFor` in `lib/resolver.ts`) is the worker's `POST /sign` (→ Funnel → gate → Ollama
  `qwen2.5vl:7b`, `OLLAMA_VISION_MODEL`) or, on the dev path, Ollama's `/api/chat` directly with the
  settings' "Sign model". Prompt, schema and parser are in `@grosher/core` (`resolve/sign.ts`), and
  `matchSign()` runs the words through the category layer (a sign line or its fragments, "&" "/" "·",
  generic words like "Foods" dropped) to categories at .6–.79, the aisle number off the sign, sign-group
  headings, the unmatched rest. Measured on this Mac: 22 s a sign warm, 62 s cold (the 6 GB model loading),
  24 s through the deployed worker; `ollama pull qwen2.5vl:7b` (6 GB) once. The gate's body cap is 2 MB.
- **Derivation** (`derive.ts`, pure): legs between taps → metres (steps × stride, or seconds × pace) and a
  direction relative to the reference heading, squared to the nearest right angle within 30° (else kept and
  reported); dead reckoning gives every tap a point. `buildDraft` → the editor's `Draft`: taps as nodes
  (merged within 0.8 m), the walk as edges, aisle ends on one line chained into cross aisles, shelf blocks
  either side of each aisle (one side when tagged; up to 1.2 m, half the gap to the next parallel aisle;
  dropped and reported when a walked leg crosses one), the sign's categories as locations along the aisle
  (left / right in turn) with the reference categories re-homed onto them, an end cap location, pins as
  nodes (Checkout lane → checkout, Exit → exit, departments → their label anchor). The built draft is
  `grosher.surveydraft.<storeId>` (what the editor's Reset returns to) and the working copy
  `grosher.editor.<storeId>`; `#/edit?store=<storeId>` opens it (`surveyed.ts`), and the inspector's Survey
  panel re-derives with a corrected stride (asks first: it replaces the edits) or exports the file.
- **Tests:** `test/survey-steps.test.ts`, `test/survey-derive.test.ts` (a simulated walk: lengths, spacing,
  snapping, timing fallback, re-derive, undo, a draft that validates and routes),
  `packages/core/test/sign.test.ts`, the worker's `/sign` tests, and `node scripts/survey-flow.mjs <base>
  [--shots dir]` (CI): Playwright with the page clock faked and the sensors mocked (`survey-driver.mjs`, also
  used by the contrast gate for all eleven survey screens): calibrate, three aisles with sign photos taken
  offline, pins, an undo, back online, build, export, the editor at 1440, and the file imported into a fresh
  browser. Sign photo fixtures: `test/fixtures/signs/` (rendered, not photographed).

### Project page (`apps/web/public/project/`, served at `/project/`)

A static write-up, no React: `index.html` with its CSS inline (nothing render-blocking), `project.js` for the
one animation (a lime token round the reroute loop in the pipeline diagram, visible only on the connectors:
inside a box it hides and that box's border turns lime) and play-while-visible for the hero video, `img/` for
the media, `capture.json` for the share card's numbers. Linked from the README's top and the list screen's
footer ("About"). Sections: hero (two columns from 1100 px: text, and the reroute video in a large phone above
the fold), the app (three phones), why (with the pull quote), how it works (steps, pipeline diagram, two
rules), decisions (five Problem / Choice / Result cards, each with one number), architecture (an inline SVG,
a wide variant from 1000 px and a tall one below), results (a bento: bench beside solver over not-measured;
resolution beside performance), interface (the share card live, equal height with the map legend), limits,
footer.

Layout: one grid, content 1120 px and prose 680 px from the same left edge; section gaps 72 px mobile / 120
desktop (`--half-gap` above and below each section). Light per DESIGN.md: each section is its own gradient
slice, meeting seamlessly (haze → lime-green → leaf → deep, then back up to leaf at the footer), with one or
two blooms kept inside it vertically (a bloom clipped while still tinted draws a seam). Ink follows the region:
warm ink (`--ink-warm`) on haze and the mango hand-off, white on green; muted white only where the ground is #276E3E or darker or inside
a card, full white on the leaf footer. Every figure carries an HTML comment with its source file or commit;
update the page when the README bench, the fixtures, the perf gate or the index timings move.

Media: `node apps/web/scripts/capture-project.mjs http://localhost:4173` against `vite preview` of a fresh build.
It types a 14-item list over 13 aisles in no store order, walks the trip, and writes the 2× WebP stills (list,
3D trip, checkout), the 6-second WebM + MP4 loop with its WebP poster, and `capture.json`. The trip clock is
simulated: the page's `Date.now` is frozen and advanced by each leg at `WALK_MPS` (1 m/s), so the card reads
walking time only. The 3D frame is the mid-trip step (30–70%) nearest 6 of 14 with the next stop's marker in
the map area, the camera within 40 m, and its cards inside the map area and clear of each other; today that
is step 6 at the default framing: Chips in lime, and Paper Towel and Dog Food, off screen to the left, as
edge chips (chips count as cards). `capture.json` records the step and the cards counted at each step
evaluated. The loop's one reroute arrives at that step; its poster shows Coffee with Chips stacked below. The trip's "vs list in order" (49%) sits inside
the bench's 14-stop range (35–54%, `npm run bench`'s last line).

The service worker never answers `/project/` with the app shell (`navigateFallbackDenylist`) and does not
precache it (`globIgnores`). `prefers-reduced-motion` keeps the video paused with controls, the token at rest
and the you-dot's halo still.

### PWA

`vite-plugin-pwa` (`registerType: autoUpdate`, registered in `main.tsx`) with its own worker, `src/sw.ts`
(`strategies: injectManifest`, built to `/sw.js`; typechecked by `tsconfig.sw.json`). It precaches every
emitted file: app, texture JPEGs and the self-hosted fonts (`public/fonts/*.woff2`, declared in
`src/fonts.css`; Outfit and Doto are not loaded from Google, which would miss the cache on the first visit).
**Navigations are network-first** (4 s, then the precached `index.html`; registered before the precache
route, whose `directoryIndex` would otherwise answer `/` from the cache), except `/project/` (the static
write-up, neither precached nor shelled). A new worker takes over at once (`skipWaiting` + `clients.claim`),
deletes every cache but the precache, then (in a message to itself: a reload inside `activate` deadlocks,
fetches wait for activation) pings each window; a window that does not answer or answers "failed" is
reloaded with `WindowClient.navigate`. The app works offline after one online load. Icons are in
`public/icons/` (lime dot on soil). Check with `npm run build && npx vite preview`, load once, go offline,
reload.

**Never a blank screen** (after an iPhone opened to the bare `--deep` body: a stored `grosher.notes` of the
wrong shape threw in the first render, and the old worker served its cached shell cache-first):

- **Persisted state is versioned** (`lib/persist.ts`). `storage.ts` (localStorage) and `db.ts` (IndexedDB)
  write `{__grosher: 1, v, data}`; a bare value from before is version 0. Each key has migrations and a
  validator; a value that fails (corrupt JSON, wrong shape, a version newer than the build) is quarantined
  (`grosher.quarantine.<key>.<time>` / `quarantine:<key>:<time>`, at most 8 kept) and the reader gets its
  fallback; lists and history keep their good rows. A new persisted key gets a schema in `SCHEMAS`; a shape
  change bumps its version with a migration. Read storage only through `load` / `dbGet`, never raw.
  **Everything a store owns is keyed by its id**: `lists:` / `history:` / `learning:` / `index:<storeId>`,
  `grosher.trip.<storeId>`, `grosher.notes.<storeId>`, `grosher.reset.<storeId>`, `grosher.offered.<storeId>`,
  `grosher.editor.<storeId>` (the bare `grosher.trip` / `grosher.notes` are the demo Supercenter's from before
  Grosher, never read now). A device that used the demo keeps its data; Grosher starts clean beside it.
- **The boot guard** is inline in `index.html` (between `<!-- boot-guard -->` markers, so it works when no
  chunk loads): the error plate ("Something went wrong", the error and three frames, Reload, Reset local
  data, the build id; soil plate on the ground, passes the contrast gate), the 8 s watchdog (the plate
  if `Booted` in `main.tsx` has not run; it goes away if the app starts after all), one-time recovery when a
  hashed chunk is missing (a stale build: unregister the worker, delete the caches, reload; at most once a
  minute via `sessionStorage`, a second failure shows the plate) and the answer to the worker's ping.
  Reset local data downloads `grosher-lists-<date>.json` (lists and history per store) first, then clears
  `grosher.*` localStorage, the IndexedDB database, the caches and the worker. `db.ts` keeps one connection
  that closes on `versionchange`, so the delete is not blocked.
- **Boundaries.** `ErrorBoundary` at the root hands render errors to the plate (a chunk error to the
  recovery); `FallbackBoundary` around the lazy 3D map falls back to the flat map once recovery has been
  spent. `#/__crash` throws on purpose (the gate and the test use it). `VITE_BUILD_ID` (the Pages commit,
  else `git rev-parse`) is logged on boot and shown on the plate.
- **Test:** `node apps/web/scripts/boot-resilience.mjs [--shots dir]` (CI runs it): three builds (the
  legacy generateSW worker and guard-less shell via `GROSHER_LEGACY_SW=1`, "old" and "new"), a local host
  that answers missing files with `index.html` as Pages does, and six cases: legacy worker + old-format
  state + an evicted entry chunk → deploy → the new build renders (measured 5.8 s, unaided); this worker's
  next open after a deploy; a missing lazy chunk (one reload); a chunk that keeps failing (one reload, then
  the flat map); a render error (the plate, Reset exports then clears); no first render (the plate at 8 s), and two stale-map cases: a saved answer at a location the map lost (boots, "Needs a
place", the route covers the rest) and a map change under a trip in progress (it resumes without that stop),
and a device with the demo Supercenter's data opening Grosher (clean, hero lists offered, the demo's data
untouched, its paused trip not resumed). It seeds Grosher's keys and aborts every resolver request (none runs
in CI; a local build may point at this Mac's Ollama), so it reads the same everywhere.

### Deploy: Cloudflare Pages (web) + Worker (resolver)

**Pages.** Connect the GitHub repo; production branch `main`. Dashboard settings:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Root directory | `/` (the repo root: the workspaces install from the root lockfile) |
| Build command | `npm run build -w @grosher/web` |
| Build output directory | `apps/web/dist` |
| Node version | `.nvmrc` pins 22 (or set the `NODE_VERSION=22` environment variable) |
| Environment variables | `VITE_RESOLVER_PROVIDER=worker`, `VITE_RESOLVER_URL=https://grosher-resolver.atishaypahadiya3.workers.dev` |

Live: the app at `https://grosher.pages.dev`, the worker at `https://grosher-resolver.atishaypahadiya3.workers.dev`
(ollama upstream through Tailscale Funnel and the gate), installed on an iPhone and verified offline on 17 Oct 2026.

Pages runs `npm clean-install` itself before the build command. `apps/web/public/_headers` ships with the
build: `sw.js`, `registerSW.js`, the manifest and the HTML are `no-cache` so a deploy reaches installed apps
on their next open; `/assets/*`, `/fonts/*` and the Workbox runtime are hashed and `immutable`;
`Permissions-Policy` allows the microphone for voice entry. No `_redirects`: routes are hash-based and
navigations fall back to `index.html` through the service worker. The build also fails on any `sk-ant` string
(`bundle.test.ts`), and CI's perf gate runs on every push (`.github/workflows/ci.yml`,
`apps/web/scripts/perf-gate.mjs`: three framings of the 3D view within 70 draw calls and 12,000 instances),
followed by the contrast gate (`apps/web/scripts/contrast-gate.mjs`) and the boot-resilience test.
`apps/web/.env.local` is git-ignored (it was tracked once): a local Ollama address there would otherwise bake
into the deployed bundle.

**Checking the production build as an installed PWA over HTTPS** (Chromium only registers a service worker
on an origin whose certificate it trusts, so plain `ignoreHTTPSErrors` is not enough):

```bash
brew install mkcert && mkcert -install            # once; the phone needs the root CA from `mkcert -CAROOT` too
mkcert localhost 192.168.1.20                      # the Mac's LAN address, for the phone
npm run build -w @grosher/web
HTTPS_KEY=localhost+1-key.pem HTTPS_CERT=localhost+1.pem npm run preview -w @grosher/web   # https://localhost:4173
```

Load once, Add to Home Screen, go offline, reopen. Last verified in headless Chromium at 390×844 (certificate
trusted by `--ignore-certificate-errors-spki-list`): secure context, worker activated and controlling with
the precache filled, manifest with name / icons 192 + 512 + maskable / `standalone` / `start_url`, and after
`setOffline` a reload rendered the list screen and a routed trip opened in 3D with all nine textures.

## Design rules a future session must not break (DESIGN.md §7, plus what the code relies on)

- No blue anywhere. Lime `#D4FF4A` is the only accent and it means *now*: you, the next stop, the chosen
  lane, the one primary button. No second accent, no status colours on the map.
- No flat background colours on phone screens: the gradient ground + blooms, with white glass for controls
  and deep glass (`--glass-deep`) for content cards. Editor chrome is cream.
- The warm half is "Papaya" (haze `#FF9E6B`, apricot `#F2703A`, the mango hand-off `#E2A23C` under the
  `--lime-green` name, moss `#86B84A`). Text on it is `--ink-warm` `#2A0F06` (muted `rgba(42,15,6,.72)`),
  never soil green and never white; white stays on green. Content cards that start on it use
  `--glass-deep-warm` (.56) so their white ink holds 4.5:1; lime on orange or cream gets `--ring-soil`.
  Focus is one global two-tone ring (`:focus-visible`: 2 px warm ink inside, 2 px lime outside), never per
  component. `apps/web/scripts/contrast-gate.mjs` measures text (≥ 4.5:1), icon glyphs and focus rings
  (≥ 3:1) against the pixels behind them on list, trip (start, mid-route, last leg), checkout and the
  project page; CI fails under target, so run it after any colour, glass or ground change. Every label
  over the 3D scene sits on `--plate` (soil .88 + white hairline) with white or lime text: never put text
  on the scene itself.
- Outfit for words, Doto for every number that matters. No emoji, no Inter / Roboto, no drop shadows (glows
  and blur only).
- Only two labels on the map: the next stop and the checkout callout. Markers and labels never scale with zoom.
- No animation longer than 480 ms; everything respects `prefers-reduced-motion`.
- No "amazing / smart / optimized" copy. Numbers say it.
- Phone screens are a centred column, max 430px; verify at 390×844 and 1440×900.
- Keep the solver's penalties position-and-mask only (exactness), keep Fixture/Department optional (the
  solver never reads them), keep `.ts` imports with extensions and `erasableSyntaxOnly`-safe syntax in
  packages (Node runs them directly).

## How to map a new store

The quick way is **survey mode** (`#/survey` on the phone, see above): one walk gives a draft with aisles,
spacing, sign categories, doors and landmarks; open it on the Mac (`#/edit?store=<id>`, or import the
survey file there) and continue from step 1 below to fix it by hand. The full manual way:

1. **Underlay.** Open `#/edit`, select tool, "Add image" with a floor-plan photo or sketch. Unlock it, drag
   to position, scroll or pinch to scale until a known distance (a 10 m scale bar, aisle spacing) matches;
   lock it. Use the measure tool to check.
2. **Corridors.** Corridor tool: tap along each walkable line; taps snap to existing nodes so loops close.
   Mark checkout lanes and turnstiles one-way in the edge inspector. Doors tool: entrance, exit, lanes.
3. **Fixtures.** Fixture tool: two taps per shelf block; set kind, department, height (1.8 shelves, 1.0
   counters) and the aisle sign code. Walls get `kind: wall`.
4. **Locations.** Location tool: tap on a corridor beside the shelf; fill Walmart aisle / section / modular,
   side (Left / Right / Endcap), zone, tags. Add the items that live there; confidence starts at 0.6.
5. **Textures.** Texture tool: one straight-on photo per department.
6. **Validate.** Fix every error (unreachable locations, missing departments, broken references); warnings
   are floating nodes and unlabelled locations.
7. **Categories.** Photograph every aisle sign. Each sign becomes a group and each line on it a category:
   write them into the store's `categories.json` (or a `taxonomy.ts` like the demo's and generate), one
   category per bay run on one side of one aisle. In the editor the Category tool assigns a category to a
   slot by tapping it, Validate lists categories without a slot and slots without one, and the Categories
   layer shows the signs on the map. ~300 categories is a Supercenter; a neighbourhood market is fewer.
8. **Write.** "Write to package" into `packages/stores/<storeId>` (create the folder first; give the store a
   new `storeId`, `name`, `address`), register the bundle in `packages/stores/src/index.ts`, run
   `npm test` (the stores tests validate every registered store), commit. Preview in 3D along the way.

**What the survey replaces, piece by piece.** The corridors, fixtures and locations (steps 1–4) replace the
generated layout. The aisle-sign photos (step 7) replace `taxonomy.ts` → `categories.json`: that is the
whole mapping from products to shelves, and it is the part that differs store to store. The **catalog
carries over**: product names and aliases are the same at every Walmart, so `demo/catalog.json` is copied
into the new store as is, and because its items point at categories through their locations, re-running
`seed-catalog.ts --reconcile` against the new `categories.json` (or re-seeding only the categories the new
store has and the demo lacks) re-homes every item onto the new slots. Textures (step 5) replace the
placeholders file for file. Memory, lists and history are per store and start empty.
