// Contrast gate (DESIGN.md §2 "Ink"): measures every element against the pixels actually behind it on a
// served build and fails (exit 1) under the targets. Run against vite preview after a build:
//
//   npm run build -w @grosher/web && npx vite preview --port 4173 &
//   node scripts/contrast-gate.mjs http://localhost:4173            [--json out.json] [--report]
//
// Screens: list, the trip at three camera states (the start of the route, mid-route, the last leg to the
// checkout) and checkout at 390×844; then the list with an item nothing can place (its unknown row, the
// resolver note) and the Picker, Settings and Lists sheets; the project page at 390 and 1440, full height.
// Targets: text ≥ 4.5:1 (≥ 3:1 at 24 px, or 18.66 px bold); icon glyphs in controls and focus rings ≥ 3:1.
//
// Method. Text: its colour (with its alpha and every ancestor's opacity) against the background sampled
// under its box with all text made transparent; the worse of the 10th and 90th percentile background
// pixel, so a gradient or a busy scene counts at its worst. Only text that is on top where it is drawn
// (elementFromPoint) and not disabled. Icons: an icon-only control's glyph colour against the pixels
// behind the glyph with the glyph hidden. Focus: each focusable control is shot unfocused, then focused
// from the keyboard; the ring's pixels (within 6 px of the control, changed by the focus) are split into
// the darker and the lighter tone (split halfway between the extremes), and the better tone's median ratio against the unfocused pixels must
// reach 3:1: the two-tone ring is built so that one tone always contrasts with the ground it sits on.
// Pixels are decoded on a canvas in a blank page, so the gate needs nothing beyond Playwright.
// The 3D trip map's labels (.m-overlay: the next-stop card, the checkout callout, stop cards, edge chips,
// numbered dots) sit on solid plates, so they are gated like everything else: the pixels behind their text
// are the plate's, whatever the scene does.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { driveSurvey, prepare } from "./survey-driver.mjs";
import { writeFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const JSON_OUT = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const TEXT = 4.5;
const LARGE = 3;
const UI = 3;
const LIST = "Greek yogurt, Paper towels, Bananas, Toor dal, Frozen pizza, Coffee, Dog food, Tylenol, Chips, Bread, Ice cream, Shampoo, Spinach, Pasta";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const decoder = await browser.newPage();

/** Pixel statistics for boxes of a PNG screenshot, computed on a canvas in a blank page. */
async function pixels(png, jobs) {
  return decoder.evaluate(
    async ({ b64, jobs }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      return jobs.map(([x0, y0, x1, y1]) => {
        const X0 = Math.max(0, Math.floor(x0));
        const Y0 = Math.max(0, Math.floor(y0));
        const W = Math.min(img.width, Math.ceil(x1)) - X0;
        const H = Math.min(img.height, Math.ceil(y1)) - Y0;
        if (W <= 0 || H <= 0) return null;
        const d = g.getImageData(X0, Y0, W, H).data;
        const out = [];
        for (let i = 0; i < d.length; i += 4) out.push(d[i], d[i + 1], d[i + 2]);
        return { w: W, h: H, px: out };
      });
    },
    { b64: png.toString("base64"), jobs },
  );
}

const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const triples = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
};
const over = (fg, a, bg) => fg.map((c, k) => c * a + bg[k] * (1 - a));
const worstAgainst = (fg, a, bgPx) => {
  const s = [...bgPx].sort((p, q) => lum(p) - lum(q));
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return Math.min(ratio(over(fg, a, at(0.1)), at(0.1)), ratio(over(fg, a, at(0.9)), at(0.9)));
};
const median = (xs) => {
  const s = [...xs].sort((p, q) => p - q);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

const HIDE_TEXT = "*,*::before,*::after{color:transparent!important;text-shadow:none!important;caret-color:transparent!important;-webkit-text-fill-color:transparent!important}*::placeholder{color:transparent!important}svg text{fill:transparent!important}";
const HIDE_ICONS = "button svg,a svg,.pill svg{visibility:hidden!important}";
const withStyle = async (page, css, fn) => {
  await page.evaluate((css) => {
    const s = document.createElement("style");
    s.id = "__contrast";
    s.textContent = css;
    document.head.append(s);
  }, css);
  await page.waitForTimeout(150);
  try {
    return await fn();
  } finally {
    await page.evaluate(() => document.getElementById("__contrast")?.remove());
    await page.waitForTimeout(100);
  }
};

/** Everything on screen that the gate measures: text runs, icon-only control glyphs, focusable controls. */
const collect = () => {
  const seen = new Set();
  const visible = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  const onTop = (el, r) => {
    const x = Math.min(innerWidth - 1, Math.max(0, (r.left + r.right) / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, (r.top + r.bottom) / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && (el.contains(hit) || hit.contains(el));
  };
  const alphaOf = (el) => {
    let a = 1;
    for (let e = el; e; e = e.parentElement) a *= +getComputedStyle(e).opacity;
    return a;
  };
  const rgba = (s) => {
    const m = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
    return { rgb: m.slice(0, 3), a: m[3] ?? 1 };
  };
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 48);
  const where = (el) => (el.closest(".m-overlay") ? "map" : "ui");
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode()); ) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || !visible(el) || el.closest("[disabled],[aria-disabled=true],.sr-only,script,style,noscript")) continue;
    seen.add(el);
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    // the map overlay ignores the pointer, so elementFromPoint looks through it: it is on top by construction
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth || (!el.closest(".m-overlay") && !onTop(el, r))) continue;
    const cs = getComputedStyle(el);
    const isSvg = el instanceof SVGElement;
    const c = rgba(isSvg ? cs.fill : cs.color);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
    texts.push({ kind: "text", where: where(el), text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), cls: String(el.className?.baseVal ?? el.className).split(" ")[0], fg: c.rgb, a: c.a * alphaOf(el), size, need: large ? 3 : 4.5, box: [r.left, r.top, r.right, r.bottom] });
  }
  const controls = [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((el) => !el.disabled && visible(el) && !el.closest("[inert],.m-overlay"));
  const icons = [];
  for (const el of controls) {
    if ((el.textContent || "").trim()) continue;
    const svg = el.querySelector("svg");
    if (!svg) continue;
    const r = svg.getBoundingClientRect();
    if (r.width < 4 || r.bottom <= 0 || r.top >= innerHeight || !onTop(el, el.getBoundingClientRect())) continue;
    const cs = getComputedStyle(svg);
    const c = rgba(cs.color);
    icons.push({ kind: "icon", where: "ui", text: label(el), cls: String(el.className).split(" ")[0], fg: c.rgb, a: c.a * alphaOf(svg), need: 3, box: [r.left, r.top, r.right, r.bottom] });
  }
  const focus = controls
    .map((el, i) => {
      el.dataset.contrastId = String(i);
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && onTop(el, r) ? { kind: "focus", where: "ui", id: String(i), text: label(el), cls: String(el.className).split(" ")[0], need: 3, box: [r.left, r.top, r.right, r.bottom] } : null;
    })
    .filter(Boolean);
  return { texts, icons, focus };
};

async function measure(page, name) {
  // no transitions while measuring: a focus ring that eases in would be shot half drawn
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation-play-state:paused!important}" });
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.waitForTimeout(200);
  const { texts, icons, focus } = await page.evaluate(collect);
  const dpr = await page.evaluate(() => devicePixelRatio);
  const scale = (b, pad = 0) => b.map((v, k) => (v + (k < 2 ? -pad : pad)) * dpr);
  const rows = [];
  // text
  const bgShot = await withStyle(page, HIDE_TEXT, () => page.screenshot());
  const bgs = await pixels(bgShot, texts.map((t) => scale(t.box)));
  texts.forEach((t, i) => bgs[i] && rows.push({ ...t, screen: name, ratio: worstAgainst(t.fg, t.a, triples(bgs[i].px)) }));
  // icon glyphs
  if (icons.length) {
    const iconBg = await withStyle(page, HIDE_TEXT + HIDE_ICONS, () => page.screenshot());
    const ibs = await pixels(iconBg, icons.map((t) => scale(t.box)));
    icons.forEach((t, i) => ibs[i] && rows.push({ ...t, screen: name, ratio: worstAgainst(t.fg, t.a, triples(ibs[i].px)) }));
  }
  // focus rings
  const before = await page.screenshot();
  for (const f of focus) {
    await page.keyboard.press("Shift"); // a keyboard interaction, so programmatic focus is :focus-visible
    const ok = await page.evaluate((id) => {
      const el = document.querySelector(`[data-contrast-id="${id}"]`);
      el?.focus({ preventScroll: true });
      return !!el && el.matches(":focus-visible");
    }, f.id);
    if (!ok) continue;
    await page.waitForTimeout(60);
    const after = await page.screenshot();
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    const box = scale(f.box, 6);
    const [a, b] = await pixels(before, [box]).then(async ([p]) => [p, (await pixels(after, [box]))[0]]);
    if (!a || !b) continue;
    const A = triples(a.px);
    const B = triples(b.px);
    const changed = [];
    for (let i = 0; i < A.length; i++) if (Math.abs(A[i][0] - B[i][0]) + Math.abs(A[i][1] - B[i][1]) + Math.abs(A[i][2] - B[i][2]) > 60) changed.push(i);
    if (changed.length < 8) {
      rows.push({ ...f, screen: name, ratio: 1, note: "no visible focus ring" });
      continue;
    }
    // two tones: split halfway between the darkest and the lightest changed pixel (a median split fails
    // when one tone has most of the pixels, as the longer outer ring does)
    const ls = changed.map((i) => lum(B[i]));
    const L = (Math.min(...ls) + Math.max(...ls)) / 2;
    const dark = changed.filter((i) => lum(B[i]) <= L);
    const light = changed.filter((i) => lum(B[i]) > L);
    const tone = (ids) => median(ids.map((i) => ratio(B[i], A[i])));
    rows.push({ ...f, screen: name, ratio: Math.max(tone(dark), tone(light)), dark: +tone(dark).toFixed(2), light: +tone(light).toFixed(2) });
  }
  return rows;
}

/**
 * The list's layout at this scroll: no two visible text runs overlap, no list text shows through the
 * footer's solid plate (rows tinted magenta, the plate below its fade sampled), and, scrolled to the end,
 * the last row clears the footer. Failures go into `layout`.
 */
const layout = [];
async function layoutChecks(page, name) {
  const geo = await page.evaluate(() => {
    const runs = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) || el.closest(".sr-only")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight) continue;
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        // the block the run is set in: lines of one heading or paragraph may touch (tight display leading)
        let block = el;
        while (block.parentElement && getComputedStyle(block).display.startsWith("inline")) block = block.parentElement;
        if (hit && (el.contains(hit) || hit.contains(el))) runs.push({ text: n.textContent.trim().slice(0, 30), box: [r.left, r.top, r.right, r.bottom], block });
      }
    }
    const overlaps = [];
    for (let i = 0; i < runs.length; i++)
      for (let j = i + 1; j < runs.length; j++) {
        if (runs[i].block === runs[j].block) continue;
        const [a, b] = [runs[i].box, runs[j].box];
        const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
        const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
        if (w > 2 && h > 2) overlaps.push(`"${runs[i].text}" × "${runs[j].text}"`);
      }
    const footer = document.querySelector(".cta-wrap")?.getBoundingClientRect();
    const rows = [...document.querySelectorAll(".list-sheet li")];
    const last = rows.at(-1)?.getBoundingClientRect();
    const atEnd = Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1;
    return { overlaps, footer: footer && [footer.left, footer.top, footer.right, footer.bottom], lastBottom: last?.bottom ?? null, atEnd, rows: rows.length };
  });
  for (const o of geo.overlaps) layout.push(`${name}: text overlaps ${o}`);
  if (geo.atEnd && geo.lastBottom !== null && geo.footer && geo.lastBottom > geo.footer[1] + 0.5) layout.push(`${name}: the last row ends ${Math.round(geo.lastBottom - geo.footer[1])}px under the footer`);
  // bleed: list text in magenta, the footer below its 28px fade must hold none of it
  if (geo.footer) {
    const shot = await withStyle(page, ".list-sheet, .list-sheet *{color:#ff00ff!important;-webkit-text-fill-color:#ff00ff!important}", () => page.screenshot());
    const dpr = await page.evaluate(() => devicePixelRatio);
    const box = [geo.footer[0], geo.footer[1] + 28, geo.footer[2], geo.footer[3]].map((v) => v * dpr);
    const [p] = await pixels(shot, [box]);
    const px = p ? triples(p.px) : [];
    const magenta = px.filter(([r, g, b]) => r > 150 && b > 150 && g < 110).length;
    if (magenta > 8) layout.push(`${name}: ${magenta} pixels of list text show through the footer plate`);
  }
  console.log(`layout ${name.padEnd(18)} ${geo.rows} rows · ${geo.overlaps.length} overlaps${geo.atEnd ? ` · last row ${geo.lastBottom !== null && geo.footer ? Math.round(geo.footer[1] - geo.lastBottom) : "?"}px clear of the footer` : ""}`);
}

const all = [];
const errors = [];
try {
  // ---- the app: list, trip, checkout at 390×844
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/?perf=1`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__grosherIndex, null, { timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  const input = page.getByLabel(/add items/i);
  await input.fill(LIST);
  await input.press("Enter");
  await page.getByText(/14 items · 14 placed/i).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(400);
  all.push(...(await measure(page, "list")));
  // the 14-item list's layout, at the top and scrolled to the end
  await layoutChecks(page, "list 14 top");
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  await layoutChecks(page, "list 14 end");
  all.push(...(await measure(page, "list 14 end")));
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole("button", { name: /route 14 items/i }).click();
  await page.getByTestId("map3d").waitFor({ timeout: 120_000 });
  const settle = async () => {
    await page.evaluate(() => window.__grosherPerf && (window.__grosherPerf.frames = 0));
    await page.waitForFunction(() => (window.__grosherPerf?.frames ?? 0) >= 4, null, { timeout: 240_000 });
    await page.waitForTimeout(700);
  };
  const gotIt = async (n) => {
    for (let k = 0; k < n; k++) {
      await page.getByRole("button", { name: /got it/i }).click();
      await page.waitForTimeout(500);
    }
    await settle();
  };
  await settle();
  all.push(...(await measure(page, "trip start")));
  await gotIt(6); // 7 of 14 next
  all.push(...(await measure(page, "trip mid")));
  await gotIt(7); // 14 of 14 next: the last leg, the checkout lane beyond it
  all.push(...(await measure(page, "trip end")));
  await page.getByRole("button", { name: /got it/i }).click();
  await page.getByText(/trip done/i).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(600);
  all.push(...(await measure(page, "checkout")));
  await ctx.close();

  // ---- a hero close-up (src/hero): the header, the back pill and the sheet over the zone's dark interior
  {
    const cctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const cp = await cctx.newPage();
    cp.on("pageerror", (e) => errors.push(e.message));
    await cp.goto(`${BASE}/?perf=1&tier=hi`, { waitUntil: "load" });
    await cp.evaluate(() => document.fonts.ready);
    const ci = cp.getByLabel(/add items/i);
    await ci.fill("toor dal (bulk)");
    await ci.press("Enter");
    await cp.getByRole("button", { name: /route 1 item/i }).click({ timeout: 60_000 });
    await cp.waitForFunction(() => window.__grosherCloseUp?.state === "open" && window.__grosherPerf?.hero?.tier, null, { timeout: 120_000 });
    await cp.waitForTimeout(1500);
    all.push(...(await measure(cp, "trip close-up")));
    await cctx.close();
  }

  // ---- the sheets, and a list with an unknown item (no model answers here, so it stays unknown)
  const sctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const sp = await sctx.newPage();
  sp.on("pageerror", (e) => errors.push(e.message));
  await sp.goto(`${BASE}/`, { waitUntil: "load" });
  await sp.waitForFunction(() => !!window.__grosherIndex, null, { timeout: 120_000 });
  await sp.evaluate(() => document.fonts.ready);
  const add = sp.getByLabel(/add items/i);
  await add.fill("Greek yogurt, Bananas, Qwzx polish");
  await add.press("Enter");
  const where = sp.getByRole("button", { name: /tell me where/i }).first();
  await where.waitFor({ timeout: 90_000 });
  await sp.waitForTimeout(600);
  all.push(...(await measure(sp, "list unknown")));
  const sheet = async (open, name) => {
    await open.click();
    await sp.waitForTimeout(700);
    all.push(...(await measure(sp, name)));
    await sp.getByRole("button", { name: /^close$/i }).first().click();
    await sp.waitForTimeout(500);
  };
  await sheet(where, "picker sheet");
  await sheet(sp.getByRole("button", { name: /^settings$/i }), "settings");
  await sheet(sp.getByRole("button", { name: /^lists$/i }).first(), "lists sheet");
  // the error plate (index.html's boot guard), raised by a render error on purpose
  await sp.goto(`${BASE}/#/__crash`, { waitUntil: "load" });
  await sp.locator(".boot-fail").waitFor({ timeout: 30_000 });
  await sp.evaluate(() => document.fonts.ready);
  all.push(...(await measure(sp, "error plate")));
  await sctx.close();

  // ---- survey mode (the cream screens) at 390×844, walked with a mocked sensor stream (survey-driver.mjs)
  const vctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const vp = await vctx.newPage();
  vp.on("pageerror", (e) => errors.push(e.message));
  await prepare(vp, { signs: [["12", "Cereal", "Breakfast", "Coffee", "Tea"], ["7", "International", "Indian", "Foods", "Atta & Rice"]] });
  await driveSurvey(vp, {
    base: BASE,
    fixtures: fileURLToPath(new URL("../test/fixtures/signs", import.meta.url)),
    goOffline: (off) => vctx.setOffline(off),
    onScreen: async (name) => all.push(...(await measure(vp, `survey ${name}`))),
  });
  await vctx.close();

  // ---- the project page at 390 and 1440, full height, motion reduced (the video and the token rest)
  // (a browser without the software-WebGL flags: with them Chromium cannot capture a page this tall)
  const plain = await chromium.launch();
  for (const w of [390, 1440]) {
    const pc = await plain.newContext({ viewport: { width: w, height: 900 }, reducedMotion: "reduce" });
    const pp = await pc.newPage();
    pp.on("pageerror", (e) => errors.push(e.message));
    await pp.goto(`${BASE}/project/`, { waitUntil: "load" });
    await pp.evaluate(() => document.fonts.ready);
    await pp.setViewportSize({ width: w, height: await pp.evaluate(() => document.documentElement.scrollHeight) });
    await pp.waitForTimeout(500);
    all.push(...(await measure(pp, `project ${w}`)));
    await pc.close();
  }
  await plain.close();
} finally {
  await browser.close();
}

const gated = all;
const fails = gated.filter((r) => r.ratio < r.need);
const fmt = (r) => `${r.ratio.toFixed(2)} (need ${r.need}) ${r.where === "map" ? "map " : ""}${r.kind} "${r.text}" .${r.cls}${r.note ? ` · ${r.note}` : ""}${r.dark !== undefined ? ` · tones ${r.dark} / ${r.light}` : ""}`;
for (const screen of [...new Set(all.map((r) => r.screen))]) {
  const rows = gated.filter((r) => r.screen === screen && r.where === "ui");
  const low = (kind) => {
    const k = rows.filter((r) => r.kind === kind);
    return k.length ? `${kind} ${k.length}, lowest ${Math.min(...k.map((r) => r.ratio)).toFixed(2)}` : `${kind} 0`;
  };
  const map = all.filter((r) => r.screen === screen && r.where === "map");
  console.log(`${screen.padEnd(13)} ${low("text")} · ${low("icon")} · ${low("focus")}${map.length ? ` · map labels ${map.length}, lowest ${Math.min(...map.map((r) => r.ratio)).toFixed(2)}` : ""}`);
  if (process.argv.includes("--report")) for (const r of [...rows, ...map].sort((a, b) => a.ratio / a.need - b.ratio / b.need).slice(0, 6)) console.log(`    ${fmt(r)}`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(all, null, 1));
if (errors.length) console.log(`page errors: ${errors.join(" | ")}`);
if (layout.length) {
  console.log(`\nFAIL: layout`);
  for (const l of layout) console.log(`  ${l}`);
  process.exit(1);
}
if (fails.length) {
  console.log(`\nFAIL: ${fails.length} below target`);
  for (const r of fails) console.log(`  ${r.screen}: ${fmt(r)}`);
  process.exit(1);
}
console.log(`\nOK: ${gated.length} elements at or above target (text ${TEXT}:1, large text ${LARGE}:1, icons and focus ${UI}:1)`);
