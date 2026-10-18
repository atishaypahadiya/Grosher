// Boot resilience: a device with old state and a stale service-worker cache gets a working app after a
// deploy, and nothing it stores can leave it on a blank screen.
//
//   node scripts/boot-resilience.mjs [--shots dir]
//
// Builds the app three times into a temp folder (vite build, ~5 s each): "legacy" (the generateSW worker
// devices installed until 18 Oct 2026: navigations answered cache-first from the precache, and a shell
// without the boot guard), "old" and
// "new" (this worker, different build ids, so different chunk hashes). A local server plays Cloudflare
// Pages, which answers any missing file with index.html (200, text/html), and swaps builds to "deploy".
//
//   A  legacy worker + old-format state + an evicted entry chunk → deploy → the app renders, on the new build
//   B  this worker, old build, evicted entry chunk → deploy → the next open renders the new build
//   C  a lazy chunk the server no longer has → one reload onto the new build, which renders
//   D  a chunk that keeps failing → one reload, then the part's fallback (the 3D map → the flat map), no loop
//   E  a render error → the plate; Reset local data downloads the lists, clears, and the app renders
//   F  a first render that never comes → the plate at 8 s
//   G  a saved answer at a location the map no longer has (the live bug: oat milk → DAIRY-8, confirmed on
//      map v2) → the app boots, the stale item nothing names shows "Needs a place", the route covers the rest
//   H  a map change under a trip in progress → the trip resumes without the removed location's stop
//
// Exit code 1 on any failure. CI runs it after the contrast gate.

import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, statSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = resolve(fileURLToPath(import.meta.url), "../..");
const SHOTS = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const TMP = mkdtempSync(join(tmpdir(), "grosher-boot-"));

// ---- three builds
const builds = {};
for (const [name, env] of [
  ["legacy", { GROSHER_LEGACY_SW: "1", VITE_BUILD_ID: "legacy" }],
  ["old", { VITE_BUILD_ID: "old" }],
  ["new", { VITE_BUILD_ID: "new" }],
]) {
  const out = join(TMP, name);
  const t0 = Date.now();
  execFileSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { cwd: WEB, env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "inherit"] });
  builds[name] = out;
  console.log(`built ${name.padEnd(6)} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
const entryOf = (dir) => readFileSync(join(dir, "index.html"), "utf8").match(/<script type="module" crossorigin src="([^"]+)"/)[1];

// ---- a Pages-like host: one origin, the build it serves can change ("deploy")
let root = builds.old;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = join(root, path === "/" ? "index.html" : path);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html"); // Pages' SPA answer, even for /assets/*
  const noCache = /\/(sw\.js|registerSW\.js|index\.html|manifest\.webmanifest)$/.test(file) || file.endsWith("index.html");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": noCache ? "no-cache" : "public, max-age=31536000, immutable" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://localhost:${server.address().port}`;
const deploy = (name) => {
  root = builds[name];
};

const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
};
const shot = async (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("console", (m) => process.env.DEBUG && console.log(`  [page] ${m.text()}`));
  return { ctx, page };
}

/** load, let the worker install and take control, and wait for the app */
async function install(page) {
  await page.goto(`${BASE}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  await page.getByLabel(/add items/i).waitFor({ timeout: 60_000 });
}

/** drop one URL from every cache and the HTTP cache, as iOS does when it evicts part of a site's storage */
const evict = async (page, path) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.clearBrowserCache");
  await cdp.detach();
  return page.evaluate(async (path) => {
    let n = 0;
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      for (const req of await c.keys()) if (new URL(req.url).pathname === path) n += +(await c.delete(req));
    }
    return n;
  }, path);
};

const rendered = (page, timeout = 60_000) =>
  page
    .getByLabel(/add items/i)
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);
/** poll until the page shows the list screen of `build`, through any reloads on the way; the seconds it took */
async function renderedBuild(page, build, timeout = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await page
      .evaluate(() => ({ build: document.documentElement.innerHTML.match(/var BUILD = "([^"]*)"/)?.[1] ?? "none", list: !!document.querySelector('[aria-label*="Add items" i]') }))
      .catch(() => null);
    if (s?.build === build && s.list) return (Date.now() - t0) / 1000;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}
const buildOf = (page) => page.evaluate(() => document.documentElement.innerHTML.match(/var BUILD = "([^"]*)"/)?.[1] ?? null);

// the state a device from before the envelopes can hold: a bare (v0) list with a broken row, the value
// that blanked the live app (notes: 42), a corrupt trip, a bare flag, garbage learning state
async function seedOldState(page) {
  await page.evaluate(async () => {
    localStorage.setItem("grosher.notes", "42");
    localStorage.setItem("grosher.trip", "{not json");
    localStorage.setItem("grosher.flat", "true");
    const db = await new Promise((r) => {
      const q = indexedDB.open("grosher", 1);
      q.onupgradeneeded = () => q.result.createObjectStore("kv");
      q.onsuccess = () => r(q.result);
    });
    const tx = db.transaction("kv", "readwrite");
    const kv = tx.objectStore("kv");
    const now = Date.now();
    kv.put([{ id: "l_old", name: "Draft", items: ["Ghee", "Bananas"], storeId: "demo-supercenter", createdAt: now, updatedAt: now, kind: "draft" }, { id: 7, items: "broken" }], "lists:demo-supercenter");
    kv.put("garbage", "learning:demo-supercenter");
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  });
}

try {
  // ---- A: the legacy worker, stuck the way the iPhone was
  {
    deploy("legacy");
    const { ctx, page } = await fresh();
    await install(page);
    await seedOldState(page);
    const entry = entryOf(builds.legacy);
    const gone = await evict(page, entry);
    deploy("new");
    let navs = 0;
    page.on("framenavigated", (f) => f === page.mainFrame() && navs++);
    await page.goto(`${BASE}/`, { waitUntil: "commit" }).catch(() => {});
    const secs = await renderedBuild(page, "new");
    const ok = secs !== null;
    check("A  legacy worker + old state + evicted entry chunk → deploy → renders the new build", ok, `evicted ${gone}, ${secs?.toFixed(1)} s, navigations ${navs}`);
    if (ok) {
      // the list survived (its good row), the bad values moved to quarantine
      await page.getByText("Bananas").first().waitFor({ timeout: 20_000 }).catch(() => {});
      // the trip is read once the catalog is in
      await page.waitForFunction(() => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k) => k.startsWith("grosher.quarantine.")).length >= 2, null, { timeout: 30_000 }).catch(() => {});
      const s = await page.evaluate(() => ({
        bananas: document.body.innerText.includes("Bananas"),
        quarantined: Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k) => k.startsWith("grosher.quarantine.")).length,
        notes: localStorage.getItem("grosher.notes"),
      }));
      check("A  old state: the list's good rows kept, notes and trip quarantined", s.bananas && s.quarantined >= 2 && s.notes !== "42", JSON.stringify(s));
    }
    await shot(page, "a-after-deploy");
    await ctx.close();
  }

  // ---- B: this worker, an old build, its entry chunk evicted → deploy → next open
  {
    deploy("old");
    const { ctx, page } = await fresh();
    await install(page);
    await evict(page, entryOf(builds.old));
    deploy("new");
    await page.goto(`${BASE}/`, { waitUntil: "commit" });
    const secs = await renderedBuild(page, "new");
    check("B  network-first navigation: the next open after a deploy renders the new build", secs !== null, `${secs?.toFixed(1)} s`);
    await ctx.close();
  }

  // ---- C: a lazy chunk the server no longer has → reload once onto the new build
  {
    deploy("old");
    const { ctx, page } = await fresh();
    await install(page);
    // the trip's 3D chunk of the old build, dropped from the cache; the open page is still the old build
    const lazy = await page.evaluate(async () => {
      const keys = [];
      for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) keys.push(new URL(r.url).pathname);
      return keys.filter((p) => /^\/assets\/TripMap3D-.*\.js$/.test(p));
    });
    for (const p of lazy) await evict(page, p);
    deploy("new");
    let navs = 0;
    page.on("framenavigated", (f) => f === page.mainFrame() && navs++);
    await page.getByLabel(/add items/i).fill("Milk, Bananas");
    await page.getByLabel(/add items/i).press("Enter");
    await page.getByRole("button", { name: /route 2 items/i }).click({ timeout: 30_000 });
    const secs = await renderedBuild(page, "new");
    await page.waitForTimeout(2000);
    check("C  a missing lazy chunk → one reload onto the new build", secs !== null && navs === 1, `lazy chunks evicted ${lazy.length}, reloads ${navs}`);
    await ctx.close();
  }

  // ---- D: a chunk that keeps failing → one reload, then the flat map, no loop
  {
    deploy("new");
    // no service worker here: it fetches chunks itself, past the page's routes; this case is the loop guard
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.route(/\/assets\/TripMap3D-.*\.js$/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" }));
    await page.goto(`${BASE}/`);
    await page.getByLabel(/add items/i).waitFor({ timeout: 60_000 });
    let navs = 0;
    page.on("framenavigated", (f) => f === page.mainFrame() && navs++);
    const route = async () => {
      await page.getByLabel(/add items/i).fill("Milk, Bananas");
      await page.getByLabel(/add items/i).press("Enter");
      await page.getByRole("button", { name: /route 2 items/i }).click({ timeout: 30_000 });
    };
    await route();
    // the reload resumes the saved trip; its 3D chunk fails again: the flat map, no second reload
    await page.waitForTimeout(8000);
    const s = await page.evaluate(() => ({ flat: !!document.querySelector(".trip-flat"), plate: !!document.querySelector(".boot-fail") }));
    check("D  a 3D chunk that keeps failing: one reload, then the flat map, no loop", s.flat && !s.plate && navs === 1, `reloads ${navs}, ${JSON.stringify(s)}`);
    await shot(page, "d-flat-fallback");
    await ctx.close();
  }

  // ---- E: a render error → the plate; Reset local data exports the lists, clears, renders
  {
    deploy("new");
    const { ctx, page } = await fresh();
    await install(page);
    await page.getByLabel(/add items/i).fill("Paneer, Atta");
    await page.getByLabel(/add items/i).press("Enter");
    await page.waitForTimeout(1500); // the draft autosaves
    await page.goto(`${BASE}/#/__crash`);
    const alert = page.getByRole("alert").filter({ hasText: "Something went wrong" });
    const plate = await alert.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    const text = plate ? await alert.innerText() : "";
    check("E  a render error shows the plate with the error, Reload and Reset local data", plate && /Crash test/.test(text) && /Reload/.test(text) && /Reset local data/.test(text));
    await shot(page, "e-plate-render");
    const download = page.waitForEvent("download", { timeout: 15_000 });
    await page.evaluate(() => (location.hash = "")); // the reload after the reset lands on the list
    await page.getByRole("button", { name: /reset local data/i }).click();
    const file = await (await download).path();
    const exported = JSON.parse(readFileSync(file, "utf8"));
    const items = exported.lists?.["demo-supercenter"]?.find((l) => l.kind === "draft")?.items ?? [];
    check("E  Reset local data downloads the lists first", items.includes("Paneer") && items.includes("Atta"), `draft ${JSON.stringify(items)}`);
    const ok = await rendered(page);
    const after = await page.evaluate(() => ({ keys: Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k) => k.startsWith("grosher.") && !k.startsWith("grosher.lists")).length, text: document.body.innerText.includes("Paneer") }));
    check("E  …then clears this device's data and the app renders empty", ok && !after.text, JSON.stringify(after));
    await ctx.close();
  }

  // ---- F: no first render → the plate at 8 s
  {
    deploy("new");
    const { ctx, page } = await fresh();
    const entry = entryOf(builds.new);
    await page.route((u) => u.pathname === entry, () => {}); // never answered
    const t0 = Date.now();
    await page.goto(`${BASE}/`, { waitUntil: "commit" });
    const plate = await page.getByRole("alert").filter({ hasText: "did not start within 8 seconds" }).waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    const s = (Date.now() - t0) / 1000;
    check("F  boot watchdog: the plate after 8 s without a first render", plate && s >= 7.5 && s < 13, `${s.toFixed(1)} s`);
    await shot(page, "f-plate-watchdog");
    await ctx.close();
  }
  // ---- G: a saved answer at a location the map no longer has
  const stale = (name, id, extra = {}) => ({ id, name, locationIds: ["DAIRY-8"], source: "llm", department: "dairy", confirms: 2, misses: 0, confidence: 0.86, lastConfirmed: Date.now() - 86_400_000, ...extra });
  const seedStale = (page, learning, list, trip) =>
    page.evaluate(
      async ([learning, list, trip]) => {
        const db = await new Promise((r) => {
          const q = indexedDB.open("grosher", 1);
          q.onupgradeneeded = () => q.result.createObjectStore("kv");
          q.onsuccess = () => r(q.result);
        });
        const tx = db.transaction("kv", "readwrite");
        const kv = tx.objectStore("kv");
        const now = Date.now();
        kv.put(learning, "learning:demo-supercenter");
        if (list) kv.put([{ id: "l_draft", name: "Draft", items: list, storeId: "demo-supercenter", createdAt: now, updatedAt: now, kind: "draft", usedAt: [] }], "lists:demo-supercenter");
        kv.delete("index:demo-supercenter"); // the stale entry answers before the full index is in, as on the phone
        await new Promise((r) => (tx.oncomplete = r));
        db.close();
        if (trip) localStorage.setItem("grosher.trip", JSON.stringify(trip));
      },
      [learning, list, trip],
    );
  {
    deploy("new");
    const { ctx, page } = await fresh();
    await install(page);
    await seedStale(page, { pending: [stale("Oat Milk", "llm:oatmilk", { subcategory: "plant milk" }), stale("Qwzx Gizmo", "llm:qwzxgizmo")], llm: [], memory: [] }, ["Oat milk", "Qwzx gizmo", "Bananas", "Bread"]);
    await page.reload();
    const ok = await rendered(page);
    await page.getByText(/4 items · 3 placed/i).waitFor({ timeout: 30_000 }).catch(() => {});
    const s = await page.evaluate(() => ({
      plate: !!document.querySelector(".boot-fail"),
      rows: Object.fromEntries([...document.querySelectorAll("li[data-source]")].map((r) => [r.querySelector(".name")?.textContent ?? r.textContent.slice(0, 20), { source: r.getAttribute("data-source"), sub: r.querySelector(".sub")?.textContent ?? "" }])),
      route: [...document.querySelectorAll("button")].map((b) => b.textContent ?? "").find((t) => /^Route/.test(t)) ?? "",
    }));
    const gizmo = Object.entries(s.rows).find(([k]) => /qwzx/i.test(k))?.[1];
    const oat = Object.entries(s.rows).find(([k]) => /oat milk/i.test(k))?.[1];
    check("G  a saved answer at a location the map lost: boots, Needs a place, the route covers the rest", ok && !s.plate && gizmo?.source === "unknown" && /needs a place/i.test(gizmo.sub) && oat?.source !== "unknown" && /route 3 items/i.test(s.route), `oat milk ${oat?.source}, gizmo "${gizmo?.sub}", ${s.route.replace(/\s+/g, " ").slice(0, 20)}`);
    await shot(page, "g-stale-location");
    await ctx.close();
  }

  // ---- H: a map change under a trip in progress
  {
    deploy("new");
    const { ctx, page } = await fresh();
    await install(page);
    const trip = { original: ["llm:qwzxgizmo", "milk", "bananas"], remaining: ["llm:qwzxgizmo", "milk", "bananas"], got: [], skipped: [], positionNodeId: "ENTRANCE", walkedM: 0, startedAt: Date.now() - 600_000 };
    await seedStale(page, { pending: [stale("Qwzx Gizmo", "llm:qwzxgizmo")], llm: [], memory: [] }, null, trip);
    await page.reload();
    const resumed = await page.getByText(/next · 1 of 2/i).waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
    const plate = await page.evaluate(() => !!document.querySelector(".boot-fail"));
    check("H  a map change under a trip: it resumes, the removed location's stop left for checkout", resumed && !plate);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nFAIL: ${failed.length} of ${results.length}` : `\nOK: ${results.length} checks`);
process.exit(failed.length ? 1 : 0);
