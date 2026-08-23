-- Per-wallet win and participation streaks. Writes via API (service role); RLS deny-all for clients.
-- Historical win streaks are backfilled lazily on first dashboard read (see lib/db/wallet-streaks.ts).

CREATE TABLE IF NOT EXISTS wallet_streaks (
  wallet_address TEXT PRIMARY KEY,
  win_current_streak INTEGER NOT NULL DEFAULT 0 CHECK (win_current_streak >= 0),
  win_best_streak INTEGER NOT NULL DEFAULT 0 CHECK (win_best_streak >= 0),
  win_total_wins INTEGER NOT NULL DEFAULT 0 CHECK (win_total_wins >= 0),
  last_win_at TIMESTAMPTZ,
  participation_current_streak INTEGER NOT NULL DEFAULT 0 CHECK (participation_current_streak >= 0),
  participation_best_streak INTEGER NOT NULL DEFAULT 0 CHECK (participation_best_streak >= 0),
  last_participation_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_streaks_win_current ON wallet_streaks (win_current_streak DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_streaks_participation_current ON wallet_streaks (participation_current_streak DESC);

ALTER TABLE wallet_streaks ENABLE ROW LEVEL SECURITY;

-- Idempotency: one row per draw event so retries do not double-apply win streak updates.
CREATE TABLE IF NOT EXISTS wallet_streak_draw_events (
  draw_key TEXT PRIMARY KEY,
  winner_wallet TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wallet_streak_draw_events ENABLE ROW LEVEL SECURITY;
