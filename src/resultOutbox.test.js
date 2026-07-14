import test from "node:test";
import assert from "node:assert/strict";

import {
  RESULT_OUTBOX_KEY,
  gameResultFrom,
  pendingGameResults,
  queueGameResult,
  removePendingGameResult,
} from "./resultOutbox.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("creates results only for games with active play time", () => {
  const game = {
    gameId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    mode: "playing",
    ringsCleared: 0,
    score: 8,
    playTimeMs: 2400.4,
    difficulty: "normal",
  };

  assert.deepEqual(gameResultFrom(game, "restart"), {
    gameId: game.gameId,
    rings: 0,
    score: 8,
    playMs: 2400,
    difficulty: "normal",
    endedReason: "restart",
  });
  assert.equal(gameResultFrom({ ...game, mode: "ready" }, "restart"), null);
  assert.equal(gameResultFrom({ ...game, playTimeMs: 0 }, "restart"), null);
  assert.equal(gameResultFrom(game, "unknown"), null);
});

test("keeps one locally retryable snapshot per game id", () => {
  const storage = new MemoryStorage();
  const first = { gameId: "game-1", rings: 0, playMs: 1000, endedReason: "pagehide" };
  const final = { ...first, rings: 2, playMs: 5000, endedReason: "gameover" };

  assert.equal(queueGameResult(first, storage), true);
  assert.equal(queueGameResult(final, storage), true);
  assert.deepEqual(pendingGameResults(storage), [final]);

  removePendingGameResult(first.gameId, storage);
  assert.deepEqual(pendingGameResults(storage), []);
  assert.equal(storage.getItem(RESULT_OUTBOX_KEY), null);
});
