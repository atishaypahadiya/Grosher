# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Grosher is

Grocery navigation app: given a shopping list, route the shopper through the store on the shortest path
(entrance → every item → checkout → exit), with live reroute as items are checked off. Target stores are
Walmart Supercenters in San Jose (the fixture names Story Rd / Almaden); no real store map exists yet.

## Repo at a glance (audited 2026-10-16)

Three unrelated pieces. No root package.json, no workspace, no shared tooling, no CI.

| Dir | Stack | State | Verdict |
| --- | --- | --- | --- |
| `backend/` | Python 3.13, FastAPI, one 456-line `main.py` | Working V0 demo, no tests | Superseded for routing. Keep only the store-comparison idea |
| `frontend/` | Create React App 5.0.1 + React 19, one `App.js` | Working V0 demo UI, 1 stale failing test | Outdated (CRA deprecated). Replace, don't port |
| `packages/core/` | TypeScript, Node ≥ 22.18, zero runtime deps | Working, 6 tests pass, benchmarked | **This is the product.** Build on it |

### backend/ — FastAPI "trip optimizer" (Nov 2025)

- `POST /optimize-trip`: lat/lon + list of item names → evaluates two hard-coded stores (Walmart and
  Target San Jose, ~12 items each with price and an (x, y) on a unitless grid, 1 unit ≈ 2 m). Per store it
  returns availability, total price, round-trip drive estimate (haversine at 35 km/h), an in-store route
  (nearest-neighbour over Euclidean points, entrance → items → fixed checkout), walking and checkout time
  estimates, and a total trip time. Best store = (all items available, lowest trip time, lowest price).
- `GET /stores`, `GET /health`, `GET /` also exist. CORS is open to `http://localhost:3000` only.
- Complete for what it is. No DB, no real map, no tests, no item resolution beyond `.strip().lower()`.

```bash
cd backend
pip install -r requirements.txt            # fastapi, uvicorn, pydantic (already installed globally here)
python3 -m uvicorn main:app --reload --port 8000     # or: python3 main.py
curl -X POST localhost:8000/optimize-trip -H 'Content-Type: application/json' \
  -d '{"user_location":{"latitude":37.3382,"longitude":-121.8863},"shopping_list":["milk","eggs","bananas"]}'
```

Verified 2026-10-16: all endpoints return 200; a 5-item list picks Walmart at 9.2 min total trip.

### frontend/ — CRA single-page demo (Nov 2025)

- One component, `src/App.js`: textarea list, lat/lon inputs with browser geolocation, POSTs to a hardcoded
  `http://localhost:8000/optimize-trip`, then renders best-store summary cards, available/missing items,
  other stores, numbered route steps, and an SVG polyline of the route on a grid. `App.css` is 647 lines.
- Boilerplate never cleaned up: `<title>React App</title>`, `logo.svg`, `reportWebVitals`, and `App.test.js`
  is still the stock "renders learn react link" test, which fails because that text is gone.
- `react-scripts` 5.0.1 (CRA) was deprecated by the React team in Feb 2025 and is unmaintained. It still boots
  on Node 25 but prints webpack-dev-server deprecation warnings, and caniuse-lite is 11 months stale.

```bash
cd frontend
npm install
npm start                                   # http://localhost:3000, needs the backend on :8000
CI=true npm test -- --watchAll=false        # 1 test, currently fails (stale boilerplate)
```

Verified 2026-10-16: dev server compiles and serves. Worth keeping from it: the UX shape (list in, summary
cards, step list plus map). Not worth keeping: the code.

### packages/core/ — `@grosher/core` routing engine (Oct 2026)

Pure TypeScript library, no build step: Node ≥ 22.18 runs `.ts` directly (type stripping), so
`tsconfig.json` sets `erasableSyntaxOnly` (no enums, no parameter properties, no namespaces) and
`verbatimModuleSyntax` with explicit `.ts` import extensions. Keep writing it that way.

```bash
cd packages/core
npm install
npm test                                    # node --test test/*.test.ts   (6 tests, ~0.3 s)
node --test --test-name-pattern="reroute" test/solver.test.ts   # single test
npm run typecheck                           # tsc --noEmit
npm run bench                               # route vs. list-order baseline, 5–30 stops
```

Verified 2026-10-16: tests pass, typecheck clean. Bench on the demo store (walking distance only):

```
stops   solver     list order  grosher  saved  solve p50 / max (ms)
   5    held-karp      324 m     274 m   16%     0.0 / 0.2
  10    held-karp      550 m     377 m   31%     0.5 / 1.1
  13    held-karp      655 m     425 m   35%     5.3 / 6.2
  18    heuristic      928 m     546 m   41%     7.0 / 9.0
  30    heuristic     1404 m     751 m   46%    69.9 / 70.7
```

How it works (read `src/types.ts` first, then `graph.ts`, then `solver.ts`):

- **StoreGraph** (`types.ts`): nodes in local metres (y down), edges (optionally one-way, used for entrance
  turnstiles and checkout lanes), `ShelfLocation`s pinned to an edge at an offset, one entrance, many
  checkout lanes, one exit. A `Stop` is a list item resolved to one or more candidate location ids plus
  tags (`frozen|chilled|heavy|fragile|produce`).
- **WalkGraph** (`graph.ts`): splits each aisle edge at its shelf locations into virtual `loc:<id>` nodes, so
  entering an aisle from the near vs. far end is costed correctly. Binary-heap Dijkstra; `Router` caches one
  single-source run per node.
- **Router** (`solver.ts`): `solve({stops, fromNodeId?, weights?, mode?})`. ≤ `EXACT_LIMIT` (13) stops →
  Held–Karp DP over (visited mask, last stop, candidate point), exact including penalties and multi-location
  items. Above that → greedy + 2-opt + Or-opt, with the best candidate per stop chosen by a layered shortest
  path. End cost picks the best checkout lane. `routeForOrder` scores a fixed order (the honest "time saved"
  baseline); `reroute(remaining, currentNodeId)` just re-solves from the current node.
- **Constraints are penalties in metres** (`DEFAULT_WEIGHTS`): ambient-after-cold, heavy-late, fragile-early,
  produce-after-fragile. Each depends only on (stop added, set already visited), which is what keeps
  Held–Karp exact. Bitmasks cap stops at 31 in the heuristic and 20 in exact mode.
- `src/fixtures/demoStore.ts`: synthetic 12-aisle supercenter grocery side plus a 30-item catalog. The only
  store map that exists. Replace with a real map when one is surveyed.

What core does **not** have: an HTTP API, a UI, item-name → `Stop` resolution, inventory or prices, multiple
stores, or a real store map.

## Git history

```
91e0ce2  2025-11-25  Initial commit – Grosher v0          backend/main.py (+ a committed .pyc), frontend as a broken submodule
1d7d93e  2025-11-25  Fix: convert frontend from submodule  frontend/ added as a normal folder (CRA app)
a6850c7  2026-10-16  Routing core                           packages/core/ added, .pyc removed, root .gitignore added
```

Eleven-month gap between the V0 demo and the core. The root `.gitignore` lists `.expo/`, which suggests an
Expo / React Native app was considered but never committed.

## How the pieces relate

Nothing imports anything. The backend and frontend talk over HTTP; core is standalone.

The old backend's in-store routing (nearest-neighbour on Euclidean coordinates, no walls, no aisles, fixed
checkout) is strictly worse than core's graph-based exact/heuristic solver and should be considered dead.
The one thing the backend does that core does not is **compare stores**: price totals, availability, and a
drive-time estimate. That is a product feature worth re-adding later, on top of core, not a reason to keep
the Python service.

### Current architecture

```
  frontend/ (CRA, React 19)            backend/ (FastAPI)                 packages/core/ (TS)
  ┌──────────────────────┐   HTTP      ┌───────────────────────┐          ┌─────────────────────┐
  │ list + lat/lon input │ ──────────▶ │ POST /optimize-trip   │          │ StoreGraph/WalkGraph│
  │ summary cards        │ ◀────────── │ 2 hard-coded stores   │          │ Dijkstra            │
  │ step list + SVG map  │  JSON       │ haversine drive est.  │          │ Held-Karp / 2-opt   │
  └──────────────────────┘             │ nearest-neighbour     │          │ penalties, reroute  │
                                       │ route (Euclidean)     │          │ demo store fixture  │
                                       └───────────────────────┘          └─────────────────────┘
                                                                           (nothing uses it yet)
```

### Recommended architecture

```
                     apps/web  (Vite + React + TS, mobile-first PWA)
                     ┌────────────────────────────────────────────┐
                     │ list entry → resolve items → Stop[]        │
                     │ store map (SVG from StoreGraph) + route    │
                     │ check-off → Router.reroute() in-browser   │
                     └───────────────┬────────────────────────────┘
                                     │ import (npm workspace)
                     ┌───────────────▼────────────────────────────┐
                     │ packages/core   (@grosher/core, unchanged) │
                     └───────────────┬────────────────────────────┘
                                     │ StoreGraph + catalog JSON
                     ┌───────────────▼────────────────────────────┐
                     │ packages/stores  (real store maps, items)  │
                     │ demoStore now; surveyed Walmart maps later │
                     └────────────────────────────────────────────┘

  Later, only if needed: a thin TS API for multi-store comparison and shared lists.
  The solver runs in < 100 ms in the browser, so a server is not required for routing.
```

## What to build next: options

1. **Web app on core (recommended).** New `apps/web` with Vite + React + TypeScript, npm workspaces at the
   root, importing `@grosher/core` directly. Render the demo store from `StoreGraph` as an SVG map, type a
   list, draw the route, tap items to check off and reroute. Mobile-first so it works on a phone in-store;
   make it a PWA. Tradeoffs: ships the differentiator (real routing, live reroute) fastest and proves the
   core API against a real consumer; still on the synthetic map, and no multi-store comparison yet.
2. **Expo / React Native app on core.** Same idea, native. The `.expo/` ignore hints this was considered.
   Tradeoffs: closer to the end-state phone product and gets camera/location APIs; much slower iteration on
   map rendering, more toolchain, and the core API will still change. Premature until the UX is settled.
3. **Real store map first.** Survey one Walmart (Story Rd), encode it as a `StoreGraph` plus an item
   catalog in a `packages/stores` package, add validation tests (connectivity, every item reachable).
   Tradeoffs: this is the real moat and the thing the solver is waiting for, but there is no UI to show it
   in and the survey format is easier to design once a map renderer exists.

Recommendation: option 1, then fold option 3 in as the second milestone once the renderer exists. Delete
`backend/` and `frontend/` when the web app reaches parity with the frontend's current screen (list in,
route out), keeping the store-comparison idea on the roadmap.

## Conventions and gotchas

- Core coordinates are metres with y pointing down (floor-plan convention); the old backend used an
  arbitrary grid with 1 unit ≈ 2 m. Do not mix them.
- Penalty weights are in metres so they trade off directly against walking distance.
- Adding a new constraint to the solver: it must depend only on (stop being added, set already visited,
  position), or Held–Karp stops being exact. Add it in `prepare()`'s `penalty` closure, then extend the
  "held-karp matches brute force" test.
- `Stop.locationIds` with more than one entry means the item is in several places (endcaps); the solver
  picks the location, so never pre-pick it in the caller.
- Node 25 is installed on this machine; core needs ≥ 22.18, CRA runs but warns.
