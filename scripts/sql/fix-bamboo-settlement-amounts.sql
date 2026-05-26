-- Repair settlement amounts for BAMBOO raffles drawn before revenueInCurrency was used at draw time.
-- Run per raffle after verifying gross from confirmed entries matches expectations.
--
-- Example: "The Pandarianz G1 Mint token" (1a9da111-ff68-47af-8e8d-94eb28614861)
--   712 BAMBOO gross, fee_bps_applied = 200 → platform 14.24, creator 697.76

-- Preview gross + proposed amounts for affected raffles:
SELECT
  r.id,
  r.title,
  r.currency,
  r.fee_bps_applied,
  r.creator_payout_amount,
  r.platform_fee_amount,
  COALESCE(SUM(e.amount_paid) FILTER (WHERE e.status = 'confirmed' AND UPPER(e.currency) = UPPER(r.currency)), 0) AS gross,
  ROUND(
    COALESCE(SUM(e.amount_paid) FILTER (WHERE e.status = 'confirmed' AND UPPER(e.currency) = UPPER(r.currency)), 0)
    * COALESCE(r.fee_bps_applied, 0) / 10000.0,
    6
  ) AS platform_fee_fix,
  ROUND(
    COALESCE(SUM(e.amount_paid) FILTER (WHERE e.status = 'confirmed' AND UPPER(e.currency) = UPPER(r.currency)), 0)
    * (1 - COALESCE(r.fee_bps_applied, 0) / 10000.0),
    6
  ) AS creator_payout_fix
FROM raffles r
LEFT JOIN entries e ON e.raffle_id = r.id
WHERE UPPER(r.currency) = 'BAMBOO'
  AND r.winner_wallet IS NOT NULL
  AND COALESCE(r.creator_payout_amount, 0) = 0
  AND COALESCE(r.platform_fee_amount, 0) = 0
GROUP BY r.id, r.title, r.currency, r.fee_bps_applied, r.creator_payout_amount, r.platform_fee_amount
HAVING COALESCE(SUM(e.amount_paid) FILTER (WHERE e.status = 'confirmed' AND UPPER(e.currency) = UPPER(r.currency)), 0) > 0;

-- Apply fix for Pandarianz G1 Mint token raffle:
UPDATE raffles
SET
  platform_fee_amount = 14.24,
  creator_payout_amount = 697.76
WHERE id = '1a9da111-ff68-47af-8e8d-94eb28614861'
  AND UPPER(currency) = 'BAMBOO'
  AND COALESCE(creator_payout_amount, 0) = 0
  AND COALESCE(platform_fee_amount, 0) = 0
  AND creator_claimed_at IS NULL;
