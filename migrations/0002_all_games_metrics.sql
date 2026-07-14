ALTER TABLE players
  ADD COLUMN ring_games_count INTEGER NOT NULL DEFAULT 0 CHECK (ring_games_count >= 0);

ALTER TABLE game_results
  ADD COLUMN ended_reason TEXT NOT NULL DEFAULT 'gameover'
  CHECK (ended_reason IN ('gameover', 'restart', 'pagehide'));

UPDATE players
SET ring_games_count = (
  SELECT COUNT(*)
  FROM game_results
  WHERE game_results.player_id = players.id
    AND game_results.rings > 0
);
