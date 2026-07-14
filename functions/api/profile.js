const PLAYER_COOKIE = "rt_player";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 1024;

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

export function normalizePlayerName(value) {
  if (typeof value !== "string") return null;
  const name = value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
  const length = [...name].length;
  return length >= 1 && length <= 24 ? name : null;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "Leaderboard database is unavailable" }, { status: 503 });
  const playerId = playerIdFromRequest(request);
  if (!playerId) return json({ player: null });

  try {
    const player = await env.DB.prepare(
      "SELECT name FROM players WHERE id = ? LIMIT 1",
    ).bind(playerId).first();
    return json({ player: player ? { name: player.name } : null });
  } catch (error) {
    console.error("Unable to load player profile", error);
    return json({ error: "Unable to load player profile" }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "Leaderboard database is unavailable" }, { status: 503 });
  const body = await readJson(request);
  if (body.error) return body.error;
  const name = normalizePlayerName(body.value?.name);
  if (!name) return json({ error: "Name must contain 1–24 visible characters" }, { status: 400 });

  const cookiePlayerId = playerIdFromRequest(request);
  const now = Date.now();

  try {
    if (cookiePlayerId) {
      const existing = await env.DB.prepare(
        "SELECT id FROM players WHERE id = ? LIMIT 1",
      ).bind(cookiePlayerId).first();
      if (existing) {
        await env.DB.prepare(
          "UPDATE players SET name = ?, updated_at = ? WHERE id = ?",
        ).bind(name, now, cookiePlayerId).run();
        return json({ player: { name } });
      }
    }

    const playerId = crypto.randomUUID();
    const secureAttribute = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    await env.DB.prepare(
      "INSERT INTO players (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).bind(playerId, name, now, now).run();
    return json(
      { player: { name } },
      {
        status: 201,
        headers: {
          "set-cookie": `${PLAYER_COOKIE}=${playerId}; Path=/; Max-Age=31536000; HttpOnly${secureAttribute}; SameSite=Lax`,
        },
      },
    );
  } catch (error) {
    console.error("Unable to save player profile", error);
    return json({ error: "Unable to save player profile" }, { status: 500 });
  }
}
