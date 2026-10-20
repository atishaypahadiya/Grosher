// The close-up gate (CI): opens close-ups on the production build and holds them to the close-up budget
// (src/hero/budget.ts), separate from the overview's perf gate: Grosher's two hero zones, Bulk & pulses and
// Produce (its arrival, an island stop, the wet wall, a look down the zone and along the wall), and the worst
// standard close-up (the most triangles of all, test/standard-zone.test.ts: A4-R16, the mole, enchilada and
// hot sauces, jars and bottles on both faces of a 35 m aisle).
//
//   node scripts/hero-gate.mjs http://localhost:4173 [--shots dir]
//
//   lazy        nothing of a close-up (its chunks, its textures, the transcoder) is fetched by the list screen
//               before the list has an item, nor by a trip whose close-ups never open (?closeup=0)
//   draw calls  per frame, every pass: the worst frame of the arrival (high up, the overview still drawn under
//               the zone), at eye level, looking along the aisle; Bulk's scoop bins out over the store
//   triangles   the same
//   GPU MB      the close-up textures resident on the GPU, as transcoded on this device, every mip level (hi
//               tier): the open zone's and any other zone's still or already uploaded (src/hero/stats.ts)
//   combined    a walk standard → Produce → Bulk → standard, the next zone prepared during each stop: one zone on
//               the GPU at a time (the one before is freed when it is left, the next uploads only after), and
//               the page's peak over the whole walk within the same budget
//   download    what a close-up fetches that the overview did not: its chunks (gzip), its hi-tier KTX2 files and
//               the transcoder (gzip), by the requests the page made, sized from dist/
//   prepared    the next stop's zone prepared during the stop before (at Got it: built, transcoded, compiled,
//               still off the GPU), then ready within 400 ms or two rendered frames of being asked for (it
//               uploads in the hold), at every step of that walk; and the first stop's on the list screen
//               (Bulk, Produce, the standard A4-R16)
//
// Frame times are headless software rendering (SwiftShader): printed, never judged. Check a phone with
// ?debug=perf.

import { chromium } from "playwright";
import { gzipSync } from "node:zlib";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLOSE_UP_BUDGET as B } from "../src/hero/budget.ts";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const shotsAt = process.argv.indexOf("--shots");
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
// --json <path>: what it measured as data, for scripts/docs-numbers.mjs (the README and the project page cite it)
const JSON_OUT = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
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
const preload = { prepared: false, onList: false, std: false, produce: false };
/** each Got it on the combined walk: from, to, asked for → ready, and whether the next zone was prepared */
const transitions = [];
/** the walk's residency at each stop (with the next stop's zone prepared) and its peak */
const combined = { stops: [], peakMB: 0 };
/** the next zone's state as Got it is tapped on the stop before */
const ahead = [];
const residentMB = () => page.evaluate(() => {
  const h = window.__grosherPerf.hero;
  return { mb: (h.gpuBytes + h.envBytes) / 2 ** 20, peakMB: h.peakBytes / 2 ** 20, textures: h.textures, zone: window.__grosherCloseUp?.zone ?? null };
});
const downloads = {};
/** request → ready of a stop's close-up, from the map's log: milliseconds, and frames rendered in between */
const readyIn = (zone) =>
  page.evaluate((z) => {
    const log = (window.__grosherCloseUpLog ?? []).filter((e) => e.zone === z);
    const req = log.find((e) => e.event === "request" || e.event === "request+ready");
    const ready = log.find((e) => e.event === "ready" || e.event === "request+ready");
    return req && ready ? { ms: Math.round(ready.t - req.t), frames: ready.frame != null && req.frame != null ? ready.frame - req.frame : null } : null;
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
  const arrival = async (label, shot, along = "along the aisle", dx = 300) => {
    await page.waitForFunction(() => window.__grosherCloseUp?.state === "open" && window.__grosherPerf?.hero?.tier, null, { timeout: 90_000 });
    let worst = null;
    // 2.5 s of arrival at 1/40 speed: 100 s; read every 1.5 s
    for (let i = 0; i < 40; i++) {
      const r = await page.evaluate(() => ({ ...window.__grosherPerf }));
      // only frames that drew the close-up: the readout is a frame late, and on a slow runner the overview's
      // last frame before the switch (its products and fixtures, the overview gate's to judge) landed here
      const drewZone = Object.keys(r.breakdown ?? {}).some((k) => k.startsWith("hero-"));
      if (drewZone && (!worst || r.calls > worst.calls || (r.calls === worst.calls && r.triangles > worst.triangles))) worst = r;
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
    await page.mouse.move(cx + dx, cy, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    rows.push({ view: `${label}: ${along}`, ...(await steady(30)), patched: true });
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
  // Produce, the daylit room: an island stop (prepared on the list), its arrival, eye level and a look down the
  // zone; then the wet wall, facing the chiller, and a look along it
  await fresh("?perf=1&tier=hi");
  fetched.length = 0;
  const pr = page.getByLabel(/add items/i);
  await pr.fill("honeycrisp apples");
  await pr.press("Enter");
  preload.produce = await page
    .waitForFunction(() => window.__grosherPrepared === "grosher:produce", null, { timeout: 60_000 })
    .then(() => true, () => false);
  await slowClock();
  await page.getByRole("button", { name: /route 1 item/i }).click({ timeout: 30_000 });
  await arrival("Produce island", "produce-island", "down the zone", -300);
  downloads.Produce = downloadOf(fetched, baseline);
  await fresh("?perf=1&tier=hi");
  const wet = page.getByLabel(/add items/i);
  await wet.fill("cold pressed juice");
  await wet.press("Enter");
  await page.getByRole("button", { name: /route 1 item/i }).click({ timeout: 30_000 });
  await page.waitForFunction(() => window.__grosherCloseUp?.state === "open" && window.__grosherPerf?.hero?.tier, null, { timeout: 90_000 });
  await page.waitForTimeout(3000);
  rows.push({ view: "Produce: the wet wall", ...(await steady(30)) });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "produce-wall-eye.png") });
  {
    const box = await page.getByTestId("map3d").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 320, box.y + box.height * 0.45, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    rows.push({ view: "Produce: along the wet wall", ...(await steady(30)) });
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "produce-wall-along.png") });
  }
  // prepared ahead, and one zone on the GPU at a time: floral (a standard close-up), honeycrisp apples (Produce),
  // toor dal (Bulk), milk (standard). During each stop the next one's zone is prepared in the background; after
  // "Got it" (the way out, the next leg shown on the map) it opens without a pause
  await fresh("?perf=1&tier=hi");
  const fourth = page.getByLabel(/add items/i);
  await fourth.fill("bouquet, honeycrisp apples, toor dal (bulk), milk");
  await fourth.press("Enter");
  await page.getByRole("button", { name: /route 4 items/i }).click({ timeout: 30_000 });
  await page.getByTestId("map3d").waitFor({ timeout: 60_000 });
  for (let step = 0; step < 3; step++) {
    await page.waitForFunction(() => window.__grosherCloseUp?.state === "open", null, { timeout: 90_000 });
    await page.waitForTimeout(6000); // the arrival, then the next zone's preparation in the background
    combined.stops.push(await residentMB());
    const cur = await page.evaluate(() => window.__grosherCloseUp.zone);
    // tapping Got it: the next stop's zone already prepared during this one (built, transcoded, compiled) and
    // still off the GPU (it uploads in the hold, once this one is freed)
    ahead.push(await page.evaluate((c) => {
      const zones = window.__grosherPerf.hero.zones ?? {};
      const next = Object.keys(zones).find((id) => id !== c);
      return { zone: next ?? null, state: (next && zones[next]) ?? "absent" };
    }, cur));
    await page.getByRole("button", { name: /got it/i }).click();
    await page.waitForFunction((c) => window.__grosherCloseUp?.zone && window.__grosherCloseUp.zone !== c && window.__grosherCloseUp.state === "open", cur, { timeout: 90_000 });
    const z = await page.evaluate(() => window.__grosherCloseUp.zone);
    transitions.push({ from: cur, to: z, ready: await readyIn(z), prepared: ahead.at(-1).zone === z && ahead.at(-1).state === "prepared" });
  }
  await page.waitForTimeout(6000);
  combined.stops.push(await residentMB());
  combined.peakMB = combined.stops.at(-1).peakMB;
  // prepared: when Got it is tapped the next zone is built, transcoded and compiled, and off the GPU; then ready
  // within a frame or two of being asked for. (On a software renderer the upload in the hold takes seconds and
  // stretches the hold, which hides an unprepared zone's load too: hence the state check. And an overdue frame
  // of the overview, 100–350 ms there, can land between the request and its commit: hence frames as well as ms.)
  const quick = (r) => r !== null && (r.ms < 400 || (r.frames !== null && r.frames <= 2));
  preload.prepared = transitions.length === 3 && transitions.every((t) => t.prepared && quick(t.ready)) && transitions.some((t) => t.to === "bulk") && transitions.some((t) => t.to === "produce");
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
  // over: what drew it, the biggest first
  if (over && r.breakdown) console.log(`    ${Object.entries(r.breakdown).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, v]) => `${k} ${v.toLocaleString("en-US")}`).join(" · ")}`);
}
console.log("");
for (const [zone, d] of Object.entries(downloads)) {
  const dlOver = d.kb > B.downloadKB;
  failed ||= dlOver;
  console.log(`download, ${zone}: ${d.kb.toFixed(0)} KB (chunks ${(d.chunks / 1024).toFixed(0)} KB gzip, textures ${(d.textures / 1024).toFixed(0)} KB, transcoder ${(d.transcoder / 1024).toFixed(0)} KB gzip)${dlOver ? "   OVER BUDGET" : ""}`);
}
const combinedOver = combined.peakMB > B.gpuTextureMB || combined.stops.some((r) => r.mb > B.gpuTextureMB);
failed ||= combinedOver || combined.stops.length < 4;
console.log(`combined, standard → Produce → Bulk → standard: ${combined.stops.map((r) => `${r.zone} ${r.mb.toFixed(1)} MB (${r.textures} textures)`).join(" · ")}; peak ${combined.peakMB.toFixed(1)} MB${combinedOver ? "   OVER BUDGET" : ""}`);
console.log(`lazy: ${lazy ? "nothing of a close-up fetched by an empty list or a trip without close-ups" : "FETCHED WITHOUT A CLOSE-UP"}`);
const fmt = (r) => (r ? `${r.ms} ms, ${r.frames ?? "?"} frames` : "never");
const steps = transitions.map((t) => `${t.from} → ${t.to} (${t.prepared ? "prepared" : "NOT prepared"}, ready ${fmt(t.ready)})`).join("; ");
console.log(`prepared ahead: ${preload.prepared ? "yes, during the stop before" : "NO: the next stop's zone was not ready"}: ${steps}`);
failed ||= !preload.prepared;
console.log(`prepared on the list: ${preload.onList && preload.std && preload.produce ? "yes, before Route (Bulk, Produce, and the standard A4-R16)" : `NO: the first stop's close-up was not prepared on the list screen (Bulk ${preload.onList}, Produce ${preload.produce}, standard ${preload.std})`}`);
failed ||= !preload.onList || !preload.std || !preload.produce;
console.log(`tier: ${rows[0]?.hero.tier}`);
if (JSON_OUT)
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        gate: "closeup",
        tier: rows[0]?.hero.tier ?? null,
        rows: rows.map((r) => ({ view: r.view, calls: r.calls, triangles: r.triangles, mb: Number(((r.hero.gpuBytes + (r.hero.envBytes ?? 0)) / 2 ** 20).toFixed(1)) })),
        downloadKB: Object.fromEntries(Object.entries(downloads).map(([zone, d]) => [zone, Math.round(d.kb)])),
        combined: { stops: combined.stops.map((r) => ({ zone: r.zone, mb: Number(r.mb.toFixed(1)) })), peakMB: Number(combined.peakMB.toFixed(1)) },
        transitions: transitions.map((t) => ({ from: t.from, to: t.to, prepared: t.prepared, ms: t.ready?.ms ?? null, frames: t.ready?.frames ?? null })),
      },
      null,
      2,
    ) + "\n",
  );
console.log(`budget: ≤ ${B.drawCalls} draw calls, ≤ ${B.triangles.toLocaleString("en-US")} triangles, ≤ ${B.gpuTextureMB} MB GPU textures, ≤ ${B.downloadKB.toLocaleString("en-US")} KB download`);
if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 5).join("\n  ")}`);
if (failed) {
  console.error("close-up gate FAILED");
  process.exit(1);
}
console.log("close-up gate passed");
