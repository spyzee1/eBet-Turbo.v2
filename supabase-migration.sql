-- eBet-Turbo Supabase Migration
-- Futtasd le a Supabase Dashboard → SQL Editor-ban

-- 1. Betting journal (key-value store) — server-only, írás/olvasás csak service keyjel
CREATE TABLE IF NOT EXISTS app_data (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app_data ENABLE ROW LEVEL SECURITY;
-- Nincs policy → minden anon/authenticated kliens-hozzáférés tiltva, service key bypasselja

-- 2. Completed matches accumulator (msport) — server-only
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
ALTER TABLE completed_matches ENABLE ROW LEVEL SECURITY;
-- Szintén deny-all kliensoldalon

-- Index a 3 napos szűréshez
CREATE INDEX IF NOT EXISTS idx_completed_matches_start_time ON completed_matches(start_time);

-- 3. Per-user journal (replaces shared app_data 'journal' key)
CREATE TABLE IF NOT EXISTS journals (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  entries    JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE journals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_journal" ON journals;
CREATE POLICY "users_own_journal" ON journals FOR ALL USING (auth.uid() = user_id);

-- 4. Per-user settings
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings   JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_settings" ON user_settings;
CREATE POLICY "users_own_settings" ON user_settings FOR ALL USING (auth.uid() = user_id);

-- 5. Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan       TEXT NOT NULL DEFAULT 'pro',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_read_own_sub" ON subscriptions;
CREATE POLICY "users_read_own_sub" ON subscriptions FOR SELECT USING (auth.uid() = user_id);

-- 6. Per-user checked matches (zöld pipák)
CREATE TABLE IF NOT EXISTS user_checked_matches (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  entries    JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_checked_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_checked" ON user_checked_matches;
CREATE POLICY "users_own_checked" ON user_checked_matches FOR ALL USING (auth.uid() = user_id);

-- Realtime engedélyezése a journals és user_checked_matches táblákhoz (idempotens)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE journals;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE user_checked_matches;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
