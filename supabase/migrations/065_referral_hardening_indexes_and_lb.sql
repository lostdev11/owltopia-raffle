-- Referral hardening: indexes for 24h velocity checks + leaderboard excludes dust purchases.
-- Minimum amounts here must stay in sync with defaults in lib/referrals/hardening.ts (or adjust both).

CREATE INDEX IF NOT EXISTS idx_entries_buyer_referrer_created
  ON public.entries (wallet_address, created_at DESC)
  WHERE referrer_wallet IS NOT NULL AND status IN ('pending', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_entries_referrer_created
  ON public.entries (referrer_wallet, created_at DESC)
  WHERE referrer_wallet IS NOT NULL AND status IN ('pending', 'confirmed');

DROP VIEW IF EXISTS public.referral_leaderboard_v1;

CREATE VIEW public.referral_leaderboard_v1 AS
SELECT
  e.referrer_wallet AS wallet_address,
  COUNT(DISTINCT e.wallet_address)::bigint AS referred_users,
  COUNT(*)::bigint AS referred_entries
FROM public.entries e
WHERE e.referrer_wallet IS NOT NULL
  AND trim(e.referrer_wallet) <> ''
  AND e.status = 'confirmed'
  AND e.refunded_at IS NULL
  AND (
    (e.currency = 'SOL' AND e.amount_paid >= 0.02::numeric)
    OR (e.currency = 'USDC' AND e.amount_paid >= 1::numeric)
    OR (e.currency = 'OWL' AND e.amount_paid >= 10::numeric)
  )
GROUP BY e.referrer_wallet;

COMMENT ON VIEW public.referral_leaderboard_v1 IS
  'Referrers by distinct buyers; confirmed, non-refunded, min purchase per currency (anti-dust).';
