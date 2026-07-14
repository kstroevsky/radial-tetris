export const RESULT_OUTBOX_KEY = "radial-tetris-result-outbox-v1";

const MAX_PENDING_RESULTS = 50;
const FINALIZABLE_MODES = new Set(["playing", "paused", "gameover"]);
const ENDED_REASONS = new Set(["gameover", "restart", "pagehide"]);

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function gameResultFrom(game, endedReason) {
  const playMs = Math.round(game?.playTimeMs ?? 0);
  if (!game || !FINALIZABLE_MODES.has(game.mode) || playMs <= 0 || !ENDED_REASONS.has(endedReason)) return null;
  return {
    gameId: game.gameId,
    rings: game.ringsCleared,
    score: game.score,
    playMs,
    difficulty: game.difficulty,
    endedReason,
  };
}

export function pendingGameResults(storage = defaultStorage()) {
  try {
    const value = JSON.parse(storage.getItem(RESULT_OUTBOX_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((result) => result && typeof result.gameId === "string") : [];
  } catch {
    return [];
  }
}

export function queueGameResult(result, storage = defaultStorage()) {
  try {
    const pending = pendingGameResults(storage).filter((item) => item.gameId !== result.gameId);
    pending.push(result);
    storage.setItem(RESULT_OUTBOX_KEY, JSON.stringify(pending.slice(-MAX_PENDING_RESULTS)));
    return true;
  } catch {
    return false;
  }
}

export function removePendingGameResult(gameId, storage = defaultStorage()) {
  try {
    const pending = pendingGameResults(storage).filter((result) => result.gameId !== gameId);
    if (pending.length > 0) storage.setItem(RESULT_OUTBOX_KEY, JSON.stringify(pending));
    else storage.removeItem(RESULT_OUTBOX_KEY);
  } catch {
    // The in-memory submission still succeeds when persistent storage is unavailable.
  }
}
