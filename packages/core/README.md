# @grosher/core

Routing core for Grosher: turns a grocery list into one line through the store, entrance → every item → checkout → exit.

## What's in here

| File | What it does |
| --- | --- |
| `src/types.ts` | Store graph, shelf locations, stops, weights, route types |
| `src/graph.ts` | Builds the walkable graph, splits aisle edges at shelf locations (virtual nodes), Dijkstra |
| `src/solver.ts` | Held–Karp (exact, ≤13 stops) and greedy + 2-opt + Or-opt (above), multi-location items, constraint penalties, reroute, list-order baseline |
| `src/fixtures/demoStore.ts` | Synthetic Supercenter grocery side + 30 items, until the real store map exists |
| `test/solver.test.ts` | DP vs brute force, heuristic gap, cold-last, path continuity, reroute |
| `bench/bench.ts` | Grosher route vs walking the list in typed order |

## Run

Needs Node ≥ 22.18 (runs `.ts` directly, no build step).

```bash
npm install
npm test
npm run bench
npm run typecheck
```

## Model

- **Graph:** nodes are walkable points in local meters; edges are walkable segments (optionally one-way: entrance, checkout lanes). Each shelf location is inserted as a virtual node on its aisle edge, so near-end vs far-end entry is costed correctly.
- **Problem:** open path from a fixed start through every stop, ending at the best checkout lane, then the exit. A stop can have several candidate locations (generalized TSP).
- **Constraints are penalties, in meters:** ambient-after-cold, heavy-late, fragile-early, produce-after-fragile. Each depends only on (stop added, set already visited), so Held–Karp stays exact with penalties included.
- **Reroute:** solve the remaining stops from the last checked-off node.
