// The close-up gate (CI): opens close-ups on the production build and holds them to the close-up budget
// (src/hero/budget.ts), separate from the overview's perf gate: Grosher's Bulk & pulses hero zone, and the
// worst standard close-up (the most triangles of all 319, test/standard-zone.test.ts: A4-R16, the mole,
// enchilada and hot sauces, jars and bottles on both faces of a 35 m aisle).
//
//   node scripts/hero-gate.mjs http://localhost:4173 [--shots dir]
//
//   lazy        nothing of a close-up (its chunks, its textures, the transcoder) is fetched by the list screen
//               before the list has an item, nor by a trip whose close-ups never open (?closeup=0)
//   draw calls  per frame, every pass: the worst frame of the arrival (high up, the overview still drawn under
//               the zone), at eye level, looking along the aisle; Bulk's scoop bins out over the store
//   triangles   the same
//   GPU MB      the close-up's textures as transcoded on this device, every mip level (hi tier)
//   download    what a close-up fetches that the overview did not: its chunks (gzip), its hi-tier KTX2 files and
//               the transcoder (gzip), by the requests the page made, sized from dist/
//   prepared    the next stop's zone ready when its close-up is asked for (prepared during the stop before), and
//               the first stop's on the list screen
//
// Frame times are headless software rendering (SwiftShader): printed, never judged. Check a phone with
// ?debug=perf.

import { chromium } from "playwright";
import { gzipSync } from "node:zlib";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CLOSE_UP_BUDGET as B } from "../src/hero/budget.ts";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const shotsAt = process.argv.indexOf("--shots");
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const DIST = join(import.meta.dirname, "..", "dist");
const GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"];

// ---- download size: the files a session fetched beyond the overview's, sized from the build
const assets = readdirSync(join(DIST, "assets"));
for (const name of ["HeroZone", "StandardZone"]) if (!assets.some((f) => f.startsWith(`${name}-`) && f.endsWith(".js"))) throw new Error(`no ${name} chunk in dist/assets: is the zone still lazy?`);
const gz = (p) => gzipSync(readFileSync(p)).length;
const fileOf = (url) => {
  const path = new URL(url).pathname;
  const m = /^\/(assets|basis)\/(.+)$/.exec(path);
  return m ? join(DIST, m[1], m[2]) : null;
};
/** the close-up's own download: chunks and wasm gzipped, textures as they are */
const downloadOf = (urls, baseline) => {
  const out = { chunks: 0, textures: 0, transcoder: 0 };
  for (const u of new Set(urls)) {
    if (baseline.has(u)) continue;
    const f = fileOf(u);
    if (!f) continue;
    if (f.endsWith(".ktx2")) out.textures += statSync(f).size;
    else if (/basis_transcoder/.test(f)) out.transcoder += gz(f);
    else if (f.endsWith(".js")) out.chunks += gz(f);
  }
  return { ...out, kb: (out.chunks + out.textures + out.transcoder) / 1024 };
};

const browser = await chromium.launch({ args: GL });
// every scenario in a fresh context: clean storage, and nothing left rendering from the one before (a busy
// software-rendered page can keep the next navigation from loading on CI's runners)
let ctx = null;
let page = null;
const fresh = async (query) => {
  if (ctx) await ctx.close();
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  page = await ctx.newPage();
  page.setDefaultTimeout(90_000);
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (r) => fetched.push(r.url()));
  await page.goto(`${BASE}/${query}`, { waitUntil: "load", timeout: 120_000 });
};
const errors = [];
const fetched = [];
const heroish = (u) => /HeroZone-|StandardZone-|\.ktx2|basis_transcoder/.test(u);

const steady = async (n) => {
  await page.evaluate(() => window.__grosherPerf && (window.__grosherPerf.frames = 0));
  await page.waitForFunction((k) => (window.__grosherPerf?.frames ?? 0) >= k, n, { timeout: 120_000 });
  return page.evaluate(() => window.__grosherPerf);
};

const rows = [];
let lazy;
const preload = { prepared: false, readyMs: 0, onList: false, std: false, stdReadyMs: 0 };
const downloads = {};
/** request → ready of a stop's close-up, from the map's log */
const readyMs = (zone) =>
  page.evaluate((z) => {
    const log = (window.__grosherCloseUpLog ?? []).filter((e) => e.zone === z);
    const req = log.find((e) => e.event === "request" || e.event === "request+ready");
    const ready = log.find((e) => e.event === "ready" || e.event === "request+ready");
    return req && ready ? Math.round(ready.t - req.t) : null;
  }, zone);
let baseline;
try {
  await fresh("?perf=1");
  const input = page.getByLabel(/add items/i);
  await input.waitFor({ timeout: 30_000 });
  // the list screen with nothing on it fetches nothing of a close-up
  await page.waitForTimeout(3000);
  lazy = !fetched.some(heroish);
  // the overview alone (no close-up opens) neither: its requests are the baseline of every close-up's download
  await fresh("?perf=1&closeup=0");
  const input0 = page.getByLabel(/add items/i);
  await input0.fill("Milk, Bananas");
  await input0.press("Enter");
  await page.getByRole("button", { name: /route 2 items/i }).click({ timeout: 30_000 });
  await page.getByTestId("map3d").waitFor({ timeout: 60_000 });
  await steady(20);
  lazy &&= !fetched.some(heroish);
  baseline = new Set(fetched);
  fetched.length = 0;
  // now, in a fresh visit, a bulk item: the next stop is in the zone and the close-up opens on its own
  await fresh("?perf=1&tier=hi");
  const again = page.getByLabel(/add items/i);
  await again.fill("toor dal (bulk)");
  await again.press("Enter");
  // the route starts in the zone: its close-up is prepared while the list is open (chunks, fixtures, the
  // zone's geometry and textures), before Route is tapped
  preload.onList = await page
    .waitForFunction(() => window.__grosherPrepared === "grosher:bulk", null, { timeout: 60_000 })
    .then(() => true, () => false);
  // the arrival in slow motion (the page's clock 40× slower): every frame's reading, the worst kept
  const slowClock = () => page.evaluate(() => {
    const real = performance.now.bind(performance);
    let base = real();
    let at = base;
    let rate = 1 / 40;
    performance.now = () => at + (real() - base) * rate;
    // back to real time, without the clock jumping
    window.__grosherClockNormal = () => {
      at += (real() - base) * rate;
      base = real();
      rate = 1;
    };
  });
  /** the arrival (worst frame, slowed), eye level, and a look along the aisle, for the close-up now opening */
  const arrival = async (label, shot) => {
    await page.waitForFunction(() => window.__grosherCloseUp?.state === "open" && window.__grosherPerf?.hero?.tier, null, { timeout: 90_000 });
    let worst = null;
    // 2.5 s of arrival at 1/40 speed: 100 s; read every 1.5 s
    for (let i = 0; i < 40; i++) {
      const r = await page.evaluate(() => ({ ...window.__grosherPerf }));
      if (!worst || r.calls > worst.calls || (r.calls === worst.calls && r.triangles > worst.triangles)) worst = r;
      await page.waitForTimeout(1500);
    }
    // (this page's clock was slowed: its frame times mean nothing, so they print as "–")
    rows.push({ view: `${label}: arriving (worst frame)`, ...worst, patched: true });
    await page.evaluate(() => window.__grosherClockNormal());
    await page.waitForTimeout(3000); // the walk in ends, then settle
    rows.push({ view: `${label}: eye level`, ...(await steady(30)), patched: true });
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `${shot}-eye.png`) });
    // look along the aisle: the widest view of the zone (and the overview beyond it)
    const box = await page.getByTestId("map3d").boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.45;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 300, cy, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    rows.push({ view: `${label}: along the aisle`, ...(await steady(30)), patched: true });
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `${shot}-aisle.png`) });
  };
  await slowClock();
  await page.getByRole("button", { name: /route 1 item/i }).click({ timeout: 30_000 });
  await arrival("Bulk", "hero");
  downloads.Bulk = downloadOf(fetched, baseline);
  // a scoop bin on the island's north face: the shopper looks south, out over the rest of the store
  await fresh("?perf=1&tier=hi");
  const third = page.getByLabel(/add items/i);
  await third.fill("bulk granola");
  await third.press("Enter");
  await page.getByRole("button", { name: /route 1 item/i }).click({ timeout: 30_000 });
  await page.waitForFunction(() => window.__grosherCloseUp?.state === "open" && window.__grosherPerf?.hero?.tier, null, { timeout: 90_000 });
  await page.waitForTimeout(3000);
  rows.push({ view: "Bulk: scoop bins, facing out", ...(await steady(30)) });
  // the worst standard close-up: the first stop, prepared on the list like Bulk's
  await fresh("?perf=1&tier=hi");
  fetched.length = 0;
  const std = page.getByLabel(/add items/i);
  await std.fill("enchilada sauce");
  await std.press("Enter");
  preload.std = await page
    .waitForFunction(() => window.__grosherPrepared === "grosher:std:A4-R16", null, { timeout: 60_000 })
    .then(() => true, () => false);
  await slowClock();
  await page.getByRole("button", { name: /route 1 item/i }).click({ timeout: 30_000 });
  await arrival("standard A4-R16", "standard");
  downloads["standard"] = downloadOf(fetched, baseline);
  // prepared ahead: a floral stop (a standard close-up), then toor dal; while the first is open the Bulk zone
  // is prepared in the background, and after "Got it" (the way out, the next leg shown on the map) it opens
  // without a pause; then a standard stop after Bulk, the same
  await fresh("?perf=1&tier=hi");
  const fourth = page.getByLabel(/add items/i);
  await fourth.fill("bouquet, toor dal (bulk), milk");
  await fourth.press("Enter");
  await page.getByRole("button", { name: /route 3 items/i }).click({ timeout: 30_000 });
  await page.getByTestId("map3d").waitFor({ timeout: 60_000 });
  for (const zone of ["bulk", null]) {
    await page.waitForFunction(() => window.__grosherCloseUp?.state === "open", null, { timeout: 90_000 });
    await page.waitForTimeout(6000); // the arrival, then the next zone's compile and upload in the background
    await page.getByRole("button", { name: /got it/i }).click();
    await page.waitForFunction((z) => (z ? window.__grosherCloseUp?.zone === z : window.__grosherCloseUp?.quality === "standard" && window.__grosherCloseUp?.item !== "Bouquet") && window.__grosherCloseUp?.state === "open", zone, { timeout: 90_000 });
    const z = await page.evaluate(() => window.__grosherCloseUp.zone);
    const ms = await readyMs(z);
    if (zone) preload.readyMs = ms;
    else preload.stdReadyMs = ms;
  }
  // ready within a frame or two of being asked for: it was prepared (unprepared, the zone loads, builds and
  // compiles first: seconds on a software renderer)
  preload.prepared = preload.readyMs !== null && preload.readyMs < 400 && preload.stdReadyMs !== null && preload.stdReadyMs < 400;
} finally {
  await browser.close();
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad("view", 28)} ${pad("calls", 7)} ${pad("triangles", 11)} ${pad("GPU tex", 10)} frame ms (SwiftShader)`);
let failed = !lazy || errors.length > 0;
for (const r of rows) {
  // the KTX2 textures and the gloss's baked environment map
  const mb = (r.hero.gpuBytes + (r.hero.envBytes ?? 0)) / 2 ** 20;
  const over = r.calls > B.drawCalls || r.triangles > B.triangles || mb > B.gpuTextureMB;
  failed ||= over;
  console.log(`${pad(r.view, 28)} ${pad(r.calls, 7)} ${pad(r.triangles.toLocaleString("en-US"), 11)} ${pad(mb.toFixed(1) + " MB", 10)} ${r.patched ? "–" : r.frameMs.toFixed(1)}${over ? "   OVER BUDGET" : ""}`);
}
console.log("");
for (const [zone, d] of Object.entries(downloads)) {
  const dlOver = d.kb > B.downloadKB;
  failed ||= dlOver;
  console.log(`download, ${zone}: ${d.kb.toFixed(0)} KB (chunks ${(d.chunks / 1024).toFixed(0)} KB gzip, textures ${(d.textures / 1024).toFixed(0)} KB, transcoder ${(d.transcoder / 1024).toFixed(0)} KB gzip)${dlOver ? "   OVER BUDGET" : ""}`);
}
console.log(`lazy: ${lazy ? "nothing of a close-up fetched by an empty list or a trip without close-ups" : "FETCHED WITHOUT A CLOSE-UP"}`);
console.log(`prepared ahead: ${preload.prepared ? `yes, during the stop before; asked for → ready ${preload.readyMs} ms (Bulk), ${preload.stdReadyMs} ms (standard)` : `NO: the next stop's zone was not ready when asked for (${preload.readyMs} ms Bulk, ${preload.stdReadyMs} ms standard)`}`);
failed ||= !preload.prepared;
console.log(`prepared on the list: ${preload.onList && preload.std ? "yes, before Route (Bulk, and the standard A4-R16)" : `NO: the first stop's close-up was not prepared on the list screen (Bulk ${preload.onList}, standard ${preload.std})`}`);
failed ||= !preload.onList || !preload.std;
console.log(`tier: ${rows[0]?.hero.tier}`);
console.log(`budget: ≤ ${B.drawCalls} draw calls, ≤ ${B.triangles.toLocaleString("en-US")} triangles, ≤ ${B.gpuTextureMB} MB GPU textures, ≤ ${B.downloadKB.toLocaleString("en-US")} KB download`);
if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 5).join("\n  ")}`);
if (failed) {
  console.error("close-up gate FAILED");
  process.exit(1);
}
console.log("close-up gate passed");
