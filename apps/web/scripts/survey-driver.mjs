// Drives survey mode through a whole store walk with a mocked sensor stream, for scripts/survey-flow.mjs
// (assertions, screenshots) and scripts/contrast-gate.mjs (every survey screen measured).
//
// The page's clock is Playwright's fake one, advanced 20 ms per accelerometer sample, so a two-minute walk
// runs in seconds and every timestamp the app records is consistent. A step is a 2.6 m/s² bump in the
// accelerometer's magnitude every 0.6 s; the compass is a deviceorientationabsolute event every 250 ms.
// Sign photos are the fixtures in test/fixtures/signs; the worker's /sign is answered by a route.

import { join } from "node:path";

export const REF_HEADING = 30; // the store's front faces 30° east of north
export const STEP_S = 0.6;
const SAMPLE_MS = 20;
const G = 9.81;

/** before the page loads: the clock, iOS-style sensor permission, the worker at a test URL, and its /sign */
export async function prepare(page, { signs, online = true } = {}) {
  await page.clock.install({ time: new Date("2026-10-18T10:00:00Z") });
  await page.addInitScript(() => {
    const grant = async () => "granted";
    if (window.DeviceMotionEvent) window.DeviceMotionEvent.requestPermission = grant;
    if (window.DeviceOrientationEvent) window.DeviceOrientationEvent.requestPermission = grant;
    if (!localStorage.getItem("grosher.resolver")) localStorage.setItem("grosher.resolver", JSON.stringify({ provider: "worker", workerUrl: "https://resolver.test", ollamaUrl: "http://localhost:11434", model: "qwen3:8b", visionModel: "qwen2.5vl:7b" }));
  });
  let n = 0;
  await page.route("https://resolver.test/sign", async (route) => {
    const words = signs?.[n++] ?? [];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ words }) });
  });
  await page.route("https://resolver.test/resolve", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ results: [] }) }));
  return { signsRead: () => n };
}

/** the sensors for `ms`: standing still, or walking `steps` steps on `heading` */
export async function feed(page, { ms, steps = 0, heading = REF_HEADING }) {
  const stepEvery = steps ? ms / steps : Infinity;
  for (let t = 0; t < ms; t += SAMPLE_MS) {
    // the bump of a step, centred 100 ms into each step period
    const phase = steps ? t % stepEvery : Infinity;
    const bump = steps ? 2.6 * Math.exp(-(((phase - 100) / 70) ** 2)) - 1.2 * Math.exp(-(((phase - 330) / 80) ** 2)) : 0;
    const sendHeading = t % 250 === 0;
    await page.clock.runFor(SAMPLE_MS);
    await page.evaluate(
      ([z, h]) => {
        window.dispatchEvent(new DeviceMotionEvent("devicemotion", { accelerationIncludingGravity: { x: 0.2, y: 1.1, z }, interval: 20 }));
        if (h !== null) window.dispatchEvent(new DeviceOrientationEvent("deviceorientationabsolute", { alpha: (360 - h) % 360, beta: 0, gamma: 0, absolute: true }));
      },
      [G + bump, sendHeading ? heading : null],
    );
  }
}
export const walk = (page, steps, heading) => feed(page, { ms: steps * STEP_S * 1000, steps, heading });

const button = (page, name) => page.getByRole("button", { name, exact: true });

/** a sign photo through the camera input (the button opens a file chooser) */
export async function photo(page, file) {
  const chooser = page.waitForEvent("filechooser");
  await button(page, "Sign photo").click();
  await (await chooser).setFiles(file);
  await page.getByText(/Sign \d+:/).last().waitFor({ timeout: 10_000 }).catch(() => {});
}

/**
 * The whole walk. onScreen(name) is called at each screen worth a look (screenshot, contrast). Returns
 * what the test checks against.
 */
export async function driveSurvey(page, { base, fixtures, onScreen = async () => {}, goOffline }) {
  await page.goto(`${base}/#/survey`);
  await page.getByRole("heading", { name: "Survey a store" }).waitFor({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await onScreen("home");

  // calibrate: 13 steps over the 10 m
  await button(page, "Calibrate").click();
  await onScreen("calibrate");
  await button(page, "Start").click();
  await feed(page, { ms: 600 });
  await walk(page, 13, REF_HEADING);
  await feed(page, { ms: 400 });
  await button(page, "Stop").click();
  await onScreen("calibrated");
  await button(page, "Save").click();

  // start: stand in the entrance facing in
  await button(page, "Start survey").click();
  await feed(page, { ms: 3000 }); // past the motion grace period, the compass settles
  await onScreen("entrance");
  await button(page, "Entrance").click();

  if (goOffline) await goOffline(true);
  // aisle 12: up 30 m (40 steps), its sign photographed at the head
  await walk(page, 8, REF_HEADING);
  await photo(page, join(fixtures, "aisle-12.jpg"));
  await button(page, "Start aisle").click();
  await walk(page, 20, REF_HEADING);
  await onScreen("aisle");
  await button(page, "Aisle number").click();
  for (const k of ["1", "2"]) await page.getByRole("dialog", { name: "Aisle number" }).getByRole("button", { name: k, exact: true }).click();
  await onScreen("numpad");
  await page.getByRole("dialog", { name: "Aisle number" }).getByRole("button", { name: "Done" }).click();
  await walk(page, 20, REF_HEADING);
  await button(page, "End aisle").click();

  // across 3 m, aisle 7 down (its number read off the sign)
  await walk(page, 4, REF_HEADING + 90);
  await photo(page, join(fixtures, "aisle-7.jpg"));
  await button(page, "Start aisle").click();
  await walk(page, 40, REF_HEADING + 180);
  await button(page, "End aisle").click();

  // across 3 m, a third aisle up 22.5 m: one side only, an end cap, no photo
  await walk(page, 4, REF_HEADING + 90);
  await button(page, "Start aisle").click();
  await button(page, "One side only").click();
  await button(page, "End cap").click();
  await walk(page, 30, REF_HEADING);
  await button(page, "End aisle").click();

  // pins: the dairy wall at the back, a checkout lane at the front, the exit
  await walk(page, 4, REF_HEADING + 90);
  await button(page, "Pin").click();
  await onScreen("pins");
  await page.getByRole("dialog", { name: "Pin a landmark" }).getByRole("button", { name: "Dairy wall" }).click();
  // a slip: a pin dropped by mistake, then undone
  await button(page, "Pin").click();
  await page.getByRole("dialog", { name: "Pin a landmark" }).getByRole("button", { name: "Bakery" }).click();
  await page.getByRole("button", { name: /^Undo pin Bakery$/ }).click();
  await walk(page, 34, REF_HEADING + 180);
  await button(page, "Pin").click();
  await page.getByRole("dialog", { name: "Pin a landmark" }).getByRole("button", { name: "Checkout lane" }).click();
  await walk(page, 8, REF_HEADING + 270);
  await button(page, "Pin").click();
  await page.getByRole("dialog", { name: "Pin a landmark" }).getByRole("button", { name: "Exit" }).click();
  await onScreen("captured offline");

  // back online: the queue reads both signs
  if (goOffline) await goOffline(false);
  for (let i = 0; i < 60; i++) {
    await page.clock.runFor(1000);
    if ((await page.getByText(/Sign \d+: read/).count()) >= 2) break;
    await page.waitForTimeout(100);
  }
  await onScreen("captured");

  await button(page, "Finish").click();
  await onScreen("home with survey");
  await button(page, "Build draft map").click();
  await page.getByRole("heading", { name: "Draft map built" }).waitFor();
  await onScreen("built");
}
