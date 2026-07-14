PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 24),
  games_count INTEGER NOT NULL DEFAULT 0 CHECK (games_count >= 0),
  total_rings INTEGER NOT NULL DEFAULT 0 CHECK (total_rings >= 0),
  max_rings INTEGER NOT NULL DEFAULT 0 CHECK (max_rings >= 0),
  total_play_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_play_ms >= 0),
  best_score INTEGER NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_results (
  game_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  rings INTEGER NOT NULL CHECK (rings >= 0),
  score INTEGER NOT NULL CHECK (score >= 0),
  play_ms INTEGER NOT NULL CHECK (play_ms >= 0),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'normal', 'hard')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS game_results_player_id ON game_results(player_id);
