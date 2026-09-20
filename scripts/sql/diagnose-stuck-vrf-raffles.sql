-- Diagnose stuck VRF raffles (Owltopia G2 #1351 + Breppe OG #135).
-- Production IDs observed 2026-09-20:
--   fb2b7e62-b3c3-4a2a-9681-73b892c4df15  Owltopia G2 #1351
--   3eb71da7-3352-4fe9-b877-7a204f9c3851  Breppe OG #135
--
-- Both were ready_to_draw with draw_vrf_status=failed and
-- draw_vrf_error='No eligible randomness oracle candidates were found'
-- (Switchboard commit never created draw_vrf_account).

SELECT
  r.id,
  r.title,
  r.status,
  r.end_time,
  r.winner_wallet,
  r.winner_selected_at,
  r.draw_algo,
  r.draw_sold_count,
  r.draw_ledger_hash,
  r.draw_vrf_status,
  r.draw_vrf_account,
  r.draw_vrf_request_tx,
  r.draw_vrf_fulfill_tx,
  r.draw_vrf_error,
  r.draw_vrf_requested_at,
  r.prize_deposited_at,
  EXISTS (
    SELECT 1
    FROM raffle_draw_secrets s
    WHERE s.raffle_id = r.id
      AND s.seed_hex LIKE 'sbkp:%'
  ) AS has_vrf_account_secret
FROM raffles r
WHERE r.id IN (
    'fb2b7e62-b3c3-4a2a-9681-73b892c4df15',
    '3eb71da7-3352-4fe9-b877-7a204f9c3851'
  )
   OR r.title ILIKE '%Owltopia G2 #1351%'
   OR r.title ILIKE '%Breppe OG #135%'
ORDER BY r.end_time ASC NULLS LAST;
