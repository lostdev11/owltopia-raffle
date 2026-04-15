-- All-time referral stats for public leaderboard (confirmed, non-refunded only; server-side aggregate — not client-writable).

CREATE OR REPLACE VIEW public.referral_leaderboard_v1 AS
SELECT
  e.referrer_wallet AS wallet_address,
  COUNT(DISTINCT e.wallet_address)::bigint AS referred_users,
  COUNT(*)::bigint AS referred_entries
FROM public.entries e
WHERE e.referrer_wallet IS NOT NULL
  AND trim(e.referrer_wallet) <> ''
  AND e.status = 'confirmed'
  AND e.refunded_at IS NULL
GROUP BY e.referrer_wallet;

COMMENT ON VIEW public.referral_leaderboard_v1 IS
  'Referrers ranked by distinct buyers (confirmed, non-refunded entries only).';
