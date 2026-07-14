import test from "node:test";
import assert from "node:assert/strict";

import { leaderboardSort, onRequestGet as getLeaderboard } from "../functions/api/leaderboard.js";
import { normalizePlayerName, onRequestGet as getProfile, onRequestPost as saveProfile } from "../functions/api/profile.js";
import { onRequestPost as saveResult, validateGameResult } from "../functions/api/results.js";

const PLAYER_ID = "123e4567-e89b-42d3-a456-426614174000";
const GAME_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const ZERO_RING_GAME_ID = "9ad5e4c8-4402-4dd5-a125-9e8903e6722d";

function jsonRequest(url, body, cookie) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

class ProfileDatabase {
  constructor() {
    this.players = new Map();
  }

  prepare(sql) {
    return {
      bind: (...values) => ({
        first: async () => {
          const id = values[0];
          const player = this.players.get(id);
          if (!player) return null;
          return sql.includes("SELECT id") ? { id } : { name: player.name };
        },
        run: async () => {
          if (sql.startsWith("INSERT")) {
            this.players.set(values[0], { name: values[1] });
          } else if (sql.startsWith("UPDATE")) {
            this.players.set(values[2], { name: values[0] });
          }
          return { success: true };
        },
      }),
    };
  }
}

class ResultsDatabase {
  constructor() {
    this.players = new Map([[PLAYER_ID, {
      games: 0,
      ringGames: 0,
      totalRings: 0,
      maxRings: 0,
      playMs: 0,
      bestScore: 0,
    }]]);
    this.gameIds = new Set();
    this.batchSizes = [];
  }

  prepare(sql) {
    return { bind: (...values) => ({ sql, values }) };
  }

  async batch(statements) {
    this.batchSizes.push(statements.length);
    const [insert, update] = statements;
    if (this.gameIds.has(insert.values[0])) throw new Error("UNIQUE constraint failed: game_results.game_id");
    if (!this.players.has(insert.values[1])) throw new Error("FOREIGN KEY constraint failed");
    this.gameIds.add(insert.values[0]);
    const player = this.players.get(update.values[6]);
    player.games += 1;
    player.ringGames += update.values[0];
    player.totalRings += update.values[1];
    player.maxRings = Math.max(player.maxRings, update.values[2]);
    player.playMs += update.values[3];
    player.bestScore = Math.max(player.bestScore, update.values[4]);
    return [{ success: true }, { success: true }];
  }
}

test("normalizes player names and persists an anonymous cookie profile", async () => {
  assert.equal(normalizePlayerName("  An\u0000na  "), "Anna");
  assert.equal(normalizePlayerName(""), null);
  assert.equal(normalizePlayerName("x".repeat(25)), null);

  const DB = new ProfileDatabase();
  const createResponse = await saveProfile({
    request: jsonRequest("https://game.test/api/profile", { name: "  Anna  " }),
    env: { DB },
  });
  assert.equal(createResponse.status, 201);
  const cookie = createResponse.headers.get("set-cookie");
  assert.match(cookie, /^rt_player=[0-9a-f-]{36};/i);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);

  const cookiePair = cookie.split(";", 1)[0];
  const profileResponse = await getProfile({
    request: new Request("https://game.test/api/profile", { headers: { cookie: cookiePair } }),
    env: { DB },
  });
  assert.deepEqual(await profileResponse.json(), { player: { name: "Anna" } });

  const updateResponse = await saveProfile({
    request: jsonRequest("https://game.test/api/profile", { name: "Nova" }, cookiePair),
    env: { DB },
  });
  assert.equal(updateResponse.status, 200);
  assert.deepEqual(await updateResponse.json(), { player: { name: "Nova" } });
});

test("validates results and aggregates a game id only once", async () => {
  const valid = {
    gameId: GAME_ID,
    rings: 12,
    score: 18450,
    playMs: 286400,
    difficulty: "normal",
    endedReason: "gameover",
  };
  assert.deepEqual(validateGameResult(valid), valid);
  const { endedReason: _reason, ...legacy } = valid;
  assert.deepEqual(validateGameResult(legacy), valid);
  assert.equal(validateGameResult({ ...valid, rings: 999999 }), null);
  assert.equal(validateGameResult({ ...valid, difficulty: "nightmare" }), null);
  assert.equal(validateGameResult({ ...valid, endedReason: "quit" }), null);

  const DB = new ResultsDatabase();
  const context = () => ({
    request: jsonRequest("https://game.test/api/results", valid, `rt_player=${PLAYER_ID}`),
    env: { DB },
  });
  const first = await saveResult(context());
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { accepted: true, duplicate: false });

  const duplicate = await saveResult(context());
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { accepted: true, duplicate: true });
  assert.deepEqual(DB.batchSizes, [2, 2]);
  assert.deepEqual(DB.players.get(PLAYER_ID), {
    games: 1,
    ringGames: 1,
    totalRings: 12,
    maxRings: 12,
    playMs: 286400,
    bestScore: 18450,
  });

  const zeroRingResult = {
    gameId: ZERO_RING_GAME_ID,
    rings: 0,
    score: 7,
    playMs: 2400,
    difficulty: "normal",
    endedReason: "restart",
  };
  const zeroRingResponse = await saveResult({
    request: jsonRequest("https://game.test/api/results", zeroRingResult, `rt_player=${PLAYER_ID}`),
    env: { DB },
  });
  assert.equal(zeroRingResponse.status, 201);
  assert.deepEqual(DB.players.get(PLAYER_ID), {
    games: 2,
    ringGames: 1,
    totalRings: 12,
    maxRings: 12,
    playMs: 288800,
    bestScore: 18450,
  });
});

test("uses only whitelisted leaderboard sort expressions", async () => {
  assert.equal(leaderboardSort("average"), "average");
  assert.equal(leaderboardSort("time"), "time");
  assert.equal(leaderboardSort("max_rings DESC; DROP TABLE players"), "max");

  let query = "";
  const DB = {
    prepare(sql) {
      query = sql;
      return {
        all: async () => ({
          results: [{ name: "Anna", games_count: 2, max_rings: 12, average_rings: 8.5, total_play_ms: 300000, best_score: 20000 }],
        }),
      };
    },
  };
  const response = await getLeaderboard({
    request: new Request("https://game.test/api/leaderboard?sort=time"),
    env: { DB },
  });
  assert.match(query, /ORDER BY total_play_ms DESC/);
  assert.match(query, /NULLIF\(ring_games_count, 0\)/);
  assert.deepEqual(await response.json(), {
    sort: "time",
    players: [{ name: "Anna", gamesCount: 2, maxRings: 12, averageRings: 8.5, totalPlayMs: 300000, bestScore: 20000 }],
  });
});
