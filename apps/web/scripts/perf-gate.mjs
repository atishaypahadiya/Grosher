// Headless perf gate (DESIGN.md §3): the 3D trip view must stay within
// 70 draw calls and 12,000 product instances. Runs against a server that
// already serves the app (vite preview after a build, or vite dev):
//
//   npm run build -w @grosher/web && npx vite preview --port 4173 &
//   node scripts/perf-gate.mjs http://localhost:4173
//
// Three framings are measured: the default framing of the first leg, 13 m
// down an aisle after two items are collected, and the flattened map at
// its farthest zoom. Any framing over budget fails the process (exit 1).
// Frame time is reported but never gated: headless Chromium renders with
// SwiftShader, which is not a device number; for the same reason the page
// renders at device pixel ratio 1 (calls and instances do not depend on it,
// fill rate on a CI runner does).

import { chromium } from "playwright";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const MAX_CALLS = 70;
const MAX_INSTANCES = 12_000;
const LIST = "Basmati rice 10 lb, Spinach, Pasta, Chips, Milk, Greek yogurt, Bread, Ice cream";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const STEADY_TIMEOUT_MS = 240_000;
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const steady = async (frames) => {
  await page.evaluate(() => {
    if (window.__grosherPerf) window.__grosherPerf.frames = 0;
  });
  try {
    await page.waitForFunction((n) => (window.__grosherPerf?.frames ?? 0) >= n, frames, { timeout: STEADY_TIMEOUT_MS });
  } catch (e) {
    const seen = await page.evaluate(() => window.__grosherPerf);
    throw new Error(`no steady state after ${STEADY_TIMEOUT_MS / 1000} s (wanted ${frames} frames): ${JSON.stringify(seen)}`, { cause: e });
  }
  return page.evaluate(() => window.__grosherPerf);
};

const rows = [];
try {
  await page.goto(`${BASE}/?perf=1`, { waitUntil: "networkidle" });
  const webgl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    return gl ? gl.getParameter(gl.RENDERER) : null;
  });
  if (!webgl) throw new Error("no WebGL in this browser: the gate cannot measure the 3D view");
  const input = page.getByLabel(/add items/i);
  await input.fill(LIST);
  await input.press("Enter");
  await page.getByRole("button", { name: /route 8 items/i }).click({ timeout: 30_000 });
  // the 3D chunk loads lazily; the flat fallback would never mount it
  await page.getByTestId("map3d").waitFor({ timeout: 60_000 }).catch(() => {
    throw new Error("the trip opened with the flat fallback, not the 3D map");
  });
  rows.push({ framing: "default (first leg)", ...(await steady(40)) });
  await page.getByRole("button", { name: /got it/i }).click();
  await page.getByRole("button", { name: /got it/i }).click();
  await page.waitForTimeout(600); // the reframe eases 480 ms
  rows.push({ framing: "down an aisle (2 collected)", ...(await steady(25)) });
  await page.getByRole("button", { name: /flatten the map/i }).click();
  await page.waitForTimeout(600);
  rows.push({ framing: "flattened", ...(await steady(25)) });
} finally {
  await browser.close();
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad("framing", 30)} ${pad("calls", 7)} ${pad("instances", 10)} ${pad("fixtures", 9)} ${pad("distance", 9)} frame ms (SwiftShader)`);
let failed = false;
for (const r of rows) {
  const over = r.calls > MAX_CALLS || r.instances > MAX_INSTANCES;
  failed ||= over;
  console.log(`${pad(r.framing, 30)} ${pad(r.calls, 7)} ${pad(r.instances, 10)} ${pad(r.productFixtures, 9)} ${pad(r.distance + " m", 9)} ${r.frameMs.toFixed(1)}${over ? "   OVER BUDGET" : ""}`);
}
console.log(`\nbudget: ≤ ${MAX_CALLS} draw calls, ≤ ${MAX_INSTANCES.toLocaleString("en-US")} instances`);
if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 5).join("\n  ")}`);
if (failed || errors.length) {
  console.error("perf gate FAILED");
  process.exit(1);
}
console.log("perf gate passed");
