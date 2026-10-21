// The project page's Cook mode still: the review sheet for "dal chawal, pasta carbonara, beef rendang", for two, at
// the moment the model's first answer is in. Dal chawal from the dish table; pasta carbonara as qwen3:8b answered it
// (the recorded answer, packages/stores/test/fixtures/dishes-model.json), tagged estimated; beef rendang still
// estimating (its answer is held), with its Cancel. Against `vite preview` of a fresh build, on this Mac's GPU at 3×
// (capture-kit.mjs), into public/project/img/cook-{1x,2x,3x}.{avif,webp,png}. Run lqip.mjs after.
//
//   node apps/web/scripts/capture-cook.mjs http://localhost:4173

import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launch, phone, still, QUALITY } from "./capture-kit.mjs";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const IMG = join(import.meta.dirname, "..", "public", "project", "img");
const TMP = join(tmpdir(), "grosher-cook");
mkdirSync(TMP, { recursive: true });

const recording = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "packages", "stores", "test", "fixtures", "dishes-model.json"), "utf8"));
const carbonara = recording.calls.find((c) => c.dish === "Pasta carbonara").content;

const browser = await launch();
try {
  const { ctx, page } = await phone(browser, { dsf: 3 });
  // the model: carbonara answers as recorded, beef rendang never does (registered after the kit's abort, so first)
  await page.route("**/api/chat", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    if (!body.format?.properties?.ingredients) return route.abort();
    if (/rendang/i.test(body.messages?.[1]?.content ?? "")) return; // held: still estimating in the still
    await route.fulfill({ json: { message: { content: carbonara } } });
  });
  await page.goto(`${BASE}/?closeup=0&${QUALITY}`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__grosherIndex, null, { timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId("plan-meals").click();
  await page.getByLabel("Dishes").fill("dal chawal, pasta carbonara, beef rendang");
  await page.getByRole("button", { name: "Make the list" }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-status="model"]').length === 1, null, { timeout: 30_000 });
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(TMP, "cook.png") });
  await ctx.close();
  console.log("cook:", JSON.stringify(still(join(TMP, "cook.png"), join(IMG, "cook"))));
} finally {
  await browser.close();
}
