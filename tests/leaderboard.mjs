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
  }),
});
assert.equal(seedResultResponse.status, 201);

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
  await page.getByText(seedName, { exact: true }).waitFor();
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
  await page.evaluate(() => window.advanceTime(120000));
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "gameover");
  await page.getByText("Leaderboard updated", { exact: true }).waitFor();
  assert.equal(resultRequests, 1, "one completed game should submit exactly one result request");

  const gameState = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  assert.equal(gameState.mode, "gameover");
  assert.ok(gameState.playTimeMs > 0);
  await page.screenshot({ path: `${outputDir}/mobile-gameover-saved.png`, fullPage: true });

  await page.getByRole("button", { name: "Leaderboard" }).click();
  await leaderboard.waitFor();
  const playerRow = leaderboard.locator("tbody tr").filter({ hasText: playerName }).first();
  await playerRow.waitFor();
  assert.equal(await playerRow.locator("td").last().textContent(), "1");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${outputDir}/desktop-leaderboard.png`, fullPage: true });
  assert.deepEqual(errors, []);
} finally {
  await context.close();
  await browser.close();
}

console.log(JSON.stringify({ playerName, resultRequests, errors }, null, 2));
