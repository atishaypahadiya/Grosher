# Grosher — DESIGN.md

**The feeling:** the produce aisle at 7 in the morning. Light through lettuce, mist just hit the shelves. Apricot haze up front, deep leaf at the back. Thin white lines for everything measured, and one lime point that means *now*.

This is the contract for `apps/web`. The canvas with the mockups is exported at `design/boards/*.png` (Mood, List, Trip, Checkout, Editor, Tokens). When this file and a board disagree, the board wins on feel and this file wins on numbers.

## 1. Principles

1. **The ground is light, never a fill.** Every screen sits on the same gradient and the same blurred blooms. Nothing is a flat color block except glass.
2. **Fixtures are photographed.** The 3D map shows the real shelves of the real store: one tiling photo per department on every shelf run. The store reads as color from far away and as product up close.
3. **One accent, one meaning.** Lime `#D4FF4A` is *now*: the dot that is you, the point on the shelf you're heading to, the chosen lane, the single primary button. Nothing else is lime. Blue does not exist in this app.
4. **Everything measured is a white hairline.** Route, stops, wireframe art, progress: thin white, 40–95% opacity. Meaning comes from opacity and shape, not hue.
5. **Numbers brag, words don't.** Every number that matters is set in Doto (dot matrix), large. Copy is short and on your side: "Got it", "Not here", "Tell me where".
6. **Mist is rendered, not styled.** Fog, bloom, depth of field in the 3D view; blurred radial blooms and backdrop blur in 2D. Soft edges everywhere except type.

## 2. Tokens

### Light (gradient stops, front of store → back)

| Token | Hex | Where |
| --- | --- | --- |
| `--haze` | `#F9D7A8` | Top / front, 0% |
| `--apricot` | `#F0C27A` | ~10% |
| `--lime-green` | `#B9D96A` | ~30% |
| `--moss` | `#6CB26A` | ~50% |
| `--leaf` | `#2E7D46` | ~75% |
| `--deep` | `#184D2E` | 100% / back wall fog |
| `--soil` | `#0F2A1A` | Dark text, lime-on-soil buttons (editor) |

Screen background: `linear-gradient(170deg, haze 0%, apricot 10–12%, lime-green 30–34%, moss 48–55%, leaf 72–80%, deep 100%)`.
Blooms (position absolute, `border-radius:50%`, `filter: blur(24–40px)`): cream `rgba(255,240,210,.9)` top-left, lime `rgba(212,255,74,.45)` center, deep `rgba(10,50,28,.8)` bottom-right.

### Ink

- On green regions: white `#FFFFFF`; muted `rgba(255,255,255,.85)`; eyebrow `rgba(255,255,255,.8)`.
- On haze regions (top ~25% of List/Checkout): `--soil`; muted `rgba(15,42,26,.7)`.
- Rule: pick ink by the region's luminance, never by component. Contrast ≥ 4.5:1 for body, ≥ 3:1 at 24px+.

### Accent and surfaces

| Token | Value |
| --- | --- |
| `--lime` | `#D4FF4A` · glow `0 0 24px rgba(212,255,74,.45)` on buttons, `0 0 18px rgba(212,255,74,.8)` on dots |
| `--glass` | `rgba(255,255,255,.14)` fill · `1px solid rgba(255,255,255,.28)` · `backdrop-filter: blur(18px) saturate(140%)` |
| `--glass-strong` | same with fill `.20` (editor pills on cream use `rgba(255,255,255,.7)`) |
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
3. **Fixtures**: generated per department `fixtureKind`, merged per department (one textured opaque mesh, plus glass, frame and glow meshes where the kind needs them), material `MeshStandardMaterial` with `map` = the department's texture (`RepeatWrapping`, repeat every 2 m on every visible face), `color` = department hex at 70% blend, roughness .85. Fixture params: `bays` (default round(length / 1.22)), `shelves` (5 gondola, 4 cold case, 3 produce / bakery), `depth` (default half the block width), `height` (1.8 shelves, 1.0 counters, 1.1 produce, .95 bakery).
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
   - unvisited stops: the next stop's card (lime-bordered) and a deep-glass card (department dot · item name · number) for each of the two stops after it; every later stop is its numbered white dot only. Cards never overlap: a card that would collide on screen with one already placed (the next stop's first, then route order), or would leave the map area, collapses to its dot. Same rule at every distance and in the flattened view.
   - ahead stops: white 12px circle with the number in Outfit 600 soil
   - done stops: 12px white 80% ring with a white check
   - chosen lane: lime point; other lanes nothing
   - entrance: white ring with arrow-in glyph; exit: lime ring
7. **Labels** (DOM overlay, screen space, no scaling): next stop = eyebrow in lime (`DAIRY · A10 · 6 OF 8`; a department equal to its aisle appears once) over the item name (Outfit 500, 17px) over distance (Outfit 300, 12px, white 85%) over the slot line in lime (`Left · bay 4 · shelf 3`). Checkout callout = eyebrow `CHECKOUT · LANE 5` over `2 min walk (118 m)`. Both are clamped into the map area between the progress strip and the sheet on manual zoom. Only these two labels exist on the map; stop cards are markers, not labels.
8. **Post**: `Bloom` (threshold .9, intensity .6, mipmap blur). The vignette is CSS, not a pass: a full-screen overlay on the trip screen above the canvas and below the markers, `linear-gradient(180deg, rgba(249,215,168,.2) 0%, rgba(249,215,168,0) 22%, rgba(24,77,46,0) 65%, rgba(24,77,46,.55) 100%)`, `pointer-events: none`. No DoF on phones by default; enable behind a flag for the launch video.

**Camera**

- Default: perspective, **42° horizontal** field (the vertical angle is derived from the aspect ratio and clamped to 42–80°), tilt 58° from vertical, yaw −18°. Framing is solved in screen space: the current leg's path plus the next stop, padded 15%, is fitted into the map area between the progress strip and the bottom sheet (the trip screen measures it); the next stop sits in that area's upper third and the you-dot in its lower third, never centred. Both endpoints are hard constraints: always inside the padded area, zooming out if nothing else satisfies that. The minimum is a visible span, not a distance: at least 30 m of store width across the frame (≈39 m of camera distance at 42°). Vertical slack slides the store upward first (sky shrinks), horizontal slack slides it toward the footprint. Same rule when flattened. On every reroute / check-off the camera eases (480ms) to the new framing.
- Gestures: one-finger drag pans; shift-drag or a two-finger twist orbits yaw ±25°; pinch and wheel zoom (distance 12–90 m, the whole demo store needs ~90 m at this field); the header **flatten** button (and pinching past max zoom-out) tweens tilt to top-down, same lighting, same markers; tap again to tilt back. Flatten state persists in `localStorage`.

**Lighting**: hemisphere light (sky `--haze`, ground `--deep`, .9) + one directional from front-left (.5). No shadows (cost on phone).

**Performance budget** (iPhone 13 class): ≤ 60 draw calls (merge fixtures per department into one `InstancedMesh` or merged geometry), ≤ 1.2 MB of textures (9 × 512² JPEG q80 ≈ 350 KB; KTX2 later if needed), 60 fps idle, bloom at half resolution. `frameloop="demand"`: render only on gesture, camera tween, marker pulse ticks, or state change.

**Fallback**: if WebGL is unavailable, mount the flat `StoreMap` SVG (editor renderer) styled with the department colors and the same markers. Never a blank screen.

## 4. The flat map (`StoreMap`, SVG) — editor and fallback

Keep the existing SVG component; restyle it:

- Canvas `#EDE9DB` with the dot grid; fixtures filled with the department hex, stroke `rgba(15,42,26,.35)` 1px, radius 2; walk graph thin `rgba(15,42,26,.35)` lines with white node dots; shelf locations `rgba(15,42,26,.55)` 2px dots; aisle codes Outfit 500 at the aisle ends; department names tracked caps along walls.
- Selection: the pinned edge in `--soil` 2px, the bay in `rgba(212,255,74,.55)` with a soil stroke, the location dot lime with soil ring, offset label in soil.
- Route in fallback mode: white ribbon over department fills as in 3D.

## 5. Screens

Phone screens render in a centred column, max-width 430px, full viewport height; the gradient and blooms fill the whole viewport behind it. Verify at 1440×900 and 390×844.

**List** (`/`): gradient ground + cream bloom; header on haze in soil (eyebrow chain, store name, "Change" pill); display "Your list, / not their layout." in Outfit 200 soil; glass pill input (`+`, placeholder "Add items, paste a list, or hold to speak", mic button); glass sheet (radius 26) with rows: name Outfit 400 16 · chip (9px department dot + text, `rgba(255,255,255,.16)`, "Dairy · last", "A6 or endcap"); unresolved row: muted line "Not placed yet · probably A4, international" + "Tell me where" ghost pill; sticky lime CTA pill: "Route 9 items" left, Doto `410 m · 11 min` right, soil circle with arrow; caption "36% shorter than walking your list in order".

**Trip** (`/trip`): full-screen 3D map; glass header row (back circle · glass pill with store name and Doto timer · flatten circle); 8-segment progress strip (done white, current lime with glow, ahead white 30%); glass bottom sheet (radius 26, inset 12): eyebrow `NEXT · 6 OF 8`, name Outfit 300 26, location line, Doto distance right with "meters" caption, buttons **Got it** (lime pill, check icon, glow) · **Not here** (glass pill) · **+** (glass circle).

**Checkout** (`/done`): gradient ground; "Trip done" / "Close" in soil on the haze; the share card = glass, radius 28: eyebrow row (`IN AND OUT` · `STORY RD · THU`), Doto hero time centered 96px, "9 of 9 items · lane 5", hairline torus art (SVG ellipses at white 55%, .8px, one lime dot at the center) as the card's middle band, two glass tiles (icon circle + label, Doto number + unit, caption): **Walked 408 m / 7 aisles never entered** and **Vs list in order −36 % / about 4 minutes saved** (the −36 in lime), footer strip: lime-dot wordmark "grosher" · "Get in. Get it. Get out." Below: "Make the map better" glass row(s) with a lime "Pick aisle" pill. Bottom: **Share card** (white pill, soil text) · **Save as usual trip** (glass pill). Share exports the card as a 1080×1920 PNG (html-to-image), gradient included.

**Editor** (`/edit`, desktop 1280): cream chrome; top bar (lime-dot wordmark / editor, store · #5435 · map v3, stats incl. texture count, Validate pill, lime-on-soil Export JSON); 64px rail (select, corridor, fixture, location, entrance/exit/checkout, **texture**, measure; "Preview in 3D" at the bottom opens the trip renderer on the current map); flat map; layer pills top-right (Graph · Fixtures · Locations · Textures · Underlay); scale bar + cursor meters bottom-left; 320px inspector: location id · wall, Aisle / Section / Modular, Side segmented (Left / Right / Endcap), Walmart zone select (GR/MD/GM/BK/FT), tag pills, **Fixture texture** slot (thumbnail, filename, size, shot date, Replace), Items here with confidence, Save (soil/lime) · Delete (rose text).

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
