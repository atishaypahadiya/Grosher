// Captures the media for the project page (public/project/) from a running
// production build of the app on the demo store, at 390×844:
//
//   npm run build -w @grosher/web && (cd apps/web && npx vite preview --port 4173 &)
//   node apps/web/scripts/capture-project.mjs http://localhost:4173
//
// Writes public/project/img/{list,trip,checkout}.webp (2× stills), trip.webm + trip.mp4 with
// trip-poster.webp (a 6-second loop: hold, Got it, the route re-solves and the camera eases to the
// next leg, hold), and public/project/capture.json (the trip's numbers and how the frame was chosen;
// the page's live share card shows them).
//
// The list: 14 everyday items over 13 aisles, typed in no store order, as a shopper writes a list.
// The trip frame: a true mid-trip step, the one nearest TARGET_STEP (6 of 14) within 30–70% of the way,
// whose view has the next stop's marker (the lit slot) inside the map area, the camera within 40 m (the
// shelves and the lit slot read; further out the store is a thin band), and its drawn cards (at most three
// since the map caps them: the next stop and the two after it, src/map3d/cardPlan.ts) clear of the
// edges, the progress strip, the sheet and each other. If none qualifies as framed, the capture zooms in
// with the app's own wheel / pinch zoom one notch at a time; capture.json records the step and the zoom.
// The video: hold, Got it arriving at that step, the camera eases to the new leg (then the same zoom, if
// any), hold.
//
// The trip clock: Playwright taps through a trip in seconds, so the page's Date.now is frozen at load
// and advances only by each leg's distance at the app's own walking pace (WALK_MPS, 1.0 m/s in
// src/lib/format.ts) before each "Got it". The card's time is therefore exactly the legs to the
// stops at 1 m/s: no time at the shelf, none of the capture's own seconds. capture.json says so.
// Timers and animation frames are untouched (only Date.now is shimmed). Needs ffmpeg and cwebp.

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
const GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"];

mkdirSync(IMG, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

/** Date.now frozen at load plus window.__walkedMs, so the trip clock reads walking time only */
const clockShim = () => {
  const frozen = Date.now();
  window.__walkedMs = 0;
  Date.now = () => frozen + window.__walkedMs;
};

async function openTrip(page) {
  await page.goto(`${BASE}/?perf=1`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__grosherIndex, null, { timeout: 60_000 }); // the full catalog's index
  const input = page.getByLabel(/add items/i);
  await input.fill(LIST);
  await input.press("Enter");
  await page.getByText(new RegExp(`${ITEMS} items · ${ITEMS} placed`, "i")).waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function steady(page, frames) {
  await page.evaluate(() => window.__grosherPerf && (window.__grosherPerf.frames = 0));
  await page.waitForFunction((n) => (window.__grosherPerf?.frames ?? 0) >= n, frames, { timeout: 120_000 });
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

const browser = await chromium.launch({ args: GL });

// ---------------------------------------------------------------- stills, the frame choice and the trip's numbers (2×)
let chosenStep = null;
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(clockShim);
  const page = await ctx.newPage();
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
    if (process.env.SCAN) {
      const f = await page.evaluate(frameReport, EDGE);
      const dist = await page.evaluate(() => window.__grosherPerf?.distance ?? Infinity);
      console.log(`scan step ${k}: ${dist} m, ${f.cards} cards, ${f.dots} dots, inside ${f.cardsInside}, overlap ${f.cardsOverlap}, next in map ${f.nextInMap} · ${f.names.map((n) => n.slice(0, 18)).join(" | ")}`);
    }
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
        _note: "Written by apps/web/scripts/capture-project.mjs from the production build on the demo store. Simulated trip: the clock is the legs to the stops (legsToStopsM) at the app's walking pace (WALK_MPS = 1.0 m/s, src/lib/format.ts), no time at the shelf. 'Walked' also counts the legs to the lane and the exit. The 3D still and the end of the video are trip step `tripFrame.step`, zoomed in by `tripFrame.zoomSteps` wheel notches (the app's own zoom). The project page's share card shows these numbers.",
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

// ---------------------------------------------------------------- the reroute loop (1×, recorded): one Got it arriving at the chosen frame
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, recordVideo: { dir: TMP, size: { width: 390, height: 844 } } });
  await ctx.addInitScript(clockShim);
  const page = await ctx.newPage();
  const t0 = Date.now();
  await openTrip(page);
  await page.getByRole("button", { name: new RegExp(`route ${ITEMS} items`, "i") }).click();
  await page.getByTestId("map3d").waitFor({ timeout: 60_000 });
  await steady(page, 20);
  for (let k = 1; k < chosenStep.step; k++) {
    await gotIt(page);
    await page.waitForTimeout(600);
  }
  await steady(page, 40);
  const start = (Date.now() - t0) / 1000;
  await page.waitForTimeout(1800);
  await gotIt(page); // arrives at the chosen step
  await page.waitForTimeout(1300); // the camera eases to the new leg
  for (let z = 0; z < chosenStep.zoomSteps; z++) {
    await zoomIn(page); // then the shopper pinches in, as in the still
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(3400);
  await ctx.close(); // flushes the video
  const raw = readdirSync(TMP).find((f) => f.endsWith(".webm"));
  if (!raw) throw new Error("no video recorded");
  renameSync(join(TMP, raw), join(TMP, "raw.webm"));
  const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
  ff(["-ss", String(start), "-t", "6", "-i", join(TMP, "raw.webm"), "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", join(IMG, "trip.webm")]);
  // H.264 too, for Safari versions without WebM: same six seconds
  ff(["-i", join(IMG, "trip.webm"), "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(IMG, "trip.mp4")]);
  ff(["-ss", String(start), "-i", join(TMP, "raw.webm"), "-frames:v", "1", join(TMP, "poster.png")]);
}

await browser.close();

// ---------------------------------------------------------------- stills and poster → WebP
for (const name of ["list", "trip", "checkout"]) execFileSync("cwebp", ["-quiet", "-q", "76", "-m", "6", join(TMP, `${name}.png`), "-o", join(IMG, `${name}.webp`)]);
execFileSync("cwebp", ["-quiet", "-q", "72", "-m", "6", join(TMP, "poster.png"), "-o", join(IMG, "trip-poster.webp")]);
rmSync(join(IMG, "trip-poster.png"), { force: true }); // the PNG poster of v1
rmSync(TMP, { recursive: true, force: true });
console.log(`wrote ${IMG}: ${readdirSync(IMG).join(", ")} and capture.json · trip frame: step ${chosenStep.step}, ${chosenStep.cards} cards`);
