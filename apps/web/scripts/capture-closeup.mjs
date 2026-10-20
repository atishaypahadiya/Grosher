// Captures the close-up arrival for the README and the project page: a short list whose first stop is in
// Produce (a hero zone), routed; the map appears, the camera comes down through the skylight to eye level
// and strolls to the bananas; a hold; Got it; the way out to the map and down again to the next stop, toor
// dal in Bulk. From a running production build at 390×844 (the poster 2×):
//
//   npm run build -w @grosher/web && (cd apps/web && npx vite preview --port 4173 &)
//   node apps/web/scripts/capture-closeup.mjs http://localhost:4173
//
// Writes public/project/img/closeup.{webm,mp4} with closeup-poster.webp (the project page's hero): the first
// arrival, a second at eye level, Got it, the way out and the second arrival; and closeup.gif (the README's
// hero): the first arrival only, ≤ 1.5 MB. Needs a GPU: a software renderer draws the
// close-ups at a few frames a second, so this one launches Chromium on the Mac's GPU (ANGLE on Metal).
// Needs ffmpeg and cwebp.

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const IMG = join(import.meta.dirname, "..", "public", "project", "img");
const TMP = join(import.meta.dirname, "..", "public", "project", ".closeup-tmp");
const LIST = "Bananas, Toor dal (bulk), Greek yogurt";
const GL = process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"];

mkdirSync(IMG, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const browser = await chromium.launch({ args: GL });
const marks = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block", recordVideo: { dir: TMP, size: { width: 390, height: 844 } } });
  const t0 = Date.now();
  const mark = (k) => (marks[k] = (Date.now() - t0) / 1000);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120_000);
  // no resolver here: every item on this list is in the catalog
  await page.route(/11434|workers\.dev|\/api\//, (r) => r.abort());
  // ?perf=1 publishes the close-up state (window.__grosherCloseUp); it draws no readout
  await page.goto(`${BASE}/?tier=hi&perf=1`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__grosherIndex);
  await page.evaluate(() => document.fonts.ready);
  const input = page.getByLabel(/add items/i);
  await input.fill(LIST);
  await input.press("Enter");
  await page.getByText(/3 items · 3 placed/i).waitFor();
  // the first stop's close-up is prepared on the list (hero/usePrepareFirst.ts): give it its idle time
  await page.waitForTimeout(4000);
  mark("route");
  await page.getByRole("button", { name: /route 3 items/i }).click();
  await page.getByTestId("map3d").waitFor();
  mark("map");
  await page.waitForFunction(() => window.__grosherCloseUp?.state === "open");
  mark("open1");
  const first = await page.evaluate(() => window.__grosherCloseUp);
  // the arrival (descent + stroll) and a hold at eye level
  await page.waitForTimeout(6500);
  // the poster: eye level in Produce, a 2× still (the video is recorded at 390 × 844 CSS pixels)
  await page.screenshot({ path: join(TMP, "poster.png") });
  mark("hold1");
  await page.getByRole("button", { name: /got it/i }).click();
  mark("gotit");
  await page.waitForFunction((z) => window.__grosherCloseUp?.state === "open" && window.__grosherCloseUp.zone !== z, first.zone);
  mark("open2");
  const second = await page.evaluate(() => window.__grosherCloseUp);
  await page.waitForTimeout(5000);
  mark("end");
  await page.close();
  await ctx.close();
  console.log(`first: ${first.zone} · ${first.item}; second: ${second.zone} · ${second.item}`);
  console.log(JSON.stringify(marks));
} finally {
  await browser.close();
}

const raw = readdirSync(TMP).find((f) => f.endsWith(".webm"));
renameSync(join(TMP, raw), join(TMP, "raw.webm"));
const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
// two cuts: from the first 3D frame (the close-up opens with it; before it the flat map shows while the
// 3D chunk loads) through the arrival and a second at eye level; then Got it to the second arrival's end
const ARRIVAL_S = 3.4; // the descent and the stroll, measured from these captures
const cuts = [
  [marks.open1 + 0.1, marks.open1 + ARRIVAL_S + 1.0],
  [marks.gotit - 0.2, marks.end - 1.5],
];
const trims = cuts.map(([a, b], i) => `[0:v]trim=${a.toFixed(2)}:${b.toFixed(2)},setpts=PTS-STARTPTS[c${i}]`).join(";") + `;[c0][c1]concat=n=2:v=1[cut]`;
ff(["-i", join(TMP, "raw.webm"), "-an", "-filter_complex", `${trims};[cut]scale=390:-2[v]`, "-map", "[v]", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "40", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", join(IMG, "closeup.webm")]);
ff(["-i", join(TMP, "raw.webm"), "-an", "-filter_complex", `${trims};[cut]scale=390:-2[v]`, "-map", "[v]", "-c:v", "libx264", "-preset", "slow", "-crf", "31", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(IMG, "closeup.mp4")]);
// 480 px, q70 (~40 KB): the poster is the project page's largest paint on a phone, and preloaded at this size
// it keeps Lighthouse's mobile performance at 100 (780 px at q78, 106 KB, read 98–99)
execFileSync("cwebp", ["-quiet", "-resize", "480", "0", "-q", "70", join(TMP, "poster.png"), "-o", join(IMG, "closeup-poster.webp")]);
// the README's GIF: the first arrival only (the descent into Produce, the stroll, a second at eye level), one
// palette, at most GIF_MAX_KB: the first rung of the ladder that fits
const GIF_MAX_KB = 1500;
const [g0, g1] = cuts[0];
let gif = null;
for (const [fps, width, colors] of [[10, 270, 112], [10, 250, 96], [9, 240, 88], [8, 230, 80], [8, 220, 64]]) {
  ff(["-ss", g0.toFixed(2), "-t", (g1 - g0).toFixed(2), "-i", join(TMP, "raw.webm"), "-vf", `fps=${fps},scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`, "-loop", "0", join(IMG, "closeup.gif")]);
  const kb = statSync(join(IMG, "closeup.gif")).size / 1024;
  if (kb <= GIF_MAX_KB) {
    gif = { fps, width, colors, kb: Math.round(kb), seconds: Number((g1 - g0).toFixed(1)) };
    break;
  }
}
if (!gif) throw new Error(`closeup.gif: no rung of the ladder fits in ${GIF_MAX_KB} KB`);
console.log(`closeup.gif: ${gif.seconds} s at ${gif.fps} fps, ${gif.width} px, ${gif.colors} colours`);
rmSync(TMP, { recursive: true, force: true });
for (const f of ["closeup.webm", "closeup.mp4", "closeup-poster.webp", "closeup.gif"]) console.log(`${f} ${Math.round(statSync(join(IMG, f)).size / 1024)} KB`);
writeFileSync(join(IMG, "..", "closeup.json"), JSON.stringify({ _note: "Written by apps/web/scripts/capture-closeup.mjs (production build, 390×844, GPU). Seconds from the video's start.", capturedAt: new Date().toISOString().slice(0, 10), list: LIST.split(", "), marks, cuts, gif }, null, 2) + "\n");
