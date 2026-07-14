import test from "node:test";
import assert from "node:assert/strict";

import {
  RINGS,
  SECTORS,
  createGame,
  gameSnapshot,
  hardDrop,
  levelForRings,
  makeBoard,
} from "./gameEngine.js";

test("stretches the former 20-ring progression milestone to 100 rings", () => {
  assert.equal(levelForRings(0), 1);
  assert.equal(levelForRings(19), 1);
  assert.equal(levelForRings(20), 2);
  assert.equal(levelForRings(99), 5);
  assert.equal(levelForRings(100), 6);

  const game = createGame();
  game.level = levelForRings(20);
  assert.equal(gameSnapshot(game).fallInterval, 0.75);
  game.level = levelForRings(100);
  assert.ok(Math.abs(gameSnapshot(game).fallInterval - 0.47) < Number.EPSILON);
});

test("applies the slower progression after real ring clears", () => {
  const game = createGame();
  game.mode = "playing";

  for (let cleared = 1; cleared <= 100; cleared += 1) {
    game.board = makeBoard();
    for (let sector = 4; sector < SECTORS; sector += 1) game.board[0][sector] = "O";
    game.active = { type: "I", sector: 1, ring: RINGS - 2, rotation: 0, entrySector: 1 };
    hardDrop(game);

    if (cleared === 20) {
      assert.equal(game.ringsCleared, 20);
      assert.equal(game.level, 2);
      assert.equal(gameSnapshot(game).fallInterval, 0.75);
    }
  }

  assert.equal(game.ringsCleared, 100);
  assert.equal(game.level, 6);
  assert.ok(Math.abs(gameSnapshot(game).fallInterval - 0.47) < Number.EPSILON);
});
