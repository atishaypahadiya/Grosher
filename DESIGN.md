# Grosher — DESIGN.md

**The feeling:** the produce aisle at 7 in the morning. Light through lettuce, mist just hit the shelves. Papaya haze up front, a mango hand-off, deep leaf at the back. Thin white lines for everything measured, and one lime point that means *now*.

This is the contract for `apps/web`. The canvas with the mockups is exported at `design/boards/*.png` (Mood, List, Trip, Checkout, Editor, Tokens). When this file and a board disagree, the board wins on feel and this file wins on numbers.

## 1. Principles

1. **The ground is light, never a fill.** Every screen sits on the same gradient and the same blurred blooms. Nothing is a flat color block except glass.
2. **Fixtures are photographed.** The 3D map shows the real shelves of the real store: one tiling photo per department on every shelf run. The store reads as color from far away and as product up close.
3. **One accent, one meaning.** Lime `#D4FF4A` is *now*: the dot that is you, the point on the shelf you're heading to, the chosen lane, the single primary button. Nothing else is lime. Blue does not exist in this app.
4. **Everything measured is a white hairline.** Route, stops, wireframe art, progress: thin white, 40–95% opacity. Meaning comes from opacity and shape, not hue.
5. **Numbers brag, words don't.** Every number that matters is set in Doto (dot matrix), large. Copy is short and on your side: "Got it", "Not here", "Tell me where".
6. **Mist is rendered, not styled.** Fog, bloom, depth of field in the 3D view; blurred radial blooms and backdrop blur in 2D. Soft edges everywhere except type.

## 2. Tokens

The boards in `design/boards/` were drawn before the "Papaya" warm half (haze, apricot, the mango hand-off, moss) and are kept as drawn. Where they differ on colour, ink, glass or plates, this section wins.

### Light (gradient stops, front of store → back)

| Token | Hex | Where |
| --- | --- | --- |
| `--haze` | `#FF9E6B` | Top / front, 0% ("Papaya") |
| `--apricot` | `#F2703A` | ~10% |
| `--lime-green` | `#E2A23C` | ~30%: the mango hand-off between orange and green (the token keeps its name) |
| `--moss` | `#86B84A` | ~50% |
| `--leaf` | `#2E7D46` | ~75% |
| `--deep` | `#184D2E` | 100% / back wall fog |
| `--soil` | `#0F2A1A` | Dark text, lime-on-soil buttons (editor) |

Screen background: `linear-gradient(170deg, haze 0%, apricot 10–12%, lime-green 30–34%, moss 48–55%, leaf 72–80%, deep 100%)`.
Browser chrome: `theme-color` and the manifest's `theme_color` are `--apricot` `#F2703A`; the manifest's `background_color` (the launch splash) is `--haze` `#FF9E6B`.
Blooms (position absolute, `border-radius:50%`, `filter: blur(24–40px)`): cream `rgba(255,180,140,.85)` top-left, lime `rgba(212,255,74,.45)` center, deep `rgba(10,50,28,.8)` bottom-right.

### Ink

- On green regions: white `#FFFFFF`; muted `rgba(255,255,255,.85)`; eyebrow `rgba(255,255,255,.8)`.
- On the orange regions (haze, apricot, the mango hand-off: the top of List, Checkout and the Trip header, the project page's hero and the top of its app section): `--ink-warm` `#2A0F06`, warm brown-black, never soil green; muted `--ink-warm-muted` `rgba(42,15,6,.72)`. Controls there (the list's ghost pills, the add pill's `+`, text, placeholder and mic glyph, the Trip header pills) take it too; voice-entry interim words are warm ink with a 2px lime underline (lime text cannot be read on orange).
- Targets, everywhere: text ≥ 4.5:1 (≥ 3:1 at 24px+, or 18.66px bold); focus rings and the glyphs of icon-only controls ≥ 3:1. Measured against the pixels actually behind each element on the production build by `apps/web/scripts/contrast-gate.mjs`, which CI runs on every push (list, trip, checkout at 390×844; the project page at 390 and 1440, full height) and which fails under target. The trip is measured at three camera states (the start of the route, mid-route, the last leg to the checkout), map labels included: they sit on plates, so they are gated like any other text.
- Location chips on the list are quiet labels: no border, a soil fill `rgba(15,42,26,.34)` a shade darker than the card, solid white text (the likely band's 80% opacity and the amber guess text both stay ≥ 5.4:1).
- The Trip sheet's white glass sits on a soil tint (`rgba(255,255,255,.1)` over `rgba(15,42,26,.34)`) and its secondary pills on `rgba(15,42,26,.3)`, so the muted lines, the lime eyebrow and Not here hold ≥ 4.5:1 over the bright scene.

### Focus

One ring for every control, set globally on `:focus-visible` and never per component: 2px `--ink-warm` against the control (`box-shadow: 0 0 0 2px`), then 2px lime outside it (`outline`, offset 2px). On orange the warm ink carries the contrast, on green the lime does, so one tone is ≥ 3:1 on any ground. It replaces a control's own shadow (glow, ring) while focused, which is why the soil ring on lime controls is drawn inset.
- Rule: pick ink by the region's luminance, never by component. Contrast ≥ 4.5:1 for body, ≥ 3:1 at 24px+.

### Accent and surfaces

| Token | Value |
| --- | --- |
| `--lime` | `#D4FF4A` · glow `0 0 24px rgba(212,255,74,.45)` on buttons, `0 0 18px rgba(212,255,74,.8)` on dots |
| `--glass` | `rgba(255,255,255,.14)` fill · `1px solid rgba(255,255,255,.28)` · `backdrop-filter: blur(18px) saturate(140%)` |
| `--glass-strong` | same with fill `.20` (editor pills on cream use `rgba(255,255,255,.7)`) |
| `--glass-deep-warm` | `rgba(15,42,26,.56)` fill, same border and blur: content cards that start on the warm half (the list sheet, the share card, the reset banner, and the Picker, Settings and Lists sheets), so their white ink stays ≥ 4.5:1 over mango; `.58` in the share-card export (no blur) |
| `--ring-soil` | `inset 0 0 0 1.5px --soil`: any lime control on an orange or cream ground (the listening mic, the project page's hero button), as the editor's lime dots have; inset, so the focus ring lands outside it on the ground |
| `--glass-deep` | `rgba(15,42,26,.22)` fill · `1px solid rgba(255,255,255,.28)` · same blur. Every card that holds content: share card, stat tiles, list sheet, "make the map better" rows. Eyebrows inside it are white 85%. White glass stays for pills, inputs, header controls and the Trip bottom sheet. |
| `--hairline` | `rgba(255,255,255,.18)` row dividers inside glass; `.25` section rules |
| Editor ground | `#F4F1E6` chrome, `#EDE9DB` canvas with 24px dot grid `rgba(15,42,26,.12)` |

### Department colors (the flat-map fills, and the grade applied to each photo in 3D)

| Dept | Hex | Texture file |
| --- | --- | --- |
| produce | `#6CB26A` | `produce.jpg` |
| dairy | `#F2EAD2` | `dairy.jpg` |
| frozen | `#DDEFF0` | `frozen.jpg` |
| bakery | `#E9B46A` | `bakery.jpg` |
| meat | `#E5A2A0` | `meat.jpg` |
| dry | `#E2C9A2` | `dry.jpg` |
| snack | `#F3C96B` | `snack.jpg` |
| drinks | `#8FC9E8` | `drinks.jpg` |
| household | `#D8D4CC` | `household.jpg` |
| checkout | `#DCE3D4` | none (flat) |

Status in text only: confirmed = `--lime`, guess = bakery `#F6D28C`, not here = meat `#F2B5B0`. No separate red/green/yellow.

### Type

- **Outfit** (Google Fonts) 200 / 300 / 400 / 500 / 600. Fallback `system-ui`.
- **Doto** (Google Fonts, dot matrix) 500 / 700 / 900. Only for numbers. Units next to a Doto number are Outfit 300, 40–45% of the number's size.

| Role | Spec |
| --- | --- |
| Hero number | Doto 700 · 72–96 · `letter-spacing: .03em` · `line-height: .9` |
| Metric | Doto 700 · 17–28 · `.04em` (timer, meters, route preview) |
| Display | Outfit 200 · 40–64 · `-.02em` · `line-height 1.02` |
| Title | Outfit 300 · 26 · `-.01em` |
| Heading | Outfit 500 · 15 |
| Body | Outfit 300 · 13–14 |
| Eyebrow | Outfit 500 · 10 · `.14em` · uppercase · white 80%, **lime** when it names the current thing |
| Aisle sign (3D shelf front) | Outfit 500 · ~7 map units · `.08em` · white 90% on `rgba(10,40,22,.55)` |

### Shape, space, motion

- Radius: 999 on every button, pill, chip and input; 26–28 on sheets and the share card; 18 on tiles; 2–3 on map fixtures.
- Gutter 16 (sheets inset 12). Safe-area top 58. Touch targets ≥ 44. Primary button 52–58 tall.
- No drop shadows. Only glows (lime) and blur (glass, blooms).
- Motion: the you-dot halo pulses (1.6s, scale 1→1.5, opacity .35→0). Reroute: old ribbon fades 120ms, new ribbon draws 240ms. Camera moves ease-out 480ms. Everything respects `prefers-reduced-motion`.

## 3. The 3D trip map (`apps/web/src/map3d/`)

Stack: `three` + `@react-three/fiber` + `@react-three/drei` + `@react-three/postprocessing`. The store graph stays 2D meters (y down); the scene maps `(x, y) → (x, 0, y)` so the floor is the XZ plane.

**Scene, back to front**

1. **Fog**: `fogExp2`, color `--haze`, density 0.006 (~12% at 60 m, ~30% at 100 m). Fog plus the CSS overlay together never hide more than 40% of the next stop at its screen position. Scene background is the same gradient as the chrome (a full-screen gradient plane behind the camera, or CSS behind a transparent canvas).
2. **Floor**: plane the size of the store footprint, material `rgba(255,255,255,.08)` over the gradient, 1px white 30% edge (a thin line geometry around the perimeter).
3. **Fixtures**: generated per department `fixtureKind`, merged per department (one textured opaque mesh, plus glass, frame and glow meshes where the kind needs them), material `MeshStandardMaterial` with `map` = the department's texture (`RepeatWrapping`, repeat every 2 m on every visible face), `color` = department hex at 70% blend, roughness .85. Fixture params: `bays` (default round(length / 1.22)), `shelves` (5 gondola, 4 cold case, 3 produce / bakery), `depth` (default half the block width), `height` (1.8 shelves, 1.0 counters, 1.1 produce, .95 bakery). **Materials by zone** (a department's `finish`, Grosher): `wood` is a light-oak texture on the body with uprights, end panels and rails in black steel (#2A2824), the dry aisles, bulk, floral, bakery, café and counters; `stainless` is a pale brushed texture at roughness .3 (no metalness: the scene has no environment map, so metal would only darken), the fresh and cold zones, under **neutral light**: its shader reduces every light term to its luminance, so the orange haze sky and the warm key keep their strength but not their colour on steel (a small grey emissive keeps the shaded sides steel too); the cold-case frames and glow of those zones do the same. The haze stays on the background, the sky, the fog and the wood. Departments of one finish share one mesh. Further kinds: service case (base to .85 m, glass front and top, lit deck), coffin (open tub, lit floor, glass lid, .9 m), bins (clear bins part-full on a spine). **Daylight** (`StoreGraph.skylights`): the skylight's frame and mullions overhead as one white line batch, a 7% glazing pane, a 16% white pool on the floor under it and white spot lights on its fixtures; the rest of the store is under a warm (#FFD9B0) key light. The floor and its edge follow `StoreGraph.outline` (Grosher's cut corner).
   - **gondola**: base deck, central spine, uprights at every bay boundary, one shelf plane per level per open face, end panels. Free-standing runs open both ways; `kind: wall` runs open toward the store centre.
   - **coldcase**: the gondola carcass plus a glass door per bay on each open face (`opacity .32`, frosted frame boxes) and a faint interior glow panel (`emissive #DDF2F5 .45`).
   - **produce**: tiered open table, three stepped levels, no uprights. **bakery**: low table with a rim. **counter**: belt plus a register block at the front end.
   The **front end** of each run (nearest the entrance) carries the aisle-sign decal (canvas atlas, `rgba(10,40,22,.55)`, white Outfit 500). Outline: `EdgesGeometry` of the hull box only, white 35%.
   **Products**: one `InstancedMesh` per primitive (box, can, bottle, bag, tray; 4,000 each). One product type per bay; instances along every shelf of every bay of every open face with seeded jitter in size, spacing and yaw, two rows on produce and bakery tables, tinted by sampling the department texture so each aisle keeps its colour. LOD: fixtures along the current leg's path (within 2.5 m) and the next stop's fixture always carry products, nearest to the shopper first; fixtures within 25 m (true distance) of the camera fill the rest. Rebuilt on camera settle and on every leg change, never per frame. Budget ≤ 12,000 instances visible, ≤ 70 draw calls total.
4. **Lit slot** (the exact bay × shelf × face of the next stop, from `slotFor`): a translucent lime volume (`opacity .42`, emissive .45) spanning the bay and the shelf level on the shelf's face, with a 2px lime rim, ignoring depth so it reads through shelving from any angle, and one selective bloom pass (threshold .15, radius .42, background ignored) that sees only this mesh and the current leg's glow line. Bloom intensity follows camera distance: full (.7) at ≥ 36 m, 40% at the 12 m pinch minimum. Nothing else on the fixture is lit.
5. **Route ribbon** on the floor (y = .02): `Line2` from drei, three segments:
   - walked: white 40%, width 2px, solid
   - current leg: white 100%, width 2px, with a second copy at width 5px, 35% opacity, blurred by bloom (the glow)
   - ahead: white 85%, width 2px, dashed `1 6`
6. **Markers** (always face the camera, constant screen size: one DOM overlay outside the canvas, every marker projected each rendered frame; no per-marker React roots, no draw calls):
   - you: lime dot 11px with a 28px halo (pulsing)
   - next stop: lime point 8px on the shelf face at the slot's shelf height; a 1px lime leader rising to its card
   - unvisited stops: the next stop's card (lime-bordered) and a card (department dot · item name · number) for each of the two stops after it, both on the plate; every later stop is its numbered dot only. Cards never overlap. A following stop off the map area (off screen, under the strip or the sheet, or behind the camera) gets an edge chip instead: the plate, white number disc, name, walking distance, an arrow pointing at it, pinned to the map area's edge on the ray from its centre; at most two, sliding along their edge to clear each other and the cards. A card that would hit the next stop's card or the checkout callout stacks directly below it (below an earlier stacked card if there is one), clear of the lime leader line, with a 1 px white leader to its dot; a card that still cannot be placed folds to its dot. Same rule at every distance and in the flattened view.
   - ahead stops: a 13px disc of the plate with a 1px white hairline (white 75%) and the number in Outfit 600 white
   - done stops: 12px white 80% ring with a white check
   - chosen lane: lime point; other lanes nothing
   - entrance: white ring with arrow-in glyph; exit: lime ring
7. **Labels** (DOM overlay, screen space, no scaling): next stop = eyebrow in lime (`DAIRY · A10 · 6 OF 8`; a department equal to its aisle appears once) over the item name (Outfit 500, 17px) over distance (Outfit 300, 12px, white 85%) over the slot line in lime (`Left · bay 4 · shelf 3`). Checkout callout = eyebrow `CHECKOUT · LANE 5` over `2 min walk (118 m)`. Both are clamped into the map area between the progress strip and the sheet on manual zoom. Only these two labels exist on the map; stop cards are markers, not labels.
   **Plates.** Everything with text over the 3D scene (the next-stop card, the checkout callout, the stop cards, the edge chips, the numbered dots) sits on a plate: `--plate` soil `rgba(15,42,26,.88)` with a 1px white hairline `rgba(255,255,255,.32)` (the next-stop card's border is lime), no backdrop blur. Text on it is white or lime, so its contrast is the plate's (≥ 8:1 measured), not the scene's, at any camera position, and the contrast gate checks it like any other text.
8. **Post**: `Bloom` (threshold .9, intensity .6, mipmap blur). The vignette is CSS, not a pass: a full-screen overlay on the trip screen above the canvas and below the markers, `linear-gradient(180deg, rgba(255,158,107,.2) 0%, rgba(255,158,107,0) 22%, rgba(24,77,46,0) 65%, rgba(24,77,46,.55) 100%)`, `pointer-events: none`. No DoF on phones by default; enable behind a flag for the launch video.

**Camera**

- Default: perspective, **42° horizontal** field (the vertical angle is derived from the aspect ratio and clamped to 42–80°), tilt 58° from vertical, yaw −18°. Framing is solved in screen space: the current leg's path plus the next stop, padded 15%, is fitted into the map area between the progress strip and the bottom sheet (the trip screen measures it); the next stop sits in that area's upper third and the you-dot in its lower third, never centred. Both endpoints are hard constraints: always inside the padded area, zooming out if nothing else satisfies that. The minimum is a visible span, not a distance: at least 30 m of store width across the frame (≈39 m of camera distance at 42°). Vertical slack slides the store upward first (sky shrinks), horizontal slack slides it toward the footprint. Same rule when flattened. On every reroute / check-off the camera eases (480ms) to the new framing.
- Gestures: one-finger drag pans; shift-drag or a two-finger twist orbits yaw ±25°; pinch and wheel zoom (distance 12–90 m, the whole demo store needs ~90 m at this field); the header **flatten** button (and pinching past max zoom-out) tweens tilt to top-down, same lighting, same markers; tap again to tilt back. Flatten state persists in `localStorage`.

**Lighting**: hemisphere light (sky `--haze`, ground `--deep`, .9) + one directional from front-left (.5). No shadows (cost on phone).

**Performance budget** (iPhone 13 class): ≤ 60 draw calls (merge fixtures per department into one `InstancedMesh` or merged geometry), ≤ 1.2 MB of textures (9 × 512² JPEG q80 ≈ 350 KB; KTX2 later if needed), 60 fps idle, bloom at half resolution. `frameloop="demand"`: render only on gesture, camera tween, marker pulse ticks, or state change.

**Fallback**: if WebGL is unavailable, mount the flat `StoreMap` SVG (editor renderer) styled with the department colors and the same markers. Never a blank screen.

## 4. The flat map (`StoreMap`, SVG) — editor and fallback

Keep the existing SVG component; restyle it:

- Canvas `#EDE9DB` with the dot grid; fixtures filled with the department hex, stroke `rgba(15,42,26,.35)` 1px, radius 2; walk graph thin `rgba(15,42,26,.35)` lines with white node dots; shelf locations `rgba(15,42,26,.55)` 2px dots; aisle codes Outfit 500 at the aisle ends and department names tracked caps along walls, both in solid `--soil` on a 3px canvas-colour halo (`paint-order: stroke`), so they read where they cross fills and location dots (at 55% with no halo they measured 2.5:1).
- Selection: the pinned edge in `--soil` 2px, the bay in `rgba(212,255,74,.55)` with a soil stroke, the location dot lime with soil ring, offset label in soil.
- Route in fallback mode: white ribbon over department fills as in 3D.

## 5. Screens

Phone screens render in a centred column, max-width 430px, full viewport height; the gradient and blooms fill the whole viewport behind it. Verify at 1440×900 and 390×844.

**List** (`/`): gradient ground + cream bloom; header on haze in warm ink (eyebrow chain, store name, "Change" pill); display "Your list, / not their layout." in Outfit 200 warm ink; glass pill input (`+`, placeholder "Add items, paste a list, or hold to speak", mic button); glass sheet (radius 26) with rows: name Outfit 400 16 · chip (9px department dot + text, `rgba(255,255,255,.16)`, "Dairy · last", "A6 or endcap"); unresolved row: muted line "Not placed yet · probably A4, international" + "Tell me where" ghost pill; sticky lime CTA pill (on a footer plate with its caption: the ground's deep green, fading in over 28 px, full width, so rows pass under it and never under the caption's words; the list pads by the footer's height): "Route 9 items" left, Doto `410 m · 11 min` right, soil circle with arrow; caption "36% shorter than walking your list in order".

**Trip** (`/trip`): full-screen 3D map; glass header row (back circle · glass pill with store name and Doto timer · flatten circle); 8-segment progress strip (done white, current lime with glow, ahead white 30%); glass bottom sheet (radius 26, inset 12): eyebrow `NEXT · 6 OF 8`, name Outfit 300 26, location line, Doto distance right with "meters" caption, buttons **Got it** (lime pill, check icon, glow) · **Not here** (glass pill) · **+** (glass circle).

**Checkout** (`/done`): gradient ground; "Trip done" / "Close" in warm ink on the haze; the share card = glass, radius 28: eyebrow row (`IN AND OUT` · `STORY RD · THU`), Doto hero time centered 96px, "9 of 9 items · lane 5", hairline torus art (SVG ellipses at white 55%, .8px, one lime dot at the center) as the card's middle band, two glass tiles (icon circle + label, Doto number + unit, caption): **Walked 408 m / 7 aisles never entered** and **Vs list in order −36 % / about 4 minutes saved** (the −36 in lime), footer strip: lime-dot wordmark "grosher" · "Get in. Get it. Get out." Below: "Make the map better" glass row(s) with a lime "Pick aisle" pill. Bottom: **Share card** (white pill, soil text) · **Save as usual trip** (glass pill). Share exports the card as a 1080×1920 PNG (html-to-image), gradient included.

**Editor** (`/edit`, desktop 1280): cream chrome; top bar (lime-dot wordmark / editor, store · #5435 · map v3, stats incl. texture count, Validate pill, lime-on-soil Export JSON); 64px rail (select, corridor, fixture, location, entrance/exit/checkout, **texture**, measure; "Preview in 3D" at the bottom opens the trip renderer on the current map); flat map; layer pills top-right (Graph · Fixtures · Locations · Textures · Underlay); scale bar + cursor meters bottom-left; 320px inspector: location id · wall, Aisle / Section / Modular, Side segmented (Left / Right / Endcap), Walmart zone select (GR/MD/GM/BK/FT), tag pills, **Fixture texture** slot (thumbnail, filename, size, shot date, Replace), Items here with confidence, Save (soil/lime) · Delete (rose text).

**Survey** (`#/survey`, phone first, one thumb): the editor's cream (`#F4F1E6`, soil ink, white cards with a soil 18% hairline, radius 18), centred 430 column. Every control sits in a sticky bottom tray: full-width 64px buttons (radius 20; the one primary is soil with lime text, the rest white with the hairline), Undo and Finish as small pills above them. Live readouts at the top in Doto (steps 44px, heading with a `°` unit, "no compass" in muted soil when there is none); the state line ("Aisle 12 · 23 steps · 17.2 m") in Outfit 500 18. Quick tags are the editor's `.tag` pills at 44px (on = soil with lime text). Sheets (aisle-number numpad with 64px Doto keys and a soil/lime Done; the landmark grid of 56px buttons) sit at the bottom in white, radius 24 at the top. The running list ("Captured · n") newest first: a title in Outfit 500, metres and steps in Doto, each sign photo's status ("waiting for a connection", "reading…", "read · 3 categories", "retrying in 30 s · …") with a check when read. Screens: Home (stride card, store fields, this survey, Start / Continue, Build draft map, Import), Calibrate ("Walk 10 m": Start, Stop, result, Save), Walk (Entrance first; then Sign photo · Pin · Start aisle, or End aisle while in one), Built (aisles · categories · shelves, what to check in the editor, Open in the editor). All measured by the contrast gate at 390×844 (lowest text 5.46:1, focus 15.88:1).

**Error plate** (index.html's boot guard): over the ground gradient, a `--plate` soil card (radius 24, white hairline): "Something went wrong" Outfit 500 22, a muted line, the error in a dark inset code block, **Reload** (lime, soil text) and **Reset local data** (outline white), the build id. In the contrast gate (lowest text 9.38:1).

## 6. Data additions

In `packages/core/src/types.ts` (optional fields, demo store keeps working):

```ts
export interface Fixture {
  id: string;
  kind: "shelf" | "wall" | "counter" | "selfcheckout" | "service" | "other";
  polygon: [number, number][];   // meters, y down, closed implicitly
  height?: number;               // meters, default 1.8; counters 1.0
  department?: string;           // key into departments; picks color + texture
  aisle?: string;                // "A12" → aisle sign on the front face
}
export interface Department { id: string; name: string; color: string; texture?: string; anchor?: [number, number]; angle?: number }
// StoreGraph gains:
fixtures?: Fixture[];
departments?: Department[];
```

`packages/stores/<store>/textures/<dept>.jpg` + `textures.json` manifest `{ dept: { file, w, h, shotAt, repeatMeters } }`. The demo store derives fixtures from its aisle edges (1.4 m-wide blocks each side, merged) and uses generated placeholder textures (`scripts/make-placeholder-textures.ts` writes 512² JPEGs with the department color and a soft grain) so the 3D view works before the survey walk. Real photos replace them file-for-file.

## 7. Don'ts

- No blue, anywhere. No flat background colors on phone screens. No second accent.
- No emoji, no Inter/Roboto, no drop shadows.
- No status color on the map; the map only knows white, lime, and the photos.
- No map label other than the next stop and the checkout callout.
- Don't scale markers or labels with zoom. Don't animate longer than 480ms; the user is walking.
- No "amazing / smart / optimized". The numbers say it.
