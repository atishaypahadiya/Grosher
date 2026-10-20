# Grosher: our own designed demo store

Step 1: store data, taxonomy, routing and the overview map. It replaces the synthetic "Demo Supercenter" as the
default demo store; Walmart Story Rd stays a separate real store. The detailed close-up aisle art (the hero
aisles) is a later task and is not built here.

## Context

A Whole Foods-style market: full grocery plus pharmacy, alcohol, and body care / hygiene. No clothing or
electronics. It must be **realistic, not rigged**: real-store conventions, so walking a list in the order it was
written is naturally long and Grosher's route is honestly shorter.

## Geometry

Local metres: x to the right 0–85, y downward 0–70, origin at the top-left.

- **Outline:** an 85 × 70 m rectangle with the top-right corner cut diagonally from (75, 0) to (85, 10).
- **Doors:** entrance on the west wall near (0, 4); exit on the west wall near (0, 64). Restrooms are not
  modelled.
- **West column** (x 1–10):
  - Floral, y 1–5 (inside the entrance, the decompression zone)
  - Service desk, y 7–11
  - Pharmacy counter + OTC shelving, y 13–21
  - Body care & hygiene: two short gondola runs perpendicular to the wall, y 22–30
  - Checkout, y 31–48: 8 staffed lanes + 1 express + 6 self-checkout. Lanes run east–west; shoppers enter from
    the east and leave west, then walk down to the exit.
  - Seating, y 50–56
- **North band:**
  - Produce, x 12–48, y 2–14: a wet wall along the north wall plus 6–8 islands. A **skylight** sits over
    x 14–46, y 3–13; this is the only daylit zone.
  - Bulk & pulses, x 50–68, y 2–8: gravity bins and scoop bins.
- **East wall** (service counters + cases, x 76–84):
  - Seafood, y 12–22, at the cut corner
  - Meat, y 24–37
  - Dairy & eggs, y 39–52: deliberately the far wall, diagonally opposite the entrance
  - Cheese & specialty, y 54–66
- **Centre, west bank:** 10 grocery gondola runs east–west, x 14–51, y 17–46 (about 3.2 m pitch). Aisle 1 is
  nearest produce (north), aisle 10 is south.
- **Cross aisle:** x 51–54.
- **Centre, east bank:**
  - Beer, wine & spirits: 4 short runs, x 54–71, y 17–28
  - Wine bar island, x 55–71, y 37–44
- **Frozen:** 2 long runs, x 14–71, y 50–55 (reach-in doors + one coffin run). Frozen sits next to the food hall
  and checkout, so cold items land late naturally.
- **South band** (y 61–69):
  - Café (coffee, juice, smoothies), x 12–21
  - Food hall, x 22–60, with stations: hot bar, rotisserie, salad bar, soups, sushi, pizza, deli
  - Bakery, x 61–74
- **Walkways:** main perimeter loop ≥ 3 m, aisles 2.4 m, gondolas 1.2 m deep, end caps on both ends of every
  centre run. Refine to realistic fixture sizes but keep this arrangement.

## Centre aisles

Each has a hanging sign with 4–6 category words for the resolver's sign matching.

1. Breakfast, coffee & tea
2. Baking, atta & flours, spices, oils & ghee
3. Pasta, rice & sauces
4. World foods: Indian (masalas, pickles, papad, ready-to-eat), Asian, Latin, Middle Eastern
5. Canned & jarred
6. Snacks, namkeen & sweets
7. Drinks: water, sparkling, soda, shelf-stable juice & milk
8. Household & paper
9. Kitchen & home: utensils, cookware, food storage, foil & wraps
10. Baby & pet

## Taxonomy

- Reuse existing categories wherever they fit; place each one in the right Grosher location.
- Add the missing categories with storage tags and aliases:
  - pharmacy: OTC pain relief, cold & flu, allergy, digestive, first aid, vitamins & supplements, prescription
    pickup
  - body care: soap & body wash, hair care, oral care, deodorant, skincare, feminine care, shaving
  - kitchenware: cookware, utensils, food storage
  - alcohol: beer, cold beer, red / white / sparkling wine, spirits
  - bulk: bulk pulses / dal (toor, moong, masoor, chana, rajma), bulk rice & grains, bulk nuts & seeds, bulk
    dried fruit, bulk flours
  - floral: bouquets, plants
  - food hall stations and café
  - Indian staples if missing: atta, ghee, masalas, pickles, papad, namkeen
- Storage comes from the shared storage list, never from names:
  - hot: rotisserie and hot bar
  - cold: cut fruit, seafood, meat, dairy, cheese, deli, sushi, salad bar, cold beer
  - frozen: frozen
- Items that previously ended as "Needs a place" because Walmart grocery had no category (sunglasses aside)
  should now resolve where Grosher sells them. Run the resolver's blind eval on this store and report accuracy
  against the old store.

## Routing

- Build the WalkGraph from this geometry: perimeter loop, aisle entries at both ends, the cross aisle, counters
  reachable from the walkway in front of them, and checkout lanes as the route end before the exit.
- Run the existing solver unchanged and report solve times.

## Hero demo lists

Saved lists for demos, written in the order a person would naturally jot them, **not** shuffled to make Grosher
look good.

1. **Weeknight dal-chawal:** toor dal (bulk), basmati rice, ghee, onions, tomatoes, cilantro, green chilies,
   yogurt, paneer, atta
2. **Weekly staples:** milk, eggs, bread, bananas, spinach, chicken, cereal, coffee, paper towels, dish soap,
   frozen peas
3. **Friday night in:** chips, salsa, sushi platter, red wine, cheese, crackers, ice cream, sparkling water,
   flowers
4. **Quick pharmacy run:** cold & flu medicine, tissues, orange juice, chicken soup (hot bar), throat lozenges

For each, report list-order distance vs Grosher's route distance and time, and say whether any result looks
unrealistic.

## Overview map (no hero-aisle art yet)

- Render Grosher in the existing 3D overview with correct geometry: cut corner, counters, islands, wine bar,
  food hall stations.
- Placeholder materials by zone: warm wood + black steel for dry aisles, stainless for fresh and cold.
- Produce gets daylight from the skylight: a visible skylight frame overhead and brighter, cooler light on that
  zone. The rest is warm track lighting.
- The flat map, editor and survey import must all handle the new store.
- Keep within the current performance gate. If the new store can't fit, report what exceeds it rather than
  raising the limits.

## UI

- Grosher is the default store. Show "Grosher" as the store name in the header (replacing "Demo Supercenter ·
  Synthetic layout").
- Keep the synthetic store loadable for tests but hidden from the picker. Report anything that still depends on
  it.
- Saved data (memories, lists) is per store. Nothing from the old store may leak into Grosher's placement.

## Tests (in CI)

- The graph is connected; every shelf and counter is reachable; every category is placed; no fixture overlaps
  another or a walkway.
- The new storage tags are pinned.
- Solver time on each hero list.
- Hero-list route snapshots, so later map edits show up as diffs.
- The contrast gate and the performance gate pass on the new store.

## Done when

Deployed, checked on the live site at 390×844, committed. The report has the hero-list table, resolver accuracy
(old store vs Grosher), and screenshots of the overview map (whole store, the produce skylight, the food hall),
the list screen and a trip.

## As built (step 1, 18 Oct 2026)

Generated by `packages/stores/scripts/gen-grosher.ts` from `scripts/grosher-taxonomy.ts`; checked by
`packages/stores/test/grosher.test.ts`. Where the build departs from the plan above, and why:

- **Entrance at (0, 6), not (0, 4).** Floral (y 1–5) and the service desk (y 7–11) sit either side of the entry
  walk; at y 4 the walk would cross the flower tables. Exit at (0, 64) as planned.
- **Aisles 2.0 m clear, gondolas 1.1 m, pitch 3.1 m.** Ten aisles with shelving on both sides need eleven runs;
  at 2.4 m aisles and 1.2 m gondolas that is 37 m, and y 17–46 is 29. Eleven runs at 3.1 m pitch fill y 15.8–47.9
  and keep a 3 m walkway each side (produce above, frozen below). 2.0 m is a typical Whole Foods aisle.
- **Checkout lanes at 1.6 m pitch** (0.7 m belt counters, 0.9 m lanes, x 3.5–9.5), lanes 1–8 and express in
  y 31–46, then six self-checkout kiosks in one row at y 47.6–48.4 behind a 1.5 m queue. Shoppers enter each lane
  from the west walkway (x 12) and leave west onto the front walkway (x 2.2), which runs down to the exit.
- **Frozen runs break once** (x 41.6–44, both runs) so the frozen aisle and the food hall are not a 57 m walk
  round; reach-in doors both faces at y 51–52.4, coffins at y 54.6–55.6.
- **Bakery x 61.5–71.5** (not to 74), so the east walkway in front of the cheese counter stays 4 m clear.
- **Produce**: the wet wall x 13–48 at the north wall (greens, herbs, mushrooms, cut vegetables, cut fruit) and
  two rows of four islands under the skylight (x 14–45.4, y 4.8–11.8). **Bulk**: gravity bins on the wall,
  scoop bins on an island, x 50–68.
- **Pharmacy**: the Rx counter against the west wall at the end of its own spur, two OTC runs; **body care**: two
  runs; all four runs east–west (perpendicular to the wall), each face on a spur from the west walkway.
- **East wall**: seafood counter y 12.5–21.5, butcher counter 24.5–30 then a self-serve meat case 30.5–36.5,
  dairy 39.5–51.5, cheese counter 54.5–59 then a cheese case 59.5–65.5; all face the east walkway (x 73.5).
- **Beer, wine & spirits** are aisles 11–13 (four runs at 3.3 m pitch); the north run is the cold-beer doors.
  The wine bar is a ring of bar counter (x 55–71, y 37–44) entered from the cross aisle.
- **Food hall**: hot bar, salad bar and soups are islands (y 61.6–63.4); rotisserie, sushi, pizza and the deli
  are counters along the south wall (y 65.8–67), both off one aisle (y 64.6); a few tables in the café and food
  hall, six by the exit.
- **Storage**: soups are hot like the hot bar and rotisserie (kept hot in kettles); the pizza counter is
  ambient (made to order). Cold: the fresh counters, dairy, cheese, deli, cut fruit and vegetables, sushi, the
  salad bar, cold beer (40 categories). Frozen: 25.
- **Taxonomy**: all 298 demo categories reused, 26 new (papad, cookware, kitchen utensils, cold beer, beer,
  cider & seltzer, white & rosé, sparkling, red, spirits, wine bar, five bulk, bouquets, plants, customer
  service, hot bar, soups, salad bar, sushi, pizza, coffee bar, juice & smoothie bar). OTC, body care and the
  Indian staples already existed; papad had been an alias of namkeen.
- **Catalog**: carried from the demo's file at load time, 964 rows re-homed by their names (beer, wine and
  spirits off the bar mixers; flowers off the batteries; prepared sushi; the salad bar; papad), plus 41 of
  Grosher's own rows. 123 mixers rows with names no rule recognises ("Fortunate Islands", "The Big Kahuna")
  stay with the mixers.

Overview, not yet hero art: a light-oak wood finish with black-steel uprights on the dry side, a pale brushed
stainless on fresh and cold, a skylight frame and daylight pool over produce, warm light elsewhere, the cut
corner in the floor and on the flat map. Performance gate on Grosher: 46–48 draw calls, ≤ 7,924 instances.

### Follow-ups (18 Oct 2026)

- **Heavy means about 2 kg or more for the typical unit**, decided by the shelf (29 heavy shelves, 10 bulky);
  paper towels, toilet paper, dish soap and chips are not heavy, and a new "bulky" tag (no route penalty) covers
  the big light things. Weekly staples now starts in produce (359 m, was 387); dal-chawal still detours for
  the rice, atta and ghee.
- **Stainless reads as neutral steel**: fresh and cold fixtures take the light's strength but not the haze's
  colour.
- Walls and counters are named by their department on the next-stop card and the sheet ("Body care, left").

## Step 2: Bulk & pulses as the hero aisle (18 Oct 2026)

The zone is the benchmark for close-up quality and the recipe every other aisle follows: see CLAUDE.md "Hero
close-ups" and DESIGN.md §5b. The overview layout was set to real proportions for it (map v2): 0.65 m wall
shelving with the five sections west to east, a 1.4 m waist-high scoop-bin island (new category: bulk granola,
trail mix & snacks), a centerpiece plinth at the island's west end. The reference photos named in the brief
(design/refs/) were not in the repository when it was built; the look follows the brief's description.

### Refinement against the references (19 Oct 2026)

The reference photos arrived and are kept locally in `design/refs/` (git-ignored: third-party images). Against
them: the arrival descends outside the zone and walks in under its own ceiling (no ceiling over the rest of
the store); light became per pixel with sharp pools and plank shadows; grain is drawn at its real size, with
real grains on the stop's bin; the shelves carry thirteen kinds of pack; the centerpiece was rebuilt from the
photo (jute sacks with rolled frayed rims, the chakki in its round tray, a grey clay pot of wheat); the
produce stands, the produce wall's end and the aisle 1 gondola stand beyond the zone as its backdrop.

## Step 3: Produce as the second hero zone (20 Oct 2026)

The produce zone (x 12–48, y 2–14) upgraded from standard close-ups to a hand-drawn hero zone, the store's one
daylit room: see CLAUDE.md "Produce (`src/hero/produce`)" and DESIGN.md §5b. Studied against
`design/refs/produce-stainless-skylight.png` and `cut-fruit-case.png` (kept local). No juice reference was in
`design/refs/`; the Grosher Press juices follow the brief. The map is unchanged: the islands, the wall and its
categories and bays are the map's (the wall reads greens and salad kits, herbs, mushrooms and sprouts, cut
vegetables, cut fruit, juice), and the six island faces that have no location are drawn as fillers (stone
fruit, squash and pumpkins, Roma and corn, shallots, red potatoes, Brussels sprouts). One alias was added:
"cut fruit" (and "fruit cups", "cut melon", "fruit tubs") on the cut fruit & juice shelf, where "cut fruit"
alone had fallen through to a fuzzy match on gum.
