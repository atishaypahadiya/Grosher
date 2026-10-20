// The off-list guard's demo walk (?demo=walk, src/lib/demoWalk.ts) end to end, in CI: "Friday night in"
// loads and routes itself, the scripted walk plays (here 12× faster, no close-ups), and the guard must fire
// exactly once, on the deliberate detour, wandering; stay quiet through the long waits at the food hall's
// counters; the checkout must show the honest line; the "demo walk" badge must show while it plays.
//
//   node scripts/guard-demo.mjs http://localhost:4173 [--shots dir]

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const shotsAt = process.argv.indexOf("--shots");
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const fails = [];
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block" })).newPage();
  page.setDefaultTimeout(300_000);
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?demo=walk&speed=12&closeup=0`, { waitUntil: "load" });
  await page.getByTestId("demo-walk").waitFor();
  await page.getByTestId("guard-card").waitFor();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "guard-card.png") });
  const line = await page.getByTestId("detours").textContent();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "guard-checkout.png") });
  const ev = await page.evaluate(() => window.__grosherGuardDemo ?? []);
  const shown = ev.filter((e) => e.event === "guard" || e.event === "help");
  const detourLeg = ev.find((e) => e.event === "detour")?.leg;
  const counterLegs = [...new Set(ev.filter((e) => e.kind === "foodhall" || e.kind === "counter").map((e) => e.leg))];
  console.log(ev.filter((e) => e.event !== "arrive").map((e) => `  ${String(e.t).padStart(4)} s  leg ${e.leg}  ${e.kind.padEnd(8)} ${String(e.item).padEnd(16)} ${e.event}${e.reason ? ` (${e.reason})` : ""}`).join("\n"));
  if (shown.length !== 1) fails.push(`the guard showed ${shown.length} times (want once)`);
  if (!shown.every((e) => e.event === "guard" && e.leg === detourLeg && e.reason === "wandering")) fails.push("the guard fired somewhere other than the detour");
  if (!counterLegs.length) fails.push("no counter or food hall leg in the walk");
  if (shown.some((e) => counterLegs.includes(e.leg))) fails.push("the guard spoke during a counter wait");
  if (!/^1 detour/.test(line ?? "")) fails.push(`checkout line: ${line}`);
  console.log(`checkout: ${line}`);
  console.log(`counter legs, quiet: ${counterLegs.join(", ")}`);
} finally {
  await browser.close();
}
if (errors.length) fails.push(`page errors: ${errors.slice(0, 3).join(" | ")}`);
if (fails.length) {
  console.error(`guard demo FAILED:\n  ${fails.join("\n  ")}`);
  process.exit(1);
}
console.log("guard demo passed");
