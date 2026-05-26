-- Owl Nesting: read-only audit for Claim-all incident (ledger vs accrual).
-- Run in Supabase SQL editor. Adjust intervals as needed.

-- 1) Wallets with multiple distinct on-chain claim txs in 24h (repeat Claim all pattern)
SELECT
  wallet_address,
  COUNT(DISTINCT transaction_signature) AS tx_count_24h,
  SUM(amount)::numeric AS owl_claimed_24h,
  MIN(created_at) AS first_claim,
  MAX(created_at) AS last_claim
FROM public.staking_reward_events
WHERE event_type = 'claim'
  AND execution_path = 'onchain_transfer'
  AND transaction_signature IS NOT NULL
  AND btrim(transaction_signature) <> ''
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY wallet_address
HAVING COUNT(DISTINCT transaction_signature) >= 2
ORDER BY owl_claimed_24h DESC;

-- 2) Per-wallet estimated claimable (active OWL nests) vs ledger totals (7d)
WITH position_math AS (
  SELECT
    p.wallet_address,
    p.id AS position_id,
    p.claimed_rewards,
    CASE p.reward_rate_unit_snapshot
      WHEN 'hourly' THEN p.amount * p.reward_rate_snapshot
        * EXTRACT(EPOCH FROM (NOW() - p.staked_at)) / 3600.0
      WHEN 'weekly' THEN p.amount * p.reward_rate_snapshot
        * EXTRACT(EPOCH FROM (NOW() - p.staked_at)) / 604800.0
      ELSE p.amount * p.reward_rate_snapshot
        * EXTRACT(EPOCH FROM (NOW() - p.staked_at)) / 86400.0
    END AS accrued_now
  FROM public.staking_positions p
  WHERE p.status = 'active'
    AND UPPER(COALESCE(p.reward_token_snapshot, '')) = 'OWL'
),
claimable AS (
  SELECT
    wallet_address,
    COUNT(*) AS active_nests,
    SUM(GREATEST(0, accrued_now - claimed_rewards))::numeric AS estimated_claimable_owl,
    SUM(CASE WHEN GREATEST(0, accrued_now - claimed_rewards) >= 1 THEN 1 ELSE 0 END) AS nests_over_1_owl
  FROM position_math
  GROUP BY wallet_address
),
ledger AS (
  SELECT
    wallet_address,
    SUM(amount)::numeric AS ledger_claim_owl_7d,
    COUNT(*) FILTER (WHERE execution_path = 'onchain_transfer') AS onchain_events_7d,
    COUNT(DISTINCT transaction_signature) FILTER (
      WHERE execution_path = 'onchain_transfer'
        AND transaction_signature IS NOT NULL
        AND created_at > NOW() - INTERVAL '24 hours'
    ) AS onchain_tx_24h
  FROM public.staking_reward_events
  WHERE event_type = 'claim'
    AND created_at > NOW() - INTERVAL '7 days'
  GROUP BY wallet_address
)
SELECT
  c.wallet_address,
  c.active_nests,
  c.estimated_claimable_owl,
  c.nests_over_1_owl,
  COALESCE(l.ledger_claim_owl_7d, 0) AS ledger_claim_owl_7d,
  COALESCE(l.onchain_tx_24h, 0) AS onchain_tx_24h
FROM claimable c
LEFT JOIN ledger l ON l.wallet_address = c.wallet_address
WHERE c.estimated_claimable_owl >= 1
  AND (
    COALESCE(l.onchain_tx_24h, 0) >= 2
    OR (c.estimated_claimable_owl >= 10 AND COALESCE(l.ledger_claim_owl_7d, 0) >= 10)
  )
ORDER BY c.estimated_claimable_owl DESC;

-- 3) Single wallet deep dive (replace wallet)
-- \set wallet 'PASTE_WALLET_HERE'
SELECT
  p.id,
  p.status,
  p.claimed_rewards,
  CASE p.reward_rate_unit_snapshot
    WHEN 'hourly' THEN p.amount * p.reward_rate_snapshot
      * EXTRACT(EPOCH FROM (NOW() - p.staked_at)) / 3600.0
    WHEN 'weekly' THEN p.amount * p.reward_rate_snapshot
      * EXTRACT(EPOCH FROM (NOW() - p.staked_at)) / 604800.0
    ELSE p.amount * p.reward_rate_snapshot
      * EXTRACT(EPOCH FROM (NOW() - p.staked_at)) / 86400.0
  END AS accrued_now,
  GREATEST(
    0,
    CASE p.reward_rate_unit_snapshot
      WHEN 'hourly' THEN p.amount * p.reward_rate_snapshot
        * EXTRACT(EPOCH FROM (NOW() - p.staked_at)) / 3600.0
      WHEN 'weekly' THEN p.amount * p.reward_rate_snapshot
        * EXTRACT(EPOCH FROM (NOW() - p.staked_at)) / 604800.0
      ELSE p.amount * p.reward_rate_snapshot
        * EXTRACT(EPOCH FROM (NOW() - p.staked_at)) / 86400.0
    END - p.claimed_rewards
  ) AS claimable_now
FROM public.staking_positions p
WHERE p.wallet_address = 'PASTE_WALLET_HERE'
  AND UPPER(COALESCE(p.reward_token_snapshot, '')) = 'OWL'
ORDER BY claimable_now DESC;

SELECT
  created_at,
  amount,
  execution_path,
  transaction_signature,
  position_id,
  note
FROM public.staking_reward_events
WHERE wallet_address = 'PASTE_WALLET_HERE'
  AND event_type = 'claim'
ORDER BY created_at DESC
LIMIT 50;
