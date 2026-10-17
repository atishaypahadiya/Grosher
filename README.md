# Grosher

[![CI](https://github.com/atishaypahadiya/Grosher/actions/workflows/ci.yml/badge.svg)](https://github.com/atishaypahadiya/Grosher/actions/workflows/ci.yml)

Grosher turns a shopping list into the shortest walk through the store. Type, paste or dictate the list; each
line is matched to a shelf (the store's catalog first, then your own memory of where things were, then a local
language model for the rest); the route is solved exactly for up to 13 stops with the shopping constraints a
person would apply anyway (frozen last, heavy late, eggs and chips after the cans), and it re-plans from where
you stand every time you check something off. One synthetic Supercenter ships as the demo; real stores are
surveyed with the built-in map editor. It is a web app that installs to the home screen and works offline.
The visual contract is [DESIGN.md](DESIGN.md).

<p>
  <img src="design/boards/01-list.png" width="30%" alt="The list screen: items resolved to departments, the route call to action" />
  <img src="design/boards/02-trip.png" width="30%" alt="The trip: a 3D view of the store with the next shelf lit" />
  <img src="design/boards/03-checkout.png" width="30%" alt="Checkout: time, metres walked, and how much shorter than walking the list in order" />
</p>

## The route

`packages/core` is a zero-dependency routing engine: the store is a graph of corridors in metres with shelf
locations pinned to edges, Dijkstra over it, then Held–Karp (exact, with penalties and multi-location items) up
to 13 stops and a greedy + 2-opt + Or-opt heuristic above that. `npm run bench` against the demo store, random
lists, walking distance only:

| stops | solver | list order | Grosher | saved | solve p50 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 5 | Held–Karp | 324 m | 274 m | 16% | 0.0 ms |
| 8 | Held–Karp | 451 m | 341 m | 24% | 0.1 ms |
| 10 | Held–Karp | 550 m | 377 m | 31% | 0.5 ms |
| 13 | Held–Karp | 655 m | 425 m | 35% | 5.6 ms |
| 18 | heuristic | 928 m | 546 m | 41% | 7.1 ms |
| 25 | heuristic | 1,195 m | 673 m | 44% | 26.1 ms |
| 30 | heuristic | 1,404 m | 751 m | 46% | 73.0 ms |

## Item resolution

A typed line becomes a stop through five layers in order: exact catalog match (names, brands, quantities
stripped), fuzzy match (trigram Dice + Damerau–Levenshtein, threshold .72), the shopper's own per-store memory,
a local language model (Ollama, `qwen3:8b`, one call per list, strict JSON, about 27 output tokens per item) that
names the department, and finally "unknown", which asks for a tap on the map. Two fixtures in
`packages/core/test/fixtures`: a tuned set the thresholds were set on, and a held-out set written blind
afterwards that is only ever reported.

| layer | tuned set (60) | held-out set (30) |
| --- | ---: | ---: |
| exact | 20 / 20 | 8 / 8 |
| fuzzy | 12 / 12 | 8 / 8 |
| memory | 8 / 8 | 6 / 6 |
| llm | 12 / 12 | 6 / 6 |
| unknown | 8 / 8 | 2 / 2 |
| all | 100% | 100% |

What you confirm on a trip is remembered: "Got it" raises confidence, "Not here" lowers it, a tap on the map
places it, and the exact words you typed come back as a suggestion next time ("yogurt" → "Chobani greek
yogurt?").

## Run it

Node 22.18 or newer.

```bash
npm install
npm run dev                 # http://localhost:5173, also on the LAN for a phone
npm test                    # engine, store data, worker, web app
npm run bench               # the table above
```

For the language-model layer, install [Ollama](https://ollama.com), `ollama pull qwen3:8b`, and start it with
`OLLAMA_ORIGINS` allowing the app's origin. The phone uses the Mac's address from `apps/web/.env.local`
(`VITE_OLLAMA_URL=http://192.168.1.20:11434`) while on the same Wi-Fi, or, installed, the Cloudflare worker in
`apps/resolver` that reaches the same model through a tunnel. Without any of it the app still works: items the
catalog and your memory cannot place ask for one tap.

## Map a store

Open `#/edit` on a desktop. Add a floor-plan photo as the underlay and scale it to a known distance; tap along
each walkable corridor (taps snap, loops close); mark the entrance, exit and checkout lanes; draw the shelf
blocks and give each a department and an aisle sign; drop locations on the corridor beside the shelves and list
the items that live there; one straight-on photo per department for the 3D textures; Validate until it is clean;
"Write to package" into `packages/stores/<storeId>`. The step-by-step version is in `CLAUDE.md` under "How to
map a new store".

## Layout

```
packages/core      routing engine + item resolution (no dependencies, Node runs the TypeScript)
packages/stores    store data: the demo Supercenter, departments, shelf slots, generators
apps/web           Vite + React PWA: list, 3D trip, checkout, editor
apps/resolver      Cloudflare Worker: the language-model layer over HTTPS
```

`CLAUDE.md` is the full project guide; `DESIGN.md` the design rules and tokens.
