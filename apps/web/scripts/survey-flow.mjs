// Survey mode, end to end, with a mocked sensor stream (scripts/survey-driver.mjs): calibrate, walk three
// aisles with sign photos taken offline, pins, an undo, back online so the queue reads the signs, build the
// draft, export the file, open it in the editor at 1440, and import the file into a fresh browser (the
// AirDrop-to-the-Mac path). Asserts the numbers; with --shots, a 390×844 screenshot of every screen.
//
//   node scripts/survey-flow.mjs http://localhost:4173 [--shots dir]

import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { driveSurvey, prepare } from "./survey-driver.mjs";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const SHOTS = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const FIXTURES = resolve(fileURLToPath(import.meta.url), "../../test/fixtures/signs");
const SIGNS = [
  ["12", "Cereal", "Breakfast", "Coffee", "Tea"],
  ["7", "International", "Indian", "Foods", "Atta & Rice", "Asian"],
];

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const browser = await chromium.launch();
const errors = [];
let downloaded = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  // the download path (headless Chromium's share sheet would only cancel)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: undefined });
  });
  const mock = await prepare(page, { signs: SIGNS });
  let n = 0;
  await driveSurvey(page, {
    base: BASE,
    fixtures: FIXTURES,
    goOffline: (off) => ctx.setOffline(off),
    onScreen: async (name) => {
      if (name === "calibrated") {
        const cal = await page.evaluate(() => JSON.parse(localStorage.getItem("grosher.calibration") ?? "null"));
        void cal; // saved on the next tap; checked below
      }
      if (name === "captured offline") {
        const waiting = await page.getByText(/waiting for a connection/).count();
        check("offline: capture never waits, both photos queued for a connection", waiting === 2 && mock.signsRead() === 0, `${waiting} waiting, ${mock.signsRead()} sent`);
      }
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${String(++n).padStart(2, "0")}-${name.replace(/\s+/g, "-")}.png`) });
    },
  });

  const cal = await page.evaluate(() => JSON.parse(localStorage.getItem("grosher.calibration")).data);
  check("calibration: 13 steps in 10 m → 0.77 m a step", cal.steps === 13 && near(cal.strideM, 10 / 13, 0.001), `${cal.steps} steps, ${cal.strideM?.toFixed(3)} m`);
  check("back online: the queue read both signs", mock.signsRead() === 2);

  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("grosher.surveydraft.walmart-5435")).data);
  const st = draft.store;
  const node = (id) => st.nodes.find((x) => x.id === id);
  const edgeLen = (id) => {
    const e = st.edges.find((x) => x.id === id);
    return Math.hypot(node(e.to).x - node(e.from).x, node(e.to).y - node(e.from).y);
  };
  const aisleLen = (code) => edgeLen(st.locations.find((l) => l.aisle === code).edgeId);
  const stride = 10 / 13;
  check("aisle 12: 40 steps → 30.8 m", near(aisleLen("A12"), 40 * stride, stride), aisleLen("A12").toFixed(2));
  check("aisle 7 (number read off its sign): 40 steps → 30.8 m", near(aisleLen("A7"), 40 * stride, stride), aisleLen("A7").toFixed(2));
  const a12 = st.nodes.filter((x) => x.type === "aisle_end");
  check("aisle ends: 6 corridor ends", a12.length >= 6, String(a12.length));
  const cats = draft.categories.map((c) => `${c.aisle}:${c.name}`);
  check("sign categories on their aisles", cats.includes("A12:Cereal") && cats.includes("A12:Tea") && cats.includes("A7:Rice"), cats.join(", "));
  check("doors from pins: a checkout lane and the exit", node(st.checkoutIds[0])?.type === "checkout" && node(st.exitId)?.type === "exit");
  check("shelves: both sides of two aisles, one side of the third", st.fixtures.length === 5, String(st.fixtures.length));
  check("the slip was undone: no Bakery pin", !st.departments.find((d) => d.id === "bakery")?.anchor);

  // export (the AirDrop file)
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export survey file" }).click();
  downloaded = join(mkdtempSync(join(tmpdir(), "grosher-survey-")), "survey.json");
  await (await dl).saveAs(downloaded);
  const file = JSON.parse(readFileSync(downloaded, "utf8"));
  check("export: one versioned file with the raw walk and both photos inline", file.format === "grosher.survey" && file.version === 1 && file.steps.length > 150 && file.headings.length > 100 && Object.keys(file.photoData).length === 2, `${file.steps.length} steps, ${file.headings.length} headings, ${Object.keys(file.photoData).length} photos`);

  // the editor, on a desktop
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Open in the editor" }).click();
  await page.getByText(/Walmart Story Rd #5435 · #walmart-5435/).waitFor({ timeout: 30_000 });
  // the raw survey stays attached (the inspector's default panel), then Validate
  const panel = await page.getByRole("region", { name: "Survey" }).innerText({ timeout: 15_000 });
  check("the raw survey stays attached in the editor", /3 aisles/.test(panel) && /Re-derive/i.test(panel), panel.split("\n")[1]);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${String(++n).padStart(2, "0")}-editor-1440.png`) });
  await page.getByRole("button", { name: "Validate" }).click();
  await page.waitForTimeout(300);
  const issues = await page.locator(".ed-issues li.error").count();
  check("the draft opens in the editor and validates with no errors", issues === 0, `${issues} errors`);
  await ctx.close();

  // the Mac: a fresh browser imports the file and builds the same draft
  const mac = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mp = await mac.newPage();
  mp.on("pageerror", (e) => errors.push(e.message));
  await mp.goto(`${BASE}/#/survey`);
  const chooser = mp.waitForEvent("filechooser");
  await mp.getByRole("button", { name: "Import a survey file" }).click();
  await (await chooser).setFiles(downloaded);
  await mp.getByText(/Imported Walmart Story Rd #5435: 3 aisles/).waitFor({ timeout: 15_000 });
  await mp.getByRole("button", { name: "Build draft map" }).click();
  await mp.getByRole("button", { name: "Open in the editor" }).click();
  await mp.getByText(/#walmart-5435/).waitFor({ timeout: 30_000 });
  const again = await mp.evaluate(() => JSON.parse(localStorage.getItem("grosher.surveydraft.walmart-5435")).data.store);
  check("imported on the Mac: the same draft", again.nodes.length === st.nodes.length && again.locations.length === st.locations.length, `${again.nodes.length} nodes, ${again.locations.length} locations`);
  await mac.close();
} finally {
  await browser.close();
}
if (errors.length) check("no page errors", false, errors.join(" | "));
const failed = results.filter((r) => !r).length;
console.log(failed ? `\nFAIL: ${failed} of ${results.length}` : `\nOK: ${results.length} checks`);
process.exit(failed ? 1 : 0);
