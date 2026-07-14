import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:8788";
const outputDir = "output/web-game/leaderboard-e2e";
const suffix = Date.now().toString().slice(-4);
const playerName = `Codex Pilot ${suffix}`;
const seedName = `Seed Pilot ${suffix}`;

const seedProfileResponse = await fetch(`${baseUrl}/api/profile`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: seedName }),
});
assert.equal(seedProfileResponse.status, 201);
const seedCookie = seedProfileResponse.headers.get("set-cookie")?.split(";", 1)[0];
assert.ok(seedCookie);
const seedResultResponse = await fetch(`${baseUrl}/api/results`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: seedCookie },
  body: JSON.stringify({
    gameId: crypto.randomUUID(),
    rings: 4,
    score: 600,
    playMs: 60000,
    difficulty: "normal",
    endedReason: "gameover",
  }),
});
assert.equal(seedResultResponse.status, 201);
const seedZeroRingResponse = await fetch(`${baseUrl}/api/results`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: seedCookie },
  body: JSON.stringify({
    gameId: crypto.randomUUID(),
    rings: 0,
    score: 8,
    playMs: 120000,
    difficulty: "normal",
    endedReason: "restart",
  }),
});
assert.equal(seedZeroRingResponse.status, 201);

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
let resultRequests = 0;

page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (request.method() === "POST" && new URL(request.url()).pathname === "/api/results") resultRequests += 1;
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const nameDialog = page.getByRole("dialog", { name: "Choose your callsign" });
  await nameDialog.waitFor();
  await page.screenshot({ path: `${outputDir}/mobile-name-dialog.png`, fullPage: true });

  await page.getByLabel("Player name").fill(playerName);
  await page.getByRole("button", { name: "Lock callsign" }).click();
  await nameDialog.waitFor({ state: "hidden" });

  const cookies = await context.cookies(baseUrl);
  const identityCookie = cookies.find((cookie) => cookie.name === "rt_player");
  assert.ok(identityCookie, "anonymous player cookie should be created");
  assert.equal(identityCookie.httpOnly, true);
  assert.equal(identityCookie.sameSite, "Lax");

  await page.getByRole("button", { name: "Leaderboard" }).click();
  const leaderboard = page.getByRole("dialog", { name: "Leaderboard" });
  await leaderboard.waitFor();
  const seedRow = leaderboard.locator("tbody tr").filter({ hasText: seedName }).first();
  await seedRow.waitFor();
  assert.equal(await seedRow.locator("td").nth(2).textContent(), "4.00", "zero-ring games must not lower the average");
  assert.equal(await seedRow.locator("td").last().textContent(), "2", "all games must remain in the game count");
  await page.screenshot({ path: `${outputDir}/mobile-leaderboard.png`, fullPage: true });
  await leaderboard.getByRole("tab", { name: "Average" }).click();
  await leaderboard.getByRole("tab", { name: "Time" }).click();
  await leaderboard.getByRole("tab", { name: "Max rings" }).click();
  await leaderboard.getByRole("button", { name: `${playerName} · edit` }).click();
  await nameDialog.waitFor();
  assert.equal(await page.getByLabel("Player name").inputValue(), playerName);
  await nameDialog.getByRole("button", { name: "Cancel" }).click();
  await nameDialog.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: /Normal/ }).click();
  await page.evaluate(() => window.advanceTime(2000));
  const restartResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/results"
  ));
  await page.locator("#mobile-new-game").click();
  assert.equal((await restartResponsePromise).status(), 201);
  assert.equal(resultRequests, 1, "a short restarted game should submit exactly one result request");
  const restartedState = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  assert.equal(restartedState.mode, "playing");
  assert.ok(restartedState.playTimeMs < 100, "a restart should begin a fresh active-time counter");

  await page.evaluate(() => window.advanceTime(120000));
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "gameover");
  await page.getByText("Leaderboard updated", { exact: true }).waitFor();
  assert.equal(resultRequests, 2, "each restarted or completed game should submit exactly one result request");

  const gameState = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  assert.equal(gameState.mode, "gameover");
  assert.ok(gameState.playTimeMs > 0);
  await page.screenshot({ path: `${outputDir}/mobile-gameover-saved.png`, fullPage: true });

  await page.getByRole("button", { name: "Leaderboard" }).click();
  await leaderboard.waitFor();
  const playerRow = leaderboard.locator("tbody tr").filter({ hasText: playerName }).first();
  await playerRow.waitFor();
  assert.equal(await playerRow.locator("td").last().textContent(), "2");

  await leaderboard.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Recalibrate" }).click();
  await page.evaluate(() => window.advanceTime(2000));
  const requestsBeforeExit = resultRequests;
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".player-callsign").waitFor({ state: "attached", timeout: 10000 });
  await page.locator(".leaderboard-trigger").click();
  await leaderboard.waitFor();
  const reloadedPlayerRow = leaderboard.locator("tbody tr").filter({ hasText: playerName }).first();
  await reloadedPlayerRow.waitFor();
  await page.waitForFunction((name) => {
    const row = [...document.querySelectorAll("tbody tr")].find((candidate) => candidate.textContent.includes(name));
    return row?.lastElementChild?.textContent === "3";
  }, playerName, { timeout: 10000 });
  const exitRequests = resultRequests - requestsBeforeExit;
  assert.ok(exitRequests >= 1 && exitRequests <= 2, "page exit should send once, with at most one idempotent recovery retry");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${outputDir}/desktop-leaderboard.png`, fullPage: true });
  assert.deepEqual(errors, []);
} finally {
  await context.close();
  await browser.close();
}

console.log(JSON.stringify({ playerName, resultRequests, errors }, null, 2));
