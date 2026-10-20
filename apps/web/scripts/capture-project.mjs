// Captures the project page's and the README's app media from a running production build, on this Mac's GPU
// at full quality (capture-kit.mjs: deviceScaleFactor 3 for stills, the canvas at 3× with the composer
// multisampled, the hi texture tier):
//
//   npm run build -w @grosher/web && (cd apps/web && npx vite preview --port 4173 &)
//   node apps/web/scripts/capture-project.mjs http://localhost:4173
//
// Writes public/project/img/:
// - list, trip, checkout: 3× stills of one 14-item trip as AVIF / WebP / PNG at 1× / 2× / 3×;
// - guard: the off-list guard's card over the map, from the demo walk (?demo=walk);
// - survey: survey mode walking an aisle (sensors mocked by survey-driver.mjs);
// - trip.av1.mp4 + trip.mp4 with trip-poster.webp: a 6-second loop (hold, Got it, the route re-solves and the
//   camera eases to the next leg, hold) at 60 fps and 2×, every frame drawn on a paused, stepped page clock;
// and public/project/capture.json (the trip's numbers and how the frame was chosen; the page's live share card
// shows them, and scripts/docs-numbers.mjs checks the card against them).
//
// The list: 14 everyday items over 13 aisles, typed in no store order, as a shopper writes a list.
// The trip frame: a true mid-trip step, the one nearest TARGET_STEP (6 of 14) within 30–70% of the way,
// whose view has the next stop's marker (the lit slot) inside the map area, the camera within 40 m (the
// shelves and the lit slot read; further out the store is a thin band), and its drawn cards (at most three
// since the map caps them: the next stop and the two after it, src/map3d/cardPlan.ts) clear of the
// edges, the progress strip, the sheet and each other. If none qualifies as framed, the capture zooms in
// with the app's own wheel / pinch zoom one notch at a time; capture.json records the step and the zoom.
// The video: hold, Got it arriving at that step, the camera eases to the new leg (then the same zoom, if
// any), hold. Close-ups are off here (?closeup=0): capture-closeup.mjs covers them.
//
// The trip clock: the page's Date.now is frozen at the trip's start and advances only by each leg's distance
// at the app's own walking pace (WALK_MPS, 1.0 m/s in src/lib/format.ts) before each "Got it". The card's
// time is therefore exactly the legs to the stops at 1 m/s: no time at the shelf, none of the capture's own
// seconds. capture.json says so. Needs ffmpeg (with SVT-AV1), avifenc, cwebp and pngquant.

import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clean, encode, frames, launch, phone, poster, QUALITY, still, until } from "./capture-kit.mjs";
import { driveSurvey, prepare } from "./survey-driver.mjs";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const OUT = join(import.meta.dirname, "..", "public", "project");
const IMG = join(OUT, "img");
const TMP = join(OUT, ".capture-tmp");
const WALK_MPS = 1.0; // src/lib/format.ts
const LIST = "Greek yogurt, Paper towels, Bananas, Toor dal, Frozen pizza, Coffee, Dog food, Tylenol, Chips, Bread, Ice cream, Shampoo, Spinach, Pasta";
const ITEMS = LIST.split(", ").length;
const MAX_CARDS = 3;
const EDGE = 6; // px a card must keep from every edge
const WHEEL = -80; // one wheel notch in: the map zooms by exp(80 × 0.0015) ≈ 1.13× (TripMap3D onWheel)
const MAX_ZOOM_STEPS = 8;
const NEAR_M = 40; // within it the shelves, products and lit slot read; beyond it the view is a thin band
const TARGET_STEP = Math.round(14 * 0.43); // 6 of 14: the middle of the trip
const LOOP_F = 360; // the loop: six seconds at 60 fps

clean(TMP);
const sizes = {};

/** Date.now frozen from now on plus window.__walkedMs, so the trip clock reads walking time only */
const freezeTripClock = () => {
  const frozen = Date.now();
  window.__walkedMs = 0;
  Date.now = () => frozen + window.__walkedMs;
};

async function openTrip(page, { paused = false } = {}) {
  await page.goto(`${BASE}/?perf=1&closeup=0&${QUALITY}`, { waitUntil: "load" });
  await until(page, () => !!window.__grosherIndex, { paused }); // the full catalog's index
  await page.evaluate(freezeTripClock);
  const input = page.getByLabel(/add items/i);
  await input.fill(LIST);
  await input.press("Enter");
  await until(page, (n) => new RegExp(`${n} items · ${n} placed`, "i").test(document.body.innerText), { arg: ITEMS, paused });
  await page.evaluate(() => document.fonts.ready);
}

/** n frames drawn (real time, or stepped on a paused clock) */
async function steady(page, n, { paused = false } = {}) {
  await page.evaluate(() => window.__grosherPerf && (window.__grosherPerf.frames = 0));
  await until(page, (n) => (window.__grosherPerf?.frames ?? 0) >= n, { arg: n, paused, step: paused ? 1000 / 60 : 50 });
}

/** walk one leg on the clock, then tap Got it; returns the leg's metres */
async function gotIt(page) {
  const m = Number((await page.locator(".trip-dist .num").first().textContent()) ?? 0);
  await page.evaluate((ms) => (window.__walkedMs += ms), (m / WALK_MPS) * 1000);
  await page.getByRole("button", { name: /got it/i }).click();
  return m;
}

/** what the current trip frame shows: drawn cards, whether each clears the edges, whether the next stop is in the map */
const frameReport = (edge) => {
  const vw = innerWidth;
  const strip = document.querySelector(".progress-strip")?.getBoundingClientRect();
  const sheet = document.querySelector(".trip-sheet")?.getBoundingClientRect();
  const top = (strip?.bottom ?? 0) + edge;
  const bottom = (sheet?.top ?? innerHeight) - edge;
  const inside = (r) => r.left >= edge && r.right <= vw - edge && r.top >= top && r.bottom <= bottom;
  const shown = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getBoundingClientRect().width > 0;
  const cards = [...document.querySelectorAll(".m-overlay .m-card")].filter(shown);
  const rects = cards.map((el) => el.getBoundingClientRect());
  const overlap = rects.some((a, i) => rects.some((b, j) => j > i && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
  const next = document.querySelector(".m-overlay .m-next");
  const nextRect = next && shown(next) ? next.getBoundingClientRect() : null;
  return {
    cards: cards.length,
    cardsInside: rects.every(inside),
    cardsOverlap: overlap,
    dots: [...document.querySelectorAll(".m-overlay .m-ahead")].filter(shown).length,
    nextInMap: !!nextRect && inside(nextRect),
    names: cards.map((el) => el.textContent?.replace(/\s+/g, " ").trim()),
  };
};

/** one wheel notch over the map */
async function zoomIn(page) {
  await page.mouse.move(195, 360);
  await page.mouse.wheel(0, WHEEL);
}

const browser = await launch();
let chosenStep = null;
try {
  // ---------------------------------------------------------------- stills, the frame choice and the trip's numbers (3×)
  {
    const { ctx, page } = await phone(browser, { dsf: 3 });
    await openTrip(page);
    // the list was typed from the keyboard: drop the input's focus ring before the still
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(TMP, "list.png") });

    await page.getByRole("button", { name: new RegExp(`route ${ITEMS} items`, "i") }).click();
    await page.getByTestId("map3d").waitFor({ timeout: 60_000 });
    await steady(page, 20);
    let legsM = 0;
    // every step in the mid-trip window (30–70% of the way) is evaluated and, if it qualifies, shot; the trip
    // only walks forward, so the choice (the qualifying step nearest TARGET_STEP) is made afterwards
    const lo = Math.ceil(ITEMS * 0.3);
    const hi = Math.floor(ITEMS * 0.7);
    const seen = [];
    const qualifying = [];
    for (let k = 1; k < ITEMS; k++) {
      legsM += await gotIt(page);
      await page.waitForTimeout(700); // the camera eases 480 ms
      await steady(page, 6);
      if (k < lo || k > hi) continue;
      for (let z = 0; z <= MAX_ZOOM_STEPS; z++) {
        if (z > 0) {
          await zoomIn(page);
          await page.waitForTimeout(250);
          await steady(page, 4);
        }
        const f = await page.evaluate(frameReport, EDGE);
        const dist = await page.evaluate(() => window.__grosherPerf?.distance ?? Infinity);
        seen.push({ step: k, zoomSteps: z, distanceM: dist, cards: f.cards, dots: f.dots, cardsInside: f.cardsInside, cardsOverlap: f.cardsOverlap, nextInMap: f.nextInMap });
        if (!f.nextInMap) break; // zoomed past the next stop: this step will not do
        if (dist <= NEAR_M && f.cards <= MAX_CARDS && f.cardsInside && !f.cardsOverlap) {
          // the products along the leg are laid out on camera settle: wait for them before the still
          await page.waitForTimeout(600);
          await steady(page, 10);
          const shot = join(TMP, `trip-${k}.png`);
          await page.screenshot({ path: shot });
          qualifying.push({ step: k, of: ITEMS, midTrip: true, zoomSteps: z, zoom: +Math.exp(-WHEEL * 0.0015 * z).toFixed(2), cameraDistanceM: dist, ...f, shot });
          break;
        }
      }
    }
    qualifying.sort((a, b) => Math.abs(a.step - TARGET_STEP) - Math.abs(b.step - TARGET_STEP) || a.step - b.step);
    if (!qualifying.length) {
      console.log(JSON.stringify(seen, null, 1));
      throw new Error(`no mid-trip frame (steps ${lo}–${hi}) with the next stop in view and its cards clear of the edges and each other`);
    }
    const { shot, ...picked } = qualifying[0];
    chosenStep = { ...picked, target: TARGET_STEP, evaluated: seen.filter((x) => x.zoomSteps === 0).map((x) => ({ step: x.step, distanceM: x.distanceM, cards: x.cards, dots: x.dots })) };
    renameSync(shot, join(TMP, "trip.png"));
    legsM += await gotIt(page); // the last item
    await page.getByText(/trip done/i).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(TMP, "checkout.png") });
    const card = await page.evaluate(() => {
      const c = document.querySelector(".share-card");
      const t = (sel) => c?.querySelector(sel)?.textContent?.trim() ?? null;
      const tiles = [...(c?.querySelectorAll(".stat-tile") ?? [])].map((s) => ({ label: s.querySelector(".label-row")?.textContent?.trim(), value: s.querySelector(".num")?.childNodes[0]?.textContent?.trim(), unit: s.querySelector(".unit")?.textContent?.trim(), caption: s.querySelector(".caption")?.textContent?.trim() }));
      return { eyebrows: [...(c?.querySelectorAll(".card-eyebrows .eyebrow") ?? [])].map((e) => e.textContent?.trim()), clock: t(".card-hero .num"), sub: t(".card-sub"), tiles };
    });
    writeFileSync(
      join(OUT, "capture.json"),
      JSON.stringify(
        {
          _note: "Written by apps/web/scripts/capture-project.mjs from the production build on Grosher, on this Mac's GPU. Simulated trip: the clock is the legs to the stops (legsToStopsM) at the app's walking pace (WALK_MPS = 1.0 m/s, src/lib/format.ts), no time at the shelf. 'Walked' also counts the legs to the lane and the exit. The 3D still and the end of the video are trip step `tripFrame.step`, zoomed in by `tripFrame.zoomSteps` wheel notches (the app's own zoom). The project page's share card shows these numbers (scripts/docs-numbers.mjs checks it).",
          capturedAt: new Date().toISOString().slice(0, 10),
          list: LIST.split(", "),
          legsToStopsM: legsM,
          tripFrame: chosenStep,
          card,
        },
        null,
        2,
      ) + "\n",
    );
    await ctx.close();
  }

  // ---------------------------------------------------------------- the off-list guard's card, from the demo walk (3×)
  {
    const { ctx, page } = await phone(browser, { dsf: 3 });
    await page.goto(`${BASE}/?demo=walk&speed=12&perf=1&closeup=0&${QUALITY}`, { waitUntil: "load" });
    await page.getByTestId("guard-card").waitFor({ timeout: 300_000 });
    await page.waitForTimeout(600); // its 240 ms slide in
    await steady(page, 10);
    await page.screenshot({ path: join(TMP, "guard.png") });
    await ctx.close();
  }

  // ---------------------------------------------------------------- survey mode, an aisle being walked (3×)
  {
    const { ctx, page } = await phone(browser, { dsf: 3 });
    await page.unrouteAll();
    await prepare(page, { signs: [["12", "Cereal", "Breakfast", "Coffee", "Tea"], ["7", "International", "Indian", "Foods", "Atta & Rice"]] });
    await driveSurvey(page, {
      base: BASE,
      fixtures: join(import.meta.dirname, "..", "test", "fixtures", "signs"),
      goOffline: (off) => ctx.setOffline(off),
      onScreen: async (name) => {
        if (name === "aisle") await page.screenshot({ path: join(TMP, "survey.png") });
      },
    });
    await ctx.close();
  }

  // ---------------------------------------------------------------- the reroute loop, frame by frame at 60 fps (2×)
  {
    const { ctx, page } = await phone(browser, { dsf: 2, paused: true });
    await openTrip(page, { paused: true });
    await page.getByRole("button", { name: new RegExp(`route ${ITEMS} items`, "i") }).click();
    await until(page, () => !!document.querySelector("[data-testid=map3d]"), { paused: true });
    await steady(page, 20, { paused: true });
    for (let k = 1; k < chosenStep.step; k++) {
      await gotIt(page);
      await page.clock.runFor(600);
    }
    await steady(page, 60, { paused: true });
    const dir = join(TMP, "frames");
    let f = await frames(page, dir, 108); // 1.8 s
    await gotIt(page); // arrives at the chosen step
    f = await frames(page, dir, 78, f); // the camera eases to the new leg
    for (let z = 0; z < chosenStep.zoomSteps; z++) {
      await zoomIn(page); // then the shopper pinches in, as in the still
      f = await frames(page, dir, 5, f);
    }
    f = await frames(page, dir, LOOP_F - f, f);
    await ctx.close();
    sizes.trip = encode(dir, join(IMG, "trip"), [[0, LOOP_F]]);
    sizes.tripPosterKB = poster(join(dir, "00000.png"), join(IMG, "trip-poster.webp"));
    // the 2× poster the page swaps in after load (the small one carries the first paint)
    sizes.tripPoster2xKB = poster(join(dir, "00000.png"), join(IMG, "trip-poster-2x.webp"), 780, 82);
  }
} finally {
  await browser.close();
}

for (const name of ["list", "trip", "checkout", "guard", "survey"]) sizes[name] = still(join(TMP, `${name}.png`), join(IMG, name));
clean(TMP);
console.log(JSON.stringify(sizes));
console.log(`trip frame: step ${chosenStep.step}, ${chosenStep.cards} cards`);
