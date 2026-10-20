// Captures the close-up media for the project page and the README from a running production build, on this
// Mac's GPU at full quality (capture-kit.mjs):
//
//   npm run build -w @grosher/web && (cd apps/web && npx vite preview --port 4173 &)
//   node apps/web/scripts/capture-closeup.mjs http://localhost:4173
//
// First it checks the texture tier in ?debug=perf's readout: "hero hi" or it stops. Then:
// - closeup.av1.mp4 + closeup.mp4: the project page's hero and the README's video. "Bananas, Toor dal (bulk),
//   Greek yogurt": the descent into Produce and the stroll to the bananas, a second at eye level; Got it, the
//   way out and the descent into Bulk to the toor dal bin, a moment there. 60 fps at 2× (780 × 1688), every
//   frame drawn on a paused, stepped page clock, so the motion is exactly the app's.
// - stills at 3× as AVIF / WebP / PNG at 1× / 2× / 3×: closeup-bulk (eye level at the lit toor dal bin),
//   closeup-produce (the landing under the skylight, the island's lit crate ahead: frame PRODUCE_F of the
//   arrival, on the stepped clock), closeup-juice (the Grosher Press juice wall).
// - closeup-poster.webp: the Bulk still at 400 px (~27 KB), the video's poster, preloaded for the page's first
//   paint; the page swaps in the 2× still after load for viewers who never play the video.
// - closeup.json: the frame marks, the cuts, the sizes.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { clean, encode, frames, launch, phone, poster, QUALITY, still, until } from "./capture-kit.mjs";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const IMG = join(import.meta.dirname, "..", "public", "project", "img");
const TMP = join(import.meta.dirname, "..", "public", "project", ".closeup-tmp");
const LIST = "Bananas, Toor dal (bulk), Greek yogurt";
const ARRIVAL_F = 160; // the descent and the stroll into Produce, in frames (measured: 152 at 60 fps)
const PRODUCE_F = 68; // the landing: the skylight overhead, the produce wall, the bananas' island ahead

clean(TMP);
const browser = await launch();
const out = { capturedAt: new Date().toISOString().slice(0, 10), list: LIST.split(", "), stills: {}, marks: {} };

/** type a list, wait for every row placed, tap Route */
async function route(page, list, { paused = false } = {}) {
  await until(page, () => !!window.__grosherIndex, { paused });
  await page.evaluate(() => document.fonts.ready);
  const input = page.getByLabel(/add items/i);
  await input.fill(list);
  await input.press("Enter");
  const n = list.split(", ").length;
  await until(page, (n) => new RegExp(`${n} items? · ${n} placed`, "i").test(document.body.innerText), { arg: n, paused });
  // the first stop's close-up is prepared on the list (hero/usePrepareFirst.ts): give it its idle time
  if (paused) await page.clock.runFor(4000);
  else await page.waitForTimeout(4000);
  await page.getByRole("button", { name: new RegExp(`route ${n} items?`, "i") }).click();
}
const closeUp = () => window.__grosherCloseUp;

try {
  // ---------------------------------------------------------------- the tier, read off ?debug=perf
  {
    const { ctx, page } = await phone(browser, { dsf: 1 });
    await page.goto(`${BASE}/?${QUALITY}&debug=perf`, { waitUntil: "load" });
    await route(page, "Toor dal (bulk)");
    await until(page, () => /hero (hi|lo) ·/.test(document.querySelector("[data-testid=debug-perf]")?.textContent ?? ""));
    const line = (await page.getByTestId("debug-perf").textContent()).split("\n").find((l) => l.startsWith("hero")) ?? "";
    console.log(`?debug=perf: ${line}`);
    if (!line.startsWith("hero hi")) throw new Error(`the close-up's texture tier is not hi: "${line}"`);
    out.debugPerf = line;
    await ctx.close();
  }

  // ---------------------------------------------------------------- the video, frame by frame at 60 fps
  {
    const { ctx, page } = await phone(browser, { dsf: 2, paused: true });
    // ?perf=1 publishes the close-up's state (window.__grosherCloseUp); it draws no readout
    await page.goto(`${BASE}/?${QUALITY}&perf=1`, { waitUntil: "load" });
    await route(page, LIST, { paused: true });
    const dir = join(TMP, "frames");
    let f = 0;
    // from Route until the close-up opens (the map appearing), one frame at a time
    while (!(await page.evaluate(() => window.__grosherCloseUp?.state === "open"))) f = await frames(page, dir, 1, f);
    out.marks.open1 = f;
    out.first = await page.evaluate(closeUp);
    f = await frames(page, dir, ARRIVAL_F + 60, f); // the arrival and a second at eye level
    out.marks.gotit = f;
    await page.getByRole("button", { name: /got it/i }).click();
    while (!(await page.evaluate((z) => window.__grosherCloseUp?.state === "open" && window.__grosherCloseUp.zone !== z, out.first.zone))) f = await frames(page, dir, 1, f);
    out.marks.open2 = f;
    out.second = await page.evaluate(closeUp);
    f = await frames(page, dir, ARRIVAL_F + 90, f); // into Bulk, and a moment at the bin
    out.marks.end = f;
    await ctx.close();
    // the clip: from the first close-up's first frame through a second at eye level; Got it to the end
    out.cuts = [
      [out.marks.open1, out.marks.open1 + ARRIVAL_F + 60],
      [out.marks.gotit, out.marks.end],
    ];
    out.video = encode(dir, join(IMG, "closeup"), out.cuts);
    console.log(`first: ${out.first.zone} · ${out.first.item}; second: ${out.second.zone} · ${out.second.item}`);
    console.log(`closeup video: ${out.video.seconds} s at 60 fps, AV1 ${out.video.av1KB} KB, H.264 ${out.video.h264KB} KB`);
  }

  // ---------------------------------------------------------------- the stills, 3×, each its own trip
  for (const [name, list, atFrame] of [
    ["closeup-bulk", "Toor dal (bulk)", null],
    ["closeup-produce", "Bananas", PRODUCE_F],
    ["closeup-juice", "Cold pressed juice", null],
  ]) {
    const paused = atFrame !== null;
    const { ctx, page } = await phone(browser, { dsf: 3, paused });
    await page.goto(`${BASE}/?${QUALITY}&perf=1`, { waitUntil: "load" });
    await route(page, list, { paused });
    await until(page, () => window.__grosherCloseUp?.state === "open" && window.__grosherPerf?.hero?.tier === "hi", { paused, step: 1000 / 60 });
    if (paused) {
      // a moment of the arrival: step to it frame by frame, every frame drawn
      for (let i = 0; i < atFrame; i++) await page.clock.runFor(1000 / 60);
    } else {
      // the arrival over (a 1 s descent, a walk under 5 s), then frames flowing with everything uploaded
      await page.waitForTimeout(6000);
      await page.evaluate(() => (window.__grosherPerf.frames = 0));
      await until(page, () => (window.__grosherPerf?.frames ?? 0) >= 30);
    }
    const png = join(TMP, `${name}.png`);
    await page.screenshot({ path: png });
    const cu = await page.evaluate(closeUp);
    out.stills[name] = { zone: cu.zone, item: cu.item, files: still(png, join(IMG, name)) };
    // 400 px at q60 (~27 KB): on a phone the poster sits below the lede, the first paint, and competes with the
    // fonts for the link; at 480 px / 40 KB Lighthouse's mobile performance read 99 by run (the page swaps in the
    // 2× still after load)
    if (name === "closeup-bulk") out.posterKB = poster(png, join(IMG, "closeup-poster.webp"), 400, 60);
    console.log(`${name}: ${cu.zone} · ${cu.item}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

clean(TMP);
writeFileSync(join(IMG, "..", "closeup.json"), JSON.stringify({ _note: "Written by apps/web/scripts/capture-closeup.mjs (production build, this Mac's GPU, 390×844: video 2× at 60 fps on a stepped page clock, stills 3×). Marks and cuts are frame numbers.", ...out }, null, 2) + "\n");
console.log(`poster ${out.posterKB} KB; stills: ${Object.entries(out.stills).map(([k, v]) => `${k} ${v.files["2x"].avif} KB avif 2×`).join(", ")}`);
