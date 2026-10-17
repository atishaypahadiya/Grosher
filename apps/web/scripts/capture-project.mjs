// Captures the media for the project page (public/project/) from a running
// production build of the app on the demo store, at 390×844:
//
//   npm run build -w @grosher/web && (cd apps/web && npx vite preview --port 4173 &)
//   node apps/web/scripts/capture-project.mjs http://localhost:4173
//
// Writes public/project/img/{list,checkout}.webp (2× stills), trip.webm + trip.mp4 + trip-poster.png
// (a 6-second loop of two reroutes: Got it, the camera eases to the next leg) and
// public/project/capture.json (the trip's numbers, which the page's live share card shows).
//
// The trip clock: Playwright taps through a trip in seconds, so the page's Date.now is frozen at load
// and advances only by each leg's distance at the app's own walking pace (WALK_MPS, 1.0 m/s in
// src/lib/format.ts) before each "Got it". The card's time is therefore exactly the legs to the
// stops at 1 m/s: no time at the shelf, none of the capture's own seconds. capture.json says so.
// Timers and animation frames are untouched (only Date.now is shimmed).
// Needs ffmpeg and cwebp on the PATH.

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const OUT = join(import.meta.dirname, "..", "public", "project");
const IMG = join(OUT, "img");
const TMP = join(OUT, ".capture-tmp");
const WALK_MPS = 1.0; // src/lib/format.ts
const LIST = "Bananas, Spinach, Basmati rice, Toor dal, Paneer, Milk, Greek yogurt, Paper towels, Tylenol, Ice cream";
const ITEMS = LIST.split(", ").length;
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

const browser = await chromium.launch({ args: GL });

// ---------------------------------------------------------------- stills and the trip's numbers (2×)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(clockShim);
  const page = await ctx.newPage();
  await openTrip(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(TMP, "list.png") });

  await page.getByRole("button", { name: new RegExp(`route ${ITEMS} items`, "i") }).click();
  await page.getByTestId("map3d").waitFor({ timeout: 60_000 });
  let legsM = 0;
  for (let k = 0; k < ITEMS; k++) {
    const m = Number((await page.locator(".trip-dist .num").first().textContent()) ?? 0);
    legsM += m;
    await page.evaluate((ms) => (window.__walkedMs += ms), (m / WALK_MPS) * 1000);
    await page.getByRole("button", { name: /got it/i }).click();
  }
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
        _note: "Written by apps/web/scripts/capture-project.mjs from the production build on the demo store. Simulated trip: the clock is the legs to the stops (legsToStopsM) at the app's walking pace (WALK_MPS = 1.0 m/s, src/lib/format.ts), no time at the shelf. 'Walked' also counts the legs to the lane and the exit. The project page's share card shows these numbers.",
        capturedAt: new Date().toISOString().slice(0, 10),
        list: LIST.split(", "),
        legsToStopsM: legsM,
        card,
      },
      null,
      2,
    ) + "\n",
  );
  await ctx.close();
}

// ---------------------------------------------------------------- the reroute loop (1×, recorded)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, recordVideo: { dir: TMP, size: { width: 390, height: 844 } } });
  await ctx.addInitScript(clockShim);
  const page = await ctx.newPage();
  const t0 = Date.now();
  await openTrip(page);
  await page.getByRole("button", { name: new RegExp(`route ${ITEMS} items`, "i") }).click();
  await page.getByTestId("map3d").waitFor({ timeout: 60_000 });
  await steady(page, 40);
  const start = (Date.now() - t0) / 1000;
  await page.waitForTimeout(1300);
  await page.getByRole("button", { name: /got it/i }).click();
  await page.waitForTimeout(2300);
  await page.getByRole("button", { name: /got it/i }).click();
  await page.waitForTimeout(2600);
  await ctx.close(); // flushes the video
  const raw = readdirSync(TMP).find((f) => f.endsWith(".webm"));
  if (!raw) throw new Error("no video recorded");
  renameSync(join(TMP, raw), join(TMP, "raw.webm"));
  const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
  ff(["-ss", String(start), "-t", "6", "-i", join(TMP, "raw.webm"), "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", join(IMG, "trip.webm")]);
  // H.264 too, for Safari versions without WebM: same six seconds
  ff(["-i", join(IMG, "trip.webm"), "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(IMG, "trip.mp4")]);
  ff(["-ss", String(start), "-i", join(TMP, "raw.webm"), "-frames:v", "1", join(IMG, "trip-poster.png")]);
}

await browser.close();

// ---------------------------------------------------------------- stills → WebP
for (const name of ["list", "checkout"]) execFileSync("cwebp", ["-quiet", "-q", "76", "-m", "6", join(TMP, `${name}.png`), "-o", join(IMG, `${name}.webp`)]);
rmSync(TMP, { recursive: true, force: true });
console.log(`wrote ${IMG}: ${readdirSync(IMG).join(", ")} and capture.json`);
