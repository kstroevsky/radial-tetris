const PLAYER_COOKIE = "rt_player";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIFFICULTIES = new Set(["easy", "normal", "hard"]);
const MAX_BODY_BYTES = 2048;

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function playerIdFromRequest(request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === PLAYER_COOKIE) {
      const value = valueParts.join("=");
      return UUID_PATTERN.test(value) ? value : null;
    }
  }
  return null;
}

async function readJson(request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return { error: json({ error: "Content-Type must be application/json" }, { status: 415 }) };
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return { error: json({ error: "Request body is too large" }, { status: 413 }) };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { error: json({ error: "Request body is too large" }, { status: 413 }) };
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}

export function validateGameResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { gameId, rings, score, playMs, difficulty } = value;
  if (!UUID_PATTERN.test(gameId ?? "")) return null;
  if (!Number.isInteger(rings) || rings < 0 || rings > 100000) return null;
  if (!Number.isInteger(score) || score < 0 || score > 1000000000) return null;
  if (!Number.isInteger(playMs) || playMs < 0 || playMs > 86400000) return null;
  if (!DIFFICULTIES.has(difficulty)) return null;
  if (rings > 20 + Math.ceil(playMs / 500)) return null;
  return { gameId, rings, score, playMs, difficulty };
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "Leaderboard database is unavailable" }, { status: 503 });
  const playerId = playerIdFromRequest(request);
  if (!playerId) return json({ error: "Player profile required" }, { status: 401 });

  const body = await readJson(request);
  if (body.error) return body.error;
  const result = validateGameResult(body.value);
  if (!result) return json({ error: "Invalid game result" }, { status: 400 });

  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO game_results (game_id, player_id, rings, score, play_ms, difficulty, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(result.gameId, playerId, result.rings, result.score, result.playMs, result.difficulty, now),
      env.DB.prepare(
        "UPDATE players SET games_count = games_count + 1, total_rings = total_rings + ?, max_rings = MAX(max_rings, ?), total_play_ms = total_play_ms + ?, best_score = MAX(best_score, ?), updated_at = ? WHERE id = ?",
      ).bind(result.rings, result.rings, result.playMs, result.score, now, playerId),
    ]);
    return json({ accepted: true, duplicate: false }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed: game_results.game_id")) {
      return json({ accepted: true, duplicate: true });
    }
    if (message.includes("FOREIGN KEY constraint failed")) {
      return json({ error: "Player profile required" }, { status: 401 });
    }
    console.error("Unable to save game result", error);
    return json({ error: "Unable to save game result" }, { status: 500 });
  }
}
