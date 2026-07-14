import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.MOBILE_TEST_URL ?? "http://127.0.0.1:4173";
const GUIDE_KEY = "radial-tetris-mobile-gesture-guide-v1";
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

async function snapshot() {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function openReady({ guideSeen = true } = {}) {
  scenario += 1;
  await page.goto(`${url}/?mobile-test=${scenario}`);
  await page.evaluate(({ key, seen }) => {
    if (seen) localStorage.setItem(key, "seen");
    else localStorage.removeItem(key);
  }, { key: GUIDE_KEY, seen: guideSeen });
  await page.reload();
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.waitForTimeout(40);
}

async function chooseNormal() {
  const button = page.getByRole("button", { name: /Normal Standard drop/i });
  await button.click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode !== "ready");
}

async function startFresh() {
  await openReady({ guideSeen: true });
  await chooseNormal();
  assert.equal((await snapshot()).mode, "playing");
}

async function canvasGeometry() {
  return page.locator(".game-canvas").evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      radius: Math.min(rect.width, rect.height) * 0.39,
    };
  });
}

async function dispatch(selector, type, pointerId, point, options = {}) {
  await page.evaluate(({ targetSelector, eventType, id, eventPoint, eventOptions }) => {
    const target = document.querySelector(targetSelector);
    target.dispatchEvent(new PointerEvent(eventType, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: "touch",
      isPrimary: eventOptions.isPrimary ?? true,
      buttons: eventType === "pointerup" || eventType === "pointercancel" ? 0 : 1,
      clientX: eventPoint.x,
      clientY: eventPoint.y,
    }));
  }, {
    targetSelector: selector,
    eventType: type,
    id: pointerId,
    eventPoint: point,
    eventOptions: options,
  });
}

async function tapBoard(pointerId = 1, pointOverride = null) {
  const geometry = await canvasGeometry();
  const point = pointOverride ?? { x: geometry.cx + geometry.radius, y: geometry.cy };
  await dispatch(".game-canvas", "pointerdown", pointerId, point);
  await dispatch(".game-canvas", "pointerup", pointerId, point);
}

async function swipeArc(direction, pointerId, distance = 72) {
  const geometry = await canvasGeometry();
  const start = { x: geometry.cx + geometry.radius, y: geometry.cy };
  const angle = direction * distance / geometry.radius;
  const end = {
    x: geometry.cx + Math.cos(angle) * geometry.radius,
    y: geometry.cy + Math.sin(angle) * geometry.radius,
  };
  await dispatch(".game-canvas", "pointerdown", pointerId, start);
  await dispatch(".game-canvas", "pointermove", pointerId, end);
  await page.waitForTimeout(25);
  await dispatch(".game-canvas", "pointerup", pointerId, end);
}

async function clickGuideBackdrop() {
  const point = await page.locator("#mobile-gesture-guide").evaluate((overlay) => {
    const overlayRect = overlay.getBoundingClientRect();
    const cardRect = overlay.querySelector(".gesture-guide-card").getBoundingClientRect();
    return {
      x: overlayRect.left + 8,
      y: Math.max(overlayRect.top + 8, Math.min(overlayRect.bottom - 8, cardRect.top - 8)),
    };
  });
  await page.mouse.click(point.x, point.y);
}

async function failPointerCapture() {
  await page.locator(".game-canvas").evaluate((canvas) => {
    canvas.setPointerCapture = () => {
      throw new Error("capture unavailable");
    };
  });
}

try {
  // First-use onboarding starts only after difficulty selection and preserves the active board.
  await openReady({ guideSeen: false });
  assert.equal(await page.locator("#mobile-gesture-guide").count(), 0, "the guide must not cover difficulty selection");
  await chooseNormal();
  const firstGuideState = await snapshot();
  assert.equal(firstGuideState.mode, "paused", "first-use onboarding must pause immediately");
  assert.ok(firstGuideState.active, "the selected game must spawn a visible piece behind onboarding");
  await page.waitForTimeout(180);
  assert.deepEqual((await snapshot()).active, firstGuideState.active, "the active piece must freeze behind onboarding");
  assert.deepEqual(
    await page.locator(".gesture-guide-row").allTextContents(),
    ["Swipe arcOrbit", "TapRotate clockwise", "Swipe inSoft drop", "Flick inHard drop"],
  );
  await page.locator(".gesture-guide-card").click({ position: { x: 20, y: 20 } });
  assert.equal(await page.locator("#mobile-gesture-guide").count(), 1, "taps inside the guide must not dismiss it");
  const blockedState = await snapshot();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press(" ");
  assert.deepEqual((await snapshot()).active, blockedState.active, "gameplay keys must be suppressed while onboarding is open");
  await clickGuideBackdrop();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "playing");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), GUIDE_KEY), "seen");
  assert.equal(await page.locator("#mobile-gesture-guide").count(), 0);

  await page.reload();
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.waitForTimeout(40);
  await chooseNormal();
  assert.equal(await page.locator("#mobile-gesture-guide").count(), 0, "dismissal must persist across reloads");
  assert.equal((await snapshot()).mode, "playing");

  // Old visible controllers and stale mobile hint are gone; browser-scroll constraints remain intact.
  assert.equal(await page.locator(".mobile-controller, .mobile-polar-control, .mobile-orbit-rail, #mobile-nudge").count(), 0);
  assert.equal(await page.getByText(/Spin clockwise, pull up to rotate/i).count(), 0);
  assert.equal(await page.locator(".game-canvas").evaluate((node) => getComputedStyle(node).touchAction), "none");
  const rootScrolling = await page.evaluate(() => ({
    htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    htmlOverscrollY: getComputedStyle(document.documentElement).overscrollBehaviorY,
  }));
  assert.equal(rootScrolling.htmlOverflowY, "auto");
  assert.equal(rootScrolling.bodyOverflowY, "auto");
  assert.equal(rootScrolling.htmlOverscrollY, "auto");

  // Tap is clockwise-only and exactly one turn.
  await startFresh();
  const tapBefore = await snapshot();
  await tapBoard(10);
  const tapAfter = await snapshot();
  assert.equal(tapAfter.active.rotation, (tapBefore.active.rotation + 1) % 4, "a board tap must rotate clockwise once");

  // Tangential swipes orbit relatively in both directions in 22px steps.
  await startFresh();
  const clockwiseStart = (await snapshot()).active.sector;
  await swipeArc(1, 11);
  const clockwiseEnd = (await snapshot()).active.sector;
  assert.equal((clockwiseEnd - clockwiseStart + 16) % 16, 3, "clockwise arc should apply three relative orbit steps");
  await swipeArc(-1, 12, 50);
  const counterclockwiseEnd = (await snapshot()).active.sector;
  assert.equal((counterclockwiseEnd - clockwiseEnd + 16) % 16, 14, "counterclockwise arc should apply two reverse steps");

  // Deliberate inward motion converts to stepped soft-drop commands.
  await startFresh();
  const softGeometry = await canvasGeometry();
  const softStart = { x: softGeometry.cx + softGeometry.radius, y: softGeometry.cy };
  const softEnd = { x: softStart.x - 50, y: softStart.y };
  const softBefore = await snapshot();
  await dispatch(".game-canvas", "pointerdown", 20, softStart);
  await page.waitForTimeout(130);
  await dispatch(".game-canvas", "pointermove", 20, softEnd);
  await page.waitForTimeout(30);
  await dispatch(".game-canvas", "pointerup", 20, softEnd);
  const softAfter = await snapshot();
  assert.equal(softAfter.score - softBefore.score, 2, "50px of deliberate inward drag must apply two rewarded soft steps");
  assert.equal(softAfter.active.ring, softBefore.active.ring - 2);

  // A qualifying inward flick hard-drops once and cannot spill into the next piece.
  await startFresh();
  const hardGeometry = await canvasGeometry();
  const hardStart = { x: hardGeometry.cx + hardGeometry.radius, y: hardGeometry.cy };
  const hardEnd = { x: hardStart.x - 72, y: hardStart.y };
  await dispatch(".game-canvas", "pointerdown", 21, hardStart);
  await dispatch(".game-canvas", "pointermove", 21, hardEnd);
  await dispatch(".game-canvas", "pointerup", 21, hardEnd);
  await page.waitForTimeout(40);
  const hardAfter = await snapshot();
  assert.ok(hardAfter.occupiedByRing.some((count) => count > 0), "a fast 72px inward flick must lock the piece");
  const nextPieceAfterHardDrop = JSON.stringify(hardAfter.active);
  const scoreAfterHardDrop = hardAfter.score;
  await page.waitForTimeout(220);
  const hardSettled = await snapshot();
  assert.equal(JSON.stringify(hardSettled.active), nextPieceAfterHardDrop, "hard drop must happen exactly once");
  assert.equal(hardSettled.score, scoreAfterHardDrop, "hard-drop input must not leak into the next piece");

  // Outward and unresolved diagonal movement do nothing.
  await startFresh();
  const ignoredGeometry = await canvasGeometry();
  const ignoredStart = { x: ignoredGeometry.cx + ignoredGeometry.radius, y: ignoredGeometry.cy };
  const ignoredBefore = await snapshot();
  await dispatch(".game-canvas", "pointerdown", 30, ignoredStart);
  await dispatch(".game-canvas", "pointermove", 30, { x: ignoredStart.x + 34, y: ignoredStart.y });
  await dispatch(".game-canvas", "pointerup", 30, { x: ignoredStart.x + 34, y: ignoredStart.y });
  assert.deepEqual((await snapshot()).active, ignoredBefore.active, "outward motion must be ignored");
  await dispatch(".game-canvas", "pointerdown", 31, ignoredStart);
  await dispatch(".game-canvas", "pointermove", 31, { x: ignoredStart.x - 10, y: ignoredStart.y + 10 });
  await dispatch(".game-canvas", "pointerup", 31, { x: ignoredStart.x - 10, y: ignoredStart.y + 10 });
  assert.deepEqual((await snapshot()).active, ignoredBefore.active, "sub-threshold ambiguous movement must not become a tap or command");

  // Only the primary pointer is accepted.
  await startFresh();
  const multiGeometry = await canvasGeometry();
  const multiPoint = { x: multiGeometry.cx + multiGeometry.radius, y: multiGeometry.cy };
  const multiBefore = await snapshot();
  await dispatch(".game-canvas", "pointerdown", 40, multiPoint);
  await dispatch(".game-canvas", "pointerdown", 41, multiPoint, { isPrimary: false });
  await dispatch(".game-canvas", "pointerup", 41, multiPoint, { isPrimary: false });
  await dispatch(".game-canvas", "pointercancel", 40, multiPoint);
  assert.deepEqual((await snapshot()).active, multiBefore.active, "extra fingers must be ignored until the primary pointer ends");

  // Failed pointer capture still receives off-target release, and a pointer ID can be reused.
  await startFresh();
  await failPointerCapture();
  const captureGeometry = await canvasGeometry();
  const captureStart = { x: captureGeometry.cx + captureGeometry.radius, y: captureGeometry.cy };
  const captureAngle = 48 / captureGeometry.radius;
  const captureEnd = {
    x: captureGeometry.cx + Math.cos(captureAngle) * captureGeometry.radius,
    y: captureGeometry.cy + Math.sin(captureAngle) * captureGeometry.radius,
  };
  await dispatch(".game-canvas", "pointerdown", 50, captureStart);
  await dispatch(".game-canvas", "pointermove", 50, captureEnd);
  await page.waitForTimeout(25);
  await dispatch("body", "pointerup", 50, captureEnd);
  const stoppedAfterBodyRelease = await snapshot();
  await page.waitForTimeout(120);
  assert.deepEqual((await snapshot()).active, stoppedAfterBodyRelease.active, "off-target release must stop a failed-capture gesture");
  const reusedBefore = await snapshot();
  await tapBoard(50);
  assert.equal((await snapshot()).active.rotation, (reusedBefore.active.rotation + 1) % 4, "released pointer IDs must be reusable");

  // Blur, pause, and restart cancel buffered movement.
  await startFresh();
  const cancelGeometry = await canvasGeometry();
  const cancelStart = { x: cancelGeometry.cx + cancelGeometry.radius, y: cancelGeometry.cy };
  const cancelCandidate = { x: cancelStart.x - 30, y: cancelStart.y };
  const blurBefore = await snapshot();
  await dispatch(".game-canvas", "pointerdown", 60, cancelStart);
  await dispatch(".game-canvas", "pointermove", 60, cancelCandidate);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(220);
  await dispatch("body", "pointerup", 60, cancelCandidate);
  assert.deepEqual((await snapshot()).active, blurBefore.active, "blur must discard a buffered hard-drop candidate");

  const pauseBefore = await snapshot();
  await dispatch(".game-canvas", "pointerdown", 61, cancelStart);
  await dispatch(".game-canvas", "pointermove", 61, cancelCandidate);
  await page.locator("#mobile-pause").click();
  await dispatch("body", "pointerup", 61, cancelCandidate);
  assert.equal((await snapshot()).mode, "paused");
  assert.deepEqual((await snapshot()).active, pauseBefore.active, "pause must cancel buffered mobile input");
  await page.getByRole("button", { name: "Resume" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "playing");

  await dispatch(".game-canvas", "pointerdown", 62, cancelStart);
  await dispatch(".game-canvas", "pointermove", 62, cancelCandidate);
  await page.locator("#mobile-new-game").click();
  const restartState = await snapshot();
  await dispatch("body", "pointerup", 62, cancelCandidate);
  await page.waitForTimeout(220);
  assert.deepEqual((await snapshot()).active, restartState.active, "restart must prevent the previous gesture from reaching the new piece");
  assert.equal((await snapshot()).score, restartState.score);

  // Piece-lock cancellation prevents a long drag from carrying into its successor.
  await startFresh();
  const lockGeometry = await canvasGeometry();
  const lockStart = { x: lockGeometry.right + 34, y: lockGeometry.cy };
  const lockEnd = { x: lockGeometry.cx, y: lockGeometry.cy };
  await dispatch(".game-canvas", "pointerdown", 70, lockStart);
  await page.waitForTimeout(130);
  await dispatch(".game-canvas", "pointermove", 70, lockEnd);
  await page.waitForTimeout(100);
  const locked = await snapshot();
  assert.ok(locked.occupiedByRing.some((count) => count > 0), "a long deliberate drag must eventually lock the piece");
  const successor = JSON.stringify(locked.active);
  const lockedScore = locked.score;
  await dispatch(".game-canvas", "pointermove", 70, { x: lockGeometry.cx - 60, y: lockGeometry.cy });
  await dispatch("body", "pointerup", 70, { x: lockGeometry.cx - 60, y: lockGeometry.cy });
  await page.waitForTimeout(180);
  assert.equal(JSON.stringify((await snapshot()).active), successor, "piece-boundary cancellation must protect the successor");
  assert.equal((await snapshot()).score, lockedScore);

  // Help has a compact visual with a 44px target, pauses immediately, and dismisses from the backdrop.
  await startFresh();
  const help = page.getByRole("button", { name: "Show mobile gesture guide" });
  const helpBounds = await help.boundingBox();
  assert.ok(helpBounds.width >= 44 && helpBounds.height >= 44, `help target must be at least 44px: ${JSON.stringify(helpBounds)}`);
  await help.click();
  assert.equal((await snapshot()).mode, "paused");
  assert.equal(await page.locator("#mobile-gesture-guide").count(), 1);
  assert.equal(await page.locator("#mobile-pause").isVisible(), false, "system controls must be obscured while help is open");
  const helpBlocked = await snapshot();
  await page.keyboard.press("ArrowLeft");
  assert.deepEqual((await snapshot()).active, helpBlocked.active);
  await clickGuideBackdrop();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "playing");

  // Escape is the accessible dismissal path.
  await help.click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "playing");
  assert.equal(await page.locator("#mobile-gesture-guide").count(), 0);

  // The 15-second timer counts foreground-visible time and resumes exactly once.
  await help.click();
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__testVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => window.__testVisibilityState,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(900);
  assert.equal(await page.locator("#mobile-gesture-guide").count(), 1, "hidden time must not count toward help timeout");
  await page.evaluate(() => {
    window.__testVisibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(13_900);
  assert.equal(await page.locator("#mobile-gesture-guide").count(), 1, "help must remain for 15 seconds of foreground time");
  await page.waitForTimeout(700);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "playing");
  assert.equal(await page.locator("#mobile-gesture-guide").count(), 0, "help must auto-close after 15 foreground seconds");
  const resumedOnce = await snapshot();
  await page.waitForTimeout(220);
  assert.equal((await snapshot()).mode, "playing");
  assert.equal((await snapshot()).gameId, resumedOnce.gameId, "auto-close must resume without restarting");

  // Ready/playing/paused keep the demand-driven render loop behavior.
  await openReady({ guideSeen: true });
  await page.waitForTimeout(150);
  const readyFrames = await page.evaluate(() => window.__mobileTestRafCount);
  await page.waitForTimeout(220);
  assert.ok(
    await page.evaluate((before) => window.__mobileTestRafCount - before <= 1, readyFrames),
    "ready mode must not run a continuous game RAF loop",
  );
  await chooseNormal();
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

  assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
  console.log("mobile gesture and onboarding regression passed");
} finally {
  await browser.close();
}
