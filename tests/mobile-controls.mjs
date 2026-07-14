import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.MOBILE_TEST_URL ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
await context.addInitScript(() => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  window.__mobileTestRafCount = 0;
  window.requestAnimationFrame = (callback) => originalRequestAnimationFrame((time) => {
    window.__mobileTestRafCount += 1;
    return callback(time);
  });
});
const page = await context.newPage();
const errors = [];
let scenario = 0;

page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

async function startFresh() {
  scenario += 1;
  await page.goto(`${url}/?mobile-test=${scenario}`);
  await page.getByRole("button", { name: /Normal Standard drop/i }).click();
}

async function snapshot() {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function failPointerCapture(selector) {
  await page.evaluate((targetSelector) => {
    document.querySelector(targetSelector).setPointerCapture = () => {
      throw new Error("capture unavailable");
    };
  }, selector);
}

async function dispatch(selector, type, pointerId, options = {}) {
  await page.evaluate(({ targetSelector, eventType, id, eventOptions }) => {
    document.querySelector(targetSelector).dispatchEvent(new PointerEvent(eventType, {
      bubbles: true,
      pointerId: id,
      pointerType: "touch",
      buttons: eventType === "pointerdown" ? 1 : 0,
      ...eventOptions,
    }));
  }, { targetSelector: selector, eventType: type, id: pointerId, eventOptions: options });
}

try {
  await page.goto(`${url}/?mobile-test=idle-loop`);
  await page.waitForTimeout(150);
  const readyFrames = await page.evaluate(() => window.__mobileTestRafCount);
  await page.waitForTimeout(220);
  assert.ok(
    await page.evaluate((before) => window.__mobileTestRafCount - before <= 1, readyFrames),
    "ready mode must not run a continuous game RAF loop",
  );
  await page.getByRole("button", { name: /Normal Standard drop/i }).click();
  await page.waitForTimeout(120);
  const playingFrames = await page.evaluate(() => window.__mobileTestRafCount);
  await page.waitForTimeout(180);
  assert.ok(
    await page.evaluate((before) => window.__mobileTestRafCount - before > 5, playingFrames),
    "playing mode must run the game loop",
  );
  await page.keyboard.press("p");
  await page.waitForTimeout(120);
  const pausedFrames = await page.evaluate(() => window.__mobileTestRafCount);
  await page.waitForTimeout(220);
  assert.ok(
    await page.evaluate((before) => window.__mobileTestRafCount - before <= 1, pausedFrames),
    "paused mode must suspend the game RAF loop",
  );

  await startFresh();
  await failPointerCapture("#mobile-orbit-right");
  await dispatch("#mobile-orbit-right", "pointerdown", 1);
  await page.waitForTimeout(430);
  await dispatch("body", "pointerup", 1);
  await page.waitForTimeout(120);
  const orbitAfterRelease = (await snapshot()).active.sector;
  await page.waitForTimeout(240);
  assert.equal((await snapshot()).active.sector, orbitAfterRelease, "off-target orbit release must stop repeating");
  assert.equal(await page.locator("#mobile-orbit-right").getAttribute("data-pressed"), null);

  await startFresh();
  await failPointerCapture("#mobile-orbit-right");
  await dispatch("#mobile-orbit-right", "pointerdown", 7);
  await page.waitForTimeout(390);
  await dispatch("body", "pointerup", 7);
  await page.waitForTimeout(100);
  await dispatch("#mobile-orbit-right", "pointerdown", 7);
  await page.waitForTimeout(50);
  await dispatch("#mobile-orbit-right", "pointerup", 7);
  await page.waitForTimeout(120);
  const reusedPointerSector = (await snapshot()).active.sector;
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(240);
  assert.equal((await snapshot()).active.sector, reusedPointerSector, "reused pointer IDs must not orphan repeat timers");

  await startFresh();
  await failPointerCapture("#mobile-nudge");
  await dispatch("#mobile-nudge", "pointerdown", 9);
  await page.waitForTimeout(250);
  await dispatch("body", "pointerup", 9);
  await page.waitForTimeout(100);
  const nudgeScoreAfterRelease = (await snapshot()).score;
  await page.waitForTimeout(240);
  assert.equal((await snapshot()).score, nudgeScoreAfterRelease, "off-target Nudge release must stop repeating");
  assert.equal(await page.locator("#mobile-nudge").getAttribute("data-pressed"), null);

  await startFresh();
  const orbitStart = (await snapshot()).active.sector;
  await dispatch("#mobile-orbit-right", "pointerdown", 11);
  await page.waitForTimeout(410);
  await dispatch("#mobile-orbit-right", "pointerup", 11);
  const orbitStopped = (await snapshot()).active.sector;
  assert.notEqual(orbitStopped, orbitStart, "normal orbit hold must repeat");
  await page.waitForTimeout(220);
  assert.equal((await snapshot()).active.sector, orbitStopped, "normal orbit release must remain stopped");

  await startFresh();
  const multitouchStart = await snapshot();
  await dispatch("#mobile-orbit-right", "pointerdown", 21);
  await dispatch("#mobile-nudge", "pointerdown", 22);
  await page.waitForTimeout(360);
  await dispatch("#mobile-orbit-right", "pointerup", 21);
  await dispatch("#mobile-nudge", "pointerup", 22);
  const multitouchStopped = await snapshot();
  assert.notEqual(multitouchStopped.active.sector, multitouchStart.active.sector, "two-finger Orbit must keep repeating");
  assert.ok(multitouchStopped.score > multitouchStart.score, "two-finger Nudge must keep repeating");
  await page.waitForTimeout(220);
  const multitouchAfterRelease = await snapshot();
  assert.equal(multitouchAfterRelease.active.sector, multitouchStopped.active.sector, "two-finger Orbit must stop independently");
  assert.equal(multitouchAfterRelease.score, multitouchStopped.score, "two-finger Nudge must stop independently");

  await startFresh();
  await dispatch("#mobile-nudge", "pointerdown", 31);
  await page.waitForTimeout(160);
  await page.keyboard.press("p");
  const pausedScore = (await snapshot()).score;
  await page.waitForTimeout(260);
  assert.equal((await snapshot()).score, pausedScore, "pausing must cancel active Nudge repeats");
  assert.equal(await page.locator("#mobile-nudge").getAttribute("data-pressed"), null);

  await page.keyboard.press("p");
  await dispatch("#mobile-orbit-right", "pointerdown", 32);
  await page.waitForTimeout(160);
  await page.locator("#mobile-new-game").click();
  const restartedSector = (await snapshot()).active.sector;
  await page.waitForTimeout(320);
  assert.equal((await snapshot()).active.sector, restartedSector, "restarting must cancel active Orbit repeats");
  assert.equal(await page.locator("#mobile-orbit-right").getAttribute("data-pressed"), null);

  const rotationStart = (await snapshot()).active.rotation;
  await dispatch("[data-spin-pole-action=rotate]", "pointerdown", 12);
  await dispatch("[data-spin-pole-action=rotate]", "pointerup", 12);
  assert.notEqual((await snapshot()).active.rotation, rotationStart, "Spin pole tap must still rotate once");

  assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
  console.log("mobile control regression passed");
} finally {
  await browser.close();
}
