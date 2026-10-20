// Shared by the media scripts (capture-project.mjs, capture-closeup.mjs): the browser on this Mac's GPU, the
// app at full quality, stills in AVIF / WebP / PNG at 1× / 2× / 3×, and video recorded frame by frame.
//
// Quality: Chromium on the GPU (ANGLE on Metal; SwiftShader elsewhere, with a warning: its close-ups are a few
// frames a second and its output is not what a phone shows), the page at deviceScaleFactor 3 for stills and 2
// for video, and the app's capture parameters: ?dpr=3 (the canvas at the page's full pixel ratio; the app caps
// it at 2) and ?msaa=4 (the composer's target multisampled; the app draws it without) — src/map3d/renderQuality.ts
// — with the close-ups' hi texture tier pinned (?tier=hi).
//
// Video: the page's clock is installed and paused (Playwright's clock: Date, performance.now, timers and
// requestAnimationFrame), then stepped 1/60 s at a time with a screenshot after each step, so every frame is
// drawn and the motion is exactly 60 fps whatever a frame costs to render. Encoded as AV1 (SVT-AV1) and H.264
// MP4s at a quality that keeps grain and label text.

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export const FPS = 60;
export const VIEW = { width: 390, height: 844 };
/** the widest box a phone-shaped still is shown in on the project page (the hero's phone, 360 px less its bezel) */
export const STILL_1X = 342;
export const QUALITY = "tier=hi&dpr=3&msaa=4";

export const onGpu = process.platform === "darwin";
const GL = onGpu ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"];

export async function launch() {
  if (!onGpu) console.warn("capture-kit: no Metal here, rendering in SwiftShader: soft and slow, not for publishing");
  return chromium.launch({ args: GL });
}

/** a phone-sized context; `paused` installs the page clock and stops it (video), else time is real (stills) */
export async function phone(browser, { dsf = 3, paused = false } = {}) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: dsf, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180_000);
  // no resolver: everything these lists hold is in the catalog, and a local model would make runs differ
  await page.route(/11434|workers\.dev|\/api\//, (r) => r.abort());
  if (paused) {
    await page.clock.install({ time: new Date("2026-10-20T10:00:00") });
    await page.clock.pauseAt(new Date("2026-10-20T10:00:01"));
  }
  return { ctx, page };
}

/** wait for `fn` in the page; on a paused clock, page time advances `step` ms between looks */
export async function until(page, fn, { arg, timeout = 180_000, step = 50, paused = false } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn, arg).catch(() => false)) return;
    if (paused) await page.clock.runFor(step);
    else await page.waitForTimeout(step);
  }
  throw new Error(`timed out waiting for ${String(fn).slice(0, 120)}`);
}

/** n frames of page time, 1/60 s each, a screenshot after each into dir/NNNNN.png (numbered from `from`) */
export async function frames(page, dir, n, from = 0) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    await page.clock.runFor(1000 / FPS);
    await page.screenshot({ path: join(dir, `${String(from + i).padStart(5, "0")}.png`) });
  }
  return from + n;
}

export const frameCount = (dir) => readdirSync(dir).filter((f) => f.endsWith(".png")).length;

// SVT-AV1 prints its configuration whatever ffmpeg's log level: quiet, unless it fails
const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });

/**
 * dir/NNNNN.png → out.av1.mp4 (SVT-AV1, CRF 34) and out.mp4 (H.264 high, CRF 18): 60 fps, the frames' own size
 * (2× the CSS viewport), cut to [first, last) frame ranges joined in order
 */
export function encode(dir, out, cuts) {
  const list = join(dir, "frames.txt");
  const lines = [];
  for (const [a, b] of cuts) for (let i = a; i < b; i++) lines.push(`file '${join(dir, `${String(i).padStart(5, "0")}.png`)}'`, `duration ${1 / FPS}`);
  execFileSync("sh", ["-c", `cat > '${list}'`], { input: lines.join("\n") + "\n" });
  const input = ["-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=${FPS},format=yuv420p`, "-an"];
  ff([...input, "-c:v", "libsvtav1", "-preset", "5", "-crf", "34", "-g", "120", "-movflags", "+faststart", `${out}.av1.mp4`]);
  ff([...input, "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "18", "-tune", "film", "-movflags", "+faststart", `${out}.mp4`]);
  return { av1KB: Math.round(statSync(`${out}.av1.mp4`).size / 1024), h264KB: Math.round(statSync(`${out}.mp4`).size / 1024), seconds: Number((lines.length / 2 / FPS).toFixed(2)) };
}

/**
 * A 3× PNG (1170 px wide) → base-{1x,2x,3x}.{avif,webp,png}, 1× being STILL_1X px wide. AVIF and WebP at a
 * quality that keeps label text; the PNGs (the fallback) through pngquant at its highest quality.
 */
export function still(png, base) {
  const out = {};
  for (const [x, w] of [["1x", STILL_1X], ["2x", STILL_1X * 2], ["3x", STILL_1X * 3]]) {
    const sized = `${base}-${x}.png`;
    ff(["-i", png, "-vf", `scale=${w}:-2:flags=lanczos`, sized]);
    execFileSync("avifenc", ["-q", "62", "-s", "4", "--yuv", "444", sized, `${base}-${x}.avif`], { stdio: "ignore" });
    execFileSync("cwebp", ["-quiet", "-q", "82", "-m", "6", "-sharp_yuv", sized, "-o", `${base}-${x}.webp`]);
    execFileSync("pngquant", ["--force", "--skip-if-larger", "--quality", "85-98", "--speed", "1", "--output", sized, sized]);
    out[x] = Object.fromEntries(["avif", "webp", "png"].map((f) => [f, Math.round(statSync(`${base}-${x}.${f}`).size / 1024)]));
  }
  return out;
}

/** a small WebP for a video's poster (it carries the page's first paint on a phone) */
export function poster(png, file, width = 480, q = 70) {
  execFileSync("cwebp", ["-quiet", "-resize", String(width), "0", "-q", String(q), "-sharp_yuv", png, "-o", file]);
  return Math.round(statSync(file).size / 1024);
}

export const clean = (dir) => rmSync(dir, { recursive: true, force: true });
