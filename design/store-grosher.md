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
