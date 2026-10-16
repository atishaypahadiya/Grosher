# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Grosher is

Grocery navigation: a shopping list in, the shortest walk through the store out, with live reroute as
items are checked off. One store map exists, a synthetic Walmart-style Supercenter in `packages/stores/demo`.
Real stores get surveyed with the built-in map editor. `DESIGN.md` is the visual contract; its boards are in
`design/boards/`. The boards win on feel, `DESIGN.md` wins on numbers.

## Layout

```
package.json          npm workspaces: packages/*, apps/*. Root scripts: test, typecheck, bench, dev.
packages/core         @grosher/core  routing engine. Zero deps, no build step, Node ≥ 22.18 runs the .ts.
packages/stores       @grosher/stores store data: demo/{store,catalog}.json, demo/textures/, departments,
                      geometry validation, generator scripts.
apps/web              @grosher/web   Vite + React 19 + TypeScript PWA: list, 3D trip, checkout, editor.
docs/superpowers/specs design notes from earlier sessions.
```

Dependency direction: `web → core, stores`; `stores → core` (types, and the engine in its tests); core's
tests take the demo store from stores as a devDependency. Workspace packages resolve by symlink; `exports`
point straight at `src/index.ts`, so nothing is compiled.

## Commands

```bash
npm install                              # once, at the root
npm test                                 # core (node --test), stores (node --test), web (vitest)
npm run typecheck                        # tsc --noEmit in every workspace
npm run dev                              # Vite dev server for apps/web, http://localhost:5173 (host: true for phones)
npm run bench                            # core: route vs. list-order baseline, 5–30 stops

cd packages/core && node --test --test-name-pattern="reroute" test/solver.test.ts     # one core test
cd apps/web && npx vitest run test/trip.test.ts                                      # one web file
cd apps/web && npm run build && npx vite preview                                     # production build + SW
npm run gen:demo -w @grosher/stores      # regenerate demo/store.json + catalog.json from scripts/gen-demo.ts
npm run gen:textures -w @grosher/stores  # regenerate the placeholder textures + textures.json
```

Web tests run in jsdom, where WebGL does not exist, so the trip screen under test always uses the flat
map fallback. Node's own `localStorage` stub shadows jsdom's; `apps/web/test/setup.ts` replaces it and
stubs `canvas.getContext`.

## Routing engine (`packages/core`)

Read `src/types.ts`, then `graph.ts`, then `solver.ts`.

- `StoreGraph`: nodes in local metres (y down), edges (optionally one-way: turnstiles, checkout lanes),
  `ShelfLocation`s pinned to an edge at an offset, one entrance, many checkout lanes, one exit. Rendering-only
  additions: `fixtures` (polygons with height, department, aisle sign) and `departments` (color, texture file).
  A `Stop` is a list item resolved to one or more candidate locations plus tags
  (`frozen|chilled|heavy|fragile|produce`).
- `WalkGraph` splits each edge at its shelf locations into virtual `loc:<id>` nodes and runs heap Dijkstra;
  `Router` caches one single-source run per node.
- `Router.solve({stops, fromNodeId?, weights?, mode?})`: up to `EXACT_LIMIT` (13) stops → Held–Karp over
  (visited mask, last stop, candidate point), exact with penalties and multi-location items; above that →
  greedy + 2-opt + Or-opt with candidates chosen by a layered shortest path. The end cost picks the best
  checkout lane. `routeForOrder` scores a fixed order (the "vs. your list in order" baseline); `reroute`
  re-solves the remaining stops from the current node.
- Constraints are penalty metres (`DEFAULT_WEIGHTS`): ambient-after-cold 60/stop, heavy-late 4/position,
  fragile-early 3/position, produce-after-fragile 15/stop. A new penalty must depend only on (stop being
  added, set already visited, position) or Held–Karp stops being exact. Add it in `prepare()`'s `penalty`
  closure and extend the brute-force comparison test. Bitmasks cap stops at 31 (heuristic) and 20 (exact).

## Store data (`packages/stores`)

- `demo/store.json` (StoreGraph with 33 fixtures and the department table), `demo/catalog.json` (30
  `Stop`s), `demo/textures/<dept>.jpg` + `textures.json` (`{dept: {file, w, h, shotAt, repeatMeters}}`).
- `src/index.ts` exports `StoreBundle` = `{store, catalog, textures, textureUrl(file)}`. `textureUrl` is a
  `new URL(..., import.meta.url)` so Vite emits the JPEGs as hashed assets (precached by the PWA) and Node
  resolves the same files.
- `src/departments.ts` is the canonical table from DESIGN.md §2; each store carries a copy.
- `src/geometry.ts`: simple-polygon and segment-overlap checks; `fixtureProblems(store)` is used by the
  tests and the editor's Validate.
- `scripts/gen-demo.ts` derives the demo fixtures from the aisle edges (1.4 m blocks each side, merged where
  they meet and share a department; 1.0 m counters). Real stores are not generated; they are surveyed.

## Web app (`apps/web/src`)

Screens are state-driven in `App.tsx`: list → trip → checkout, plus `#/edit` (hash route; path routes need a
host rewrite, deliberately not done yet). The ground gradient and blooms sit behind every phone screen in a
centred 430px column.

- `components/ListScreen` resolves typed names against the catalog (`lib/resolve.ts`), shows department-dot
  chips (`lib/chips.ts`), hold-to-speak (`lib/speech.ts`) and the lime Route CTA.
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

- `Fixtures.tsx`: one merged mesh per department (texture tiled every `repeatMeters` on top and side faces,
  department hex at 70% as the grade), one merged `EdgesGeometry` per department, all aisle signs in one
  canvas atlas on one merged plane mesh, and the lit fixture (next stop) drawn alone with lime emissive and
  rim. `fixtureForLocation` picks the block on the location's side of the corridor.
- `Ribbon.tsx`: walked / current (with a wide copy for the bloom) / ahead (dashed) as drei `Line`.
- `Overlay.tsx`: markers and the two labels are plain DOM outside the Canvas, projected every rendered frame
  by `OverlayProjector`. Never use drei `Html` here: one React root per marker, and React 19 warns on each
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

**Perf gate** (DESIGN.md §3: ≤ 60 draw calls): open the trip with `?perf=1`; `Perf.tsx` writes
`window.__grosherPerf = {calls, triangles, programs, frameMs}` with `gl.info` accumulated across all passes.
Last measured on the demo store at 390×844 in headless Chromium: 42–46 calls, ~750–900 triangles. Frame
time from headless Chromium is SwiftShader (software) and is not a device number; measure that on a phone.
The Playwright scripts that drove these checks live outside the repo; the pattern is: `vite dev`, fill the
list, Route, `waitForFunction(() => window.__grosherPerf.frames > 100)`, read the object, screenshot.

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
corridor's aisle as default, items on shelves, department textures) and `validateDraft` (doors, fixture
geometry and departments, catalog references, reachability of every location and lane from the entrance to
the exit). `io.ts` builds the export (`store.json` with `version + 1`, `catalog.json`,
`textures/textures.json`, new images) and writes it.

**Write-to-package flow.** Drafts autosave per store in `localStorage` (`grosher.editor.<storeId>`). "Write
to package" (Chrome / Edge only: File System Access API) opens a directory picker; choose
`packages/stores/<storeId>` and the editor writes the files in place, then `git diff` shows the survey.
Elsewhere, "Export JSON" downloads the same files to copy in by hand. "Import JSON" accepts a store, a
catalog, or a `{store, catalog}` bundle. "Reset draft to the package" discards local edits.

### PWA

`vite-plugin-pwa` (`registerType: autoUpdate`, registered in `main.tsx`). Workbox precaches every emitted
file: app, texture JPEGs and the self-hosted fonts (`public/fonts/*.woff2`, declared in `src/fonts.css`;
Outfit and Doto are not loaded from Google, which would miss the cache on the first visit). Navigations fall
back to `index.html`. The app works offline after one online load. Icons are in `public/icons/` (lime dot
on soil). Check with `npm run build && npx vite preview`, load once, go offline, reload.

## Design rules a future session must not break (DESIGN.md §7, plus what the code relies on)

- No blue anywhere. Lime `#D4FF4A` is the only accent and it means *now*: you, the next stop, the chosen
  lane, the one primary button. No second accent, no status colours on the map.
- No flat background colours on phone screens: the gradient ground + blooms, with white glass for controls
  and deep glass (`--glass-deep`) for content cards. Editor chrome is cream.
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
7. **Write.** "Write to package" into `packages/stores/<storeId>` (create the folder first; give the store a
   new `storeId`, `name`, `address`), register the bundle in `packages/stores/src/index.ts`, run
   `npm test` (the stores tests validate every registered store), commit. Preview in 3D along the way.
