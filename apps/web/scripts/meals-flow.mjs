// Cook mode end to end, in CI, with the local model mocked (page.route on Ollama's /api/chat and the worker's
// /dishes, whichever the build calls): five dishes typed, four from the dish table and one the model answers;
// the review (grouped by dish, the merged lines, "You probably have" unticked, the model's dish and lines tagged
// estimated); a line edited and one removed; Add to list; every line placed; Route opens the trip. Then the Mac
// asleep: the model unreachable, the table's dishes still give their lines, the unknown dish says it needs the
// laptop's model, nothing errors; and a dish answered once comes back from the cache with the model gone.
//
//   node scripts/meals-flow.mjs http://localhost:4173 [--shots dir]

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const shotsAt = process.argv.indexOf("--shots");
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

/** the model's answer for pasta carbonara, two servings, as qwen3:8b gave it (test/fixtures/dishes-model.json) */
const CARBONARA = { ingredients: [
  { name: "spaghetti", quantity: 200, unit: "g", optional: false, pantryStaple: false },
  { name: "egg yolk", quantity: 3, unit: "piece", optional: false, pantryStaple: false },
  { name: "parmesan cheese", quantity: 50, unit: "g", optional: false, pantryStaple: false },
  { name: "pancetta", quantity: 150, unit: "g", optional: false, pantryStaple: false },
  { name: "black pepper", quantity: 1, unit: "tsp", optional: false, pantryStaple: true },
  { name: "garlic", quantity: 12, unit: "handful", optional: false, pantryStaple: false },
] };

/** answer cook mode's dish calls (one dish a call, or the worker's batch); refuse everything else (the item resolver) */
async function mockModel(ctx, { up }) {
  const calls = { dish: 0 };
  await ctx.route("**/api/chat", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    if (!up || !body.format?.properties?.ingredients) return route.abort();
    calls.dish++;
    await route.fulfill({ json: { message: { content: JSON.stringify(CARBONARA) } } });
  });
  await ctx.route("**/dishes", async (route) => {
    if (!up) return route.abort();
    const { dishes } = JSON.parse(route.request().postData() ?? "{}");
    calls.dish += dishes.length;
    await route.fulfill({ json: { results: dishes.map((dish) => ({ dish, ingredients: CARBONARA.ingredients })) } });
  });
  await ctx.route("**/resolve", (route) => route.abort());
  return calls;
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const fails = [];
const errors = [];
const expect = (ok, what) => {
  if (!ok) fails.push(what);
};
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const calls = await mockModel(ctx, { up: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120_000);
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?closeup=0`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__grosherIndex, null, { timeout: 120_000 });

  // ---- dishes in
  await page.getByTestId("plan-meals").click();
  await page.getByLabel("Dishes").fill("dal chawal, rajma, poha, pasta arrabbiata, pasta carbonara");
  await shot(page, "1-dishes");
  await page.getByRole("button", { name: "Make the list" }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="meal-dish"]').length === 5 && !document.querySelector('[data-status="asking"]'));
  await shot(page, "2-review");
  const dishes = await page.getByTestId("meal-dish").evaluateAll((els) => els.map((e) => [e.querySelector(".meal-dish-name")?.textContent, e.dataset.status]));
  expect(JSON.stringify(dishes) === JSON.stringify([["Dal chawal", "table"], ["Rajma chawal", "table"], ["Poha", "table"], ["Pasta arrabbiata", "table"], ["Pasta carbonara", "model"]]), `dishes: ${JSON.stringify(dishes)}`);
  expect(calls.dish === 1, `the model was asked ${calls.dish} times (want once, for carbonara)`);
  const carbonara = page.getByTestId("meal-dish").filter({ hasText: "Pasta carbonara" });
  expect(/estimated/.test(await carbonara.innerText()), "carbonara is not tagged estimated");
  expect(/Left out garlic/.test(await carbonara.innerText()), "the line with no usable unit was not reported");

  const lines = await page.getByTestId("meal-line").evaluateAll((els) =>
    els.map((e) => ({ label: e.querySelector(".meal-label").value, ticked: e.querySelector(".meal-tick").checked, pantry: e.dataset.pantry === "true", text: e.innerText })),
  );
  const line = (label) => lines.find((l) => l.label === label);
  for (const l of ["Onions × 4", "Toor dal 500 g", "Basmati rice 1 kg", "Rajma 500 g", "Poha 500 g", "Penne pasta 500 g", "Spaghetti 500 g", "Eggs pack of 6", "Parmesan 100 g"]) expect(line(l)?.ticked, `"${l}" missing or unticked`);
  expect(line("Onions × 4")?.text.includes("for: Dal chawal, Rajma chawal, Poha"), "onions do not say which dishes they are for");
  expect(/estimated/.test(line("Eggs pack of 6")?.text ?? ""), "a model line is not tagged estimated");
  expect(!/estimated/.test(line("Toor dal 500 g")?.text ?? "x estimated"), "a table line is tagged estimated");
  // parmesan: in arrabbiata it is optional, in carbonara it is not, so it is ticked
  const pantry = lines.filter((l) => l.pantry);
  expect(pantry.length >= 6 && pantry.every((l) => !l.ticked), "You probably have: missing, or ticked");
  expect(pantry.some((l) => l.label === "Salt 1 kg") && pantry.some((l) => l.label === "Turmeric 100 g"), "salt or turmeric not under You probably have");
  expect(line("Cilantro × 1 bunch")?.ticked === false, "an optional garnish starts ticked");

  // ---- edit one, remove one, tick a pantry line, people up and down
  await page.getByLabel("Edit Onions").fill("Onions × 5");
  await page.getByLabel("Remove Peanuts").click();
  await page.getByLabel("Buy Salt 1 kg").check();
  await page.getByRole("button", { name: "More people" }).first().click();
  const four = await page.getByLabel("Edit Toor dal").inputValue();
  await page.getByRole("button", { name: "Fewer people" }).first().click();
  expect(four === "Toor dal 500 g", `toor dal for three: ${four}`);
  expect((await page.getByLabel("Edit Basmati rice").inputValue()) === "Basmati rice 1 kg", "basmati for two");
  await page.locator(".meal-scroll").evaluate((e) => (e.scrollTop = e.scrollHeight));
  await shot(page, "3-review-end");
  const addLabel = await page.getByTestId("meal-add").innerText();
  await page.getByTestId("meal-add").click();
  await page.getByTestId("meal-sheet").waitFor({ state: "detached" });

  // ---- on the list, placed, and routed
  const want = Number(addLabel.match(/\d+/)?.[0] ?? 0);
  await page.getByText(new RegExp(`${want} items · ${want} placed`)).waitFor({ timeout: 60_000 }).catch(() => {});
  const head = await page.locator(".sheet-head .eyebrow").first().innerText();
  const rows = await page.locator(".rows .row-item .name").allInnerTexts();
  console.log(`list: ${head.trim()}`);
  expect(rows.includes("Onions × 5") && !rows.includes("Onions × 4"), "the edited line did not reach the list");
  expect(!rows.some((r) => /^Peanuts/.test(r)), "the removed line reached the list");
  expect(rows.includes("Salt 1 kg"), "the ticked pantry line did not reach the list");
  expect(!rows.includes("Turmeric 100 g"), "an unticked pantry line reached the list");
  const placed = head.match(/(\d+) items? · (\d+) placed/i);
  // Pancetta is the model's ad-hoc line: no shelf names it, so it waits for the resolver's model (refused here)
  expect(placed && Number(placed[1]) === want && Number(placed[2]) >= want - 1, `placed: ${head}`);
  await shot(page, "4-list");
  // a plain item already on the list gives way to the line with its quantity
  await page.getByTestId("plan-meals").click();
  await page.getByLabel("Dishes").fill("jeera rice");
  await page.getByRole("button", { name: "Make the list" }).click();
  await page.getByTestId("meal-add").click();
  const after = await page.locator(".rows .row-item .name").allInnerTexts();
  expect(after.filter((r) => /^Basmati rice/.test(r)).length === 1, "basmati twice after a second plan");
  await page.getByRole("button", { name: /^route \d+ items/i }).click();
  await page.locator(".trip-screen, [data-testid='trip']").first().waitFor({ timeout: 120_000 }).catch(() => expect(false, "the trip did not open"));
  await shot(page, "5-trip");
  await ctx.close();

  // ---- the Mac asleep: the table still answers, the unknown dish says what it needs; the cache answers a dish seen before
  const asleep = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await mockModel(asleep, { up: false });
  const ap = await asleep.newPage();
  ap.on("pageerror", (e) => errors.push(String(e)));
  await ap.goto(`${BASE}/?closeup=0`, { waitUntil: "load" });
  await ap.waitForFunction(() => !!window.__grosherIndex, null, { timeout: 120_000 });
  await ap.getByTestId("plan-meals").click();
  await ap.getByLabel("Dishes").fill("dal chawal, beef rendang");
  await ap.getByRole("button", { name: "Make the list" }).click();
  await ap.waitForFunction(() => !document.querySelector('[data-status="asking"]'), null, { timeout: 120_000 });
  const rendang = await ap.getByTestId("meal-dish").filter({ hasText: "Beef rendang" }).innerText();
  expect(/Needs your laptop's model/.test(rendang), `the unanswered dish: ${rendang}`);
  expect((await ap.getByTestId("meal-line").count()) > 8, "the table's dish gave no lines with the model asleep");
  expect(!(await ap.locator(".boot-fail").count()), "an error plate");
  await shot(ap, "6-asleep");
  await asleep.close();

  const cached = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  const c1 = await mockModel(cached, { up: true });
  const cp = await cached.newPage();
  await cp.goto(`${BASE}/?closeup=0`, { waitUntil: "load" });
  await cp.waitForFunction(() => !!window.__grosherIndex, null, { timeout: 120_000 });
  const plan = async (text) => {
    await cp.getByTestId("plan-meals").click();
    await cp.getByLabel("Dishes").fill(text);
    await cp.getByRole("button", { name: "Make the list" }).click();
    await cp.waitForFunction(() => !document.querySelector('[data-status="asking"]'), null, { timeout: 120_000 });
  };
  await plan("pasta carbonara");
  await cp.getByRole("button", { name: "Close" }).first().click();
  await cached.unroute("**/api/chat");
  await cached.unroute("**/dishes");
  await cached.route("**/api/chat", (r) => r.abort());
  await cached.route("**/dishes", (r) => r.abort());
  await plan("Pasta Carbonara");
  const status = await cp.getByTestId("meal-dish").first().getAttribute("data-status");
  expect(c1.dish === 1 && status === "model", `the cache: asked ${c1.dish}, then ${status}`);
  await cached.close();
} catch (e) {
  fails.push(String(e));
} finally {
  await browser.close();
}
if (errors.length) fails.push(...errors.map((e) => `page error: ${e}`));
if (fails.length) {
  console.log(`FAIL:\n  ${fails.join("\n  ")}`);
  process.exit(1);
}
console.log("cook mode flow passed");
