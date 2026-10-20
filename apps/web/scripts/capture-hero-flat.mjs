// The flat shelf images: what a phone without the 3D close-up shows instead (no WebGL, the zone's chunk or
// textures failing). One per category of each hero zone, rendered from the close-up itself with the stop's
// bin lit lime, the app's UI hidden:
//
//   npm run build -w @grosher/web && (cd apps/web && npx vite preview --port 4173 &)
//   node apps/web/scripts/capture-hero-flat.mjs http://localhost:4173
//
// Writes public/hero/<zone>/<category>.webp (committed). Needs cwebp. `--zone bulk|produce` does one zone.

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
// one item per category: the bin, crates or bay the image lights
const ZONES = {
  bulk: {
    "bulk-pulses": "toor dal (bulk)",
    "bulk-rice-grains": "bulk basmati rice",
    "bulk-flours": "bulk atta",
    "bulk-nuts-seeds": "bulk cashews",
    "bulk-dried-fruit": "bulk dates",
    "bulk-snacks": "bulk granola",
  },
  produce: {
    "apples-pears": "honeycrisp apples",
    citrus: "lemons",
    berries: "strawberries",
    "grapes-melons": "cantaloupe",
    "tropical-fruit": "mango",
    bananas: "bananas",
    "tomatoes-peppers": "tomatoes",
    "onions-garlic": "onions",
    "potatoes-roots": "potatoes",
    "cooking-vegetables": "zucchini",
    "salad-greens": "romaine lettuce",
    "fresh-herbs": "cilantro",
    "mushrooms-sprouts": "mushrooms",
    "cut-vegetables": "stir fry mix",
    "cut-fruit-juice": "cut fruit",
  },
};
const only = process.argv.indexOf("--zone");
const zones = only > 0 ? [process.argv[only + 1]] : Object.keys(ZONES);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
for (const zone of zones) {
const OUT = join(import.meta.dirname, "..", "public", "hero", zone);
const TMP = join(OUT, ".tmp");
mkdirSync(TMP, { recursive: true });
for (const [category, item] of Object.entries(ZONES[zone])) {
  const page = await (await browser.newContext({ viewport: { width: 760, height: 900 }, deviceScaleFactor: 1, serviceWorkers: "block" })).newPage();
  await page.goto(`${BASE}/?perf=1&tier=hi`);
  await page.addStyleTag({ content: ":root { --column: 100vw !important; }" });
  const input = page.getByLabel(/add items/i);
  await input.fill(item);
  await input.press("Enter");
  await page.getByRole("button", { name: /route 1 item/i }).click({ timeout: 30_000 });
  await page.waitForFunction(() => window.__grosherCloseUp?.state === "open" && window.__grosherPerf?.hero?.tier, null, { timeout: 90_000 });
  await page.waitForTimeout(1500);
  const bin = await page.evaluate(() => window.__grosherCloseUp.bin);
  // the image is the shelf alone: no header, strip, sheet or back pill; the bin sits in the middle band
  // visibility, not display: the sheet keeps its size, so the camera keeps the bin where the app puts it
  await page.addStyleTag({ content: ".trip-head, .progress-strip, .trip-sheet, .closeup-back, .trip-vignette { visibility: hidden !important; }" });
  await page.waitForTimeout(300);
  const png = join(TMP, `${category}.png`);
  await page.getByTestId("map3d").screenshot({ path: png });
  execFileSync("cwebp", ["-quiet", "-q", "72", "-m", "6", png, "-o", join(OUT, `${category}.webp`)]);
  console.log(`${zone} ${category}: ${bin}`);
  await page.context().close();
}
rmSync(TMP, { recursive: true, force: true });
}
await browser.close();
