# Grosher web app on core — design (2026-10-16)

Direction chosen after the repo audit in CLAUDE.md: option 1, a Vite + React + TypeScript web app
on top of `@grosher/core`, with the old Python backend and CRA frontend removed.

## Goal

A phone-usable, offline-capable web app that takes a shopping list, routes the shopper through a
store using `@grosher/core`, reroutes live as items are checked off, and lets a store map be
authored in the browser and exported as data for `packages/stores`.

## Layout

```
package.json            npm workspaces: packages/*, apps/*; scripts: test, typecheck, bench, dev
packages/core           engine only (types, WalkGraph, Router). No fixtures.
packages/stores         data/<storeId>/store.json + catalog.json, typed index, generator script
apps/web                Vite + React + TS, mobile-first PWA, imports core + stores directly
```

Dependency direction: `stores → core` (types only); `web → core, stores`; core's tests import the
demo store from `stores` as a devDependency.

## apps/web screens

- **StoreMap**: SVG render of a `StoreGraph` (edges as aisles, shelf locations as dots, entrance,
  checkouts, exit marked). Pan + pinch zoom. y-down metres mapped to screen via viewBox.
- **List**: textarea; names resolved against the catalog (exact, then case-insensitive; unresolved
  listed as "not found"). Solve draws the route polyline on the map and lists legs in order.
- **Trip**: current stop highlighted. "Got it" advances, "Not here / skip" removes the stop,
  "Add item" mid-trip. Every change calls `Router.reroute()` from the last checked-off node.
  Checkout card shows distance walked vs. the `routeForOrder` baseline for the original list.
- **Edit** (same StoreMap, toggled): tap to add nodes and edges, mark edges one-way, drop
  `ShelfLocation`s on an edge with Walmart-style codes (aisle "A12", section "100" = endcap,
  modular), tag locations, export/import StoreGraph + catalog as JSON for `packages/stores`.
- **PWA**: manifest + service worker via vite-plugin-pwa; works offline after first load.

## Tests

- core: existing 6 tests, now importing the demo store from `@grosher/stores`.
- stores: for every store in `data/`, every shelf location is reachable from the entrance and can
  reach the exit; every catalog location id exists.
- web: Vitest + jsdom smoke render of StoreMap on the demo store.

## Order of work (one commit per step, tests before each commit)

1. `git rm` backend/ and frontend/.
2. Root package.json with workspaces and root scripts.
3. packages/stores; core keeps only the engine.
4. apps/web scaffold + StoreMap — **checkpoint: show the rendered demo store before continuing**,
   then List, Trip, Edit, PWA.
5. Tests listed above.
6. CLAUDE.md updated: new layout, commands, backend/frontend sections removed, store-comparison
   (multi-store price / availability / drive time) kept on the roadmap.
