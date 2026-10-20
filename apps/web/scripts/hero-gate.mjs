// The close-up gate (CI): opens Grosher's Bulk & pulses hero zone on the production build and holds it to
// the close-up budget (src/hero/budget.ts), separate from the overview's perf gate:
//
//   node scripts/hero-gate.mjs http://localhost:4173 [--shots dir]
//
//   lazy        nothing of the zone (its chunk, its textures, the transcoder) is fetched before a close-up opens
//   draw calls  per frame, every pass: the worst frame of the arrival (high up, the overview still drawn under
//               the zone), at eye level facing PULSES & DALS, looking down the aisle, and from the island's scoop
//               bins out over the store
//   triangles   the same
//   GPU MB      the hero textures as transcoded on this device, every mip level (hi tier)
//   download    the zone chunk (gzip), its hi-tier KTX2 files and the transcoder (gzip), from dist/
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

// ---- download size, from the build
const assets = readdirSync(join(DIST, "assets"));
const zoneChunk = assets.find((f) => /^HeroZone-.*\.js$/.test(f));
if (!zoneChunk) throw new Error("no HeroZone chunk in dist/assets: is the zone still lazy?");
const gz = (p) => gzipSync(readFileSync(p)).length;
const download = {
  chunk: gz(join(DIST, "assets", zoneChunk)),
  textures: assets.filter((f) => f.endsWith(".ktx2") && !/\.lo-/.test(f)).reduce((s, f) => s + statSync(join(DIST, "assets", f)).size, 0),
  transcoder: gz(join(DIST, "basis", "basis_transcoder.js")) + gz(join(DIST, "basis", "basis_transcoder.wasm")),
};
const downloadKB = (download.chunk + download.textures + download.transcoder) / 1024;

const browser = await chromium.launch({ args: GL });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const fetched = [];
page.on("request", (r) => fetched.push(r.url()));
const heroish = (u) => /HeroZone-|\.ktx2|basis_transcoder/.test(u);

const steady = async (n) => {
  await page.evaluate(() => window.__grosherPerf && (window.__grosherPerf.frames = 0));
  await page.waitForFunction((k) => (window.__grosherPerf?.frames ?? 0) >= k, n, { timeout: 120_000 });
  return page.evaluate(() => window.__grosherPerf);
};

const rows = [];
let lazy;
const preload = { prepared: false, openMs: 0 };
try {
  await page.goto(`${BASE}/?perf=1`, { waitUntil: "load" });
  const input = page.getByLabel(/add items/i);
  await input.waitFor({ timeout: 30_000 });
  // an ordinary trip first: the overview must not touch the zone
  await input.fill("Milk, Bananas");
  await input.press("Enter");
  await page.getByRole("button", { name: /route 2 items/i }).click({ timeout: 30_000 });
  await page.getByTestId("map3d").waitFor({ timeout: 60_000 });
  await steady(20);
  lazy = !fetched.some(heroish);
  // now, in a fresh visit, a bulk item: the next stop is in the zone and the close-up opens on its own
  await page.goto(`${BASE}/?perf=1`, { waitUntil: "load" });
  await page.evaluate(() => {
    localStorage.clear();
    indexedDB.deleteDatabase("grosher");
  });
  await page.goto(`${BASE}/?perf=1&tier=hi`, { waitUntil: "load" });
  const again = page.getByLabel(/add items/i);
  await again.fill("toor dal (bulk)");
  await again.press("Enter");
  // the arrival in slow motion (the page's clock 40× slower): every frame's reading, the worst kept
  await page.evaluate(() => {
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
  await page.getByRole("button", { name: /route 1 item/i }).click({ timeout: 30_000 });
  await page.waitForFunction(() => window.__grosherCloseUp?.state === "open" && window.__grosherPerf?.hero?.tier, null, { timeout: 90_000 });
  let worst = null;
  for (let i = 0; i < 30; i++) {
    const r = await page.evaluate(() => ({ ...window.__grosherPerf }));
    if (!worst || r.calls > worst.calls || (r.calls === worst.calls && r.triangles > worst.triangles)) worst = r;
    await page.waitForTimeout(800);
  }
  // (this page's clock was slowed: its frame times mean nothing, so they print as "–")
  rows.push({ view: "arriving (worst frame)", ...worst, patched: true });
  await page.evaluate(() => window.__grosherClockNormal());
  await page.waitForTimeout(2500); // the walk in ends, then settle
  rows.push({ view: "eye level, facing the bin", ...(await steady(30)), patched: true });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "hero-eye.png") });
  // look down the aisle: the widest view of the zone (and the overview beyond it)
  const box = await page.getByTestId("map3d").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.45;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 300, cy, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  rows.push({ view: "down the aisle", ...(await steady(30)), patched: true });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "hero-aisle.png") });
  // a scoop bin on the island's north face: the shopper looks south, out over the rest of the store
  await page.goto(`${BASE}/?perf=1&tier=hi`, { waitUntil: "load" });
  await page.evaluate(() => {
    localStorage.clear();
    indexedDB.deleteDatabase("grosher");
  });
  await page.goto(`${BASE}/?perf=1&tier=hi`, { waitUntil: "load" });
  const third = page.getByLabel(/add items/i);
  await third.fill("bulk granola");
  await third.press("Enter");
  await page.getByRole("button", { name: /route 1 item/i }).click({ timeout: 30_000 });
  await page.waitForFunction(() => window.__grosherCloseUp?.state === "open" && window.__grosherPerf?.hero?.tier, null, { timeout: 90_000 });
  await page.waitForTimeout(3000);
  rows.push({ view: "scoop bins, facing out", ...(await steady(30)) });
  // prepared ahead: a floral stop, then toor dal; during the first leg the zone is prepared in the
  // background (its textures in before any close-up opened), and "Got it" opens it without the pause
  await page.goto(`${BASE}/?perf=1&tier=hi`, { waitUntil: "load" });
  await page.evaluate(() => {
    localStorage.clear();
    indexedDB.deleteDatabase("grosher");
  });
  await page.goto(`${BASE}/?perf=1&tier=hi`, { waitUntil: "load" });
  const fourth = page.getByLabel(/add items/i);
  await fourth.fill("bouquet, toor dal (bulk)");
  await fourth.press("Enter");
  await page.getByRole("button", { name: /route 2 items/i }).click({ timeout: 30_000 });
  await page.getByTestId("map3d").waitFor({ timeout: 60_000 });
  preload.prepared = await page
    .waitForFunction(() => window.__grosherCloseUp === null && !!window.__grosherPerf?.hero?.tier, null, { timeout: 60_000 })
    .then(() => true, () => false);
  await page.waitForTimeout(3000); // the compile and the upload, in the background
  const t0 = Date.now();
  await page.getByRole("button", { name: /got it/i }).click();
  await page.waitForFunction(() => window.__grosherCloseUp?.state === "open", null, { timeout: 90_000 });
  preload.openMs = Date.now() - t0;
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
const dlOver = downloadKB > B.downloadKB;
failed ||= dlOver;
console.log(`\ndownload: ${downloadKB.toFixed(0)} KB (zone chunk ${(download.chunk / 1024).toFixed(0)} KB gzip, textures ${(download.textures / 1024).toFixed(0)} KB, transcoder ${(download.transcoder / 1024).toFixed(0)} KB gzip)${dlOver ? "   OVER BUDGET" : ""}`);
console.log(`lazy: ${lazy ? "nothing of the zone fetched before the close-up" : "FETCHED BEFORE THE CLOSE-UP: " + fetched.filter(heroish).join(", ")}`);
// (SwiftShader: the opening time is software rendering's; on a GPU it is ~0.1 s, see CLAUDE.md)
console.log(`prepared ahead: ${preload.prepared ? `yes, during the previous leg; "Got it" to open ${preload.openMs} ms` : "NO: the next stop's zone was not prepared during the leg before it"}`);
failed ||= !preload.prepared;
console.log(`tier: ${rows[0]?.hero.tier}, zone ${rows[0]?.hero.triangles.toLocaleString("en-US")} triangles, textures in ${rows[0]?.hero.loadMs} ms`);
console.log(`budget: ≤ ${B.drawCalls} draw calls, ≤ ${B.triangles.toLocaleString("en-US")} triangles, ≤ ${B.gpuTextureMB} MB GPU textures, ≤ ${B.downloadKB.toLocaleString("en-US")} KB download`);
if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 5).join("\n  ")}`);
if (failed) {
  console.error("close-up gate FAILED");
  process.exit(1);
}
console.log("close-up gate passed");
