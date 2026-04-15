-- Referral codes: one active code per wallet; retired codes are never reused.
-- Attribution on ticket purchases (entries.referrer_wallet, entries.referral_code_used).

CREATE TABLE IF NOT EXISTS referral_retired_codes (
  code TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  retired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_retired_wallet ON referral_retired_codes(wallet_address);

CREATE TABLE IF NOT EXISTS wallet_referrals (
  wallet_address TEXT PRIMARY KEY,
  active_code TEXT NOT NULL,
  code_kind TEXT NOT NULL CHECK (code_kind IN ('random', 'vanity')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallet_referrals_active_code_unique UNIQUE (active_code)
);

CREATE INDEX IF NOT EXISTS idx_wallet_referrals_active_code ON wallet_referrals(active_code);

ALTER TABLE wallet_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_retired_codes ENABLE ROW LEVEL SECURITY;

-- Writes use service role; no public policies (deny by default for anon/authenticated).

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS referrer_wallet TEXT NULL,
  ADD COLUMN IF NOT EXISTS referral_code_used TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_entries_referrer_wallet ON entries(referrer_wallet)
  WHERE referrer_wallet IS NOT NULL;
