-- Gen Owl rev-share: why is the pool short?
-- Run in Supabase SQL editor. Compare books (periods − paid claims) to verified deposits.
-- Healthy system: sum(verified SOL deposits) ≈ sum(period SOL totals)
--                 and on-chain pool SOL ≈ sum(unclaimed SOL) + tiny fee buffer.
-- A hole means period totals were credited without matching pool inflows,
-- and/or SOL left the pool outside recorded claim payouts.

-- 1) Period books: deposited vs paid vs unclaimed SOL
WITH paid AS (
  SELECT
    period_month,
    COALESCE(SUM(CASE
      WHEN amount_sol > 0 AND sol_transaction_signature IS NOT NULL
           AND btrim(sol_transaction_signature) <> ''
      THEN amount_sol ELSE 0 END), 0) AS paid_sol,
    COALESCE(SUM(CASE
      WHEN amount_usdc > 0 AND usdc_transaction_signature IS NOT NULL
           AND btrim(usdc_transaction_signature) <> ''
      THEN amount_usdc ELSE 0 END), 0) AS paid_usdc,
    COUNT(*) FILTER (
      WHERE (
        (amount_sol <= 0 OR (sol_transaction_signature IS NOT NULL AND btrim(sol_transaction_signature) <> ''))
        AND (amount_usdc <= 0 OR (usdc_transaction_signature IS NOT NULL AND btrim(usdc_transaction_signature) <> ''))
        AND (amount_sol > 0 OR amount_usdc > 0)
      )
    ) AS fully_paid_claims
  FROM public.gen_owl_rev_share_claims
  GROUP BY period_month
)
SELECT
  p.period_month,
  COALESCE(p.gen1_total_sol, 0) + COALESCE(p.gen2_total_sol, 0) AS deposited_sol,
  COALESCE(paid.paid_sol, 0) AS paid_sol,
  GREATEST(
    0,
    COALESCE(p.gen1_total_sol, 0) + COALESCE(p.gen2_total_sol, 0) - COALESCE(paid.paid_sol, 0)
  ) AS unclaimed_sol,
  COALESCE(p.gen1_eligible_count, 0) + COALESCE(p.gen2_eligible_count, 0) AS eligible_nests,
  COALESCE(paid.fully_paid_claims, 0) AS claimed_nests,
  p.finalized_at
FROM public.gen_owl_rev_share_periods p
LEFT JOIN paid ON paid.period_month = p.period_month
ORDER BY p.period_month;

-- 2) Verified deposit ledger (what actually hit the pool per signature)
SELECT
  period_month,
  currency,
  amount,
  gen1_amount,
  gen2_amount,
  transaction_signature,
  depositor_wallet,
  created_at
FROM public.gen_owl_rev_share_deposits
ORDER BY created_at;

-- 3) Period totals vs sum of verified deposits (over-credit detector)
WITH dep AS (
  SELECT
    period_month,
    COALESCE(SUM(amount) FILTER (WHERE currency = 'SOL'), 0) AS deposit_sol,
    COALESCE(SUM(amount) FILTER (WHERE currency = 'USDC'), 0) AS deposit_usdc
  FROM public.gen_owl_rev_share_deposits
  GROUP BY period_month
)
SELECT
  p.period_month,
  COALESCE(p.gen1_total_sol, 0) + COALESCE(p.gen2_total_sol, 0) AS period_sol,
  COALESCE(dep.deposit_sol, 0) AS verified_deposit_sol,
  (COALESCE(p.gen1_total_sol, 0) + COALESCE(p.gen2_total_sol, 0))
    - COALESCE(dep.deposit_sol, 0) AS period_minus_deposits_sol,
  COALESCE(p.gen1_total_usdc, 0) + COALESCE(p.gen2_total_usdc, 0) AS period_usdc,
  COALESCE(dep.deposit_usdc, 0) AS verified_deposit_usdc,
  (COALESCE(p.gen1_total_usdc, 0) + COALESCE(p.gen2_total_usdc, 0))
    - COALESCE(dep.deposit_usdc, 0) AS period_minus_deposits_usdc
FROM public.gen_owl_rev_share_periods p
LEFT JOIN dep ON dep.period_month = p.period_month
ORDER BY p.period_month;

-- 4) If period_minus_deposits_sol > 0: those SOL were credited on the books
--    without a matching row in gen_owl_rev_share_deposits (classic pre-pool
--    homepage Save path, or a manual period edit). That is the shortfall source.
-- 5) On Solscan: open the rev-share pool wallet and confirm
--    inflows ≈ verified deposits, outflows ≈ sum(paid claim SOL sigs).
