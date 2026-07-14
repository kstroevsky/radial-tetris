# Leaderboard setup

The leaderboard uses the existing Cloudflare Pages project, three Pages Functions under `functions/api/`, and one D1 binding named `DB`. Static files remain outside the Functions invocation routes through `public/_routes.json`.

## Production

1. In Cloudflare, create a D1 database named `radial-tetris-leaderboard`.
2. Open that database's Console and run [`migrations/0001_leaderboard.sql`](migrations/0001_leaderboard.sql), followed by [`migrations/0002_all_games_metrics.sql`](migrations/0002_all_games_metrics.sql).
3. Open the `radial-tetris` Pages project, then go to **Settings → Bindings → Add → D1 database**.
4. Set the variable name to `DB` and select `radial-tetris-leaderboard`. Add it to both Production and Preview if preview deployments should use the leaderboard.
5. Redeploy after adding the binding.

For an existing leaderboard database that already has `0001_leaderboard.sql`, run only `0002_all_games_metrics.sql` before deploying this version. It backfills the eligible average-game count from the retained raw results.

For Git-connected Pages projects, the next deployment will include the root `functions/` directory automatically. For the current Direct Upload workflow, build and deploy from the repository root with:

```sh
npm run build
npx wrangler pages deploy dist --project-name radial-tetris
```

Pages Functions cannot be deployed through a dashboard drag-and-drop upload.

## Local Pages + D1 development

Copy `wrangler.local.example.jsonc` to a temporary local config, replace the example database ID with the ID returned by Cloudflare, and then run:

```sh
npm run build
npx wrangler d1 execute radial-tetris-leaderboard --config wrangler.local.jsonc --local --file migrations/0001_leaderboard.sql
npx wrangler d1 execute radial-tetris-leaderboard --config wrangler.local.jsonc --local --file migrations/0002_all_games_metrics.sql
npx wrangler pages dev dist --d1 DB=<DATABASE_ID>
```

Plain `npm run dev` intentionally keeps the leaderboard offline; this preserves the fast Vite-only game loop without generating `/api/*` errors. Use Pages dev when testing profile, cookie, D1, or leaderboard behavior.

## Stored data and request behavior

- `rt_player` contains only a random player UUID and is `HttpOnly`, `Secure` in production, `SameSite=Lax`, and valid for one year.
- The player's name and aggregate statistics live in `players`.
- Each finalized game's UUID, end reason, and raw result live in `game_results`, preventing a repeated request from incrementing totals twice.
- Average rings includes only games that cleared at least one ring. Maximum rings still considers every game.
- Active time includes every started game and excludes pauses and hidden-tab time.
- The client does not poll. It submits once at game-over, before restart, or on page exit. A small local outbox retries an interrupted exit submission on the next visit.
- Results remain trust-based because the game simulation runs in the browser. The API applies type, range, UUID, difficulty, body-size, and basic rate validation.
