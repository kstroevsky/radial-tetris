const SORT_ORDERS = Object.freeze({
  max: "max_rings DESC, average_rings DESC, games_count DESC, updated_at ASC",
  average: "average_rings DESC, max_rings DESC, games_count DESC, updated_at ASC",
  time: "total_play_ms DESC, max_rings DESC, updated_at ASC",
});

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function leaderboardSort(value) {
  return Object.hasOwn(SORT_ORDERS, value) ? value : "max";
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "Leaderboard database is unavailable" }, { status: 503 });
  const sort = leaderboardSort(new URL(request.url).searchParams.get("sort"));

  try {
    const result = await env.DB.prepare(`
      SELECT
        name,
        games_count,
        ring_games_count,
        max_rings,
        ROUND(CAST(total_rings AS REAL) / NULLIF(ring_games_count, 0), 2) AS average_rings,
        total_play_ms,
        best_score,
        updated_at
      FROM players
      WHERE games_count > 0
      ORDER BY ${SORT_ORDERS[sort]}
      LIMIT 50
    `).all();

    const players = result.results.map((player) => ({
      name: player.name,
      gamesCount: Number(player.games_count),
      maxRings: Number(player.max_rings),
      averageRings: Number(player.average_rings),
      totalPlayMs: Number(player.total_play_ms),
      bestScore: Number(player.best_score),
    }));
    return json({ sort, players });
  } catch (error) {
    console.error("Unable to load leaderboard", error);
    return json({ error: "Unable to load leaderboard" }, { status: 500 });
  }
}
