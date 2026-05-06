-- eBet-Turbo Supabase Migration
-- Futtasd le a Supabase Dashboard → SQL Editor-ban

-- 1. Betting journal (key-value store)
CREATE TABLE IF NOT EXISTS app_data (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Completed matches accumulator (msport)
CREATE TABLE IF NOT EXISTS completed_matches (
  event_id   TEXT PRIMARY KEY,
  player_a   TEXT NOT NULL,
  player_b   TEXT NOT NULL,
  team_a     TEXT DEFAULT '',
  team_b     TEXT DEFAULT '',
  score_a    INTEGER NOT NULL,
  score_b    INTEGER NOT NULL,
  start_time BIGINT NOT NULL,
  league     TEXT NOT NULL,
  date       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index a 3 napos szűréshez
CREATE INDEX IF NOT EXISTS idx_completed_matches_start_time ON completed_matches(start_time);
